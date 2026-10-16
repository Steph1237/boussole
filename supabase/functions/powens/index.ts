// Boussole : fonction serveur `powens` (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 1 ; contrat dans
// docs/superpowers/plans/2026-10-12-bq1-powens.md › Fonction serveur).
//
// Déploiement : verify_jwt = false. Chaque route contrôle elle-même l'appelant :
// - /connecter, /deconnecter, /synchroniser, /supprimer : JWT Supabase de l'utilisateur (auth.getUser) ; SEC2 : /connecter exige en plus
//   la revendication aal = "aal2" du JWT (double authentification), sinon 403 { erreur, code: "mfa_requise" } avant tout appel Powens ;
//   /deconnecter, /synchroniser et /supprimer l'exigent dès que l'utilisateur a un facteur vérifié (lu côté serveur par l'API admin
//   Auth, auth.admin.mfa.listFactors, jamais d'après le client) ; sans facteur vérifié, leur comportement est inchangé ;
// - /reclasser (BUD1) : JWT Supabase de l'utilisateur, session aal2 OU jeton d'un connecteur autorisé (autorisation liée au second facteur, 0033 :
//   RPC connecteur_autorise lue avec le jeton de l'appelant) ; un appel toutes les 10 secondes par utilisateur (budget_reclasser_verrouiller) ;
// - /webhook : jeton Powens de l'utilisateur (Authorization: Bearer), reconnu par son empreinte SHA-256
//   (RPC powens_utilisateur_par_empreinte), et, si POWENS_WEBHOOK_SECRET est défini, signature BI-Signature datée de moins de
//   5 minutes (BI-Signature-Date) ; sans ce secret, accepté seulement sur un domaine de bac à sable (suffixe -sandbox). Corps
//   limité à 5 Mo (lu par morceaux) ; notification d'un utilisateur dont la connexion bancaire est fermée : 200, ignorée ;
// - /nuit : jeton de nuit (RPC check_powens_nuit_token, secret Vault `powens_nuit_token`, appel pg_cron) ;
// - /retour : redirect_uri déclarée chez Powens (RETOUR_URL) ; redirection publique vers l'app, sans écriture.
// Clé de service (SUPABASE_SERVICE_ROLE_KEY) : uniquement ici, côté serveur ; toute écriture porte ou filtre user_id.
// Le jeton Powens permanent vit dans Supabase Vault (RPC powens_enregistrer / powens_jeton / powens_oublier) ; il n'est jamais
// renvoyé à l'app ni à Claude, ni journalisé.
//
// Secrets (variables d'environnement, jamais dans le code) : POWENS_DOMAIN, POWENS_CLIENT_ID, POWENS_CLIENT_SECRET,
// POWENS_WEBHOOK_SECRET (facultatif) ; SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par la plateforme.
//
// Webview (https://docs.powens.com/api-reference/overview/webview, consultée le 2026-10-12) :
// - connexion : https://webview.powens.com/connect?domain={domain}.biapi.pro&client_id=…&redirect_uri=…&code=… : le paramètre
//   `domain` est le nom d'hôte de l'API, avec `.biapi.pro` (exemple de la référence : `example.biapi.pro`) ;
// - reconnexion : https://{domain}.biapi.pro/2.0/auth/webview/reconnect?client_id=…&code=…&connection_id=…&redirect_uri=…
//   (https://docs.powens.com/documentation/integration-guides/sca-and-connection-states) ;
// - gestion d'une connexion existante (« Gérer les comptes » : activer un compte découvert mais non partagé, livret, PEA…) :
//   https://webview.powens.com/manage?domain={domain}.biapi.pro&client_id=…&code=…&connection_id=…&redirect_uri=…
//   (https://docs.powens.com/api-reference/overview/webview#manage-connections, consultée le 2026-10-12 : domain, client_id et
//   code obligatoires ; connection_id facultatif, la webview ouvre directement cette connexion ; redirect_uri facultatif, il
//   ajoute un bouton de fermeture qui y mène, sans aucun paramètre de retour hormis state). Les comptes découverts sont désactivés
//   par défaut (RGPD) : les activer depuis cette page évite une seconde connexion à la même banque (doublon facturé) ;
// - retour : redirect_uri?connection_id=… en cas de succès, ?error=…&error_description=… sinon. redirect_uri (RETOUR_URL) est
//   déclarée dans la console Powens ; /retour ne transmet à l'app que connection_id (chiffres) et error (code [a-z_]), jamais
//   error_description : supabase-js lirait ce paramètre comme une erreur d'authentification et effacerait la session.
//
// Webhooks (https://docs.powens.com/documentation/integration-guides/webhooks) : POST JSON, 2XX attendu (sinon Powens réessaie) ;
// en-tête Authorization: Bearer <jeton utilisateur> ; signature facultative BI-Signature = BASE64(HMAC_SHA256(METHOD + "." +
// endpoint + "." + date + "." + payload)) avec la date de BI-Signature-Date. Aucun champ ne porte le nom de l'événement : on
// déclare une URL par événement (/powens/webhook/connection_synced, /connection_deleted, /account_disabled, /account_enabled) ;
// /powens/webhook seul déduit l'événement de la forme du contenu. Formes (https://docs.powens.com/api-reference/user-connections/connections et
// …/data-aggregation/bank-accounts) : CONNECTION_SYNCED { user, connection: { id, … } } ; CONNECTION_DELETED = objet connexion
// { id, id_connector, state, … } ; ACCOUNT_DISABLED = objet compte { id, id_connection, disabled, … } ; ACCOUNT_ENABLED = objet
// compte avec disabled null (https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#account-enabled) :
// émis quand l'utilisateur active un compte (webview Manage) ; la connexion du compte est alors synchronisée comme pour
// CONNECTION_SYNCED (rien ne garantit qu'une synchronisation suive l'activation).
import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { api, domaine, PowensErreur } from "./powens-api.ts";
import { synchroniser, oublierConnexion, reclasser } from "./synchro.ts";

