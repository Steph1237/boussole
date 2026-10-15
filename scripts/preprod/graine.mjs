// Graine des comptes fictifs (SEC5, spec § 3.5) : un compte modèle par foyer, créé par l'API d'administration de GoTrue LOCAL (clé de
// service locale lue à chaque exécution, jamais écrite), foyer chargé, double authentification TOTP enrôlée avec un code calculé
// localement (RFC 6238) pour les foyers `mfa`. Identifiants rangés dans .preprod/comptes.json (droits 600), rien n'est affiché.
//   node scripts/preprod/graine.mjs         npm run preprod:seed
// `compteNeuf(slug, { variante, jeton })` sert au banc : un compte jetable par cas, avec un jeton aal2, aal1 ou de session simple.
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { garde, assertLocal, assertCleLocale, assertChemin, RACINE } from "./garde.mjs";
import { preparerEnv } from "./env.mjs";
import { chargerFoyer, clientSupabase, lireFoyer, reessayer } from "./charger-foyer.mjs";
import { codeTotp, secretDepuisUri } from "./totp.mjs";

export const FOYERS_DE_BASE = ["jeune-actif", "couple-enfants", "proprietaire-credit", "independant", "preretraite", "endette", "vide", "mfa-aal1"];
const SANS_SESSION = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

export const emailDe = slug => `${slug}@preprod.boussole.test`;
/** Mot de passe aléatoire conforme à la politique locale (lettres et chiffres, 8 caractères au moins). */
export const motDePasse = () => `Pp${randomBytes(15).toString("base64url").replace(/[^A-Za-z0-9]/g, "x")}9`;
const identifiantJetable = slug => `${slug}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@preprod.boussole.test`;

/** Clients locaux contrôlés par la garde : { url, admin (clé de service), anon (clé publiable) }. */
export function clientsLocaux({ racine = RACINE, variables } = {}) {
  const v = variables ?? preparerEnv({ racine });
  assertLocal(v.url); assertCleLocale(v.service); assertCleLocale(v.publiable);
  return { url: v.url, publiable: v.publiable, admin: createClient(v.url, v.service, SANS_SESSION), anon: () => createClient(v.url, v.publiable, SANS_SESSION) };
}

async function attendreAuth(url, essais = 30) {
  for (let i = 0; i < essais; i++) {
    try { const r = await fetch(`${url}/auth/v1/health`); if (r.status < 500) return; } catch { /* pile en cours de démarrage */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("GoTrue local ne répond pas");
}

async function supprimerParEmail(admin, email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`liste des comptes : ${error.message}`);
    const u = data.users.find(x => x.email === email);
    if (u) { const r = await admin.auth.admin.deleteUser(u.id); if (r.error) throw new Error(`suppression de ${email} : ${r.error.message}`); return true; }
    if (data.users.length < 200) return false;
  }
  return false;
}

/** Enrôle un facteur TOTP, le vérifie avec un code calculé, renvoie { secret, facteur, session } (session aal2). */
export async function enroler(clients, email, password) {
  const c = clients.anon();
  const connexion = await c.auth.signInWithPassword({ email, password });
  if (connexion.error) throw new Error(`connexion de ${email} : ${connexion.error.message}`);
  const e = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: "preprod" });
  if (e.error) throw new Error(`enrôlement TOTP de ${email} : ${e.error.message}`);
  const secret = e.data.totp.secret || secretDepuisUri(e.data.totp.uri);
  const session = await verifierFacteur(c, e.data.id, secret);
  return { secret, facteur: e.data.id, session };
}

/** Challenge puis verify avec le code du moment ; réessaie avec le pas suivant si la fenêtre vient de changer. */
export async function verifierFacteur(c, facteur, secret) {
  const ch = await c.auth.mfa.challenge({ factorId: facteur });
  if (ch.error) throw new Error(`challenge TOTP : ${ch.error.message}`);
  let derniere;
  for (const fenetre of [0, -1, 1]) {
    const v = await c.auth.mfa.verify({ factorId: facteur, challengeId: ch.data.id, code: codeTotp(secret, Date.now(), { fenetre }) });
    if (!v.error) return v.data;
    derniere = v.error;
    // un challenge ne sert qu'une fois : en cas d'échec, on en rouvre un
    const ch2 = await c.auth.mfa.challenge({ factorId: facteur });
    if (ch2.error) break;
    ch.data.id = ch2.data.id;
  }
  throw new Error(`vérification TOTP : ${derniere?.message ?? "échec"}`);
}

function niveau(accessToken) {
  const c = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
  return c.aal || null;
}

