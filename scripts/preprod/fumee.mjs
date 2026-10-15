// Parcours de fumée de la préproduction locale (SEC5, spec § 3.6) : une ligne par parcours, « ok » ou la cause.
//   1. RLS entre deux comptes, inscription par mot de passe
//   2. double authentification : aal1 / aal2, connecteur, et la question ouverte de SEC2 (mfa.enroll à aal1 avec un facteur vérifié)
//   3. OAuth 2.1 : enregistrement dynamique, PKCE, approbation, échange du code, claim client_id, appel du connecteur
//   3 bis. connecteur et second facteur (0033) : scripts/preprod/connecteur-mfa.mjs
//   4. connecteur : initialize, tools/list, demarrer_session, proposition puis appliquer_propositions
//   5. nuit locale (preprod.lancer_nuit) avec cours figés, sans appel externe
//   node scripts/preprod/fumee.mjs         npm run preprod:fumee
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { garde, assertLocal, RACINE } from "./garde.mjs";
import { compteNeuf, clientsLocaux, motDePasse, verifierFacteur } from "./graine.mjs";
import { clientMcp } from "./mcp-client.mjs";
import { demarrerFonctions } from "./fonctions.mjs";
import { demarrerServeur } from "./servir.mjs";
import { supabase } from "./cli.mjs";
import { reessayer } from "./charger-foyer.mjs";
import { connecteurMfa } from "./connecteur-mfa.mjs";

const SANS_SESSION = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const attendre = ms => new Promise(r => setTimeout(r, ms));
const verite = (cond, msg) => { if (!cond) throw new Error(msg); };
const b64u = b => Buffer.from(b).toString("base64url");
const claims = jwt => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));

/** Client supabase-js portant le jeton d'un utilisateur. */
const clientUtilisateur = (clients, jeton) => createClient(clients.url, clients.publiable, { ...SANS_SESSION, global: { headers: { Authorization: `Bearer ${jeton}` } } });

// ------------------------------------------------------------------------------------------------------------------ 1. RLS
async function parcoursRls(ctx) {
  const { clients } = ctx;
  // inscription par mot de passe (confirmation désactivée), connexion, lecture de son bilan
  const email = `fumee-${randomBytes(4).toString("hex")}@preprod.boussole.test`, password = motDePasse();
  const insc = await reessayer(() => clients.anon().auth.signUp({ email, password }));
  verite(!insc.error && insc.data.session, `inscription : ${insc.error?.message ?? "pas de session"}`);
  const uidInscrit = insc.data.user.id;
  try {
    const u = clientUtilisateur(clients, insc.data.session.access_token);
    const prof = await u.from("profiles").select("user_id").eq("user_id", uidInscrit);
    verite(!prof.error && prof.data.length === 1, "le profil n'a pas été créé à l'inscription (déclencheur handle_new_user)");
    const exp = await u.rpc("export_all");
    verite(!exp.error && exp.data && typeof exp.data === "object", `export_all : ${exp.error?.message}`);
  } finally { await clients.admin.auth.admin.deleteUser(uidInscrit).catch(() => {}); }

  const A = await compteNeuf("couple-enfants", { clients }), B = await compteNeuf("jeune-actif", { clients });
  try {
    const a = clientUtilisateur(clients, A.accessToken), b = clientUtilisateur(clients, B.accessToken);
    const lecA = await a.from("positions").select("id", { count: "exact" });
    const lecB = await b.from("positions").select("id", { count: "exact" });
    verite(lecA.count === 9 && lecB.count === 4, `bilans lus : A ${lecA.count}/9, B ${lecB.count}/4`);
    const croise = await b.from("positions").select("id").eq("user_id", A.uid);
    verite(!croise.error && croise.data.length === 0, "B lit les positions de A");
    const maj = await b.from("positions").update({ name: "piraté" }).eq("user_id", A.uid).select();
    verite(!maj.error && maj.data.length === 0, "B modifie les positions de A");
    const ins = await b.from("positions").insert({ user_id: A.uid, name: "intrus", mode: "manual", value: 1 });
    verite(!!ins.error, "B insère une position au nom de A");
    const cfg = await b.from("config").select("user_id").eq("user_id", A.uid);
    verite(cfg.data.length === 0, "B lit la config de A");
    const sans = await clients.anon().from("positions").select("id");
    verite(sans.error || sans.data.length === 0, "lecture sans session");
    const verif = await clients.admin.from("positions").select("name").eq("user_id", A.uid).eq("name", "piraté");
    verite(verif.data.length === 0, "une position de A a été modifiée");
  } finally { await A.supprimer(); await B.supprimer(); }
  return "inscription, profil créé, export_all, lectures et écritures croisées refusées (9 et 4 positions)";
}

