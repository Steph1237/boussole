// SUIVI, interface (web/src/suivi-view.js) : rendus HTML purs du système cœur et satellite, de « Ta ligne » (anneau segmenté, constats, leviers et balance),
// de la politique de suivi, et règles de présentation (spec § 9.1 et § 18.4) : faits au niveau de la ligne, jugements au niveau de la classe et de l'enveloppe,
// météo en icône ET mot, aucune note chiffrée, pas de vocabulaire de récompense, tutoiement, lecture seule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CAS, donneesDe } from "./helpers/suivi-cas.mjs";

const require = createRequire(import.meta.url);
const Suivi = require("../web/src/suivi.js");
const SV = require("../web/src/suivi-view.js");
const UI = { demanderAClaude: (q, l) => '<a class="ui-claude" href="https://claude.ai/new?q=' + encodeURIComponent(q) + '"><span>' + (l || "Demander à Claude") + "</span></a>" };
const TODAY = "2026-10-15";
const cas = id => CAS.find(c => c.id === id);
const sp = t => String(t).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const texte = html => sp(html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const vueDe = id => { const d = donneesDe(cas(id)); return { d, v: Suivi.vue(d, TODAY, { capacite_mensuelle: 1700 }), L: id2 => Suivi.ligne(d, id2, TODAY, { capacite_mensuelle: 1700 }) }; };
/** Ligne à effet de levier à 15,7 % (satellite proposé) dans un PEA, plus une crypto sans prix de revient : plafond satellite dépassé, donc deux leviers « réduire le satellite » à fusionner. */
function donneesLever() {
  const d = donneesDe(cas("CM-9"));
  d.positions = [
    { id: "liv", name: "Livret A", envelope: "Livret A Exemple", owner: "p1", bloc: "Livrets", status: "actif", mode: "manual", value: 10000 },
    { id: "etf", name: "ETF Monde A", envelope: "PEA Exemple", owner: "p1", bloc: "Monde", status: "actif", mode: "market", qty: 600, price: 100, pru: 80, isin: "XX0000000025" },
    { id: "lev", name: "ETF Nasdaq 2x A", envelope: "PEA Exemple", owner: "p1", bloc: "Nasdaq 2x", status: "actif", mode: "market", qty: 168, price: 100, pru: 90, isin: "XX0000000033" },
    { id: "btc", name: "Bitcoin", envelope: "Crypto Exemple", owner: "p1", bloc: "Crypto", status: "actif", mode: "market", qty: 0.5, price: 40000, isin: "X-BTC" },
    { id: "fonds2", name: "ETF Europe A", envelope: "PEA Exemple", owner: "p1", bloc: "Europe", status: "actif", mode: "market", qty: 100, price: 100, pru: 80, isin: "XX0000000041" },
  ];
  d.instruments.push({ isin: "XX0000000041", devise: "EUR", ter: 0.2, ter_source: "dic", ter_le: "2026-09-30" });
  d.config.enveloppes_infos["Crypto Exemple"] = { type: "crypto", titulaire: "p1", source: "exemple", le: "2026-02-12" };
  return d;
}
const INTERDIT = /\b(bonus|gagne|gagné|série|record|jackpot|trade|trading|confetti|badge|classement)\b|achète|vends\b|renforce|allège|conseiller|Copilote|\bvous\b|\bvotre\b|\bvos\b/i;

test("chips des constats : Hors repère, À surveiller, OK, Manque une donnée, Info ; jamais « à travailler » ni un ordre ; le chiffre est écrit contre son repère", () => {
  const { d } = vueDe("CM-8");
  const cs = Suivi.constats(d, "soc", TODAY);
  const poids = cs.find(c => c.cle === "poids");
  assert.equal(poids.statut, "a_travailler");
  assert.equal(SV.chipConstat(poids), "Hors repère");
  assert.equal(poids.repere.max, 5, "le repère de poids porte son chiffre");
  const l8 = Suivi.ligne(d, "soc", TODAY);
  const ch = SV.chiffreConstat(poids, l8);
  assert.equal(sp(ch.valeur), "6 %");
  assert.equal(sp(ch.repere), "repère ≤ 5 % pour un satellite");
  const { d: d9 } = vueDe("CM-9");
  const lev = Suivi.constats(d9, "lev", TODAY);
  assert.equal(SV.chipConstat(lev.find(c => c.cle === "classe_risque")), "Hors repère");
  assert.equal(SV.chipConstat(lev.find(c => c.cle === "cout")), "À surveiller");
  assert.equal(SV.chipConstat(lev.find(c => c.cle === "chevauchement")), "Bientôt", "la composition des fonds n'est pas disponible : rien à fournir");
  assert.equal(SV.chipConstat(lev.find(c => c.cle === "solidite")), "Bientôt");
  assert.equal(SV.chipConstat({ cle: "cout", statut: "a_completer" }), "Manque une donnée", "une donnée que tu peux donner reste « Manque une donnée »");
  assert.equal(SV.chipConstat(lev.find(c => c.cle === "enveloppe")), "OK");
  assert.equal(SV.chipConstat(lev.find(c => c.cle === "devise")), "OK", "une ligne en euros : pas de risque de change");
  assert.equal(SV.chipConstat({ cle: "devise", statut: "bon", mesure: { devise: "USD", valeur: 12 } }), "Info");
  const coutCh = SV.chiffreConstat(lev.find(c => c.cle === "cout"), Suivi.ligne(d9, "lev", TODAY));
  assert.match(sp(coutCh.valeur), /0,6 %\/an/);
  assert.match(sp(coutCh.repere), /fourchette repère 0,3 à 0,6 %\/an/);
  for (const cle of ["cout", "poids", "chevauchement", "classe_risque", "solidite", "enveloppe", "devise"])
    for (const st of ["bon", "a_surveiller", "a_travailler", "a_completer"]) assert.doesNotMatch(SV.chipConstat({ cle, statut: st }), /travailler|allège|vends|garde|conserve|renforce/i, cle + " " + st);
});

test("météo : l'icône et le mot vont ensemble (4 états), aucune note chiffrée", () => {
  for (const m of ["clair", "eclaircies", "a_regarder", "a_completer"]) {
    const h = SV.meteoHtml(m);
    assert.match(h, /<svg class="sv-ico"/); assert.match(h, /class="sv-meteo-mot">(Au clair|Éclaircies|À regarder à ta revue|À compléter)</);
    assert.doesNotMatch(texte(h), /\d/);
  }
  assert.deepEqual(["clair", "eclaircies", "a_regarder", "a_completer"].map(m => texte(SV.meteoHtml(m))), ["Au clair", "Éclaircies", "À regarder à ta revue", "À compléter"]);
});

test("système cœur et satellite : arcs, graduation du plafond au bon endroit, « dépassé » en mot, tableau équivalent", () => {
  const { v } = vueDe("SY-2"); // satellite à 20 % de l'investi pour un plafond de 15 % : dépassé
  const h = SV.systemeHtml(v, { U: UI });
  assert.match(h, /<line class="sv-tick depasse"/);
  assert.match(texte(h), /plafond 15 % · dépassé/);
  assert.match(texte(h), /À surveiller/);
  assert.match(sp(h), /aria-label="Cœur [^"]*Satellite [^"]*sur 15 %[^"]*Plafond satellite dépassé/);
  assert.match(h, /<table class="sv-tab"><caption class="ui-sr">/);
  const sy1 = SV.systemeHtml(vueDe("SY-1").v, { U: UI });
  assert.doesNotMatch(sy1, /depasse/);
  assert.match(sy1, /À confirmer avec Claude/, "rôles proposés, pas encore validés");
  // sans rôle à confirmer : plus de lien de confirmation
  const d = donneesDe(cas("SY-1")); d.positions.forEach(p => { p.role = Suivi.roleEffectif(d, p.id, TODAY) || "coeur"; p.role_source = "valide"; });
  assert.doesNotMatch(SV.systemeHtml(Suivi.vue(d, TODAY), { U: UI }), /À confirmer avec Claude/);
  assert.equal(SV.systemeHtml({ lignes: [], systeme: { montants: { total: 0 } }, roles_a_confirmer: [] }, {}), "");
  // la graduation est en % de l'investi : à 15 % du financier investi, elle est après le début de l'arc du satellite
  assert.match(SV.anneauSvg(v), /<defs><pattern id="svHachure"/);
});

