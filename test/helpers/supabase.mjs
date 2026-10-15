// Aides Supabase pour les tests d'intégration (isolation RLS, journal, savoir, nuit).
//
// SEC5 : les tests visent la PRÉPRODUCTION LOCALE, jamais la production. La cible vient de l'environnement :
//   BOUSSOLE_SUPABASE_URL   URL de la pile locale (http://127.0.0.1:54521)
//   BOUSSOLE_SUPABASE_KEY   clé publiable locale
//   SUPABASE_SERVICE_KEY    clé de service locale (jamais dans le dépôt, jamais affichée)
// `npm run preprod:test` les renseigne depuis `supabase status` ; à la main : eval "$(node scripts/preprod/env.mjs --export)".
// Sans cible locale, `hasServiceKey` vaut false et les tests d'intégration se sautent (avec la raison dans SKIP_REASON).
// Garde : une URL qui n'est pas locale, ou une clé qui n'est pas celle de la pile locale, fait lever une erreur à l'import, sauf
// BOUSSOLE_PROD=1, réservé à scripts/migrate-steph.mjs (outil de production légitime : URL lue dans web/config.js, comme avant).
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertLocal, assertCleLocale } from "../../scripts/preprod/garde.mjs";
import { codeTotp, secretDepuisUri } from "../../scripts/preprod/totp.mjs";

const CONFIG_PATH = fileURLToPath(new URL("../../web/config.js", import.meta.url));

function lireConfigProduction() {
  const src = readFileSync(CONFIG_PATH, "utf8");
  const pick = (name) => {
    const m = src.match(new RegExp(`${name}\\s*:\\s*["']([^"']+)["']`));
    if (!m) throw new Error(`web/config.js : champ ${name} introuvable`);
    return m[1];
  };
  return { url: pick("supabaseUrl"), key: pick("supabaseKey") };
}

const RAISON_DEFAUT = "préproduction locale non active (BOUSSOLE_SUPABASE_URL, BOUSSOLE_SUPABASE_KEY et SUPABASE_SERVICE_KEY absents) : test d'intégration non exécuté, lance `npm run preprod:test`";

/** Résout la cible des tests depuis un environnement. Pure (testée). Lève si la cible n'est pas la pile locale. */
export function resoudreCible(env = process.env) {
  const prod = env.BOUSSOLE_PROD === "1";
  const serviceKey = env.SUPABASE_SERVICE_KEY || "";
  let url = env.BOUSSOLE_SUPABASE_URL || "", key = env.BOUSSOLE_SUPABASE_KEY || "";
  if (!url && prod) { const p = lireConfigProduction(); url = p.url; key = key || p.key; }
  if (!url) {
    return { actif: false, url: "", key: "", serviceKey: "", raison: serviceKey ? `${RAISON_DEFAUT} (SUPABASE_SERVICE_KEY est définie mais ignorée sans cible locale)` : RAISON_DEFAUT };
  }
  if (!prod) {
    assertLocal(url);
    if (serviceKey) assertCleLocale(serviceKey);
    if (key) assertCleLocale(key);
  }
  const manque = [!key && "BOUSSOLE_SUPABASE_KEY", !serviceKey && "SUPABASE_SERVICE_KEY"].filter(Boolean);
  if (manque.length) return { actif: false, url, key, serviceKey: "", raison: `${manque.join(" et ")} absent${manque.length > 1 ? "s" : ""} : test d'intégration non exécuté, lance \`npm run preprod:test\`` };
  return { actif: true, url, key, serviceKey, raison: "" };
}

const cible = resoudreCible();
export const url = cible.url;
export const key = cible.key;
export const hasServiceKey = cible.actif;
/** Raison affichée par les tests sautés (celle de la cible, ou le message par défaut). */
export const SKIP_REASON = cible.raison || RAISON_DEFAUT;
export const raisonSaut = SKIP_REASON;