/** Crée un compte, charge son foyer, enrôle le TOTP si le foyer en a un. Renvoie { uid, email, password, secret? }. */
async function creerCompte(clients, slug, { variante, email, aujourdhui } = {}) {
  const foyer = lireFoyer(slug);
  const adresse = email ?? emailDe(slug), password = motDePasse();
  const { data, error } = await reessayer(() => clients.admin.auth.admin.createUser({ email: adresse, password, email_confirm: true }));
  if (error) throw new Error(`création de ${adresse} : ${error.message}`);
  const uid = data.user.id;
  try {
    await chargerFoyer(clientSupabase(clients.admin), uid, slug, { variante, aujourdhui });
    const compte = { uid, email: adresse, password, mfa: !!foyer.mfa, jeton: foyer.jeton ?? "session" };
    if (foyer.mfa) compte.totp_secret = (await enroler(clients, adresse, password)).secret;
    return compte;
  } catch (e) {
    await clients.admin.auth.admin.deleteUser(uid).catch(() => {});
    throw e;
  }
}

/**
 * Compte jetable pour un cas du banc : foyer (et variante) chargés, jeton du niveau demandé.
 *   jeton "aal2" : mot de passe puis second facteur ; "aal1" : mot de passe seul (le facteur reste vérifié, donc les tables personnelles
 *   restent fermées par la RLS 0028) ; "session" : jeton de session simple (foyer sans facteur). Par défaut : celui du foyer.
 */
export async function compteNeuf(slug, { variante, jeton, clients = clientsLocaux(), aujourdhui } = {}) {
  const compte = await creerCompte(clients, slug, { variante, email: identifiantJetable(slug), aujourdhui });
  const voulu = jeton ?? compte.jeton;
  const c = clients.anon();
  const s = await c.auth.signInWithPassword({ email: compte.email, password: compte.password });
  if (s.error) throw new Error(`connexion de ${compte.email} : ${s.error.message}`);
  let session = s.data.session;
  if (voulu === "aal2") {
    if (!compte.mfa) throw new Error(`le foyer ${slug} n'a pas de double authentification : pas de jeton aal2`);
    const f = (await c.auth.mfa.listFactors()).data?.totp?.[0];
    session = (await verifierFacteur(c, f.id, compte.totp_secret)).session ?? (await c.auth.getSession()).data.session;
  }
  return {
    uid: compte.uid, email: compte.email, accessToken: session.access_token, refreshToken: session.refresh_token, aal: niveau(session.access_token),
    totpSecret: compte.totp_secret ?? null,
    /** Pour une nouvelle connexion (jamais à afficher ni écrire). */
    identifiants() { return { email: compte.email, password: compte.password }; },
    async supprimer() { await clients.admin.auth.admin.deleteUser(compte.uid).catch(() => {}); },
  };
}

/** Crée (ou recrée) les comptes modèles ; écrit .preprod/comptes.json (600). Ne renvoie ni mot de passe ni secret. */
export async function graine({ racine = RACINE, slugs = FOYERS_DE_BASE, clients, aujourdhui } = {}) {
  garde({ racine });
  clients ??= clientsLocaux({ racine });
  await attendreAuth(clients.url);
  const comptes = {};
  for (const slug of slugs) {
    await supprimerParEmail(clients.admin, emailDe(slug));
    const c = await creerCompte(clients, slug, { aujourdhui });
    comptes[slug] = { email: c.email, password: c.password, uid: c.uid, mfa: c.mfa, jeton: c.jeton, ...(c.totp_secret ? { totp_secret: c.totp_secret } : {}) };
  }
  const chemin = assertChemin(join(racine, ".preprod/comptes.json"), racine);
  mkdirSync(join(racine, ".preprod"), { recursive: true });
  writeFileSync(chemin, JSON.stringify({ cree_le: new Date().toISOString(), url: clients.url, comptes }, null, 2), { mode: 0o600 });
  chmodSync(chemin, 0o600);
  console.log(`${slugs.length} comptes fictifs prêts (${slugs.filter(s => comptes[s].mfa).length} avec double authentification) : .preprod/comptes.json`);
  return Object.fromEntries(Object.entries(comptes).map(([s, c]) => [s, { email: c.email, uid: c.uid, mfa: c.mfa }]));
}

export function lireComptes({ racine = RACINE } = {}) {
  const chemin = assertChemin(join(racine, ".preprod/comptes.json"), racine);
  if (!existsSync(chemin)) throw new Error("pas de .preprod/comptes.json : lance `npm run preprod:seed`");
  return JSON.parse(readFileSync(chemin, "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  graine().catch(e => { console.error(e.message); process.exit(1); });
}
