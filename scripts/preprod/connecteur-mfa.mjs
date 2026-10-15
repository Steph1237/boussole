// Parcours de bout en bout de l'autorisation du connecteur liée au second facteur (migration 0033, SEC2 bis), sur la préproduction locale :
// vrai GoTrue (serveur OAuth 2.1, TOTP), vraie PostgREST, vraie fonction mcp servie localement. Comme la page de consentement (consent.js) :
// getAuthorizationDetails, puis autoriser_connecteur avec la session aal2, puis approveAuthorization ; échange du code avec PKCE ; appels du
// connecteur avec le jeton OAuth obtenu. Une ligne par étape, « ok » ou la cause. Comptes et données fictifs, jamais la production.
//   node scripts/preprod/connecteur-mfa.mjs        npm run preprod:connecteur   (pile démarrée : npm run preprod:start)
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { garde, assertLocal } from "./garde.mjs";
import { compteNeuf, clientsLocaux } from "./graine.mjs";
import { clientMcp } from "./mcp-client.mjs";
import { demarrerFonctions } from "./fonctions.mjs";

const SANS_SESSION = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const b64u = b => Buffer.from(b).toString("base64url");
const claims = jwt => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
const verite = (cond, msg) => { if (!cond) throw new Error(msg); };
const MFA = /Double authentification requise/;
const REDIRECTION = "http://127.0.0.1:9/callback";

/** Client supabase-js portant un jeton (session de navigateur ou jeton OAuth). */
const avecJeton = (clients, jeton) => createClient(clients.url, clients.publiable, { ...SANS_SESSION, global: { headers: { Authorization: `Bearer ${jeton}` } } });

/** Session de navigateur (comme la page de consentement) : client supabase-js avec la session donnée. */
async function navigateur(clients, session) {
  const sb = createClient(clients.url, clients.publiable, SANS_SESSION);
  const r = await sb.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  verite(!r.error, `session : ${r.error?.message}`);
  return sb;
}

/** Parcours OAuth complet pour `client`, approuvé par la session `sb` ; `autoriser` : appelle autoriser_connecteur avant d'approuver
    (consent.js avec un facteur vérifié). Renvoie { jeton, rafraichissement, revendications, autorisation: { data, error } | null, deja }. */
async function parcoursOauth(clients, client, sb, { autoriser }) {
  const d = await demander(clients, client, sb);
  let autorisation = null;
  if (autoriser) autorisation = await sb.rpc("autoriser_connecteur", { p_autorisation_id: d.authorizationId });
  return { ...(await approuverEtEchanger(clients, client, sb, d)), autorisation, deja: d.deja };
}

/** Demande d'autorisation (PKCE) puis getAuthorizationDetails par la session `sb` → { authorizationId, deja, det, verifier }. */
async function demander(clients, client, sb) {
  const auth = `${clients.url}/auth/v1`;
  const verifier = b64u(randomBytes(32)), challenge = b64u(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: REDIRECTION, scope: "openid email", state: "etat", code_challenge: challenge, code_challenge_method: "S256" });
  const a = await fetch(`${auth}/oauth/authorize?${q}`, { redirect: "manual" });
  const lieu = a.headers.get("location") ?? "";
  verite(lieu.includes("/oauth/consent.html?authorization_id="), `authorize : ${a.status} ${lieu.slice(0, 80)}`);
  const authorizationId = new URL(lieu).searchParams.get("authorization_id");
  const det = await sb.auth.oauth.getAuthorizationDetails(authorizationId);
  verite(!det.error, `getAuthorizationDetails : ${det.error?.message}`);
  const deja = !("authorization_id" in (det.data ?? {}));
  return { authorizationId, deja, det, verifier };
}