// ------------------------------------------------------------------------------------------------------------------ 2. MFA
async function parcoursMfa(ctx) {
  const { clients, mcpUrl } = ctx;
  const aal2 = await compteNeuf("proprietaire-credit", { jeton: "aal2", clients });
  const aal1 = await compteNeuf("proprietaire-credit", { jeton: "aal1", clients });
  const notes = [];
  try {
    verite(aal2.aal === "aal2" && aal1.aal === "aal1", `niveaux : ${aal2.aal} / ${aal1.aal}`);
    // base : les tables personnelles sont vides en aal1 (RLS 0028), pleines en aal2
    const p2 = await clientUtilisateur(clients, aal2.accessToken).from("positions").select("id", { count: "exact" });
    const p1 = await clientUtilisateur(clients, aal1.accessToken).from("positions").select("id", { count: "exact" });
    verite(p2.count === 7 && p1.count === 0, `positions aal2=${p2.count} (7 attendues), aal1=${p1.count} (0 attendue)`);
    // connecteur : refus en aal1 avec le message, savoir commun disponible, données en aal2
    const m1 = clientMcp(mcpUrl, aal1.accessToken), m2 = clientMcp(mcpUrl, aal2.accessToken);
    await m1.initialiser(); await m2.initialiser();
    const r1 = await m1.appeler("get_overview");
    verite(r1.erreur && /Double authentification requise/.test(r1.texte), `get_overview en aal1 : ${r1.texte.slice(0, 120)}`);
    const s1 = await m1.appeler("demarrer_session");
    verite(s1.erreur && /Double authentification requise/.test(s1.texte), "demarrer_session en aal1 doit être refusé");
    const savoir = await m1.appeler("reperes", {});
    verite(!savoir.erreur, `reperes (savoir commun) en aal1 : ${savoir.texte.slice(0, 120)}`);
    const r2 = await m2.appeler("get_overview");
    verite(!r2.erreur, `get_overview en aal2 : ${r2.texte.slice(0, 120)}`);
    const b2 = await m2.appeler("lire_banque");
    verite(!b2.erreur, `lire_banque en aal2 : ${b2.texte.slice(0, 120)}`);
    const b1 = await m1.appeler("lire_banque");
    verite(b1.erreur && /Double authentification requise/.test(b1.texte), "lire_banque en aal1 doit être refusé");
    notes.push("RLS aal1 vide / aal2 pleine, connecteur refuse en aal1 (message), savoir commun ouvert, banque en aal2");

    // --- question ouverte de SEC2 : mfa.enroll avec un jeton aal1 quand un facteur est déjà vérifié ---
    const c = clients.anon();
    const s = await c.auth.signInWithPassword(aal1.identifiants());
    verite(!s.error, `reconnexion aal1 : ${s.error?.message}`);
    const enr = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: "intrus" });
    if (enr.error) {
      ctx.sec2 = { enroll_aal1_avec_facteur_verifie: "REFUSÉ", code: enr.error.code ?? null, statut: enr.error.status ?? null, message: enr.error.message };
    } else {
      ctx.sec2 = { enroll_aal1_avec_facteur_verifie: "ACCEPTÉ", facteur: enr.data.id };
      // chaîne d'attaque : un mot de passe volé suffit-il à atteindre aal2 avec un facteur que l'attaquant maîtrise ?
      try {
        const sess = await verifierFacteur(c, enr.data.id, enr.data.totp.secret || enr.data.totp.uri.match(/secret=([A-Z2-7]+)/)[1]);
        const tok = sess?.session?.access_token ?? (await c.auth.getSession()).data.session?.access_token;
        ctx.sec2.aal_apres_verify_du_nouveau_facteur = tok ? claims(tok).aal : null;
      } catch (e) { ctx.sec2.verify_du_nouveau_facteur = `refusé : ${e.message}`; }
      await clients.admin.auth.admin.mfa.deleteFactor({ id: enr.data.id, userId: aal1.uid }).catch(() => {});
    }
  } finally { await aal2.supprimer(); await aal1.supprimer(); }
  return notes.join(" ; ");
}