const APP_URL = "https://steph1237.github.io/boussole/app.html";
/** redirect_uri des pages de connexion et de reconnexion (déclarée dans la console Powens). */
const RETOUR_URL = "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/powens/retour";
const RELANCE_APRES_MS = 36 * 3600 * 1000;
/** Délai de l'appel pg_net de la nuit ; la boucle s'arrête à 60 % pour répondre à temps. */
export const BUDGET_NUIT_MS = 120_000;
export const ARRET_NUIT_MS = BUDGET_NUIT_MS * 0.6;
const JOURS_PURGE = 90;
const A_SUPPRIMER_MAX = 50;
const FRAICHEUR_SIGNATURE_MS = 5 * 60 * 1000;
const CORPS_MAX = 5 * 1024 * 1024;
const MSG_FERME = "La connexion bancaire n'est pas encore ouverte pour ton compte.";
const MSG_NON_CONNECTE = "Connecte-toi à Boussole pour gérer tes banques.";
const MSG_CONFIG = "La connexion bancaire n'est pas encore configurée : réessaie plus tard.";
/** SEC2 : connecter une banque exige une session passée par la double authentification (aal2). Code lu par l'app (Store.banque). */
const MSG_MFA = "Active la double authentification et valide ton code pour connecter ta banque. Tu la règles dans Mon compte › Sécurité.";
/** SEC2 : déconnecter, synchroniser et supprimer exigent aal2 dès que l'utilisateur a un facteur vérifié. */
const MSG_MFA_ACTION = "Valide ton code de double authentification pour faire cela, puis réessaie.";
const MSG_MFA_INCERTAIN = "Impossible de vérifier ta double authentification pour le moment : réessaie dans un moment.";

// Points d'injection pour les tests (client Supabase, fetch Powens, environnement, horloge) ; inchangés en production.
export const deps = {
  createClient: createClient as (...a: any[]) => any,
  fetch: ((...a: any[]) => (fetch as any)(...a)) as any,
  env: (k: string): string | undefined => Deno.env.get(k),
  maintenant: () => new Date(),
  horloge: () => Date.now(),
};

/* ---------- outils ---------- */
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const erreur = (status: number, message: string, code?: string) => json({ erreur: message, ...(code ? { code } : {}) }, status);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function bearer(req: Request): string {
  const m = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : "";
}

/** Comparaison en temps constant (pas de sortie anticipée) ; une chaîne vide n'est jamais égale. */
export function egalTempsConstant(a: string, b: string): boolean {
  const x = new TextEncoder().encode(String(a ?? "")), y = new TextEncoder().encode(String(b ?? ""));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && x.length > 0;
}

