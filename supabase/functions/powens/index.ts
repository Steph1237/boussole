// Boussole : fonction serveur `powens` (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 1 ; contrat dans
// docs/superpowers/plans/2026-10-12-bq1-powens.md › Fonction serveur).
//
// Déploiement : verify_jwt = false. Chaque route contrôle elle-même l'appelant :
// - /connecter, /deconnecter, /supprimer : JWT Supabase de l'utilisateur (auth.getUser) ;
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
// - retour : redirect_uri?connection_id=… en cas de succès, ?error=…&error_description=… sinon. redirect_uri (RETOUR_URL) est
//   déclarée dans la console Powens ; /retour ne transmet à l'app que connection_id (chiffres) et error (code [a-z_]), jamais
//   error_description : supabase-js lirait ce paramètre comme une erreur d'authentification et effacerait la session.
//
// Webhooks (https://docs.powens.com/documentation/integration-guides/webhooks) : POST JSON, 2XX attendu (sinon Powens réessaie) ;
// en-tête Authorization: Bearer <jeton utilisateur> ; signature facultative BI-Signature = BASE64(HMAC_SHA256(METHOD + "." +
// endpoint + "." + date + "." + payload)) avec la date de BI-Signature-Date. Aucun champ ne porte le nom de l'événement : on
// déclare une URL par événement (/powens/webhook/connection_synced, /connection_deleted, /account_disabled) ; /powens/webhook
// seul déduit l'événement de la forme du contenu. Formes (https://docs.powens.com/api-reference/user-connections/connections et
// …/data-aggregation/bank-accounts) : CONNECTION_SYNCED { user, connection: { id, … } } ; CONNECTION_DELETED = objet connexion
// { id, id_connector, state, … } ; ACCOUNT_DISABLED = objet compte { id, id_connection, disabled, … }.
import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { api, domaine, PowensErreur } from "./powens-api.ts";
import { synchroniser, oublierConnexion } from "./synchro.ts";

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
const erreur = (status: number, message: string) => json({ erreur: message }, status);
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

async function utilisateur(db: any, req: Request): Promise<{ id: string } | null> {
  const jwt = bearer(req);
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  return error || !data?.user?.id ? null : { id: data.user.id };
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

/* POST /powens/connecter { connection_id? } → { url } (page de connexion, ou de reconnexion avec connection_id). */
app.post("/connecter", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
  const f = await db.from("fonctionnalites").select("active").eq("user_id", user.id).eq("cle", "banque").maybeSingle();
  if (f.error) return erreur(500, "Erreur interne : réessaie dans un moment.");
  if (f.data?.active !== true) return erreur(403, MSG_FERME);
  const cfg = configPowens();
  if (!cfg) return erreur(503, MSG_CONFIG);
  const corps = await lireCorps(req);
  if (!corps) return erreur(400, "Requête illisible.");
  let connexionId: number | null = null;
  if (corps.connection_id != null) {
    connexionId = idPowens(corps.connection_id);
    if (connexionId == null) return erreur(400, "connection_id invalide.");
  }
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
    }
    const e = encodeURIComponent;
    const url = connexionId == null
      ? `https://webview.powens.com/connect?domain=${e(cfg.nom + ".biapi.pro")}&client_id=${e(cfg.clientId)}&redirect_uri=${e(RETOUR_URL)}&code=${e(code)}`
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

/* POST /powens/supprimer → { ok: true } : suppression de l'utilisateur Powens, avant delete_me(). 401, 403 ou 404 chez Powens :
   l'utilisateur est déjà parti (ou son jeton ne vaut plus rien) → oublié quand même. */
app.post("/supprimer", async (c: any) => {
  const req: Request = c.req.raw;
  const db = admin();
  if (!db) return erreur(500, "Configuration serveur manquante.");
  const user = await utilisateur(db, req);
  if (!user) return erreur(401, MSG_NON_CONNECTE);
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
type Evenement = "CONNECTION_SYNCED" | "CONNECTION_DELETED" | "ACCOUNT_DISABLED";
const EVENEMENTS: Evenement[] = ["CONNECTION_SYNCED", "CONNECTION_DELETED", "ACCOUNT_DISABLED"];

/** Événement : nom du chemin s'il est donné, sinon déduit de la forme du contenu. */
function evenementDe(chemin: string | undefined, corps: any): Evenement | null {
  if (chemin) {
    const e = chemin.toUpperCase() as Evenement;
    return EVENEMENTS.includes(e) ? e : null;
  }
  if (corps?.connection && typeof corps.connection === "object") return "CONNECTION_SYNCED";
  if (corps?.connection_id != null) return "CONNECTION_SYNCED";
  if (corps?.id != null && "id_connection" in corps) return "ACCOUNT_DISABLED";
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
  if (ev === "CONNECTION_SYNCED") {
    const id = idPowens(corps?.connection?.id ?? corps?.id_connection ?? corps?.connection_id);
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
  const users = [...new Set((actifs.data ?? []).map((f: any) => String(f.user_id)))];
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
