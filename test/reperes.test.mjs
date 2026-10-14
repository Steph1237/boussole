import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { FIXTURE, reperesDeMigration } from "./helpers/projection-cas.mjs";
const R = createRequire(import.meta.url)("../web/src/reperes.js");
const esp = s => s.replace(/[  ]/g, " ");
const L = [
  { cle: "livret_a_taux", libelle: "Taux du Livret A", valeur: 1.7, unite: "%", dateEffet: "2025-08-01", sourceTitre: "Banque de France", sourceUrl: "https://www.banque-france.fr", verifieLe: "2026-10-10" },
  { cle: "pea_plafond", libelle: "Plafond PEA", valeur: 150000, unite: "€", dateEffet: "2014-01-01", sourceTitre: "service-public", sourceUrl: "https://www.service-public.fr", verifieLe: "2026-01-01" },
];
test("valeur : trouvée, ou défaut si absente / liste vide", () => {
  assert.equal(R.valeur(L, "livret_a_taux", 2.4), 1.7);
  assert.equal(R.valeur(L, "inconnu", 3), 3);
  assert.equal(R.valeur(null, "livret_a_taux", 2.4), 2.4);
});
test("aVerifier : vérifié il y a plus de 180 jours", () => {
  assert.equal(R.aVerifier(L[0], "2026-10-10"), false);
  assert.equal(R.aVerifier(L[1], "2026-10-10"), true);
  assert.equal(R.A_VERIFIER_JOURS, 180);
});
test("format : unité française", () => {
  assert.equal(esp(R.format(L[0])), "1,7 %");
  assert.equal(esp(R.format(L[1])), "150 000 €");
  assert.equal(R.format({ valeur: 25, unite: "ans" }), "25 ans");
});
test("depuisLignes : lignes SQL → vue camelCase", () => {
  const v = R.depuisLignes([{ cle: "x", libelle: "X", valeur: "2.5", unite: "%", date_effet: "2026-01-01", source_titre: "s", source_url: "https://s", verifie_le: "2026-02-01", mode: "manuel" }]);
  assert.deepEqual(v[0], { cle: "x", libelle: "X", valeur: 2.5, unite: "%", dateEffet: "2026-01-01", dateFin: null, sourceTitre: "s", sourceUrl: "https://s", verifieLe: "2026-02-01", mode: "manuel" });
});
test("depuisLignes : date_fin → dateFin (null si absente ou nulle)", () => {
  const base = { cle: "x", libelle: "X", valeur: "1.7", unite: "%", date_effet: "2026-08-01", source_titre: "s", source_url: "https://s", verifie_le: "2026-10-14", mode: "manuel" };
  const v = R.depuisLignes([{ ...base, date_fin: "2027-01-31" }, { ...base, cle: "y", date_fin: null }, { ...base, cle: "z" }]);
  assert.deepEqual(v.map(r => [r.cle, r.dateFin]), [["x", "2027-01-31"], ["y", null], ["z", null]]);
  assert.equal(v[0].dateEffet, "2026-08-01", "les autres champs sont inchangés");
  assert.equal(R.depuisLignes(null).length, 0);
});

/* ---------- migrations 0030 et 0031 (PROJ) : les 68 repères de la projection, recopiés de test/fixtures/projection-cas.json ---------- */
const SQL_0031 = readFileSync(new URL("../supabase/migrations/0031_projection.sql", import.meta.url), "utf8");
const SQL_0030 = readFileSync(new URL("../supabase/migrations/0030_reperes_projection.sql", import.meta.url), "utf8");
const M0030 = [...reperesDeMigration("0030_reperes_projection.sql").values()];
const DOMAINES_OFFICIELS = ["gouv.fr", "ecb.europa.eu", "insee.fr", "banque-france.fr", "caf.fr", "hcfea.fr"];   // *.gouv.fr couvre legifrance.gouv.fr et bofip.impots.gouv.fr
const SOURCES_PRIMAIRES = ["lobservatoire.creditlogement.fr", "aspim.fr", "indexes.nasdaqomx.com", "research-center.amundi.com"];
const hoteOk = h => [...DOMAINES_OFFICIELS, ...SOURCES_PRIMAIRES].some(d => h === d || h.endsWith("." + d));

