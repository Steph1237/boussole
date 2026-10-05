// Aides Supabase pour les tests d'intégration (isolation RLS).
//
// - `url` et `key` (clé publiable) sont lus dans web/config.js : une seule source de vérité.
// - La clé service (`SUPABASE_SERVICE_KEY`) vient uniquement de l'environnement : jamais dans
//   le repo, jamais affichée. Sans elle, `hasServiceKey` vaut false et les tests se sautent.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const CONFIG_PATH = fileURLToPath(new URL("../../web/config.js", import.meta.url));

function readConfig() {
  const src = readFileSync(CONFIG_PATH, "utf8");
  const pick = (name) => {
    const m = src.match(new RegExp(`${name}\\s*:\\s*["']([^"']+)["']`));
    if (!m) throw new Error(`web/config.js : champ ${name} introuvable`);
    return m[1];
  };
  return { url: pick("supabaseUrl"), key: pick("supabaseKey") };
}

export const { url, key } = readConfig();

const serviceKey = process.env.SUPABASE_SERVICE_KEY || "";
export const hasServiceKey = serviceKey.length > 0;
export const SKIP_REASON = "SUPABASE_SERVICE_KEY absent : test d'isolation non exécuté";

const NO_SESSION = { auth: { autoRefreshToken: false, persistSession: false } };

/** Client rôle service (contourne RLS). Lève une erreur si la clé service est absente. */
export function adminClient() {
  if (!hasServiceKey) throw new Error(SKIP_REASON);
  return createClient(url, serviceKey, NO_SESSION);
}

/** Client anonyme (clé publiable), sans session persistée. */
export function userClient() {
  return createClient(url, key, NO_SESSION);
}

/**
 * Crée un utilisateur de test confirmé via l'API admin, puis renvoie un client connecté
 * avec son mot de passe : `{ id, email, client }`.
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
  return { id, email, client };
}

/** Supprime un utilisateur de test (cascade sur toutes ses tables). */
export async function deleteTestUser(id) {
  if (!id) return;
  const { error } = await adminClient().auth.admin.deleteUser(id);
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new Error(`suppression de l'utilisateur ${id} impossible : ${error.message}`);
  }
}