async function sha256Hex(t: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacBase64(secret: string, donnee: string): Promise<string> {
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(donnee)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

function admin() {
  const url = deps.env("SUPABASE_URL"), cle = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !cle) return null;
  return deps.createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Configuration Powens complète, ou null (domaine absent ou invalide, client_id ou secret absent). */
function configPowens(): { nom: string; base: string; clientId: string; secret: string } | null {
  // Espaces et retours à la ligne retirés : une valeur collée depuis la console Powens en garde souvent (sinon invalid_client).
  const clientId = deps.env("POWENS_CLIENT_ID")?.trim(), secret = deps.env("POWENS_CLIENT_SECRET")?.trim();
  if (!clientId || !secret) return null;
  try {
    return { ...domaine({ POWENS_DOMAIN: deps.env("POWENS_DOMAIN") }), clientId, secret };
  } catch (e) {
    console.error("powens:", msg(e));
    return null;
  }
}

/** Utilisateur du JWT de la requête, validé par auth.getUser (signature, expiration, session), avec le niveau d'assurance du jeton.
    C'est le seul endroit qui appelle aalDuJeton, et seulement après ce contrôle : l'aal n'est jamais lu sur un jeton non validé. */
async function utilisateur(db: any, req: Request): Promise<{ id: string; aal: "aal1" | "aal2" } | null> {
  const jwt = bearer(req);
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  return error || !data?.user?.id ? null : { id: data.user.id, aal: aalDuJeton(jwt) };
}

/** Niveau d'assurance (revendication aal) d'un JWT : "aal2" si la session a franchi un second facteur, "aal1" sinon.
    ATTENTION : décodage de la charge utile SANS vérifier la signature. À n'appeler que sur un jeton déjà validé par auth.getUser
    (voir utilisateur() ci-dessus) ; ne jamais s'en servir pour authentifier. Illisible ou sans revendication : aal1 (comme Supabase,
    qui traite un jeton sans aal comme aal1). */
export function aalDuJeton(jwt: string): "aal1" | "aal2" {
  try {
    const b64 = (jwt.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    return claims?.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

/** SEC2 : garde des actions sur une banque déjà connectée (déconnecter, synchroniser, supprimer). Session aal2 : rien à contrôler.
    Session aal1 : si l'utilisateur a un facteur vérifié (API admin Auth, clé de service : le client ne peut pas le fausser), la
    double authentification est exigée (403 mfa_requise) ; sinon, comportement habituel. Lecture des facteurs en échec : refus (503),
    jamais un passe-droit. → null (continuer) ou la réponse d'erreur. */
async function exigerAal2SiFacteur(db: any, user: { id: string; aal: string }): Promise<Response | null> {
  if (user.aal === "aal2") return null;
  let facteurs: any[];
  try {
    const { data, error } = await db.auth.admin.mfa.listFactors({ userId: user.id });
    if (error) throw new Error(error.message ?? "listFactors");
    facteurs = Array.isArray(data?.factors) ? data.factors : [];
  } catch (e) {
    console.error("powens: facteurs illisibles", msg(e));
    return erreur(503, MSG_MFA_INCERTAIN);
  }
  return facteurs.some((f) => f?.status === "verified") ? erreur(403, MSG_MFA_ACTION, "mfa_requise") : null;
}

/** Revendication client_id d'un JWT (jeton OAuth d'un connecteur), null pour une session ordinaire. Même réserve que aalDuJeton : jeton déjà validé. */
export function clientIdDuJeton(jwt: string): string | null {
  try {
    const b64 = (jwt.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    return typeof claims?.client_id === "string" && claims.client_id ? claims.client_id : null;
  } catch {
    return null;
  }
}

/** Reclassement (BUD1) : session aal2, ou jeton d'un connecteur que l'utilisateur a autorisé avec son second facteur (public.connecteur_autorise(), 0033,
    lue avec le jeton de l'appelant : elle compare client_id et session_id aux autorisations de l'utilisateur). Tout le reste, et toute lecture en
    échec : 403 mfa_requise (jamais un passe-droit). → null (continuer) ou la réponse d'erreur. */
async function exigerAal2OuConnecteur(user: { id: string; aal: string }, jwt: string): Promise<Response | null> {
  if (user.aal === "aal2") return null;
  const url = deps.env("SUPABASE_URL"), anon = deps.env("SUPABASE_ANON_KEY");
  if (url && anon && clientIdDuJeton(jwt)) {
    try {
      const c = deps.createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await c.rpc("connecteur_autorise");
      if (!error && data === true) return null;
    } catch (e) {
      console.error("powens: autorisation du connecteur illisible", msg(e));
    }
  }
  return erreur(403, MSG_MFA_ACTION, "mfa_requise");
}

/** Corps brut, lu par morceaux ; null au-delà de `max` octets (Content-Length annoncé ou octets reçus). */
async function lireBorne(req: Request, max: number): Promise<string | null> {
  const annonce = Number(req.headers.get("Content-Length") ?? "");
  if (Number.isFinite(annonce) && annonce > max) return null;
  if (!req.body) return "";
  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(n);
  let o = 0;
  for (const m of morceaux) { tout.set(m, o); o += m.byteLength; }
  return new TextDecoder().decode(tout);
}

/** Domaine Powens de bac à sable (nom en -sandbox) ; false si absent ou invalide. */
function bacASable(): boolean {
  try {
    return domaine({ POWENS_DOMAIN: deps.env("POWENS_DOMAIN") }).nom.endsWith("-sandbox");
  } catch {
    return false;
  }
}

/** Corps JSON ({} si vide), null s'il est illisible ou n'est pas un objet. */
async function lireCorps(req: Request): Promise<Record<string, unknown> | null> {
  const t = await req.text();
  if (!t.trim()) return {};
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function idPowens(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^[0-9]{1,15}$/.test(v) && Number(v) > 0) return Number(v);
  return null;
}

async function jetonDe(db: any, userId: string): Promise<string | null> {
  const { data, error } = await db.rpc("powens_jeton", { p_user: userId });
  if (error) throw new Error("lecture du coffre impossible");
  return typeof data === "string" && data ? data : null;
}

async function connexionAppartient(db: any, userId: string, id: number): Promise<boolean> {
  const { data, error } = await db.from("banque_connexions").select("id").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error("lecture des connexions impossible");
  return !!data;
}

/** Crée l'utilisateur Powens et l'enregistre. Si un autre appel l'a enregistré entre-temps (powens_enregistrer → false),
    l'utilisateur créé en trop est supprimé chez Powens (avec son propre jeton, au mieux) et le jeton enregistré est repris. */
async function creerUtilisateur(db: any, cfg: { base: string; clientId: string; secret: string }, userId: string): Promise<string> {
  const cree = await api(cfg.base, null, deps.fetch).authInit(cfg.clientId, cfg.secret);
  const supprimerCree = async () => {
    try {
      await api(cfg.base, cree.auth_token, deps.fetch).supprimerUtilisateur();
    } catch (e) {
      console.warn("powens: utilisateur Powens en trop non supprimé", msg(e));
    }
  };
  const r = await db.rpc("powens_enregistrer", { p_user: userId, p_powens_user_id: cree.id_user, p_jeton: cree.auth_token });
  if (r.error) {
    await supprimerCree();
    throw new Error("enregistrement dans le coffre impossible");
  }
  if (r.data === true) return cree.auth_token;
  await supprimerCree();
  const existant = await jetonDe(db, userId);
  if (!existant) throw new Error("accès Powens introuvable après un enregistrement concurrent");
  return existant;
}

/** Réponse d'échec : message Powens traduit (502) ou erreur interne (500), jamais de jeton ni de secret. */
function echec(e: unknown, prefixe = "") {
  if (e instanceof PowensErreur) {
    // Statut et code Powens seulement (ex. 400 invalid_client) : jamais de jeton, de secret ni de contenu de requête.
    console.warn(`powens: refus Powens ${e.status}${e.code ? ` ${e.code}` : ""}`);
    return erreur(502, `${prefixe}${e.message}`);
  }
  console.error("powens:", msg(e));
  return erreur(500, `${prefixe}Erreur interne : réessaie dans un moment.`);
}

/** Lance un travail après la réponse si le runtime le permet (EdgeRuntime.waitUntil), sinon l'attend. */
async function enFond(travail: Promise<unknown>) {
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") runtime.waitUntil(travail);
  else await travail;
}

/* ---------- application ---------- */
export const app = new Hono().basePath("/powens");

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["authorization", "content-type", "apikey", "x-client-info"],
  maxAge: 86400,
}));

/* POST /powens/connecter { connection_id?, mode? } → { url } : page de connexion ; de reconnexion avec connection_id ; de gestion
   de cette connexion (webview Manage : activer d'autres comptes de la même banque) avec connection_id et mode "gerer". */
app.post("/connecter", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
  const f = await db.from("fonctionnalites").select("active").eq("user_id", user.id).eq("cle", "banque").maybeSingle();
  if (f.error) return erreur(500, "Erreur interne : réessaie dans un moment.");
  if (f.data?.active !== true) return erreur(403, MSG_FERME);
  // SEC2 : connexion, reconnexion et gestion d'une banque seulement après la double authentification (aal2), avant tout appel Powens.
  if (user.aal !== "aal2") return erreur(403, MSG_MFA, "mfa_requise");
  const cfg = configPowens();
  if (!cfg) return erreur(503, MSG_CONFIG);
  const corps = await lireCorps(req);
  if (!corps) return erreur(400, "Requête illisible.");
  let connexionId: number | null = null;
  if (corps.connection_id != null) {
    connexionId = idPowens(corps.connection_id);
    if (connexionId == null) return erreur(400, "connection_id invalide.");
  }
  if (corps.mode != null && corps.mode !== "gerer") return erreur(400, "mode invalide.");
  let gerer = corps.mode === "gerer";
  if (gerer && connexionId == null) return erreur(400, "connection_id manquant : choisis la connexion à gérer.");
  try {
    if (connexionId != null && !(await connexionAppartient(db, user.id, connexionId))) return erreur(404, "Connexion introuvable.");
    let jeton = await jetonDe(db, user.id);
    if (!jeton) {
      if (connexionId != null) return erreur(409, "Ton accès Powens est introuvable : connecte de nouveau ta banque.");
      jeton = await creerUtilisateur(db, cfg, user.id);
    }
    let code: string;
    try {
      code = await api(cfg.base, jeton, deps.fetch).code();
    } catch (err) {
      if (!(err instanceof PowensErreur && err.status === 401)) throw err;
      // Jeton refusé (utilisateur Powens disparu ou jeton révoqué) : oubli, puis nouvel utilisateur, une seule fois. Une
      // reconnexion devient une nouvelle connexion (l'ancienne appartenait à l'utilisateur disparu).
      const o = await db.rpc("powens_oublier", { p_user: user.id });
      if (o.error) throw new Error("effacement du coffre impossible");
      jeton = await creerUtilisateur(db, cfg, user.id);
      code = await api(cfg.base, jeton, deps.fetch).code();
      connexionId = null;
      gerer = false;
    }
    const e = encodeURIComponent;
    const url = connexionId == null
      ? `https://webview.powens.com/connect?domain=${e(cfg.nom + ".biapi.pro")}&client_id=${e(cfg.clientId)}&redirect_uri=${e(RETOUR_URL)}&code=${e(code)}`
      : gerer
      ? `https://webview.powens.com/manage?domain=${e(cfg.nom + ".biapi.pro")}&client_id=${e(cfg.clientId)}&code=${e(code)}&connection_id=${connexionId}&redirect_uri=${e(RETOUR_URL)}`
      : `${cfg.base}auth/webview/reconnect?client_id=${e(cfg.clientId)}&code=${e(code)}&connection_id=${connexionId}&redirect_uri=${e(RETOUR_URL)}`;
    return json({ url });
  } catch (err) {
    return echec(err);
  }
});

/* POST /powens/deconnecter { connection_id } → { ok: true } : suppression chez Powens, puis dans Boussole. */
app.post("/deconnecter", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
  const mfa = await exigerAal2SiFacteur(db, user);
  if (mfa) return mfa;
  const corps = await lireCorps(req);
  const id = idPowens(corps?.connection_id);
  if (id == null) return erreur(400, "connection_id manquant ou invalide.");
  try {
    if (!(await connexionAppartient(db, user.id, id))) return erreur(404, "Connexion introuvable.");
    const jeton = await jetonDe(db, user.id);
    if (jeton) {
      const cfg = configPowens();
      if (!cfg) return erreur(503, MSG_CONFIG);
      await api(cfg.base, jeton, deps.fetch).supprimerConnexion(id);
    }
  } catch (err) {
    return echec(err, "La déconnexion chez Powens a échoué : ");
  }
  try {
    await oublierConnexion(db, user.id, id, { maintenant: deps.maintenant() });
  } catch (err) {
    console.error("powens: déconnexion locale en échec", msg(err));
    return erreur(500, "La banque est déconnectée chez Powens, mais pas encore dans Boussole : réessaie.");
  }
  return json({ ok: true });
});

/* POST /powens/synchroniser { connection_id } → { ok: true, rapport } : bouton « Synchroniser maintenant ». Relance chez Powens
   (PUT users/me/connections/{id}?psu_requested=false&background=true : la référence Powens consultée le 2026-10-12 ne documente
   pas de mode synchrone pour ce PUT, background n'y est décrit que pour POST ; la relance est donc demandée en tâche de fond, comme
   la nuit), puis synchronisation immédiate côté serveur des données déjà disponibles, sous le bail habituel ; Powens notifie
   ensuite CONNECTION_SYNCED à la fin de sa relance, et le webhook synchronise de nouveau. Une relance refusée par Powens
   n'empêche pas la synchronisation (rapport.relance = false, relance_erreur). Bail déjà pris → 409. */
app.post("/synchroniser", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
  const mfa = await exigerAal2SiFacteur(db, user);
  if (mfa) return mfa;
  const corps = await lireCorps(req);
  const id = idPowens(corps?.connection_id);
  if (id == null) return erreur(400, "connection_id manquant ou invalide.");
  const f = await db.from("fonctionnalites").select("active").eq("user_id", user.id).eq("cle", "banque").maybeSingle();
  if (f.error) return erreur(500, "Erreur interne : réessaie dans un moment.");
  if (f.data?.active !== true) return erreur(403, MSG_FERME);
  const cfg = configPowens();
  if (!cfg) return erreur(503, MSG_CONFIG);
  try {
    if (!(await connexionAppartient(db, user.id, id))) return erreur(404, "Connexion introuvable.");
    const jeton = await jetonDe(db, user.id);
    if (!jeton) return erreur(409, "Ton accès Powens est introuvable : connecte de nouveau ta banque.");
    const client = api(cfg.base, jeton, deps.fetch);
    let relance = true, relanceErreur: string | null = null;
    try {
      await client.relancer(id);
    } catch (e) {
      if (!(e instanceof PowensErreur)) throw e;
      console.warn(`powens: relance refusée ${e.status}${e.code ? ` ${e.code}` : ""}`);
      relance = false;
      relanceErreur = e.message;
    }
    const r = await synchroniser(db, client, user.id, id, { maintenant: deps.maintenant() });
    if (r.sautee) return erreur(409, "Synchronisation déjà en cours pour cette banque : réessaie dans un instant.");
    return json({
      ok: true,
      rapport: {
        ok: r.ok, sautee: false, relance, ...(relanceErreur ? { relance_erreur: relanceErreur } : {}), etat: r.etat, comptes: r.comptes, operations: r.operations,
        rattaches_auto: r.rattaches_auto, crees_auto: r.crees_auto, suggestions: r.suggestions, comptes_en_double: r.comptes_en_double, doublon_de: r.doublon_de,
        positions_creees: r.positions_creees, lignes_adoptees: r.lignes_adoptees, propositions: r.propositions, erreurs: r.erreurs.length,
      },
    });
  } catch (err) {
    return echec(err);
  }
});