// ------------------------------------------------------------------------------------------------------------------ 3. OAuth
async function parcoursOauth(ctx) {
  const { clients, mcpUrl } = ctx;
  const auth = `${clients.url}/auth/v1`;
  const redirect = "http://127.0.0.1:9/callback";
  // 1. client public déclaré par l'administrateur (registration_type manual) : seul un tel client reçoit une autorisation liée au
  //    second facteur (0033 ; un client inscrit dynamiquement est refusé, voir connecteur-mfa.mjs). L'enregistrement dynamique reste testé.
  const reg = await fetch(`${auth}/oauth/clients/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Client dynamique de fumée", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
  const dyn = await reg.json();
  verite(reg.status < 300 && dyn.client_id, `enregistrement dynamique : ${reg.status} ${JSON.stringify(dyn).slice(0, 160)}`);
  await clients.admin.auth.admin.oauth.deleteClient(dyn.client_id).catch(() => {});
  const cree = await clients.admin.auth.admin.oauth.createClient({ client_name: "Client de fumée (préproduction)", redirect_uris: [redirect], token_endpoint_auth_method: "none" });
  verite(!cree.error && cree.data?.registration_type === "manual", `client déclaré : ${cree.error?.message ?? JSON.stringify(cree.data).slice(0, 120)}`);
  const client = cree.data;
  const resultats = {};
  try {
  for (const [libelle, slug, jetonSession] of [["compte sans facteur", "jeune-actif", "session"], ["compte à facteur, session aal2", "proprietaire-credit", "aal2"], ["compte à facteur, session aal1", "proprietaire-credit", "aal1"]]) {
    const compte = await compteNeuf(slug, { jeton: jetonSession, clients });
    try {
      // 2. demande d'autorisation avec PKCE
      const verifier = b64u(randomBytes(32));
      const challenge = b64u(createHash("sha256").update(verifier).digest());
      const q = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirect, scope: "openid email", state: "etat-fumee", code_challenge: challenge, code_challenge_method: "S256" });
      const a = await fetch(`${auth}/oauth/authorize?${q}`, { redirect: "manual" });
      const lieu = a.headers.get("location") ?? "";
      verite(a.status >= 300 && a.status < 400 && lieu, `authorize : statut ${a.status} sans redirection`);
      verite(lieu.startsWith("http://localhost:8780/oauth/consent.html?authorization_id="), `la page de consentement attendue est celle de la préproduction : ${lieu.slice(0, 100)}`);
      const authorizationId = new URL(lieu).searchParams.get("authorization_id");
      // la page de consentement locale est servie
      const page = await fetch(lieu);
      verite(page.ok && /authorization_id|consent|Autoriser/i.test(await page.text()), `page de consentement locale : ${page.status}`);
      // 3. approbation par le compte (comme consent.js : getAuthorizationDetails puis approveAuthorization)
      const sb = createClient(clients.url, clients.publiable, SANS_SESSION);
      const ss = await sb.auth.setSession({ access_token: compte.accessToken, refresh_token: compte.refreshToken });
      verite(!ss.error, `session : ${ss.error?.message}`);
      const det = await sb.auth.oauth.getAuthorizationDetails(authorizationId);
      verite(!det.error && det.data?.client?.name, `getAuthorizationDetails : ${det.error?.message}`);
      // compte à facteur, session aal2 : comme consent.js (migration 0033), autorisation du connecteur avant d'approuver
      if (jetonSession === "aal2") {
        const g = await sb.rpc("autoriser_connecteur", { p_autorisation_id: authorizationId });
        verite(!g.error && g.data?.client_id === client.client_id, `autoriser_connecteur : ${g.error?.message ?? JSON.stringify(g.data)}`);
      }
      const ap = await sb.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (ap.error) { resultats[libelle] = `approbation refusée par le serveur (${ap.error.status ?? ""} ${ap.error.code ?? ap.error.message})`; continue; }
      const retour = new URL(ap.data.redirect_url ?? ap.data.redirect_to);
      verite(retour.origin + retour.pathname === redirect && retour.searchParams.get("state") === "etat-fumee", "redirection de retour inattendue");
      const code = retour.searchParams.get("code");
      verite(code, "pas de code d'autorisation");
      // 4. échange du code
      const tk = await fetch(`${auth}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: client.client_id, code_verifier: verifier }) });
      const jeton = await tk.json();
      verite(tk.ok && jeton.access_token, `échange du code : ${tk.status} ${JSON.stringify(jeton).slice(0, 160)}`);
      const c = claims(jeton.access_token);
      verite(c.client_id === client.client_id, `claim client_id : ${c.client_id}`);
      // 5. appel du connecteur avec ce jeton
      const m = clientMcp(mcpUrl, jeton.access_token);
      const init = await m.initialiser();
      verite(init.json?.result?.serverInfo, `initialize avec le jeton OAuth : ${init.status}`);
      const ov = await m.appeler("get_overview");
      resultats[libelle] = `jeton aal=${c.aal ?? "?"}, client_id présent, get_overview ${ov.erreur ? "REFUSÉ (" + ov.texte.slice(0, 40) + "…)" : "ok"}`;
      if (slug === "proprietaire-credit") {
        // Propriété de sécurité (0033) : le jeton OAuth est aal1 ; approuvé par une session aal2 qui a enregistré l'autorisation du connecteur,
        // il lit ; approuvé par une session aal1 (mot de passe seul), il ne lit rien.
        if (jetonSession === "aal2") verite(!ov.erreur, `jeton OAuth autorisé avec le code refusé par le connecteur : ${ov.texte.slice(0, 120)}`);
        else verite(ov.erreur && /Double authentification requise/.test(ov.texte), "un jeton OAuth approuvé en aal1 d'un compte à facteur doit être refusé par le connecteur");
        // Constat (SEC2, § « Connecteur MCP : que contient le jeton OAuth ? ») : l'aal du jeton suit-il celui de la session qui approuve ?
        if (jetonSession === "aal2") ctx.constats.push(`jeton OAuth émis après approbation en session aal2 : aal=${c.aal}, amr=${JSON.stringify(c.amr?.map(a => a.method))} (GoTrue ${ctx.versionAuth}) → le connecteur ${ov.erreur ? "REFUSE" : "accepte"} ce jeton (autorisation liée au second facteur, 0033)`);
      }
      if (slug === "jeune-actif") {
        verite(!ov.erreur, "compte sans facteur : le jeton OAuth doit être accepté");
        // la connexion est notée (voyant « Claude est connecté ») avec l'identifiant du client OAuth
        let n = [];
        for (let i = 0; i < 5 && !n.length; i++) { n = (await clients.admin.from("connexions_assistant").select("client_id, client_nom").eq("user_id", compte.uid)).data ?? []; if (!n.length) await attendre(1000); }
        verite(n.some(x => x.client_id === client.client_id), "connexions_assistant ne contient pas le client OAuth");
      }
    } finally { await compte.supprimer(); }
  }
  } finally { await clients.admin.auth.admin.oauth.deleteClient(client.client_id).catch(() => {}); }
  return Object.entries(resultats).map(([k, v]) => `${k} : ${v}`).join(" ; ");
}

