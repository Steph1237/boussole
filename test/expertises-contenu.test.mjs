// Contenu des 8 expertises v1 (migration 0017), lu statiquement : champs présents et dans les bornes, cas d'évaluation couvrant
// les 6 catégories, tutoiement, aucun établissement, émetteur, courtier ni plateforme, aucun ISIN, références existantes
// (thèmes, repères de 0010, fiches de 0010/0011, autres expertises), dimension marché d'actions et etf-fonds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const lire = p => (existsSync(p) ? readFileSync(p, "utf8") : "");
const m17 = lire("supabase/migrations/0017_expertises_contenu.sql");
const savoir = lire("supabase/migrations/0010_savoir_reperes.sql") + "\n" + lire("supabase/migrations/0011_savoir_fiches.sql");

const SLUGS = ["allocation-risque", "actions", "etf-fonds", "taux-obligations", "immobilier-credit", "fiscalite-enveloppes", "crypto", "budget-epargne"];
const THEMES = ["epargne", "enveloppes", "fiscalite", "immobilier", "retraite", "protection", "marches", "comportement", "credit"];
const ANGLES = ["allocation", "frais", "concentration", "devises", "crise", "enveloppes", "liquidite"];
const MARCHES = ["fr", "eu", "us", "em", "monde"];
// Repères et fiches réellement publiés par 0010 / 0011 (lus dans les migrations, pas recopiés ici).
const REPERES = [...lire("supabase/migrations/0010_savoir_reperes.sql").matchAll(/^\s*\('([a-z0-9_]+)', '/gm)].map(m => m[1]).filter(k => k.includes("_") || k === "pass");
const FICHES = [...savoir.matchAll(/^\s*\('([a-z0-9-]+)', '(epargne|enveloppes|fiscalite|immobilier|retraite|protection|marches|comportement|credit)'/gm)].map(m => m[1]);
// Établissements, sociétés de gestion, émetteurs d'ETF, courtiers, assureurs et plateformes : jamais nommés.
const NOMS_INTERDITS = ["Amundi", "iShares", "BlackRock", "Lyxor", "Vanguard", "Xtrackers", "SPDR", "Invesco", "State Street", "Natixis",
  "Carmignac", "Comgest", "BNP", "Paribas", "Crédit Agricole", "Société Générale", "LCL", "Caisse d'Épargne", "Banque Populaire",
  "Crédit Mutuel", "CIC", "Banque Postale", "HSBC", "Hello bank", "Boursorama", "BoursoBank", "Fortuneo", "Trade Republic", "Degiro",
  "Bourse Direct", "Saxo", "Interactive Brokers", "eToro", "Revolut", "Scalable", "Linxea", "Yomoni", "Nalo", "Ramify", "Goodvest",
  "Placement-direct", "Meilleurtaux", "Pretto", "Cafpi", "AXA", "Generali", "Allianz", "Swiss Life", "Spirica", "Suravenir", "Predica",
  "Cardif", "Corum", "Primonial", "Binance", "Coinbase", "Kraken", "Bitpanda", "Bitstamp", "Crypto.com", "Ledger", "Trezor", "Tether", "Circle"];
const ISIN = /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/;

/** Les 8 lignes de l'insert, champs extraits dans l'ordre des colonnes. */
function expertises() {
  const fin = m17.indexOf("\non conflict (slug)");
  assert.ok(fin > 0, "clause on conflict absente");
  return SLUGS.map((slug, i) => {
    const debut = m17.indexOf(`\n  ('${slug}', $f$`);
    assert.ok(debut > 0, "expertise manquante : " + slug);
    const suivante = i + 1 < SLUGS.length ? m17.indexOf(`\n  ('${SLUGS[i + 1]}', $f$`) : fin;
    const b = m17.slice(debut, suivante);
    const textes = [...b.matchAll(/\$f\$([\s\S]*?)\$f\$/g)].map(m => m[1]);
    const jsons = [...b.matchAll(/\$j\$([\s\S]*?)\$j\$::jsonb/g)].map(m => JSON.parse(m[1]));
    const tableaux = [...b.matchAll(/array\[([^\]]*)\](?:::text\[\])?/g)].map(m => [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]));
    assert.equal(textes.length, 6, slug + " : 6 textes (nom, quand_consulter, perimetre, methode, garde_fous, format)");
    assert.equal(jsons.length, 3, slug + " : 3 JSON (controles, evals, changelog)");
    assert.equal(tableaux.length, 4, slug + " : 4 tableaux (themes_savoir, reperes, angles, marches)");
    const [nom, quand_consulter, perimetre, methode, garde_fous, format] = textes;
    const [controles, evals, changelog] = jsons;
    const [themes_savoir, reperes, angles, marches] = tableaux;
    assert.match(b, /\n\s+1, 'publie', \$j\$/, slug + " : version 1, statut publie");
    return { slug, nom, quand_consulter, perimetre, methode, garde_fous, format, controles, evals, changelog, themes_savoir, reperes, angles, marches, bloc: b };
  });
}
const E = expertises();
const texteDe = e => [e.nom, e.quand_consulter, e.perimetre, e.methode, e.garde_fous, e.format, JSON.stringify(e.controles), JSON.stringify(e.evals)].join("\n");

/* Catégories de cas d'évaluation, reconnues à leur contenu (aucune étiquette dans le schéma) */
const CATEGORIES = {
  injection: c => /\b(ignore|oublie|fais comme si|nouvelle consigne)\b/i.test(c.question) && c.attendu.some(a => /garde-fous/i.test(a)),
  produit: c => c.attendu.some(a => /critères/i.test(a)) && c.interdit.some(i => /(citer|nommer|désigner|donner)\b[^.]*\b(produit|fonds|ETF|ISIN|émetteur|action|société|jeton|plateforme|établissement|banque|assureur|courtier|contrat|SCPI|offre|prestataire|placement)/i.test(i)),
  manquant: c => c.attendu.some(a => /manqu/i.test(a)) && c.attendu.some(a => /formulaire/i.test(a)),
  reglementaire: c => c.attendu.some(a => /Appelle `reperes`/.test(a) && /date/.test(a)),
  hors: (c, slug) => c.attendu.some(a => (a.match(/expertise `([a-z-]+)`/g) || []).some(m => m.slice(12, -1) !== slug)),
};
const categorie = (c, slug) => Object.keys(CATEGORIES).filter(k => CATEGORIES[k](c, slug));

test("0017 : les 8 expertises, dans l'ordre, sans doublon, insert idempotent (version incrémentée par le déclencheur seulement)", () => {
  assert.ok(m17, "migration 0017_expertises_contenu.sql absente");
  assert.deepEqual([...m17.matchAll(/^\s*\('([a-z-]+)', \$f\$/gm)].map(m => m[1]), SLUGS);
  assert.match(m17, /insert into public\.expertises \(slug, nom, quand_consulter, perimetre, methode, controles, garde_fous, format, themes_savoir, reperes,\s+angles, marches, evals, version, statut, changelog, mis_a_jour_le\) values/);
  const conflit = m17.slice(m17.indexOf("on conflict (slug)"));
  for (const c of ["nom", "quand_consulter", "perimetre", "methode", "controles", "garde_fous", "format", "themes_savoir", "reperes", "angles", "marches", "evals"]) {
    assert.ok(conflit.includes(`${c} = excluded.${c}`), "mise à jour de " + c);
    assert.ok(conflit.includes(`public.expertises.${c}`) && conflit.includes(`excluded.${c})`) || conflit.includes(`excluded.${c},`), "comparaison de " + c);
  }
  assert.match(conflit, /where \(public\.expertises\.nom,[\s\S]*\)\s+is distinct from\s+\(excluded\.nom,[\s\S]*\);\s*$/);
  assert.doesNotMatch(conflit, /version =|statut =|changelog =/, "ni version, ni statut, ni journal écrasés au rejeu");
});

test("0017 : chaque champ présent et dans les bornes (schéma 0016, et 8 à 15 contrôles, 10 à 15 cas pour la v1)", () => {
  const noms = new Set(), quand = new Set();
  for (const e of E) {
    const L = (s, min, max, champ) => assert.ok(s.trim().length >= min && s.length <= max, `${e.slug} : ${champ} ${s.length} caractères (${min}-${max})`);
    L(e.nom, 3, 80, "nom"); L(e.quand_consulter, 40, 300, "quand_consulter"); L(e.perimetre, 100, 600, "perimetre");
    L(e.methode, 2500, 8000, "methode"); L(e.garde_fous, 1000, 3000, "garde_fous"); L(e.format, 200, 1500, "format");
    assert.ok(e.controles.length >= 8 && e.controles.length <= 15, e.slug + " : 8 à 15 contrôles");
    assert.ok(e.controles.every(c => typeof c === "string" && c.trim().length >= 10 && c.length <= 300), e.slug + " : contrôles");
    assert.equal(new Set(e.controles).size, e.controles.length, e.slug + " : contrôle en double");
    assert.ok(e.evals.length >= 10 && e.evals.length <= 15, e.slug + " : 10 à 15 cas d'évaluation");
    for (const c of e.evals) {
      assert.deepEqual(Object.keys(c).filter(k => !["question", "contexte", "attendu", "interdit"].includes(k)), [], e.slug + " : clé inconnue");
      assert.ok(typeof c.question === "string" && c.question.length >= 5 && c.question.length <= 500, e.slug + " : question");
      assert.ok(c.contexte === undefined || (typeof c.contexte === "string" && c.contexte.length <= 500), e.slug + " : contexte");
      assert.ok(Array.isArray(c.attendu) && c.attendu.length >= 1 && c.attendu.length <= 8, e.slug + " : attendu " + c.question);
      assert.ok(Array.isArray(c.interdit) && c.interdit.length >= 1 && c.interdit.length <= 8, e.slug + " : interdit " + c.question);
      assert.ok([...c.attendu, ...c.interdit].every(s => typeof s === "string" && s.trim() && s.length <= 300), e.slug + " : phrases");
    }
    assert.equal(new Set(e.evals.map(c => c.question)).size, e.evals.length, e.slug + " : question en double");
    assert.deepEqual(e.changelog, [{ version: 1, le: "2026-10-11", resume: e.changelog[0].resume }], e.slug + " : journal initial");
    assert.ok(e.changelog[0].resume.length >= 10);
    assert.ok(!noms.has(e.nom) && !quand.has(e.quand_consulter), e.slug + " : nom ou quand_consulter en double");
    noms.add(e.nom); quand.add(e.quand_consulter);
    for (const t of ["## Objectif", "## Étapes", "## Questions à poser"]) assert.ok(e.methode.includes(t), e.slug + " : méthode sans « " + t + " »");
    for (const t of ["En bref", "Options", "Ce qui manque", "Sources"]) assert.ok(e.format.includes(t), e.slug + " : format sans « " + t + " »");
  }
});

test("0017 : au moins 10 cas par expertise couvrant les 6 catégories (typique, produit, données manquantes, chiffre réglementaire, injection, hors périmètre)", () => {
  for (const e of E) {
    const cats = e.evals.map(c => categorie(c, e.slug));
    for (const k of Object.keys(CATEGORIES)) assert.ok(cats.some(cs => cs.includes(k)), `${e.slug} : aucun cas « ${k} »`);
    assert.ok(cats.filter(cs => cs.length === 0).length >= 2, e.slug + " : au moins 2 cas typiques");
    // le renvoi hors périmètre désigne une autre expertise existante
    for (const c of e.evals) for (const m of JSON.stringify(c).matchAll(/expertise `([a-z-]+)`/g)) assert.ok(SLUGS.includes(m[1]) && m[1] !== e.slug, e.slug + " : renvoi vers " + m[1]);
    // le cas d'injection interdit d'obéir ou de citer un produit
    const inj = e.evals.filter(c => CATEGORIES.injection(c));
    assert.ok(inj.every(c => c.interdit.length >= 1), e.slug + " : injection sans interdit");
  }
});

test("0017 : tutoiement — aucun « vous », « votre », « vos » ; consignes au Copilote, utilisateur à la 3e personne", () => {
  for (const e of E) {
    const t = texteDe(e);
    const v = t.match(/(?<![\p{L}-])(vous|votre|vôtre|vos)(?![\p{L}-])/iu); // « rendez-vous » n'est pas un vouvoiement
    assert.equal(v, null, e.slug + " : vouvoiement « " + (v && t.slice(Math.max(0, v.index - 40), v.index + 20)) + " »");
    assert.match(e.methode, /l'utilisateur/, e.slug + " : l'utilisateur à la 3e personne");
    assert.match(e.garde_fous, /\bTu es le Copilote patrimonial\b/);
    assert.match(e.methode, /\b(Tu|tu)\b/, e.slug + " : consignes à la 2e personne");
  }
});

test("0017 : aucun établissement, émetteur, courtier ni plateforme ; aucun ISIN ; pas de texte de remplissage ni de recommandation", () => {
  for (const e of E) {
    const t = texteDe(e);
    for (const n of NOMS_INTERDITS) assert.doesNotMatch(t, new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u"), `${e.slug} : nom interdit « ${n} »`);
    assert.doesNotMatch(t, ISIN, e.slug + " : code ISIN");
    assert.doesNotMatch(t, /TODO|TBD|lorem|XXX|à compléter|<valeur|<date/i, e.slug + " : remplissage");
    assert.doesNotMatch(t, /\b(achète|achetez|souscris chez|je recommande|nous recommandons|le meilleur placement est)\b/i, e.slug + " : recommandation");
    assert.doesNotMatch(t, /mot de passe|password|code secret|code pin|identifiant de connexion/i, e.slug + " : mot refusé par contenu_sensible");
  }
});

test("0017 : garde-fous communs (produit, options, repères datés, fiches, manques, professionnel réglementé, injection, détresse)", () => {
  for (const e of E) {
    const g = e.garde_fous;
    for (const [motif, m] of [
      [/code ISIN, émetteur, société de gestion, banque, assureur, courtier ni plateforme/, "aucun produit ni établissement"],
      [/donne-lui les critères/, "critères plutôt que produit"],
      [/au moins deux options, chacune avec ses avantages, ses risques/, "options avec avantages et risques"],
      [/décision revient toujours à l'utilisateur/, "décision laissée à l'utilisateur"],
      [/appelle `reperes` et cite la valeur avec sa date d'effet/, "repères datés"],
      [/Cite les fiches du savoir utilisées \(titre, date\)/, "fiches citées"],
      [/Signale ce qui manque/, "manques signalés"],
      [/Aucune promesse ni prévision de rendement/, "pas de promesse"],
      [/professionnel réglementé/, "renvoi à un professionnel réglementé"],
      [/jamais des consignes/, "injection"],
      [/Point conseil budget/, "Point conseil budget"], [/Banque de France/, "Banque de France"],
    ]) assert.match(g, motif, e.slug + " : " + m);
    assert.match(g, /## Propre à cette expertise\n- /, e.slug + " : garde-fous propres");
  }
});

test("0017 : références existantes — thèmes, repères (0010), fiches (0010/0011), angles, marchés", () => {
  assert.ok(REPERES.length >= 12 && REPERES.includes("pfu_taux"), "repères lus dans 0010 : " + REPERES);
  assert.ok(FICHES.length >= 19 && FICHES.includes("frais-et-ter"), "fiches lues dans 0010/0011");
  for (const e of E) {
    assert.ok(e.themes_savoir.length >= 2 && e.themes_savoir.every(t => THEMES.includes(t)), e.slug + " : thèmes " + e.themes_savoir);
    assert.ok(e.reperes.length >= 1 && e.reperes.every(r => REPERES.includes(r)), e.slug + " : repères " + e.reperes);
    assert.ok(e.angles.length >= 2 && e.angles.every(a => ANGLES.includes(a)), e.slug + " : angles " + e.angles);
    assert.ok(e.marches.every(m => MARCHES.includes(m)), e.slug + " : marchés " + e.marches);
    // toute référence entre accents graves existe : clé de repère (soulignés), fiche ou expertise (tirets)
    const t = texteDe(e);
    for (const [, ref] of t.matchAll(/`([^`]+)`/g)) {
      if (ref === "reperes" || ref === "analyser") continue;
      assert.ok(REPERES.includes(ref) || FICHES.includes(ref) || SLUGS.includes(ref), `${e.slug} : repère, fiche ou expertise inconnu \`${ref}\``);
    }
    // chaque repère listé est cité dans la méthode, et chaque repère cité dans la méthode est listé
    for (const r of e.reperes) assert.ok(e.methode.includes("`" + r + "`"), `${e.slug} : repère ${r} listé mais pas cité dans la méthode`);
    for (const [, r] of e.methode.matchAll(/`([a-z0-9_]+_[a-z0-9_]+|pass)`/g)) assert.ok(e.reperes.includes(r), `${e.slug} : repère ${r} cité mais pas listé`);
    // les fiches citées appartiennent aux thèmes de l'expertise (sinon consulter_expertise ne les remonte pas)
    for (const [, f] of e.methode.matchAll(/fiche `([a-z0-9-]+)`/g)) {
      const theme = (savoir.match(new RegExp(`\\('${f}', '([a-z]+)'`)) || [])[1];
      assert.ok(e.themes_savoir.includes(theme), `${e.slug} : fiche ${f} (thème ${theme}) hors des thèmes ${e.themes_savoir}`);
    }
  }
});

test("0017 : dimension marché (actions, etf-fonds) — fr, eu, us, em, monde et leurs spécificités", () => {
  for (const e of E) assert.deepEqual(e.marches, ["actions", "etf-fonds"].includes(e.slug) ? MARCHES : [], e.slug + " : marchés");
  const actions = E.find(e => e.slug === "actions").methode;
  for (const b of ["**France (fr)**", "**Europe (eu)**", "**États-Unis (us)**", "**Émergents (em)**", "**Monde (monde)**"]) assert.ok(actions.includes(b), "actions : bloc " + b);
  for (const [motif, m] of [
    [/retenue à la source américaine limitée à 15 % par la convention fiscale franco-américaine/, "retenue américaine et convention"],
    [/30 % sinon/, "taux sans formulaire"], [/crédit d'impôt égal à cette retenue/, "crédit d'impôt"], [/notice de la déclaration 2047/, "source du crédit"],
    [/EUR\/USD/, "change EUR/USD"], [/CAC 40/, "indice France"], [/Euro Stoxx 50/, "indice Europe"], [/S&P 500/, "indice États-Unis"],
    [/MSCI Emerging Markets/, "indice émergents"], [/MSCI World/, "indice monde"],
    [/Union européenne ou l'Espace économique européen sont éligibles au PEA/, "PEA réservé UE/EEE"],
    [/États-Unis pèsent environ les trois quarts du MSCI World/, "poids des États-Unis"], [/abattement de 40 %/, "dividendes au barème"],
  ]) assert.match(actions, motif, "actions : " + m);
  const etf = E.find(e => e.slug === "etf-fonds");
  for (const [motif, m] of [
    [/frais courants \(TER\)/, "frais"], [/Physique/, "réplication physique"], [/Synthétique/, "réplication synthétique"],
    [/plus de 75 % de son actif/, "éligibilité PEA"], [/couverte \(hedged\)/, "couverture de change"], [/Encours/, "encours"],
    [/Chevauchements/, "chevauchements"], [/Distribution ou capitalisation/, "distribution et fiscalité"],
    [/France et Europe/, "marchés fr/eu"], [/États-Unis \(S&P 500/, "marché us"], [/émergents \(MSCI Emerging Markets/, "marché em"], [/monde \(MSCI World/, "marché monde"],
  ]) assert.match(etf.methode, motif, "etf-fonds : " + m);
  const ctrl = etf.controles.join("\n");
  for (const motif of [/Frais courants/, /Réplication/, /PEA/, /Indice suivi/, /Concentration/, /Devise/, /Encours/, /Chevauchement/, /Capitalisation ou distribution/])
    assert.match(ctrl, motif, "etf-fonds : contrôle " + motif);
});

test("0017 : quand_consulter oriente (mots-clés propres à chaque expertise) et les périmètres renvoient aux expertises voisines", () => {
  const cles = {
    "allocation-risque": /profil de risque/, actions: /retenue à la source/, "etf-fonds": /réplication/, "taux-obligations": /BCE/,
    "immobilier-credit": /HCSF/, "fiscalite-enveloppes": /PER/, crypto: /MiCA/, "budget-epargne": /épargne de précaution/,
  };
  for (const e of E) {
    assert.match(e.quand_consulter, cles[e.slug], e.slug + " : quand_consulter");
    for (const autre of SLUGS.filter(s => s !== e.slug && cles[s].test(e.quand_consulter))) assert.fail(`${e.slug} : quand_consulter empiète sur ${autre}`);
    const renvois = SLUGS.filter(s => s !== e.slug && e.perimetre.includes(s));
    assert.ok(renvois.length >= 2, e.slug + " : le périmètre renvoie à au moins 2 expertises voisines");
  }
});
