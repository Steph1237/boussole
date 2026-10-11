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

test("0012 : libellés de navigation des fiches, uniquement des update public.savoir_fiches (replace, version + 1)", () => {
  const m12 = lire("supabase/migrations/0012_savoir_libelles.sql");
  assert.ok(m12, "migration 0012_savoir_libelles.sql absente");
  const instr = m12.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
  assert.ok(instr.length >= 1);
  const slugs = [];
  for (const s of instr) {
    assert.match(s, /^update public\.savoir_fiches\s+set contenu = replace\(/, "instruction autre qu'une mise à jour de fiche : " + s.slice(0, 60));
    assert.match(s, /version = version \+ 1, mis_a_jour_le = '2026-10-10'/);
    const slug = (s.match(/where slug = '([a-z0-9-]+)'/) || [])[1];
    assert.ok(FICHES.includes(slug), "fiche inconnue : " + slug);
    slugs.push(slug);
  }
  assert.equal(new Set(slugs).size, slugs.length, "une instruction par fiche");
  // les nouveaux libellés sont ceux du cockpit
  for (const k of ["Pilotage › Rang", "Compte › Données", "Aujourd''hui", "Patrimoine › Budget et objectifs"]) assert.ok(m12.includes(k), k);
});

test("0015 : « Patrimoine › Budget et objectifs » → « Patrimoine › Objectifs » dans les fiches (même forme que 0012)", () => {
  const m15 = lire("supabase/migrations/0015_savoir_libelles_objectifs.sql");
  assert.ok(m15, "migration 0015_savoir_libelles_objectifs.sql absente");
  const instr = m15.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
  const slugs = instr.map(s => {
    assert.match(s, /^update public\.savoir_fiches\s+set contenu = replace\(/);
    assert.match(s, /version = version \+ 1, mis_a_jour_le = '2026-10-11'/);
    assert.match(s, /and strpos\(contenu, 'Patrimoine › Budget et objectifs'\) > 0$/, "rejouable");
    return (s.match(/where slug = '([a-z0-9-]+)'/) || [])[1];
  });
  // toutes les fiches qui portent l'ancien libellé après 0011 + 0012 sont traitées
  const m12 = lire("supabase/migrations/0012_savoir_libelles.sql");
  const visees = [...m12.matchAll(/update public\.savoir_fiches[\s\S]*?where slug = '([a-z0-9-]+)'[^;]*;/g)].filter(m => m[0].includes("Patrimoine › Budget et objectifs")).map(m => m[1]);
  assert.deepEqual(slugs, visees);
  assert.deepEqual(slugs, ["investissement-programme"]);
});

test("0015 sur PGlite : remplacement effectué, version incrémentée une seule fois (rejouable)", async () => {
  const { baseAvec } = await import("./helpers/pglite.mjs");
  const db = await baseAvec(["0009_savoir_memoire.sql", "0010_savoir_reperes.sql", "0011_savoir_fiches.sql", "0012_savoir_libelles.sql"]);
  const fiche = async () => (await db.query("select contenu, version, mis_a_jour_le::text d from public.savoir_fiches where slug = 'investissement-programme'")).rows[0];
  const avant = await fiche();
  assert.ok(avant.contenu.includes("Dans Patrimoine › Budget et objectifs, Boussole calcule"));
  const m15 = readFileSync("supabase/migrations/0015_savoir_libelles_objectifs.sql", "utf8");
  await db.exec(m15);
  const apres = await fiche();
  assert.ok(apres.contenu.includes("Dans Patrimoine › Objectifs, Boussole calcule, pour chacun de vos objectifs,"));
  assert.ok(!apres.contenu.includes("Budget et objectifs"));
  assert.equal(apres.version, avant.version + 1);
  assert.equal(apres.d, "2026-10-11");
  await db.exec(m15);
  assert.equal((await fiche()).version, avant.version + 1, "rejoué : rien ne change");
  const reste = (await db.query("select slug from public.savoir_fiches where strpos(contenu, 'Budget et objectifs') > 0")).rows;
  assert.deepEqual(reste, [], "plus aucune fiche avec l'ancien libellé");
  await db.close();
});

const AVANT_0018 = ["0009_savoir_memoire.sql", "0010_savoir_reperes.sql", "0011_savoir_fiches.sql", "0012_savoir_libelles.sql",
  "0013_journal.sql", "0014_journal_durcissement.sql", "0015_savoir_libelles_objectifs.sql"];

test("0018 : une mise à jour rejouable par fiche (titre, résumé, contenu, version + 1), rien d'autre", () => {
  const m18 = lire("supabase/migrations/0018_savoir_tutoiement.sql");
  assert.ok(m18, "migration 0018_savoir_tutoiement.sql absente");
  // découpe sur « $f$; » en fin de ligne (le texte des fiches contient des « ; » en fin de ligne)
  const instr = m18.replace(/^--[^\n]*\n/gm, "").split(/(?<=\$f\$);\s*$/m).map(s => s.trim()).filter(Boolean);
  const slugs = instr.map(s => {
    assert.match(s, /^update public\.savoir_fiches\s+set titre = '(?:[^']|'')*',\s+resume = '(?:[^']|'')*',\s+contenu = \$f\$[\s\S]*?\$f\$,\s+version = version \+ 1, mis_a_jour_le = '2026-10-11'\s+where slug = '[a-z0-9-]+' and contenu is distinct from \$f\$[\s\S]*\$f\$$/,
      "instruction inattendue : " + s.slice(0, 80));
    const [, a, b] = s.match(/contenu = \$f\$([\s\S]*?)\$f\$,[\s\S]*contenu is distinct from \$f\$([\s\S]*)\$f\$$/);
    assert.equal(a, b, "même texte dans set et where");
    assert.doesNotMatch(s, /sources/, "les sources ne sont pas touchées");
    return s.match(/where slug = '([a-z0-9-]+)'/)[1];
  });
  assert.deepEqual([...slugs].sort(), [...FICHES].sort(), "les 19 fiches, une instruction chacune");
  assert.doesNotMatch(m18, /TODO|TBD|lorem|XXX|à compléter|<valeur|<date|<résumé|<contenu/i);
  assert.doesNotMatch(m18, /\b(achetez|souscrivez chez|nous recommandons|je recommande)\b/i);
});

test("0018 sur PGlite : 19 fiches au tutoiement, version + 1, sources intactes, rejouable", async () => {
  const { baseAvec } = await import("./helpers/pglite.mjs");
  const db = await baseAvec(AVANT_0018);
  const etat = async () => (await db.query("select slug, titre, resume, contenu, sources, version, mis_a_jour_le::text d from public.savoir_fiches order by slug")).rows;
  const avant = await etat();
  assert.equal(avant.length, 19);
  assert.ok(avant.some(f => /\b(vous|votre|vos)\b/i.test(f.contenu)), "point de départ au vouvoiement");
  const m18 = readFileSync("supabase/migrations/0018_savoir_tutoiement.sql", "utf8");
  await db.exec(m18);
  const apres = await etat();
  assert.deepEqual(apres.map(f => f.slug), avant.map(f => f.slug));
  apres.forEach((f, i) => {
    const a = avant[i];
    for (const champ of ["titre", "resume", "contenu"]) assert.doesNotMatch(f[champ], /\b(vous|votre|vos)\b/i, `${f.slug}.${champ} encore au vouvoiement`);
    assert.doesNotMatch(f.contenu, /\b(?!chez\b|assez\b)\p{L}+ez\b/iu, f.slug + " : impératif en -ez");
    assert.equal(f.version, a.version + 1, f.slug + " : version + 1");
    assert.equal(f.d, "2026-10-11");
    assert.deepEqual(f.sources, a.sources, f.slug + " : sources inchangées");
    // le fond ne bouge pas : mêmes intertitres (hors « se poser » → « te poser »), mêmes chiffres, mêmes liens
    const chiffres = t => (t.match(/\d[\d  ,.]*/g) || []).join("|");
    assert.equal(chiffres(f.contenu), chiffres(a.contenu), f.slug + " : chiffres inchangés");
    const liens = t => (t.match(/https?:\/\/\S+/g) || []).join("|");
    assert.equal(liens(f.contenu), liens(a.contenu), f.slug + " : liens inchangés");
    const titres = t => (t.match(/^##.*$/gm) || []).map(h => h.replace(" te poser", " se poser")).join("|");
    assert.equal(titres(f.contenu), titres(a.contenu), f.slug + " : mêmes sections");
    const mots = f.contenu.split(/\s+/).filter(Boolean).length;
    assert.ok(mots >= 200 && mots <= 900, `longueur de ${f.slug} : ${mots} mots`);
  });
  // « Comment Boussole s'en sert » : la saisie passe par Claude, plus de « renseigner » dans l'app
  const toutes = apres.map(f => f.contenu).join("\n");
  assert.doesNotMatch(toutes, /\brenseign/i);
  for (const k of ["Pilotage › Rang", "Patrimoine › Objectifs", "Compte › Données", "Aujourd'hui"]) assert.ok(toutes.includes(k), k);
  await db.exec(m18);
  assert.deepEqual(await etat(), apres, "rejoué : rien ne change");
  await db.close();
});