test("0030 : 68 repères dans la migration, identiques à ceux de la fixture ligne à ligne (clé, libellé, valeur, unité, dates, source), dans le même ordre", () => {
  assert.equal(FIXTURE.reperes.length, 68);
  assert.equal(M0030.length, 68);
  FIXTURE.reperes.forEach((r, i) => {
    const attendu = { cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, dateEffet: r.dateEffet, dateFin: r.dateFin, sourceTitre: r.sourceTitre, sourceUrl: r.sourceUrl, verifieLe: r.verifieLe };
    assert.deepEqual(M0030[i], attendu, `ligne ${i + 1} (${r.cle})`);
  });
  assert.equal(new Set(M0030.map(r => r.cle)).size, 68, "aucune clé en double");
});
test("0030 : le champ « statut » de la fixture ne va pas en base (le bloc n'a pas de colonne statut)", () => {
  const m = /insert into public\.reperes \(([^)]*)\) values/.exec(SQL_0030);
  assert.ok(m);
  assert.deepEqual(m[1].split(",").map(s => s.trim()), ["cle", "libelle", "valeur", "unite", "date_effet", "date_fin", "source_titre", "source_url", "verifie_le"]);
});
test("0030 : chaque URL est en https:// d'un domaine officiel ou d'une source primaire listée (ou de github.com/Steph1237/boussole pour les conventions)", () => {
  const urls = [...M0030.map(r => ({ cle: r.cle, url: r.sourceUrl })), { cle: "indices_mensuels", url: FIXTURE.indices_mensuels.source_url }];
  for (const { cle, url } of urls) {
    assert.match(url, /^https:\/\//, cle + " : https");
    const u = new URL(url);
    if (u.hostname === "github.com") assert.ok(u.pathname.startsWith("/Steph1237/boussole/"), cle + " : github.com/Steph1237/boussole seulement : " + url);
    else assert.ok(hoteOk(u.hostname), cle + " : domaine non listé : " + u.hostname);
  }
  assert.ok(M0030.some(r => /github\.com/.test(r.sourceUrl)), "les conventions pointent vers la spec du dépôt");
});
test("0030 : toute ligne CONV de la fixture porte « convention » dans son libellé ; aucune ligne NV ; seuls les statuts V et CONV existent", () => {
  assert.deepEqual([...new Set(FIXTURE.reperes.map(r => r.statut))].sort(), ["CONV", "V"]);
  assert.ok(FIXTURE.reperes.every(r => r.statut !== "NV"), "aucune ligne NV");
  const conv = FIXTURE.reperes.filter(r => r.statut === "CONV");
  assert.ok(conv.length >= 20);
  for (const r of conv) assert.match(M0030.find(m => m.cle === r.cle).libelle, /convention/i, r.cle);
  for (const r of M0030) assert.ok(!/\bNV\b|non vérifié/i.test(r.libelle + r.sourceTitre), r.cle + " : pas de ligne non vérifiée");
});
test("0030 : l'unité est admise par reperes_unite_check ; dates cohérentes ; vérifié à la date de la fixture ; clés au format de la table", () => {
  const m = /add constraint reperes_unite_check check \(unite in \(([^)]*)\)\)/.exec(SQL_0030);
  assert.ok(m, "contrainte reperes_unite_check étendue");
  const admises = m[1].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
  for (const u of ["%", "€", "ans", "mois"]) assert.ok(admises.includes(u), "unités de 0029 conservées : " + u);
  for (const r of M0030) {
    assert.ok(admises.includes(r.unite), r.cle + " : unité " + r.unite);
    assert.match(r.cle, /^[a-z0-9_]{2,60}$/);
    assert.ok(r.libelle.length >= 2 && r.libelle.length <= 120, r.cle + " : libellé de 2 à 120 caractères");
    assert.match(r.dateEffet, /^\d{4}-\d{2}-\d{2}$/);
    if (r.dateFin) assert.ok(r.dateFin >= r.dateEffet, r.cle + " : date_fin >= date_effet");
    assert.match(r.verifieLe, /^2026-10-14$/, r.cle + " : vérifié le 2026-10-14 (tâche 0)");
  }
});
test("0030 : aucun des 68 repères n'écrase un repère des migrations précédentes (0010, 0029, …) : ce sont des clés nouvelles", () => {
  const anciens = new Set();
  for (const f of ["0010_savoir_reperes.sql", "0029_calendrier.sql"]) for (const k of reperesDeMigration(f).keys()) anciens.add(k);
  assert.ok(anciens.size >= 40);
  for (const r of M0030) assert.ok(!anciens.has(r.cle), r.cle + " existe déjà");
  for (const cle of ["ir_taux_forfaitaire", "av_taux_ir_reduit"]) assert.ok(M0030.some(r => r.cle === cle), cle + " créée par 0030 (signalée absente en tâche 0)");
});
test("0031 : la série IPC est insérée à l'identique (60 mois, série ipc_insee) dans un bloc idempotent", () => {
  const idx = FIXTURE.indices_mensuels;
  assert.equal(idx.valeurs.length, 60);
  const bloc = SQL_0031.slice(SQL_0031.indexOf("insert into public.indices_mensuels"));
  assert.match(bloc, /on conflict \(serie, mois\) do update/);
  for (const v of idx.valeurs) assert.ok(bloc.includes(`'${v.mois}', ${v.valeur},`), "mois " + v.mois);
  assert.equal((bloc.match(/\('ipc_insee'/g) || []).length, 60);
});