/** Approbation (sauf consentement mémorisé) et échange du code → { jeton, rafraichissement, revendications }. */
async function approuverEtEchanger(clients, client, sb, { authorizationId, deja, det, verifier }) {
  const auth = `${clients.url}/auth/v1`;
  let retour;
  if (deja) retour = det.data.redirect_url ?? det.data.redirect_to;
  else {
    const ap = await sb.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    verite(!ap.error, `approveAuthorization : ${ap.error?.message}`);
    retour = ap.data.redirect_url ?? ap.data.redirect_to;
  }
  const code = new URL(retour).searchParams.get("code");
  verite(code, "pas de code d'autorisation");
  const tk = await fetch(`${auth}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECTION, client_id: client, code_verifier: verifier }) });
  const j = await tk.json();
  verite(tk.ok && j.access_token, `échange du code : ${tk.status} ${JSON.stringify(j).slice(0, 120)}`);
  return { jeton: j.access_token, rafraichissement: j.refresh_token, revendications: claims(j.access_token) };
}

async function rafraichir(clients, client, refresh) {
  const r = await fetch(`${clients.url}/auth/v1/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: client }) });
  const j = await r.json();
  verite(r.ok && j.access_token, `rafraîchissement : ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  return j;
}

/** Lecture du connecteur : get_overview, lire_banque. → { overview, banque } (résultats clientMcp). */
async function lireParConnecteur(mcpUrl, jeton) {
  const m = clientMcp(mcpUrl, jeton);
  const init = await m.initialiser();
  verite(init.json?.result?.serverInfo, `initialize : ${init.status}`);
  return { overview: await m.appeler("get_overview"), banque: await m.appeler("lire_banque"), session: await m.appeler("demarrer_session"), m };
}

export async function connecteurMfa({ clients = clientsLocaux(), mcpUrl, journal = console.log } = {}) {
  garde();
  mcpUrl = assertLocal(mcpUrl ?? `${clients.url}/functions/v1/mcp`);
  const lignes = [];
  let echecs = 0;
  const etape = async (nom, f) => {
    try { const t = await f(); lignes.push(`ok      ${nom}${t ? " : " + t : ""}`); }
    catch (e) { echecs++; lignes.push(`ÉCHEC   ${nom} : ${e.message}`); }
    journal(lignes[lignes.length - 1]);
  };

  const reg = await fetch(`${clients.url}/auth/v1/oauth/clients/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude (préproduction)", redirect_uris: [REDIRECTION], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
  const client = (await reg.json()).client_id;
  verite(client, "enregistrement dynamique du client OAuth");
  const compte = await compteNeuf("proprietaire-credit", { jeton: "aal2", clients }); // facteur TOTP vérifié, banque connectée (fictive)
  const ctx = {};
  try {
    verite(compte.aal === "aal2", `session du compte : ${compte.aal}`);
    const sessionAal2 = { access_token: compte.accessToken, refresh_token: compte.refreshToken };
    // l'attaquant n'a que le mot de passe : session aal1 du même compte
    const mdp = clients.anon();
    const s1 = await mdp.auth.signInWithPassword(compte.identifiants());
    verite(!s1.error && claims(s1.data.session.access_token).aal === "aal1", "session aal1 (mot de passe seul)");
    const sessionAal1 = s1.data.session;

    await etape("1. mot de passe seul (aal1) : autoriser_connecteur refusé, le jeton OAuth obtenu par approveAuthorization ne lit rien", async () => {
      const sb = await navigateur(clients, sessionAal1);
      const p = await parcoursOauth(clients, client, sb, { autoriser: true });
      verite(p.autorisation?.error && /Double authentification requise/.test(p.autorisation.error.message), `autoriser_connecteur en aal1 : ${JSON.stringify(p.autorisation)}`);
      verite(p.revendications.aal === "aal1" && p.revendications.client_id === client && p.revendications.session_id, `revendications : ${JSON.stringify(p.revendications).slice(0, 200)}`);
      const r = await lireParConnecteur(mcpUrl, p.jeton);
      verite(r.overview.erreur && MFA.test(r.overview.texte), `get_overview : ${r.overview.texte.slice(0, 100)}`);
      verite(r.banque.erreur && MFA.test(r.banque.texte), "lire_banque doit être refusé");
      const pos = await avecJeton(clients, p.jeton).from("positions").select("id");
      verite(!pos.error && pos.data.length === 0, "PostgREST : positions lisibles sans autorisation");
      ctx.claimsKeys = Object.keys(p.revendications).sort().join(", ");
      return `jeton aal1, revendications ${ctx.claimsKeys} ; refus « ${p.autorisation.error.message.slice(0, 60)}… »`;
    });

    await etape("2. code validé (aal2) : autoriser_connecteur, approbation, échange → le connecteur lit tout, banque comprise", async () => {
      const sb = await navigateur(clients, sessionAal2);
      const p = await parcoursOauth(clients, client, sb, { autoriser: true });
      verite(!p.autorisation.error, `autoriser_connecteur : ${p.autorisation.error?.message}`);
      const jours = Math.round((new Date(p.autorisation.data.expire_le) - new Date(p.autorisation.data.accorde_le)) / 864e5);
      verite(jours === 90 && p.autorisation.data.client_id === client && p.autorisation.data.client_nom === "Claude (préproduction)", `autorisation : ${JSON.stringify(p.autorisation.data)}`);
      verite(p.revendications.aal === "aal1", `le jeton OAuth reste aal1 (constat SEC5) : ${p.revendications.aal}`);
      const r = await lireParConnecteur(mcpUrl, p.jeton);
      verite(!r.overview.erreur, `get_overview : ${r.overview.texte.slice(0, 160)}`);
      verite(!r.banque.erreur, `lire_banque : ${r.banque.texte.slice(0, 160)}`);
      verite(!r.session.erreur && r.session.donnees?.banque && !r.session.donnees.banque.mfa_requise, `demarrer_session.banque : ${JSON.stringify(r.session.donnees?.banque ?? null).slice(0, 120)}`);
      const u = avecJeton(clients, p.jeton);
      const pos = await u.from("positions").select("id", { count: "exact" });
      const cpt = await u.from("banque_comptes").select("id, ignore");
      verite(pos.count === 7 && cpt.data?.length > 0, `PostgREST : positions ${pos.count}/7, comptes ${cpt.data?.length}`);
      // jamais d'écriture bancaire par le connecteur (rattachement d'un compte : app en aal2 seulement)
      const maj = await u.from("banque_comptes").update({ ignore: true }).eq("id", cpt.data[0].id).select();
      verite(maj.error && /row-level security/i.test(maj.error.message), `écriture bancaire par le jeton OAuth : ${JSON.stringify(maj).slice(0, 160)}`);
      const g = (await clients.admin.from("connecteurs_autorises").select("session_id, lie_le, accorde_aal, revoque_le").eq("user_id", compte.uid).is("revoque_le", null)).data;
      verite(g.length === 1 && g[0].session_id === p.revendications.session_id && g[0].accorde_aal === "aal2", `liaison : ${JSON.stringify(g)}`);
      const n = (await clients.admin.from("connexions_assistant").select("client_id").eq("user_id", compte.uid)).data ?? [];
      Object.assign(ctx, { legitime: p });
      return `90 jours, liée à la session ${p.revendications.session_id.slice(0, 8)}…, get_overview + lire_banque + demarrer_session ok, 7 positions, écriture bancaire refusée par la RLS${n.some(x => x.client_id === client) ? ", connexion notée" : ""}`;
    });

    await etape("3. rafraîchissement du jeton OAuth : même session, toujours autorisé", async () => {
      const j = await rafraichir(clients, client, ctx.legitime.rafraichissement);
      verite(claims(j.access_token).session_id === ctx.legitime.revendications.session_id, "session_id changée au rafraîchissement");
      const r = await lireParConnecteur(mcpUrl, j.access_token);
      verite(!r.overview.erreur, `get_overview après rafraîchissement : ${r.overview.texte.slice(0, 120)}`);
      ctx.legitime.jeton = j.access_token; ctx.legitime.rafraichissement = j.refresh_token;
      return "ok";
    });

    await etape("4. mot de passe volé APRÈS l'autorisation : nouvelle session OAuth du même client (consentement mémorisé) → refusée", async () => {
      const sb = await navigateur(clients, sessionAal1);
      const p = await parcoursOauth(clients, client, sb, { autoriser: false });
      verite(p.revendications.client_id === client && p.revendications.session_id !== ctx.legitime.revendications.session_id, "nouvelle session attendue");
      const r = await lireParConnecteur(mcpUrl, p.jeton);
      verite(r.overview.erreur && MFA.test(r.overview.texte), `get_overview de l'attaquant : ${r.overview.texte.slice(0, 120)}`);
      const pos = await avecJeton(clients, p.jeton).from("positions").select("id");
      verite(pos.data?.length === 0, "PostgREST : l'attaquant lit des positions");
      const r2 = await lireParConnecteur(mcpUrl, ctx.legitime.jeton);
      verite(!r2.overview.erreur, "la session légitime doit continuer");
      return `consentement déjà mémorisé : ${p.deja ? "oui" : "non"} ; jeton de l'attaquant refusé (autre session), session légitime intacte`;
    });

    await etape("5. retrait dans Compte › Connexion (revoquer_connecteur) : plus rien de lisible tout de suite", async () => {
      const sb = await navigateur(clients, sessionAal2);
      const l = await sb.from("connecteurs_autorises").select("id, client_id, client_nom, accorde_le, expire_le, lie_le, dernier_usage, revoque_le");
      verite(!l.error && l.data.length >= 1, `liste dans Compte : ${l.error?.message ?? l.data.length}`);
      const cache = await sb.from("connecteurs_autorises").select("session_id");
      verite(cache.error, "session_id ne doit pas être lisible par le propriétaire");
      const rv = await sb.rpc("revoquer_connecteur", { p_client_id: client });
      verite(!rv.error && rv.data === 1, `revoquer_connecteur : ${JSON.stringify(rv)}`);
      const r = await lireParConnecteur(mcpUrl, ctx.legitime.jeton);
      verite(r.overview.erreur && MFA.test(r.overview.texte), "après retrait, le connecteur doit être refusé");
      return "liste lue (sans session_id), retrait immédiat";
    });

    await etape("6. nouvelle autorisation avec le code : le nouveau jeton lit, l'ancien reste refusé", async () => {
      const sb = await navigateur(clients, sessionAal2);
      const p = await parcoursOauth(clients, client, sb, { autoriser: true });
      verite(!p.autorisation.error, `autoriser_connecteur : ${p.autorisation.error?.message}`);
      const r = await lireParConnecteur(mcpUrl, p.jeton);
      verite(!r.overview.erreur, `nouveau jeton : ${r.overview.texte.slice(0, 120)}`);
      const r0 = await lireParConnecteur(mcpUrl, ctx.legitime.jeton);
      verite(r0.overview.erreur, "l'ancien jeton doit rester refusé");
      ctx.nouveau = p;
      return `consentement mémorisé : ${p.deja ? "oui (autorisation créée avant la redirection, comme consent.js)" : "non"}`;
    });

    await etape("7. expiration (90 jours simulés par la clé de service locale) : message « a expiré »", async () => {
      const e = await clients.admin.from("connecteurs_autorises").update({ accorde_le: new Date(Date.now() - 91 * 864e5).toISOString(), expire_le: new Date(Date.now() - 1000).toISOString() })
        .eq("user_id", compte.uid).is("revoque_le", null).select("id");
      verite(!e.error && e.data.length === 1, `mise à jour (service_role, droits de 0033) : ${e.error?.message}`);
      const r = await lireParConnecteur(mcpUrl, ctx.nouveau.jeton);
      verite(r.overview.erreur && /a expiré \(elle vaut 90 jours\)/.test(r.overview.texte), `get_overview : ${r.overview.texte.slice(0, 160)}`);
      const pos = await avecJeton(clients, ctx.nouveau.jeton).from("positions").select("id");
      verite(pos.data?.length === 0, "PostgREST : lisible après expiration");
      return "ok";
    });

    await etape("8. course : l'attaquant (aal1) échange son code ENTRE l'autorisation et l'échange légitime → rien n'est lié, personne ne lit", async () => {
      const victime = await navigateur(clients, sessionAal2), intrus = await navigateur(clients, sessionAal1);
      const d = await demander(clients, client, victime);
      const g = await victime.rpc("autoriser_connecteur", { p_autorisation_id: d.authorizationId });
      verite(!g.error, `autoriser_connecteur : ${g.error?.message}`);
      const a = await approuverEtEchanger(clients, client, intrus, await demander(clients, client, intrus));
      const ra = await lireParConnecteur(mcpUrl, a.jeton);
      verite(ra.overview.erreur && MFA.test(ra.overview.texte), "l'attaquant ne doit rien lire avant l'échange légitime");
      const v = await approuverEtEchanger(clients, client, victime, d);
      const rv = await lireParConnecteur(mcpUrl, v.jeton), ra2 = await lireParConnecteur(mcpUrl, a.jeton);
      verite(rv.overview.erreur && ra2.overview.erreur, "deux sessions depuis l'autorisation : aucune ne doit être liée");
      const l = (await clients.admin.from("connecteurs_autorises").select("session_id").eq("user_id", compte.uid).is("revoque_le", null)).data;
      verite(l.length === 1 && l[0].session_id === null, `autorisation liée par erreur : ${JSON.stringify(l)}`);
      return "en_attente puis ambigu : la victime reconnecte, l'attaquant n'a rien lu";
    });
  } finally {
    await compte.supprimer();
  }
  return { echecs, lignes, revendications: ctx.claimsKeys };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const clients = clientsLocaux();
    const fonctions = await demarrerFonctions(clients.url);
    try {
      const r = await connecteurMfa({ clients });
      console.log(r.echecs ? `\n${r.echecs} échec(s)` : "\nautorisation du connecteur liée au second facteur : tout est conforme");
      process.exitCode = r.echecs ? 1 : 0;
    } finally { await fonctions.arreter(); }
  })().catch(e => { console.error(e.message); process.exit(1); });
}