test("« Ta ligne » : verdict en une phrase chiffrée, bilan par niveau, constats du plus grave au moins grave, rôle proposé et revue", () => {
  const { L } = vueDe("CM-9");
  const l = L("lev"), h = SV.ligneSuiviHtml(l, { U: UI, today: TODAY }), t = texte(h);
  assert.equal(SV.niveauLigne(l), "alerte");
  assert.match(t, /Hors de tes repères Diagnostic de la ligne/);
  assert.match(t, /Cette ligne est un produit à effet de levier \(volatilité ≈ 45 %\/an\), et ses frais courants sont de 0,6 %\/an, au-dessus du bas du repère de sa classe \(0,3 %\/an\)\./);
  // bilan : nombres par niveau, boutons de 44 px qui renvoient aux constats
  assert.match(t, /1 hors repère 1 à surveiller 3 OK/);
  assert.equal((h.match(/data-sv-aller="/g) || []).length, 3, "« Bientôt » ne compte pas dans le bilan");
  assert.doesNotMatch(t, /à compléter/);
  assert.match(t, /5 constats calculés sur 7/);
  // tri : alerte, à surveiller, à compléter, puis OK repliés
  const ordre = [...h.matchAll(/<details class="sv-constat sv-n-(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(ordre, ["alerte", "surveiller", "bientot", "bientot", "ok", "ok", "ok"]);
  assert.match(h, /<details class="sv-ok-groupe"><summary[^>]*><span>3 points sans problème<\/span>/);
  assert.equal((h.match(/<details class="sv-constat/g) || []).length, l.constats.length);
  assert.match(t, /Rôle proposé : satellite — à confirmer \(produit à effet de levier\)/);
  assert.match(t, /Revue chaque mois, dans ta revue mensuelle avec Claude\./);
  assert.match(h, /<h4 class="sv-c-h">Ta situation<\/h4>[\s\S]*<h4 class="sv-c-h">Pourquoi<\/h4>[\s\S]*<h4 class="sv-c-h">Le calcul<\/h4>/, "ordre du panneau d'un constat (CP4)");
  assert.match(h, /Ce qui manque/);
  assert.doesNotMatch(h, /<svg class="sv-anneau-ligne"|class="sv-seg /, "plus d'anneau segmenté");
  assert.doesNotMatch(t, /\b\d+ ?\/ ?(20|100)\b/, "aucune note chiffrée");
  assert.doesNotMatch(t, INTERDIT);
  // cœur : la prochaine revue est dite, jamais « rien à surveiller »
  const c = vueDe("CM-1").L("etf");
  assert.match(texte(SV.ligneSuiviHtml(c, { U: UI })), /Ton cœur est à revoir ce mois-ci \(octobre\)\.|Prochaine revue de ton cœur : /);
  assert.doesNotMatch(texte(SV.ligneSuiviHtml(c, { U: UI })), /rien à surveiller/i);
});

test("verdict : la phrase cite les deux constats les plus graves avec leurs chiffres ; une alerte passe avant un manque de données ; « Tout va bien » et « Diagnostic incomplet »", () => {
  const d = donneesLever();
  const l = Suivi.ligne(d, "lev", TODAY, { capacite_mensuelle: 1700 });
  assert.equal(sp(SV.phraseVerdictLigne(l)), "Cette ligne pèse 15,7 % de ton financier investi alors que ton repère pour un satellite est 5 %, et c'est un produit à effet de levier (volatilité ≈ 45 %/an).");
  const t = texte(SV.ligneSuiviHtml(l, { U: UI, today: TODAY }));
  assert.match(t, /Hors de tes repères Diagnostic de la ligne Cette ligne pèse 15,7 %/);
  const clair = JSON.parse(JSON.stringify(l)); clair.constats.forEach(c => { c.statut = c.statut === "a_completer" ? "a_completer" : "bon"; }); clair.meteo = "clair";
  assert.equal(SV.niveauLigne(clair), "ok");
  assert.match(sp(SV.phraseVerdictLigne(clair)), /^Rien à signaler : les 5 points calculés sont dans les repères\.$/);
  const inc = JSON.parse(JSON.stringify(clair)); inc.meteo = "a_completer";
  assert.equal(SV.niveauLigne(inc), "incomplet");
  assert.match(texte(SV.ligneSuiviHtml(inc, { U: UI })), /Diagnostic incomplet/);
  assert.match(SV.phraseVerdictLigne(inc), /^Il manque trop de données pour juger cette ligne/);
});

test("mini-jauge : la valeur contre son repère pour le poids, le coût, la volatilité ; rien pour un constat sans chiffre ; texte lu en alternative", () => {
  const { L } = vueDe("CM-9"), l = L("lev");
  const g = k => SV.jaugeHtml(l.constats.find(c => c.cle === k));
  assert.match(sp(g("classe_risque")), /role="img" aria-label="45 %\/an, repère 20 %"/);
  assert.match(g("cout"), /class="sv-j-zone"/);
  assert.match(sp(g("cout")), /aria-label="0,6 %\/an, repère 0,3 à 0,6 %"/);
  assert.equal(g("chevauchement"), "");
  assert.equal(g("enveloppe"), "");
  const { d } = vueDe("CM-8");
  assert.match(sp(SV.jaugeHtml(Suivi.constats(d, "soc", TODAY).find(c => c.cle === "poids"))), /aria-label="6 %, repère 5 %"/);
});

test("un seul bouton Claude principal (« Préparer avec Claude ») ; « Compléter avec Claude » en secondaire dans un bloc unique ; aucun lien Claude par constat", () => {
  const d = donneesLever(), l = Suivi.ligne(d, "lev", TODAY, { capacite_mensuelle: 1700 });
  const h = SV.ligneSuiviHtml(l, { U: UI, today: TODAY });
  assert.equal((h.match(/sv-claude-primaire/g) || []).length, 1);
  assert.equal((h.match(/Préparer avec Claude/g) || []).length, 1);
  assert.equal((h.match(/Compléter avec Claude/g) || []).length, 1);
  assert.equal((h.match(/Pour compléter le diagnostic/g) || []).length, 1);
  assert.doesNotMatch(h, /Demander à Claude/);
  assert.match(h, /sv-claude-texte[^>]*>[\s\S]*?Confirmer avec Claude/);
  const m = texte(SV.completerHtml(l, { U: UI }));
  assert.match(m, /Le prix de revient des lignes vendues dans « Crypto Exemple »/);
  assert.doesNotMatch(m, /Les 10 premières lignes|L'encours et la date de création|Sert à : Chevauchement/, "ce que l'utilisateur ne peut pas donner n'est pas dans la liste d'actions");
  assert.match(m, /Pas encore disponible dans Boussole : la composition des fonds et l'encours des fonds\./);
  assert.equal((h.match(/Pas encore disponible dans Boussole/g) || []).length, 3, "deux constats « Bientôt » et une ligne dans le bloc");
  assert.equal(SV.completerHtml(Object.assign({}, l, { constats: l.constats.filter(c => c.statut !== "a_completer"), leviers: [] }), { U: UI }), "", "rien à compléter : pas de bloc");
  const seul = SV.completerHtml(Object.assign({}, l, { leviers: [] }), { U: UI });
  assert.doesNotMatch(seul, /Compléter avec Claude|<section/, "seulement du « pas encore disponible » : une ligne discrète, aucune action");
  assert.match(seul, /class="sv-m-bientot"/);
});

test("« Que faire ? » : l'option sans coût d'abord, puis chaque option avec coût certain, gain attendu et verdict ; le titre nomme une classe et une enveloppe (jamais une ligne)", () => {
  const { L } = vueDe("DE-1");
  const h = SV.ligneSuiviHtml(L("fam"), { U: UI, today: TODAY });
  const titres = [...h.matchAll(/<h4 class="sv-o-titre">([^<]*)</g)].map(m => m[1]);
  assert.ok(titres.length >= 1);
  for (const t of titres) assert.doesNotMatch(t, /Fonds Actions Monde A/);
  const carte = h.split('<article class="sv-option"').find(x => /data-sv-levier="frais_eleves"/.test(x));
  const t = texte(carte);
  assert.match(t, /Réduire les frais de la classe/);
  assert.match(t, /Classe Actions dans « Assurance vie Exemple »/);
  assert.match(t, /Coût certain 0 € arbitrage interne, sans impôt/);
  assert.match(t, /Gain attendu \+312 € par an certain : frais économisés/);
  assert.match(t, /Rentabilisé tout de suite · ton horizon : 10 ans/);
  assert.match(carte, /<p class="sv-verdict sv-v-vaut_le_cout"><svg class="sv-ico"[\s\S]*<span class="sv-verdict-mot">Ça vaut le coût<\/span>/);
  assert.match(sp(carte), /role="img" aria-label="Gain cumulé sur 10 ans : 3 120 €\. Coût une fois : 0 €\./);
  // le cas qui ne vaut pas le coût : « Pas rentable », option sans coût d'abord, phrase sur le levier et non sur la ligne
  const { L: L3 } = vueDe("VC-3");
  const h3 = SV.ligneSuiviHtml(L3("fct"), { U: UI, today: TODAY }), t3 = texte(h3);
  assert.ok(t3.indexOf("Sans coût") < t3.indexOf("Si tu veux agir plus vite"), "l'option gratuite vient avant celles qui coûtent");
  assert.match(t3, /Oriente tes prochains versements vers d'autres classes/);
  assert.match(t3, /Pas rentable/);
  assert.match(t3, /Gain attendu \+95 € par an/);
  assert.match(t3, /Coût certain 2 106 € une fois impôt 1 821 € \+ courtage et écart 285 €/);
  assert.match(t3, /Rentabilisé en 22 ans · ton horizon : 12 ans/);
  assert.match(t3, /sur ton horizon, ne rien changer à cette classe est l'option la moins coûteuse/);
  assert.doesNotMatch(t3.slice(t3.indexOf("Que faire ?")), /Fonds Actions Monde B/, "le nom de la ligne n'est pas dans « Que faire ? » (il ne figure que dans les données d'un constat)");
  assert.match(h3, /<span class="sv-bal-pm"/, "point mort marqué sur la barre du gain");
  assert.match(h3, /Comment c'est calculé/);
  assert.equal(SV.balanceHtml({ gain_annuel: 0, cout_unique: null, horizon_ans: 5 }), "");
  assert.equal(SV.balanceHtml({ gain_annuel: 0, cout_unique: 230, horizon_ans: 5 }), "", "pas de barre 0 € contre le coût quand le gain ne se chiffre pas");
});

test("leviers fusionnés : plus de doublon « Revenir sous ton plafond satellite » ; pas de « aucun en euros » ; verdict en mot ; ce qui manque dans un seul bloc", () => {
  const d = donneesLever(), l = Suivi.ligne(d, "lev", TODAY, { capacite_mensuelle: 1700 });
  const h = SV.ligneSuiviHtml(l, { U: UI, today: TODAY }), t = texte(h);
  assert.equal((h.match(/<article class="sv-option" data-sv-levier/g) || []).length, 1, "un seul levier payant");
  assert.equal((t.match(/Revenir sous ton plafond satellite/g) || []).length, 1);
  assert.doesNotMatch(t, /aucun en euros|Pas de verdict : une donnée manque/);
  assert.match(t, /Gain attendu Pas de gain chiffrable réduit un risque/);
  assert.match(t, /À peser/);
  assert.match(t, /Répond aussi à : Ta part satellite est à [\d,]+ % pour un plafond de 15 %/);
  assert.doesNotMatch(h, /sv-bal-piste/, "pas de barre 0 € contre 185 €");
  // levier sans verdict : le mot dit qu'il manque une donnée
  const { L } = vueDe("VC-21");
  const h2 = SV.ligneSuiviHtml(L("fct"), { U: UI, today: TODAY }), t2 = texte(h2);
  assert.match(t2, /Il manque une donnée/);
  assert.match(t2, /prix de revient/);
  assert.match(t2, /À chiffrer/);
});

test("« Comment c'est calculé » : étapes, hypothèses, ce qui manque et sources", () => {
  const { L: L2 } = vueDe("VC-2");
  assert.match(texte(SV.ligneSuiviHtml(L2("fam"), { U: UI, today: TODAY })), /Hypothèses.*frais d'arbitrage de 1 % supposés/);
});

test("politique de suivi (Compte › Règles) : quatre lignes de 56 px avec leur valeur et « Modifier avec Claude », source dite", () => {
  const { v } = vueDe("PO-2");
  const h = SV.politiqueHtml(v.politique, UI), t = texte(h);
  assert.equal((h.match(/<li class="sv-regle">/g) || []).length, 4, "« Ta semaine » viendra avec le résumé hebdomadaire (phase 6)");
  assert.equal((h.match(/Modifier avec Claude/g) || []).length, 4);
  assert.match(t, /Revue du cœur Tous les six mois, en mars et septembre/);
  assert.match(t, /Plafond de la part satellite 5 % de ton financier investi/);
  assert.match(t, /Réglage par défaut selon ton profil et tes objectifs/);
  const { v: v3 } = vueDe("PO-3");
  assert.match(texte(SV.politiqueHtml(v3.politique, UI)), /Réglée avec Claude\./);
  assert.match(texte(SV.politiqueHtml(vueDe("PO-4").v.politique, UI)), /profil à faire/);
});

test("lecture seule et lexique : aucun champ de saisie, aucun bouton d'écriture, textes au tutoiement sans « conseiller » ni vocabulaire de jeu", () => {
  const sortie = [];
  for (const id of ["CM-9", "DE-1", "VC-3", "VC-21", "VC-12", "DE-14"]) {
    const { v, d } = vueDe(id);
    sortie.push(SV.systemeHtml(v, { U: UI }), SV.politiqueHtml(v.politique, UI));
    v.lignes.forEach(l => sortie.push(SV.ligneSuiviHtml(Suivi.ligne(d, l.id, TODAY), { U: UI, today: TODAY })));
  }
  const h = sortie.join("\n");
  assert.doesNotMatch(h, /<(input|select|textarea|form)\b/i);
  assert.doesNotMatch(texte(h), INTERDIT);
  assert.doesNotMatch(h, /style="[^"]*(color|background)\s*:\s*(#|rgb)/i, "aucune couleur écrite en dur dans le HTML");
});

test("fiche d'une ligne de Patrimoine › Comptes : la section « Ta ligne » est insérée entre « En bref » et « Détail » quand le suivi est fourni", () => {
  const CV = require("../web/src/comptes-view.js");
  const src = readFileSync("web/src/comptes-view.js", "utf8");
  assert.match(src, /function ficheLigneHtml\(f, U, o\)/);
  assert.match(src, /cv-f-suivi/);
  assert.match(src, /SV\.ligneSuiviHtml\(sv, \{ U: u, today: jour\(\) \}\)/);
  assert.match(src, /data-sv-aller/, "le bilan du suivi mène aux constats");
  assert.match(src, /cv-f-suivi/);
  const f = { trouvee: false };
  assert.equal(typeof CV.ficheLigneHtml, "function");
  assert.match(CV.ficheLigneHtml(f, UI, { suiviHtml: "x" }), /introuvable|Ligne/i);
});

test("css : suivi-view.css n'emploie que des jetons ; regles.html et pilotage.html portent les blocs du suivi", () => {
  const css = readFileSync("web/src/suivi-view.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "pas de couleur écrite");
  assert.doesNotMatch(css, /rgb\(|rgba\(|hsl\(/);
  assert.match(readFileSync("web/src/regles.html", "utf8"), /id="rgSuivi"/);
  assert.match(readFileSync("web/src/pilotage.html", "utf8"), /id="plSysteme"/);
  assert.match(readFileSync("build.mjs", "utf8"), /"suivi", "suivi-view"/);
  assert.match(readFileSync("build.mjs", "utf8"), /suivi-view\.css/);
});

/* Contraste AA des paires propres au suivi (verdicts, plafond dépassé, météo sur la surface), en clair et en sombre. */
import { table, couleur, contraste } from "./helpers/contraste.mjs";
for (const th of ["clair", "sombre"]) {
  test(`contraste AA (${th}) : verdicts, météo et plafond dépassé sur la surface, orbite et marques des segments`, () => {
    const t = table(th), c = n => couleur("var(" + n + ")", t), echecs = [];
    for (const [fg, bg, min] of [["--st-good", "--surface", 4.5], ["--st-watch", "--surface", 4.5], ["--st-work", "--surface", 4.5], ["--st-todo", "--surface", 4.5], ["--ink", "--surface", 4.5], ["--muted", "--surface", 4.5],
      ["--brand", "--surface", 4.5], ["--brand-ink", "--brand", 4.5], ["--st-work", "--sunk", 4.5],
      /* verdict de la ligne : pilule (texte de surface sur la couleur du statut), phrase et puces sur le fond teinté, « Que faire ? » sur le fond creusé */
      ["--surface", "--st-work", 4.5], ["--surface", "--st-watch", 4.5], ["--surface", "--st-good", 4.5], ["--surface", "--st-todo", 4.5],
      ["--ink", "--st-work-bg", 4.5], ["--ink", "--st-watch-bg", 4.5], ["--ink", "--st-good-bg", 4.5], ["--ink", "--st-todo-bg", 4.5],
      ["--st-good", "--st-good-bg", 4.5], ["--st-watch", "--st-watch-bg", 4.5], ["--st-work", "--st-work-bg", 4.5], ["--st-todo", "--st-todo-bg", 4.5],
      ["--muted", "--sunk", 4.5], ["--ink", "--sunk", 4.5], ["--brand", "--sunk", 4.5],
      /* éléments graphiques (segments, arcs, graduation, bulles) : 3:1 contre la surface */
      ["--brand", "--surface", 3], ["--s3", "--surface", 3], ["--st-good", "--surface", 3], ["--st-watch", "--surface", 3], ["--st-work", "--surface", 3], ["--ink", "--surface", 3], ["--st-todo", "--surface", 3]]) {
      const r = contraste(c(fg), c(bg));
      if (r < min) echecs.push(fg + " sur " + bg + " : " + r.toFixed(2) + " < " + min);
    }
    assert.deepEqual(echecs, []);
  });
}