/* POST /powens/reclasser → { ok, operations_reclassees, mois_recalcules, mois_figes } : rejoue le classement du budget (règles actives de budget_regles)
   sur les opérations des 90 derniers jours, recalcule les mois touchés et, de 90 jours à 13 mois, reclasse les totaux par marchand et reconstruit
   banque_mois. Appelée par l'app ou par le connecteur (regler_categorie) après une règle créée, modifiée, désactivée ou supprimée. Jeton de l'utilisateur
   requis (401), session aal2 ou connecteur autorisé (403 mfa_requise), au plus un appel toutes les 10 secondes par utilisateur (429), idempotente ;
   les mois de plus de 13 mois restent figés (mois_figes ne les liste pas). */
app.post("/reclasser", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
  const mfa = await exigerAal2OuConnecteur(user, bearer(req));
  if (mfa) return mfa;
  const f = await db.from("fonctionnalites").select("active").eq("user_id", user.id).eq("cle", "banque").maybeSingle();
  if (f.error) return erreur(500, "Erreur interne : réessaie dans un moment.");
  if (f.data?.active !== true) return erreur(403, MSG_FERME);
  try {
    const v = await db.rpc("budget_reclasser_verrouiller", { p_user: user.id, p_secondes: 10 });
    if (v?.error) throw new Error(v.error.message ?? "budget_reclasser_verrouiller");
    if (v?.data !== true) return new Response(JSON.stringify({ erreur: "Un reclassement vient d'avoir lieu : réessaie dans quelques secondes." }),
      { status: 429, headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": "10" } });
    const r = await reclasser(db, user.id, { maintenant: deps.maintenant() });
    return json({ ok: r.erreurs.length === 0, operations_reclassees: r.operations_reclassees, mois_recalcules: r.mois_recalcules, mois_figes: r.mois_figes,
      ...(r.erreurs.length ? { erreurs: r.erreurs.length } : {}) });
  } catch (err) {
    return echec(err);
  }
});

/* POST /powens/supprimer → { ok: true } : suppression de l'utilisateur Powens, avant delete_me(). 401, 403 ou 404 chez Powens :
   l'utilisateur est déjà parti (ou son jeton ne vaut plus rien) → oublié quand même. */
app.post("/supprimer", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
  const mfa = await exigerAal2SiFacteur(db, user);
  if (mfa) return mfa;
  try {
    const jeton = await jetonDe(db, user.id);
    if (!jeton) return json({ ok: true });
    const cfg = configPowens();
    if (!cfg) return erreur(503, MSG_CONFIG);
    try {
      await api(cfg.base, jeton, deps.fetch).supprimerUtilisateur(); // 404 toléré par le client
    } catch (err) {
      if (!(err instanceof PowensErreur && (err.status === 401 || err.status === 403))) throw err;
    }
    const r = await db.rpc("powens_oublier", { p_user: user.id });
    if (r.error) throw new Error("effacement du coffre impossible");
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PowensErreur) return erreur(502, `La suppression chez Powens a échoué : ${err.message} Réessaie dans un moment.`);
    return echec(err);
  }
});

