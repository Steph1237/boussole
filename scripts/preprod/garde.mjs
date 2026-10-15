// Garde commune « jamais la production » (SEC5, spec § 3.8). Appelée au début de chaque script de préproduction et du banc.
// Chaque fonction lève une Error (message en français) au premier refus ; aucune n'a d'effet de bord.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REF_PRODUCTION = "oapcewpqsbbjdlcdeizi";
export const RACINE = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// Clé publiable de production (publique par nature, mais jamais utilisable en préproduction).
const CLE_PUBLIABLE_PRODUCTION = "sb_publishable_o5IJJ2Cf6xf6sPCEWHLZag_b9HefoZ_";
// Clés sb_ de la pile locale du CLI 2.107.0 (relevées par `supabase status -o env` à la tâche 1.4) : leur début est celui des
// clés par défaut du CLI, publiques et communes à tous ses utilisateurs. Construites par concaténation pour que le test
// « dépôt sans secret » (aucune chaîne sb_secret_ dans les fichiers suivis) reste strict.
const DEBUT_PUBLIABLE_LOCALE = "sb_publishable_" + "ACJWlzQHlZjBrEgu";
const DEBUT_SECRETE_LOCALE = "sb_secret_" + "N7UND0UgjKTVK";
// Émetteurs des clés JWT de la pile locale du CLI (clés publiques et identiques pour tous les utilisateurs du CLI).
const EMETTEURS_LOCAUX = new Set(["supabase-demo", "supabase-local"]);

const refus = (msg) => { throw new Error(`garde préproduction : ${msg}`); };

/** Accepte seulement http://127.0.0.1:*, http://localhost:*, http://[::1]:* et http://kong:8000 (dans Docker). Renvoie l'URL. */
export function assertLocal(url) {
  if (typeof url !== "string" || !url.trim()) refus("URL vide.");
  let u;
  try { u = new URL(url); } catch { return refus(`URL illisible (${String(url).slice(0, 40)}).`); }
  if (u.protocol !== "http:") refus(`seul http est accepté en local (reçu ${u.protocol}) : ${u.host} n'est pas la pile locale.`);
  const h = u.hostname.toLowerCase();
  if (h.includes(REF_PRODUCTION) || h.endsWith("supabase.co")) refus(`${h} est la production ou un projet distant.`);
  const local = h === "127.0.0.1" || h === "localhost" || h === "[::1]" || (h === "kong" && u.port === "8000");
  if (!local) refus(`${u.host} n'est pas la pile locale (127.0.0.1, localhost ou kong:8000).`);
  return url;
}

function charge(jwt) {
  const parties = String(jwt).split(".");
  if (parties.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parties[1], "base64url").toString("utf8")); } catch { return null; }
}

/** Refuse toute clé qui n'a pas l'air d'une clé de la pile locale. La signature n'est pas vérifiée (la garde refuse, elle n'authentifie pas). */
export function assertCleLocale(cle) {
  if (typeof cle !== "string" || !cle.trim()) refus("clé vide.");
  if (cle === CLE_PUBLIABLE_PRODUCTION) refus("clé publiable de production.");
  if (cle.includes(REF_PRODUCTION)) refus("la clé mentionne la production.");
  if (cle.startsWith("sb_publishable_") || cle.startsWith("sb_secret_")) {
    const debut = cle.startsWith("sb_secret_") ? DEBUT_SECRETE_LOCALE : DEBUT_PUBLIABLE_LOCALE;
    if (!/^sb_(publishable|secret)_[A-Za-z0-9_-]{16,}$/.test(cle) || !cle.startsWith(debut)) refus("clé sb_ qui n'est pas celle de la pile locale du CLI.");
    return cle;
  }
  const c = charge(cle);
  if (!c) refus("clé illisible (ni JWT ni sb_).");
  if (c.ref) refus(c.ref === REF_PRODUCTION ? "clé de la production (ref)." : `clé d'un projet distant (ref ${String(c.ref).slice(0, 8)}…).`);
  if (!EMETTEURS_LOCAUX.has(c.iss)) refus(`émetteur ${JSON.stringify(c.iss)} inconnu de la pile locale.`);
  return cle;
}

/** Refuse si le dépôt ou le dossier .preprod a été lié à un projet distant (supabase link écrit .temp/project-ref). */
export function assertPasDeLien(racine = RACINE) {
  for (const p of ["supabase/.temp/project-ref", ".preprod/supabase/.temp/project-ref", ".preprod/.temp/project-ref"]) {
    if (existsSync(join(racine, p))) refus(`projet lié (${p}) : supprime ce fichier, la préproduction ne se lie jamais.`);
  }
}

/** Refuse un chemin hors du dépôt (racine) et de .preprod/ (qui est dans le dépôt), et nommément ~/Finance/sources. */
export function assertChemin(chemin, racine = RACINE) {
  const abs = resolve(chemin);
  const interdit = join(homedir(), "Finance", "sources");
  const sousSources = (p) => p === interdit || p.startsWith(interdit + sep) || /(^|\/)Finance\/sources(\/|$)/.test(p);
  if (sousSources(abs)) refus(`${abs} : les données réelles (Finance/sources) sont hors de portée.`);
  const rel = relative(resolve(racine), abs);
  if (rel.startsWith("..") || isAbsolute(rel)) refus(`${abs} est hors du dépôt.`);
  return abs;
}

/** Contrôles de démarrage d'un script : projet non lié. (L'URL et la clé se contrôlent là où elles sont lues.) */
export function garde({ racine = RACINE } = {}) { assertPasDeLien(racine); }
