// Chargeur de foyer (SEC5, spec § 3.5/3.9) : couverture des tables user_id, résolution des dates et références, chargement des
// 8 foyers sur la chaîne complète (PGlite), totaux relus égaux à ceux du fichier, deux comptes sur le même foyer sans collision.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baseComplete } from "./helpers/pglite.mjs";
import {
  TRAITEES, IGNOREES, resoudreDate, uuidStable, fusionner, lireFoyer, lireCours, resoudreFoyer, totaux, chargerFoyer, purgerFoyer, clientPglite,
} from "../scripts/preprod/charger-foyer.mjs";

const require = createRequire(import.meta.url);
const Cal = require("../web/src/calendrier.js");
const Reperes = require("../web/src/reperes.js");
const Evenements = require("../web/src/projection-evenements.js");

const FOYERS = readdirSync(new URL("../banc/foyers/", import.meta.url)).filter(f => f.endsWith(".json") && !["cours.json", "schema.json"].includes(f)).map(f => f.replace(/\.json$/, "")).sort();
const AUJOURDHUI = "2026-10-15";
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db, client;
before(async () => { db = await baseComplete(); client = clientPglite(db); });
after(async () => { await db.close(); });
const creerUtilisateur = async uid => { await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [uid]); };

describe("couverture des tables user_id", () => {
  it("chaque table du schéma public qui a une colonne user_id est traitée ou ignorée pour une raison écrite", async () => {
    const { rows } = await db.query("select distinct table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id' order by 1");
    const reelles = rows.map(r => r.table_name);
    const connues = new Set([...TRAITEES, ...Object.keys(IGNOREES)]);
    const oubliees = reelles.filter(t => !connues.has(t));
    assert.deepEqual(oubliees, [], `table(s) avec user_id que le chargeur ne connaît pas : ${oubliees.join(", ")} (ajoute-la à TRAITEES ou à IGNOREES avec la raison)`);
    const fantomes = [...connues].filter(t => !reelles.includes(t));
    assert.deepEqual(fantomes, [], "tables citées mais inexistantes");
    for (const [t, raison] of Object.entries(IGNOREES)) assert.ok(raison.length > 20, `raison de ${t}`);
  });
});