/* POST /powens/webhook[/:evenement] (Powens) → 200 dès l'authentification passée ; traitement en fond, idempotent. */
type Evenement = "CONNECTION_SYNCED" | "CONNECTION_DELETED" | "ACCOUNT_DISABLED" | "ACCOUNT_ENABLED";
const EVENEMENTS: Evenement[] = ["CONNECTION_SYNCED", "CONNECTION_DELETED", "ACCOUNT_DISABLED", "ACCOUNT_ENABLED"];

/** Événement : nom du chemin s'il est donné, sinon déduit de la forme du contenu. */
function evenementDe(chemin: string | undefined, corps: any): Evenement | null {
  if (chemin) {
    const e = chemin.toUpperCase() as Evenement;
    return EVENEMENTS.includes(e) ? e : null;
  }
  if (corps?.connection && typeof corps.connection === "object") return "CONNECTION_SYNCED";
  if (corps?.connection_id != null) return "CONNECTION_SYNCED";
  if (corps?.id != null && "id_connection" in corps) return corps.disabled === null ? "ACCOUNT_ENABLED" : "ACCOUNT_DISABLED";
  if (corps?.id != null && ("id_connector" in corps || "connector_uuid" in corps || "state" in corps)) return "CONNECTION_DELETED";
  return null;
}

