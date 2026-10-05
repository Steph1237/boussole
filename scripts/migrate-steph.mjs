#!/usr/bin/env node
// Migre les données de l'artefact « Pilotage patrimoine » (copie locale) vers un compte Boussole.
//
//   SUPABASE_SERVICE_KEY=… node scripts/migrate-steph.mjs --email vous@exemple.fr               (aperçu, n'écrit rien)
//   SUPABASE_SERVICE_KEY=… node scripts/migrate-steph.mjs --email vous@exemple.fr --appliquer   (écrit)
//   options : --source <dossier>  (défaut ~/Finance/sources/db) · --remplacer (efface d'abord les placements du compte)
//
// Le compte doit exister (inscription sur Boussole, e-mail confirmé). La clé de service n'est lue que dans l'environnement.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { adminClient, hasServiceKey } from "../test/helpers/supabase.mjs";
import { mapInstruments, mapPositions, mapTransactions, mapSnapshots, mapConfig, mapProfile, instrumentKey } from "./lib/migrate-map.mjs";
const require = createRequire(import.meta.url);
const Calc = require("../web/src/calc.js");

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--appliquer"), REPLACE = args.includes("--remplacer");
const SOURCE = opt("--source") || join(homedir(), "Finance/sources/db");
const EMAIL = (opt("--email") || "").trim().toLowerCase();
const eur = v => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " €";
const die = m => { console.error("✖ " + m); process.exit(1); };

if (!hasServiceKey) die("SUPABASE_SERVICE_KEY absente de l'environnement.");
if (!EMAIL) die("Indiquez --email <adresse du compte Boussole>.");
if (!existsSync(join(SOURCE, "positions"))) die("Dossier source introuvable : " + SOURCE);

const readDir = d => existsSync(join(SOURCE, d)) ? readdirSync(join(SOURCE, d)).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(join(SOURCE, d, f), "utf8"))) : [];
const readOne = (d, id) => existsSync(join(SOURCE, d, id + ".json")) ? JSON.parse(readFileSync(join(SOURCE, d, id + ".json"), "utf8")) : null;
const src = { positions: readDir("positions"), snapshots: readDir("snapshots"), tx: readDir("transactions"), config: readOne("config", "main"), profil: readOne("profil", "main") };

/* Symbole Yahoo par ISIN (cotations en euros en priorité) ; en cas d'échec, le symbole deviné du ticker est gardé. */
async function searchSymbol(isin) {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=6&newsCount=0`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const q = ((await r.json()).quotes || []).filter(x => x.symbol);
    const eu = q.find(x => ["PAR", "AMS", "GER", "FRA", "MIL", "EBS"].includes(x.exchange)) || q[0];
    return eu ? eu.symbol : null;
  } catch { return null; }
}

const db = adminClient();
async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die("Lecture des comptes impossible : " + error.message);
    const u = data.users.find(x => (x.email || "").toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

const user = await findUser(EMAIL);
if (!user) die(`Aucun compte Boussole pour ${EMAIL}. Créez-le sur le site, confirmez l'e-mail, puis relancez.`);
if (!user.email_confirmed_at) die("Le compte existe mais l'adresse e-mail n'est pas confirmée.");
console.log(`Compte : ${EMAIL} (${user.id})`);

const symbols = {};
for (const p of src.positions) {
  const k = instrumentKey(p);
  if (k && !k.startsWith("X-") && !(k in symbols)) symbols[k] = await searchSymbol(k);
}
const instruments = mapInstruments(src.positions, Object.fromEntries(Object.entries(symbols).filter(([, s]) => s)));
const { rows: positions, ids } = mapPositions(src.positions, user.id);
const tx = mapTransactions(src.tx, ids, user.id);
const snapshots = mapSnapshots(src.snapshots, user.id);
const config = mapConfig(src.config, src.positions, ids, user.id);
const profile = mapProfile(src.profil, user.id);

// Total attendu : positions revalorisées avec le cours unique de chaque instrument, comparé au total calculé dans l'artefact.
const priceOf = Object.fromEntries(instruments.map(i => [i.isin, i.price]));
const asCalc = rows => rows.map(r => ({ owner: r.owner, mode: r.mode, qty: r.qty, value: r.value, status: r.status, price: r.isin ? priceOf[r.isin] : null }));
const srcTotal = Calc.financier(src.positions.map(p => Object.assign({}, p, { owner: p.owner === "compagne" ? "p2" : "p1" })), "foyer");
const newTotal = Calc.financier(asCalc(positions), "foyer");

console.log(`\nÀ migrer : ${positions.length} placements · ${instruments.length} instruments · ${tx.length} transactions · ${snapshots.length} photos · ${config.rules.length} règles · ${config.recurring.length} versements programmés`);
console.log("Instruments sans symbole de cotation (cours manuel jusqu'à correction) :", instruments.filter(i => !i.symbol).map(i => `${i.isin} ${i.name}`).join(", ") || "aucun");
console.log(`Total financier : artefact ${eur(srcTotal)} → Boussole ${eur(newTotal)} (écart ${eur(newTotal - srcTotal)}, dû aux lignes qui partagent un ISIN)`);

const { count: existing } = await db.from("positions").select("id", { count: "exact", head: true }).eq("user_id", user.id);
if (existing && !REPLACE) die(`Le compte contient déjà ${existing} placement(s). Relancez avec --remplacer pour les effacer avant migration.`);
if (!APPLY) { console.log("\nAperçu uniquement : rien n'a été écrit. Ajoutez --appliquer pour migrer."); process.exit(0); }

const must = (label, { error }) => { if (error) die(`${label} : ${error.message}`); };
if (REPLACE) {
  for (const t of ["transactions", "positions", "snapshots"]) must("Effacement " + t, await db.from(t).delete().eq("user_id", user.id));
}
// Instruments partagés : on ajoute les absents ; pour les existants, on complète seulement le symbole manquant.
const { data: known } = await db.from("instruments").select("isin, symbol").in("isin", instruments.map(i => i.isin));
const knownMap = Object.fromEntries((known || []).map(k => [k.isin, k]));
const fresh = instruments.filter(i => !knownMap[i.isin]).map(i => Object.assign({}, i, { requested_by: user.id }));
if (fresh.length) must("Instruments", await db.from("instruments").insert(fresh));
for (const i of instruments) if (knownMap[i.isin] && !knownMap[i.isin].symbol && i.symbol) must("Symbole " + i.isin, await db.from("instruments").update({ symbol: i.symbol }).eq("isin", i.isin));

must("Placements", await db.from("positions").insert(positions));
if (tx.length) must("Transactions", await db.from("transactions").insert(tx));
if (snapshots.length) must("Photos", await db.from("snapshots").upsert(snapshots, { onConflict: "user_id,date" }));
must("Réglages", await db.from("config").upsert(config, { onConflict: "user_id" }));
must("Profil", await db.from("profiles").upsert(profile, { onConflict: "user_id" }));

// Vérification par relecture : même calcul que l'application.
const { data: back, error: e2 } = await db.from("positions").select("owner, mode, qty, value, status, price_override, instruments(price)").eq("user_id", user.id);
if (e2) die("Relecture : " + e2.message);
const readTotal = Calc.financier(back.map(r => ({ owner: r.owner, mode: r.mode, qty: r.qty, value: r.value, status: r.status, price: r.price_override ?? r.instruments?.price ?? null })), "foyer");
console.log(`\n✔ Migration écrite. Relecture : ${back.length} placements, total financier ${eur(readTotal)}${Math.abs(readTotal - newTotal) < 0.01 ? " (conforme)" : " — ÉCART avec l'attendu " + eur(newTotal)}`);