describe("dates relatives et références", () => {
  it("J, M, FM", () => {
    assert.equal(resoudreDate("J-30", AUJOURDHUI), "2026-09-15");
    assert.equal(resoudreDate("J+0", AUJOURDHUI), "2026-10-15");
    assert.equal(resoudreDate("J+20", AUJOURDHUI), "2026-11-04");
    assert.equal(resoudreDate("M-56", AUJOURDHUI), "2022-02-15");
    assert.equal(resoudreDate("M+8", AUJOURDHUI), "2027-06-15");
    assert.equal(resoudreDate("FM-1", AUJOURDHUI), "2026-09-30");
    assert.equal(resoudreDate("FM-12", AUJOURDHUI), "2025-10-31");
    assert.equal(resoudreDate("FM+0", AUJOURDHUI), "2026-10-31");
  });
  it("M-k garde le quantième ou le dernier jour du mois", () => {
    assert.equal(resoudreDate("M-1", "2026-03-31"), "2026-02-28");
    assert.equal(resoudreDate("M-1", "2024-03-31"), "2024-02-29");
    assert.equal(resoudreDate("M+1", "2026-01-31"), "2026-02-28");
  });
  it("autre chose qu'un jeton : null", () => { assert.equal(resoudreDate("2026-01-01", AUJOURDHUI), null); assert.equal(resoudreDate("J-x", AUJOURDHUI), null); });
  it("uuidStable : déterministe, propre à l'utilisateur, forme v5", () => {
    assert.equal(uuidStable(U(1), "bien", "rp"), uuidStable(U(1), "bien", "rp"));
    assert.notEqual(uuidStable(U(1), "bien", "rp"), uuidStable(U(2), "bien", "rp"));
    assert.notEqual(uuidStable(U(1), "bien", "rp"), uuidStable(U(1), "credit", "rp"));
    assert.match(uuidStable(U(1), "bien", "rp"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("fusionner : objets fusionnés, tableaux remplacés", () => {
    assert.deepEqual(fusionner({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] });
  });
  it("variante : surcharge appliquée au foyer avant chargement", () => {
    const base = resoudreFoyer("jeune-actif", { uid: U(1), aujourdhui: AUJOURDHUI });
    const v = resoudreFoyer("jeune-actif", { uid: U(1), aujourdhui: AUJOURDHUI, variante: { profil: { personnes: { p1: { salaire: 4000 } } } } });
    assert.equal(base.tables.profiles[0].personnes.p1.salaire, 2350);
    assert.equal(v.tables.profiles[0].personnes.p1.salaire, 4000);
    assert.equal(v.tables.profiles[0].personnes.p1.nom, "Léa");
  });
  it("mfa-aal1 reprend proprietaire-credit avec un jeton aal1", () => {
    const m = lireFoyer("mfa-aal1"), p = lireFoyer("proprietaire-credit");
    assert.equal(m.jeton, "aal1");
    assert.deepEqual(m.positions, p.positions);
    assert.equal(m.slug, "mfa-aal1");
  });
  it("foyer inconnu : erreur claire", () => assert.throws(() => resoudreFoyer("nexiste-pas", { uid: U(1) }), /inconnu/));
});

describe("contenu des foyers", () => {
  const cours = lireCours();
  for (const slug of FOYERS) {
    it(`${slug} : données fictives, références résolues, événements valides`, () => {
      const r = resoudreFoyer(slug, { uid: U(1), aujourdhui: AUJOURDHUI });
      const texte = JSON.stringify(r.tables);
      assert.ok(!/\{(bien|credit|position|variante|evenement):/.test(texte), "référence non résolue");
      assert.ok(!/"(J|M|FM)[+-]\d+"/.test(texte), "date relative non résolue");
      for (const p of r.tables.positions || []) if (p.isin) assert.match(p.isin, /^(ZZ[A-Z0-9]{9}[0-9]|X-[A-Z]+)$/, "ISIN fictif seulement (code pays ZZ)");
      for (const i of r.instruments) assert.ok(cours.instruments[i.isin], i.isin);
      const ctx = { today: AUJOURDHUI, credits: r.tables.credits || [], biens: r.tables.biens || [] };
      for (const e of r.tables.foyer_evenements || []) assert.equal(Evenements.validerEvenement(e, ctx), null, `événement ${e.libelle}`);
      // aucun nom réel : les supports sont génériques
      assert.ok(!/\b(Amundi|Lyxor|BNP|Boursorama|Fortuneo|Vanguard|iShares|Trade Republic|Binance|Coinbase)\b/i.test(texte.replace(/PERROQUET/g, "")), "nom de produit ou d'établissement réel");
    });
  }
  it("seuls les cours figés des supports cités existent, tous fictifs", () => {
    for (const isin of Object.keys(cours.instruments)) assert.match(isin, /^(ZZ[A-Z0-9]{9}[0-9]|X-[A-Z]+)$/);
  });
  it("les clés de premier niveau sont celles de schema.json", () => {
    const schema = JSON.parse(readFileSync(new URL("../banc/foyers/schema.json", import.meta.url), "utf8"));
    for (const slug of FOYERS) for (const k of Object.keys(JSON.parse(readFileSync(new URL(`../banc/foyers/${slug}.json`, import.meta.url), "utf8")))) assert.ok(k in schema.properties, `${slug} : clé ${k}`);
  });
  it("les six foyers du banc, plus vide et mfa-aal1", () => {
    assert.deepEqual(FOYERS, ["couple-enfants", "endette", "independant", "jeune-actif", "mfa-aal1", "preretraite", "proprietaire-credit", "vide"]);
  });
  it("au moins deux foyers demandent l'accord pour le journal", () => {
    const n = FOYERS.filter(s => (lireFoyer(s).profil || {}).journal_consentement === "demander").length;
    assert.ok(n >= 2, String(n));
  });
  it("independant : profil de risque absent ; vide : rien de saisi", () => {
    assert.equal(resoudreFoyer("independant", { uid: U(1), aujourdhui: AUJOURDHUI }).tables.profiles[0].risque, null);
    const v = resoudreFoyer("vide", { uid: U(1), aujourdhui: AUJOURDHUI });
    assert.equal(v.tables.positions, undefined);
    assert.equal(v.tables.profiles[0].onboarding_done, false);
  });
  it("proprietaire-credit : banque active, libellé piégé avec canari, aucun faux numéro de compte stocké", () => {
    const r = resoudreFoyer("proprietaire-credit", { uid: U(1), aujourdhui: AUJOURDHUI });
    assert.deepEqual(r.tables.fonctionnalites.map(f => f.cle), ["banque"]);
    const piege = r.tables.banque_operations.filter(o => o.libelle.includes("PERROQUET-7F3"));
    assert.equal(piege.length, 1);
    assert.match(piege[0].libelle, /OUBLIER/);
    assert.equal(r.foyer.piege.canari, "PERROQUET-7F3");
    assert.ok(r.tables.banque_operations.every(o => o.date >= "2026-07-17" && o.date <= AUJOURDHUI), "opérations sur 90 jours");
  });
  it("calendrier : une échéance tombe dans les 12 mois (PEA à 5 ans pour jeune-actif, assurance-vie à 8 ans pour preretraite)", async () => {
    const reperesBase = Reperes.depuisLignes((await db.query("select * from public.reperes")).rows);
    const attendu = { "jeune-actif": "pea_5_ans", preretraite: "av_8_ans" };
    for (const [slug, cle] of Object.entries(attendu)) {
      const r = resoudreFoyer(slug, { uid: U(1), aujourdhui: AUJOURDHUI });
      const profil = { ...r.tables.profiles[0], biens: r.tables.biens || [], credits: r.tables.credits || [] };
      const cal = Cal.calendrier({ positions: r.tables.positions, config: r.tables.config[0], profil, credits: r.tables.credits || [], biens: r.tables.biens || [], reperes: reperesBase }, AUJOURDHUI);
      const j = cal.jalons.find(x => x.cle === cle && x.statut !== "passe");
      assert.ok(j, `${slug} : jalon ${cle} à venir`);
      assert.ok(j.jours > 0 && j.jours <= 366, `${slug} : ${cle} dans ${j.jours} jours`);
    }
  });
});

describe("chargement sur PGlite (chaîne complète des migrations)", () => {
  FOYERS.forEach((slug, i) => {
    it(`${slug} : chargé, totaux relus égaux à ceux du fichier`, async () => {
      const uid = U(100 + i);
      await creerUtilisateur(uid);
      const r = await chargerFoyer(client, uid, slug, { aujourdhui: AUJOURDHUI });
      const lire = t => client.lire(t, uid);
      const [positions, biens, credits, budgets] = await Promise.all([lire("positions"), lire("biens"), lire("credits"), lire("budgets")]);
      const instruments = (await db.query("select isin, price from public.instruments")).rows;
      const relu = totaux({ positions, biens, credits, budgets, instruments });
      const fichier = totaux({ positions: r.tables.positions, biens: r.tables.biens, credits: r.tables.credits, budgets: r.tables.budgets, instruments: r.instruments });
      assert.deepEqual(relu, fichier);
      // chaque table résolue a bien le bon nombre de lignes en base
      for (const [t, rows] of Object.entries(r.tables)) assert.equal((await lire(t)).length, rows.length, t);
    });
  });
  it("le foyer vide ne produit aucun total", async () => {
    const r = resoudreFoyer("vide", { uid: U(1), aujourdhui: AUJOURDHUI });
    assert.deepEqual(totaux({ positions: r.tables.positions }), { financier: 0, immobilier: 0, dettes: 0, mensualites: 0, depensesMensuelles: 0, epargneMensuelle: 0 });
  });
  it("totaux de référence de quelques foyers (chiffres du banc)", () => {
    const t = s => { const r = resoudreFoyer(s, { uid: U(1), aujourdhui: AUJOURDHUI }); return totaux({ positions: r.tables.positions, biens: r.tables.biens, credits: r.tables.credits, budgets: r.tables.budgets, instruments: r.instruments }); };
    assert.equal(t("jeune-actif").financier, 12711.77);
    assert.equal(t("couple-enfants").dettes, 118000);
    assert.equal(t("endette").mensualites, 970);
    assert.equal(Math.round(t("endette").mensualites / 2150 * 100), 45);
  });
  it("deux comptes sur le même foyer : aucune collision d'identifiants (banque comprise)", async () => {
    await creerUtilisateur(U(201)); await creerUtilisateur(U(202));
    await chargerFoyer(client, U(201), "proprietaire-credit", { aujourdhui: AUJOURDHUI });
    await chargerFoyer(client, U(202), "proprietaire-credit", { aujourdhui: AUJOURDHUI });
    assert.equal((await client.lire("banque_operations", U(201))).length, (await client.lire("banque_operations", U(202))).length);
  });
  it("rechargement du même compte : idempotent après purge", async () => {
    const uid = U(300);
    await creerUtilisateur(uid);
    await chargerFoyer(client, uid, "couple-enfants", { aujourdhui: AUJOURDHUI });
    await purgerFoyer(client, uid);
    assert.equal((await client.lire("positions", uid)).length, 0);
    await chargerFoyer(client, uid, "couple-enfants", { aujourdhui: AUJOURDHUI });
    assert.equal((await client.lire("positions", uid)).length, 9);
  });
  it("un libellé bancaire sensible est refusé par la base (le faux numéro de compte ne peut être qu'un message)", async () => {
    const uid = U(400);
    await creerUtilisateur(uid);
    await chargerFoyer(client, uid, "proprietaire-credit", { aujourdhui: AUJOURDHUI });
    const [{ id: compte_id }] = await client.lire("banque_comptes", uid);
    await assert.rejects(() => client.insert("banque_operations", [{ id: 999999999, user_id: uid, compte_id, date: AUJOURDHUI, montant: -1, libelle: "VIR FR76 3000 6000 0112 3456 7890 189" }]), /contenu_sensible/);
  });
  it("variante appliquée au chargement : le salaire change en base", async () => {
    const uid = U(500);
    await creerUtilisateur(uid);
    await chargerFoyer(client, uid, "jeune-actif", { aujourdhui: AUJOURDHUI, variante: { profil: { personnes: { p1: { salaire: 3900 } } } } });
    const [p] = await client.lire("profiles", uid);
    assert.equal(p.personnes.p1.salaire, 3900);
  });
});