/** Signature BI-Signature : l'endpoint signé est le chemin de l'URL déclarée (exemple de la doc : « /v1/webhook-listener ») ; la
    fonction le reçoit sans le préfixe /functions/v1 : on accepte le chemin reçu, le chemin public et l'URL complète.
    BI-Signature-Date doit être à moins de 5 minutes de l'heure du serveur (rejeu d'une notification ancienne refusé). */
async function signatureValide(req: Request, brut: string, secret: string): Promise<boolean> {
  const sig = (req.headers.get("BI-Signature") ?? "").trim();
  const date = (req.headers.get("BI-Signature-Date") ?? "").trim();
  if (!sig || !date) return false;
  const quand = Date.parse(date.replace(/(\.\d{3})\d+/, "$1"));
  if (!Number.isFinite(quand) || Math.abs(deps.maintenant().getTime() - quand) > FRAICHEUR_SIGNATURE_MS) return false;
  const u = new URL(req.url);
  const publique = (deps.env("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const chemins = [u.pathname, `/functions/v1${u.pathname}`, ...(publique ? [`${publique}/functions/v1${u.pathname}`] : [])];
  const candidats = u.search ? chemins.flatMap((p) => [p, p + u.search]) : chemins;
  let ok = false;
  for (const endpoint of candidats) {
    const attendu = await hmacBase64(secret, `${req.method}.${endpoint}.${date}.${brut}`);
    if (egalTempsConstant(attendu, sig)) ok = true;
  }
  return ok;
}

async function traiterEvenement(db: any, userId: string, jeton: string, ev: Evenement, corps: any) {
  if (ev === "CONNECTION_SYNCED" || ev === "ACCOUNT_ENABLED") {
    // ACCOUNT_ENABLED : objet compte, sa connexion est dans id_connection.
    const id = idPowens(ev === "ACCOUNT_ENABLED" ? corps?.id_connection : corps?.connection?.id ?? corps?.id_connection ?? corps?.connection_id);
    if (id == null) return;
    const cfg = configPowens();
    if (!cfg) { console.error("powens: configuration absente, synchronisation ignorée"); return; }
    const r = await synchroniser(db, api(cfg.base, jeton, deps.fetch), userId, id, { maintenant: deps.maintenant() });
    console.log(r.sautee ? `powens: connexion ${id} déjà en cours de synchronisation, notification sautée`
      : `powens: connexion ${id} synchronisée${r.ok ? "" : ` avec ${r.erreurs.length} erreur(s)`}`);
  } else if (ev === "CONNECTION_DELETED") {
    const id = idPowens(corps?.id ?? corps?.connection?.id ?? corps?.id_connection ?? corps?.connection_id);
    if (id != null) await oublierConnexion(db, userId, id, { maintenant: deps.maintenant() });
  } else if (ev === "ACCOUNT_DISABLED") {
    const id = idPowens(corps?.id);
    if (id == null) return;
    const { error } = await db.from("banque_comptes").update({ actif: false, maj_le: deps.maintenant().toISOString() }).eq("user_id", userId).eq("id", id);
    if (error) throw new Error(error.message);
  }
}

async function webhook(c: any) {
  const req: Request = c.req.raw;
  const brut = await lireBorne(req, CORPS_MAX);
  if (brut == null) return erreur(413, "contenu trop volumineux");
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const secret = deps.env("POWENS_WEBHOOK_SECRET");
  if (secret) {
    if (!(await signatureValide(req, brut, secret))) return erreur(401, "non autorisé");
  } else if (!bacASable()) {
    console.error("powens: signature des notifications non configurée hors bac à sable, notification refusée");
    return erreur(401, "non autorisé");
  }
  const jeton = bearer(req);
  if (!jeton) return erreur(401, "non autorisé");
  const r = await db.rpc("powens_utilisateur_par_empreinte", { p_empreinte: await sha256Hex(jeton) });
  if (r.error) return erreur(500, "vérification impossible");
  const userId = typeof r.data === "string" && r.data ? r.data : null;
  if (!userId) return erreur(401, "non autorisé");
  const f = await db.from("fonctionnalites").select("active").eq("user_id", userId).eq("cle", "banque").maybeSingle();
  if (f.error) return erreur(500, "vérification impossible");
  if (f.data?.active !== true) return json({ ok: true }); // connexion bancaire fermée pour cet utilisateur : rien à faire
  let corps: any;
  try {
    corps = brut.trim() ? JSON.parse(brut) : {};
  } catch {
    return erreur(400, "contenu illisible");
  }
  const ev = evenementDe(c.req.param("evenement"), corps);
  if (!ev) {
    console.warn("powens: notification ignorée (événement non reconnu)");
    return json({ ok: true });
  }
  const travail = traiterEvenement(db, userId, jeton, ev, corps);
  await enFond(travail.catch((e) => console.error(`powens: traitement ${ev} en échec`, msg(e))));
  return json({ ok: true });
}
app.post("/webhook", webhook);
app.post("/webhook/:evenement", webhook);

/* POST /powens/nuit (pg_cron) → rapport. Dans l'ordre : purge du détail de plus de 90 jours (aussi planifiée seule en SQL,
   boussole-banque-purge) ; suppression chez Powens des utilisateurs mis de côté par delete_me (prive.powens_a_supprimer) ;
   relance (PUT background=true, sans l'utilisateur) des connexions de plus de 36 h. Aucune synchronisation ici : Powens notifie
   CONNECTION_SYNCED à la fin de la relance et le webhook synchronise. Arrêt à 60 % du budget de temps, la suite est reportée. */
app.post("/nuit", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const jeton = bearer(req);
  if (!jeton) return erreur(401, "non autorisé");
  const check = await db.rpc("check_powens_nuit_token", { p: jeton });
  if (check.error) {
    console.error("powens: vérification de la nuit impossible", check.error.message);
    return erreur(500, "vérification impossible");
  }
  if (check.data !== true) return erreur(401, "non autorisé");

  const t0 = deps.horloge();
  const tempsDepasse = () => deps.horloge() - t0 > ARRET_NUIT_MS;
  const maintenant = deps.maintenant();
  const rapport = { ok: false, purgees: 0, utilisateurs_supprimes: 0, utilisateurs: 0, relancees: 0, erreurs: [] as { connexion?: number; erreur: string }[] };

  // 1. Purge, d'abord (rapide, indépendante de Powens).
  const purge = await db.rpc("banque_purger", { p_jours: JOURS_PURGE });
  if (purge.error) rapport.erreurs.push({ erreur: `purge : ${purge.error.message}` });
  else rapport.purgees = Number(purge.data ?? 0);

  const cfg = configPowens();
  // 2. Utilisateurs Powens dont le compte Boussole a été supprimé : DELETE /users/me avec leur jeton, puis effacement.
  const aSupprimer = await db.rpc("powens_a_supprimer_lister", { p_limite: A_SUPPRIMER_MAX });
  if (aSupprimer.error) rapport.erreurs.push({ erreur: `utilisateurs à supprimer : ${aSupprimer.error.message}` });
  const liste = (aSupprimer.data ?? []) as { id: number; jeton: string | null }[];
  if (liste.length && !cfg) rapport.erreurs.push({ erreur: "configuration Powens absente : suppressions reportées" });
  for (const a of cfg ? liste : []) {
    if (tempsDepasse()) { rapport.erreurs.push({ erreur: "temps dépassé, suppressions reportées" }); break; }
    if (a.jeton) {
      try {
        await api(cfg!.base, a.jeton, deps.fetch).supprimerUtilisateur(); // 404 toléré : déjà parti
      } catch (e) {
        if (!(e instanceof PowensErreur && (e.status === 401 || e.status === 403))) {
          rapport.erreurs.push({ erreur: `suppression d'un utilisateur Powens : ${msg(e)}` });
          continue;
        }
      }
    }
    const fait = await db.rpc("powens_a_supprimer_fait", { p_id: a.id });
    if (fait.error) rapport.erreurs.push({ erreur: `effacement d'un utilisateur supprimé : ${fait.error.message}` });
    else rapport.utilisateurs_supprimes++;
  }

  // 3. Relances.
  const actifs = await db.from("fonctionnalites").select("user_id").eq("cle", "banque").eq("active", true);
  if (actifs.error) rapport.erreurs.push({ erreur: `lecture des interrupteurs : ${actifs.error.message}` });
  const users: string[] = [...new Set(((actifs.data ?? []) as any[]).map((f: any) => String(f.user_id)))];
  if (users.length && !cfg) rapport.erreurs.push({ erreur: "configuration Powens absente : aucune relance" });
  for (const userId of cfg ? users : []) {
    rapport.utilisateurs++;
    const cx = await db.from("banque_connexions").select("id, derniere_synchro").eq("user_id", userId);
    if (cx.error) { rapport.erreurs.push({ erreur: `lecture des connexions : ${cx.error.message}` }); continue; }
    const anciennes = (cx.data ?? []).filter((x: any) => !x.derniere_synchro || Date.parse(x.derniere_synchro) < maintenant.getTime() - RELANCE_APRES_MS);
    if (!anciennes.length) continue;
    let jetonUser: string | null = null;
    try { jetonUser = await jetonDe(db, userId); } catch (e) { rapport.erreurs.push({ erreur: msg(e) }); continue; }
    if (!jetonUser) { rapport.erreurs.push({ erreur: "accès Powens introuvable pour un utilisateur actif" }); continue; }
    const client = api(cfg!.base, jetonUser, deps.fetch);
    for (const x of anciennes) {
      const id = Number(x.id);
      if (tempsDepasse()) { rapport.erreurs.push({ connexion: id, erreur: "temps dépassé, relance reportée" }); continue; }
      try {
        await client.relancer(id);
        rapport.relancees++;
      } catch (e) {
        rapport.erreurs.push({ connexion: id, erreur: `relance : ${msg(e)}` });
      }
    }
  }
  rapport.ok = rapport.erreurs.length === 0;
  console.log(`powens: nuit, ${rapport.purgees} opération(s) purgée(s), ${rapport.utilisateurs_supprimes} utilisateur(s) Powens supprimé(s), ${rapport.relancees} relance(s), ${rapport.erreurs.length} erreur(s)`);
  return json(rapport);
});

/* GET /powens/retour (redirect_uri) → 302 vers l'app, avec connection_id (chiffres) et error (code [a-z_]) seulement ;
   error_description n'est jamais transmise (supabase-js la prendrait pour une erreur d'authentification et effacerait la session). */
app.get("/retour", (c: any) => {
  const u = new URL(c.req.raw.url);
  const p: string[] = [];
  const id = u.searchParams.get("connection_id");
  const err = u.searchParams.get("error");
  if (id && /^[0-9]{1,15}$/.test(id)) p.push(`connection_id=${id}`);
  if (err && /^[a-z_]{1,64}$/.test(err)) p.push(`error=${err}`);
  return new Response(null, { status: 302, headers: { Location: APP_URL + (p.length ? `?${p.join("&")}` : "") } });
});

Deno.serve(app.fetch);