// ------------------------------------------------------------------------------------------------------------------ 4. Connecteur
async function parcoursConnecteur(ctx) {
  const { clients, mcpUrl } = ctx;
  const c = await compteNeuf("couple-enfants", { clients });
  try {
    const m = clientMcp(mcpUrl, c.accessToken);
    const init = await m.initialiser();
    verite(init.json?.result?.serverInfo?.name === "boussole", "initialize : serverInfo");
    verite((init.json.result.instructions ?? "").includes("demarrer_session"), "initialize : instructions");
    const outils = await m.outils();
    const visibles = outils.filter(o => { const v = o._meta?.ui?.visibility; return !v || v.includes("model"); });
    verite(outils.length >= 57 && outils.some(o => o.name === "demarrer_session"), `tools/list : ${outils.length} outils`);
    const s = await m.appeler("demarrer_session");
    verite(!s.erreur && s.donnees?.conduite, `demarrer_session : ${s.texte.slice(0, 120)}`);
    // proposition : le bilan ne bouge pas, la proposition attend la validation de l'utilisateur
    const u = clientUtilisateur(clients, c.accessToken);
    const avant = (await u.from("profiles").select("protection").eq("user_id", c.uid).single()).data.protection;
    const dep = await m.appeler("set_protection", { prevoyance: false, emprunteur: false, source: "Fumée de préproduction (parcours 4)" });
    verite(!dep.erreur, `set_protection : ${dep.texte.slice(0, 160)}`);
    const apres = (await u.from("profiles").select("protection").eq("user_id", c.uid).single()).data.protection;
    verite(JSON.stringify(avant) === JSON.stringify(apres), "set_protection a écrit directement dans le profil");
    const props = (await u.from("propositions").select("id, statut, cible, source").eq("user_id", c.uid)).data;
    verite(props.length >= 1 && props.every(p => p.statut === "en_attente" && p.source), "proposition en attente avec une source");
    // validation par l'utilisateur
    const ap = await u.rpc("appliquer_propositions", { p_ids: props.map(p => p.id) });
    verite(!ap.error && ap.data >= 1, `appliquer_propositions : ${ap.error?.message ?? ap.data}`);
    const final = (await u.from("profiles").select("protection").eq("user_id", c.uid).single()).data.protection;
    verite(JSON.stringify(final) !== JSON.stringify(avant), "la protection n'a pas changé après validation");
    return `${outils.length} outils (${visibles.length} visibles pour le modèle), demarrer_session, proposition déposée puis appliquée`;
  } finally { await c.supprimer(); }
}