/**
 * PostgREST 14 (pile locale du CLI 2.107.0) répond HTTP 500 « Something went wrong » à une exception SQL de code 54000 (limite atteinte :
 * journal, mémoire) au lieu de son message. Les tests de limite acceptent ce masque, à condition de relire ensuite le compte (export_all)
 * qui prouve que la ligne n'a pas été écrite : le refus est vérifié, seul le texte de l'erreur ne l'est plus.
 */
export const erreurMasquee = (error) => !!error && error.message === "Something went wrong";

const NO_SESSION = { auth: { autoRefreshToken: false, persistSession: false } };

/** Client rôle service (contourne RLS) de la pile locale. Lève une erreur sans cible locale. */
export function adminClient() {
  if (!hasServiceKey) throw new Error(SKIP_REASON);
  return createClient(url, cible.serviceKey, NO_SESSION);
}

/** Client anonyme (clé publiable), sans session persistée. */
export function userClient() {
  if (!url || !key) throw new Error(SKIP_REASON);
  return createClient(url, key, NO_SESSION);
}

/**
 * Crée un utilisateur de test confirmé via l'API admin, puis renvoie un client connecté
 * avec son mot de passe : `{ id, email, password, client }`.
 */
export async function createTestUser(label) {
  const admin = adminClient();
  const email = `test-${label}-${Date.now()}@boussole.test`;
  const password = `Tst-${randomBytes(12).toString("base64url")}!9`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`création de l'utilisateur ${label} impossible : ${error.message}`);
  const id = data.user.id;

  const client = userClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
    throw new Error(`connexion de l'utilisateur ${label} impossible : ${signIn.error.message}`);
  }
  return { id, email, password, client };
}

/**
 * Utilisateur de test à double authentification : compte confirmé, facteur TOTP enrôlé et vérifié avec un code calculé localement
 * (RFC 6238), donc une session aal2 comme un vrai utilisateur. Sert aux tables du régime bancaire (0028, 0033 : historique_*), fermées
 * à toute session aal1. Renvoie `{ id, email, client, nouvelleSessionAal1 }` : `client` est en aal2 ; `nouvelleSessionAal1()` ouvre une
 * session par mot de passe seul (aal1, le facteur reste vérifié).
 */
export async function createTestUserAal2(label) {
  const u = await createTestUser(label);
  try {
    const e = await u.client.auth.mfa.enroll({ factorType: "totp", friendlyName: "test" });
    if (e.error) throw new Error(`enrôlement TOTP impossible : ${e.error.message}`);
    const secret = e.data.totp.secret || secretDepuisUri(e.data.totp.uri);
    let derniere = new Error("aucun essai");
    for (const fenetre of [0, -1, 1]) {
      const ch = await u.client.auth.mfa.challenge({ factorId: e.data.id });
      if (ch.error) throw new Error(`challenge TOTP impossible : ${ch.error.message}`);
      const v = await u.client.auth.mfa.verify({ factorId: e.data.id, challengeId: ch.data.id, code: codeTotp(secret, Date.now(), { fenetre }) });
      derniere = v.error;
      if (!derniere) break;
    }
    if (derniere) throw new Error(`vérification TOTP impossible : ${derniere.message}`);
    const { email, password } = u;
    return {
      ...u,
      async nouvelleSessionAal1() {
        const c = userClient();
        const r = await c.auth.signInWithPassword({ email, password });
        if (r.error) throw new Error(`connexion impossible : ${r.error.message}`);
        return c;
      },
    };
  } catch (err) {
    await deleteTestUser(u.id).catch(() => {});
    throw err;
  }
}

/** Supprime un utilisateur de test (cascade sur toutes ses tables). */
export async function deleteTestUser(id) {
  if (!id) return;
  const { error } = await adminClient().auth.admin.deleteUser(id);
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new Error(`suppression de l'utilisateur ${id} impossible : ${error.message}`);
  }
}
