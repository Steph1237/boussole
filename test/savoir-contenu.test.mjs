// Contenu initial du savoir commun (migrations 0010 et 0011) : repères et fiches complets, sourcés, sans texte de remplissage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const lire = p => (existsSync(p) ? readFileSync(p, "utf8") : "");
const m10 = lire("supabase/migrations/0010_savoir_reperes.sql");
const m11 = lire("supabase/migrations/0011_savoir_fiches.sql");
const sql = m10 + "\n" + m11;

const REPERES = ["livret_a_taux", "livret_a_plafond", "ldds_plafond", "lep_taux", "lep_plafond", "pea_plafond", "pfu_taux",
  "av_abattement_seul", "av_abattement_couple", "hcsf_taux_effort", "hcsf_duree_max", "pass"];
const FICHES = ["epargne-de-precaution", "livrets-reglementes", "ordre-de-priorite-epargne", "pea", "assurance-vie", "per",
  "compte-titres-fiscalite", "transmission-bases", "allocation-profil-de-risque", "diversification", "frais-et-ter",
  "investissement-programme", "crises-et-recuperation", "crypto-actifs", "taux-endettement", "assurance-emprunteur",
  "acheter-ou-louer", "prevoyance", "biais-comportementaux"];
const THEMES = ["epargne", "enveloppes", "fiscalite", "immobilier", "retraite", "protection", "marches", "comportement", "credit"];
const OFFICIELS = /^https:\/\/([a-z0-9-]+\.)*(service-public\.fr|service-public\.gouv\.fr|impots\.gouv\.fr|economie\.gouv\.fr|banque-france\.fr|amf-france\.org|legifrance\.gouv\.fr|urssaf\.fr|info-retraite\.fr|insee\.fr|securite-sociale\.fr|lassuranceretraite\.fr|ecb\.europa\.eu|esma\.europa\.eu)\//;

/** Bloc SQL d'une fiche : du slug jusqu'à la fin de son tableau de sources. */
function bloc(slug) {
  const i = sql.indexOf(`('${slug}',`);
  assert.ok(i >= 0, "fiche manquante : " + slug);
  return sql.slice(i, sql.indexOf("'::jsonb", i) + 8);
}

test("0010 : tous les repères, sources https officielles, idempotent", () => {
  assert.ok(m10, "migration 0010_savoir_reperes.sql absente");
  assert.match(m10, /insert into public\.reperes[\s\S]*on conflict \(cle\) do update/);
  for (const k of REPERES) {
    const i = m10.indexOf(`('${k}',`);
    assert.ok(i >= 0, "repère manquant : " + k);
    const ligne = m10.slice(i, m10.indexOf("\n", i));
    const url = (ligne.match(/'(https:\/\/[^']+)'/) || [])[1];
    assert.ok(url && OFFICIELS.test(url), "source officielle manquante pour " + k + " : " + url);
    assert.match(ligne, /'2026-10-10'\)/, "vérifié le 2026-10-10 : " + k);
  }
});

test("0010 / 0011 : toutes les fiches, thème valide, au moins une source officielle, longueur raisonnable", () => {
  assert.ok(m11, "migration 0011_savoir_fiches.sql absente");
  for (const m of [m10, m11]) if (/insert into public\.savoir_fiches/.test(m)) {
    assert.match(m, /on conflict \(slug\) do update/);
    // rejouer sans changement n'incrémente pas la version
    assert.match(m, /version = public\.savoir_fiches\.version \+ 1\s*\n\s*--[^\n]*\n\s*where public\.savoir_fiches\.contenu is distinct from excluded\.contenu or public\.savoir_fiches\.titre is distinct from excluded\.titre\s*\n\s*or public\.savoir_fiches\.resume is distinct from excluded\.resume or public\.savoir_fiches\.sources is distinct from excluded\.sources;/);
  }
  // apostrophes dans les titres de sources (JSON dans une chaîne SQL : apostrophe doublée)
  assert.ok(m11.includes("fiche de l''indice MSCI World"), "apostrophe de « l'indice MSCI World »");
  assert.doesNotMatch(m11, /"titre": "[^"]*\b(l|qu|d) [a-zéè]/, "pas d'apostrophe manquante dans un titre de source");
  // l'URL AMF « bitoin » est celle du site (faute dans leur adresse) : conservée et commentée
  assert.ok(m11.includes("investir-dans-le-bitoin-prudence"));
  assert.match(m11, /-- L'adresse AMF « investir-dans-le-bitoin-prudence »[^\n]*\n\s*-- « …bitcoin-prudence » renvoie 404/);
  for (const s of FICHES) {
    const b = bloc(s);
    const theme = (b.match(new RegExp(`^\\('${s}',\\s*'([a-z]+)'`)) || [])[1];
    assert.ok(THEMES.includes(theme), "thème invalide pour " + s + " : " + theme);
    const urls = [...b.matchAll(/"url":\s*"([^"]+)"/g)].map(m => m[1]);
    assert.ok(urls.length >= 1 && urls.length <= 3, "1 à 3 sources : " + s);
    assert.ok(urls.some(u => OFFICIELS.test(u)), "source officielle manquante : " + s);
    const contenu = (b.match(/\$f\$([\s\S]*?)\$f\$/) || [])[1] || "";
    const mots = contenu.split(/\s+/).filter(Boolean).length;
    assert.ok(mots >= 200 && mots <= 900, `longueur de ${s} : ${mots} mots`);
  }
  const tous = [...sql.matchAll(/^\s*\('([a-z0-9-]+)',\s*'([a-z]+)',/gm)].map(m => m[1]).filter(x => !REPERES.includes(x.replace(/-/g, "_")));
  assert.equal(new Set(tous).size, tous.length, "slug en double");
});

test("contenu : pas de texte de remplissage ni de recommandation de produit ou d'établissement", () => {
  assert.doesNotMatch(sql, /TODO|TBD|lorem|XXX|à compléter|<valeur|<date|<résumé|<contenu/i);
  assert.doesNotMatch(sql, /\b(achetez|souscrivez chez|nous recommandons|je recommande)\b/i);
  assert.doesNotMatch(sql, /\b(Boursorama|Fortuneo|Linxea|Yomoni|Trade Republic|Degiro|Amundi|Lyxor|iShares|BNP|Crédit Agricole|Société Générale)\b/);
});

test("démo : repères alignés sur 0010 (valeur, unité, date d'effet), marqués « exemple »", () => {
  const demo = readFileSync("web/src/demo-data.js", "utf8");
  const ligne = k => { const i = m10.indexOf(`('${k}',`); assert.ok(i >= 0, k); return m10.slice(i, m10.indexOf("\n", i)); };
  for (const k of ["livret_a_taux", "pea_plafond", "hcsf_taux_effort", "pfu_taux"]) {
    const [, valeur, unite, dateEffet] = ligne(k).match(/^\('[a-z_]+', '(?:[^']|'')*', ([0-9.]+), '([^']+)', '(\d{4}-\d{2}-\d{2})'/);
    const d = demo.match(new RegExp(`rep\\("${k}", "[^"]+", ([0-9.]+), "([^"]+)", "(\\d{4}-\\d{2}-\\d{2})"`));
    assert.ok(d, "repère de démo : " + k);
    assert.deepEqual([d[1], d[2], d[3]], [valeur, unite, dateEffet], k + " : même valeur, unité et date d'effet que 0010");
  }
  assert.ok(demo.includes('sourceTitre: "Valeur d\'exemple (démo) — " + site'), "mention « exemple » conservée");
  assert.ok(demo.includes("à 35 % des revenus"), "résumé HCSF de démo : espace insécable avant %");
});