// ------------------------------------------------------------------------------------------------------------------ 3 bis. Connecteur et second facteur
async function parcoursConnecteurMfa(ctx) {
  const r = await connecteurMfa({ clients: ctx.clients, mcpUrl: ctx.mcpUrl, journal: () => {} });
  verite(!r.echecs, r.lignes.filter(l => l.startsWith("ÉCHEC")).join(" ; "));
  return `${r.lignes.length} étapes (client dynamique refusé, aal1 refusé, code → lecture, export/suppression/mot de passe refusés au jeton OAuth, rafraîchissement, autre session refusée, retrait, nouvelle autorisation, expiration, course)`;
}

// ------------------------------------------------------------------------------------------------------------------ 5. Nuit
function sql(requete) {
  const r = supabase(["db", "query", "--local", "-o", "json", requete], { capturer: true });
  if (r.code !== 0) throw new Error(`requête SQL : ${r.err.split("\n").filter(l => l && !/new version|recommend|workdir|Connecting/i.test(l)).join(" ").slice(0, 200)}`);
  const debut = r.out.indexOf("{");
  return JSON.parse(r.out.slice(debut)).rows;
}
async function parcoursNuit(ctx) {
  const jobs = sql("select jobname, command from cron.job");
  verite(jobs.every(j => !/supabase\.co|oapcewpqsbbjdlcdeizi/.test(j.command)), "une tâche cron vise la production");
  const avant = sql("select coalesce(max(id), 0) as id from public.job_runs")[0].id;
  const id = sql("select preprod.lancer_nuit() as id")[0].id;
  let rep = null;
  for (let i = 0; i < 60 && !rep; i++) { await attendre(2000); rep = sql(`select status_code, content, error_msg from net._http_response where id = ${Number(id)}`)[0] ?? null; }
  verite(rep, "pg_net : pas de réponse de la fonction nightly en 2 minutes");
  verite(rep.status_code === 200, `nightly : statut ${rep.status_code} ${(rep.content ?? rep.error_msg ?? "").slice(0, 200)}`);
  const body = JSON.parse(rep.content);
  verite(body.ok && body.hors_ligne === true, `nightly : réponse inattendue ${rep.content.slice(0, 200)}`);
  verite(body.errors.length === 0, `nightly : erreurs ${JSON.stringify(body.errors).slice(0, 200)}`);
  const run = sql(`select ok from public.job_runs where id > ${Number(avant)} order by id desc limit 1`)[0];
  verite(run?.ok === true, "job_runs : la nuit n'est pas notée réussie");
  const prix = sql("select price::text as price, source from public.instruments where isin = 'ZZ0000000011'")[0];
  verite(prix && Number(prix.price) === 104.26 && prix.source === "fige", `cours figé non appliqué : ${JSON.stringify(prix)}`);
  return `lancer_nuit() → 200 hors ligne, ${body.instruments_updated} cours figés, ${body.users} photos, job_runs ok, aucune tâche cron vers la production`;
}

// ------------------------------------------------------------------------------------------------------------------
export async function fumee({ racine = RACINE } = {}) {
  garde({ racine });
  const clients = clientsLocaux({ racine });
  const mcpUrl = assertLocal(`${clients.url}/functions/v1/mcp`);
  const ctx = { clients, mcpUrl, sec2: null, constats: [], versionAuth: "?" };
  try { ctx.versionAuth = (await (await fetch(`${clients.url}/auth/v1/health`, { headers: { apikey: clients.publiable } })).json()).version ?? "?"; } catch { /* informatif */ }
  execFileSync(process.execPath, ["build.mjs", "--config=preprod"], { cwd: racine, stdio: "ignore" });
  const serveur = await demarrerServeur().catch(() => null); // 8780 déjà pris : un serveur tourne peut-être (preprod:app)
  const fonctions = await demarrerFonctions(clients.url);
  const lignes = [];
  let echecs = 0;
  for (const [nom, f] of [["rls", parcoursRls], ["mfa", parcoursMfa], ["oauth", parcoursOauth], ["connecteur-mfa", parcoursConnecteurMfa], ["connecteur", parcoursConnecteur], ["nuit", parcoursNuit]]) {
    const t0 = Date.now();
    try { lignes.push(`ok      ${nom} : ${await f(ctx)} (${Math.round((Date.now() - t0) / 1000)} s)`); }
    catch (e) { echecs++; lignes.push(`ÉCHEC   ${nom} : ${e.message}`); }
    console.log(lignes[lignes.length - 1]);
  }
  for (const c of ctx.constats) console.log(`CONSTAT ${c}`);
  if (ctx.sec2) console.log(`SEC2    mfa.enroll avec un jeton aal1 et un facteur déjà vérifié : ${JSON.stringify(ctx.sec2)}`);
  await fonctions.arreter();
  serveur?.close();
  return { echecs, sec2: ctx.sec2, constats: ctx.constats, lignes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fumee().then(r => process.exit(r.echecs ? 1 : 0)).catch(e => { console.error(e.message); process.exit(1); });
}
