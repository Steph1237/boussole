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
const INTERDIT = /\b(bonus|gagne|gagné|série|record|jackpot|trade|trading|confetti|badge|classement)\b|achète|vends\b|renforce|allège|conseiller|Copilote|\bvous\b|\bvotre\b|\bvos\b/i;

test("chips factuelles : jamais « à travailler » ni un ordre sur une ligne nommée ; le repère de poids est écrit avec son chiffre", () => {
  const { d } = vueDe("CM-8");
  const cs = Suivi.constats(d, "soc", TODAY);
  const poids = cs.find(c => c.cle === "poids");
  assert.equal(poids.statut, "a_travailler");
  assert.equal(SV.chipConstat(poids), "Au-dessus du repère de 5 %");
  const { d: d9 } = vueDe("CM-9");
  assert.equal(SV.chipConstat(Suivi.constats(d9, "lev", TODAY).find(c => c.cle === "classe_risque")), "Classe spéculative");
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

test("« Ta ligne » : anneau segmenté (un segment par constat), constats en lignes ouvrables, couverture écrite, rôle proposé et prochaine revue", () => {
  const { L } = vueDe("CM-9");
  const l = L("lev"), h = SV.ligneSuiviHtml(l, { U: UI, today: TODAY });
  assert.equal((h.match(/class="sv-seg /g) || []).length, l.constats.length);
  assert.equal((h.match(/<details class="sv-constat/g) || []).length, l.constats.length);
  assert.match(texte(h), /5 constats sur 7/);
  assert.match(texte(h), /Rôle proposé : satellite \(produit à effet de levier\)\. Confirme-le avec Claude\./);
  assert.match(texte(h), /Revue chaque mois, dans ta revue mensuelle avec Claude\./);
  assert.match(h, /<h4 class="sv-c-h">Ta situation<\/h4>[\s\S]*<h4 class="sv-c-h">Pourquoi<\/h4>[\s\S]*<h4 class="sv-c-h">Le calcul<\/h4>/, "ordre du panneau d'un constat (CP4)");
  assert.match(h, /Ce qui manque/);
  assert.doesNotMatch(texte(h), /\b\d+ ?\/ ?(20|100)\b/, "aucune note chiffrée");
  assert.doesNotMatch(texte(h), INTERDIT);
  // cœur : la prochaine revue est dite, jamais « rien à surveiller »
  const c = vueDe("CM-1").L("etf");
  assert.match(texte(SV.ligneSuiviHtml(c, { U: UI })), /Ton cœur est à revoir ce mois-ci \(octobre\)\.|Prochaine revue de ton cœur : /);
  assert.doesNotMatch(texte(SV.ligneSuiviHtml(c, { U: UI })), /rien à surveiller/i);
});

test("leviers : le titre nomme une classe et une enveloppe (jamais une ligne), gain et coût écrits, balance et verdict en mot et pictogramme", () => {
  const { d, L } = vueDe("DE-1");
  const h = SV.ligneSuiviHtml(L("fam"), { U: UI, today: TODAY });
  const titres = [...h.matchAll(/<h4 class="sv-lv-titre">([^<]*)</g)].map(m => m[1]);
  assert.ok(titres.length >= 1);
  for (const t of titres) { assert.doesNotMatch(t, /Fonds Actions Monde A/); }
  assert.ok(titres.some(t => /classe Actions/.test(t) && /Assurance vie Exemple/.test(t)));
  const carte = h.split('<article class="sv-levier"').find(x => /data-sv-levier="frais_eleves"/.test(x));
  const t = texte(carte);
  assert.match(t, /Gain \+312 € par an certain : frais/);
  assert.match(t, /Coût 0 € arbitrage interne, sans impôt/);
  assert.match(t, /Rentabilisé tout de suite · ton horizon : 10 ans/);
  assert.match(carte, /<p class="sv-verdict sv-v-vaut_le_cout"><svg class="sv-ico"[\s\S]*<span class="sv-verdict-mot">Ça vaut le coût<\/span>/);
  assert.match(sp(carte), /role="img" aria-label="Gain cumulé sur 10 ans : 3 120 €\. Coût une fois : 0 €\./);
  // le cas qui ne vaut pas le coût : mot « ne rien faire », alternative sans coût, phrase sur le levier et non sur la ligne
  const { L: L3 } = vueDe("VC-3");
  const h3 = SV.ligneSuiviHtml(L3("fct"), { U: UI, today: TODAY }), t3 = texte(h3);
  assert.match(t3, /Ne rien changer à cette classe/);
  assert.match(t3, /Gain \+95 € par an/);
  assert.match(t3, /Coût 2 106 € une fois impôt 1 821 € \+ courtage et écart 285 €/);
  assert.match(t3, /Rentabilisé en 22 ans · ton horizon : 12 ans/);
  assert.match(t3, /Sans coût : oriente tes prochains versements pour cette classe/);
  assert.match(t3, /sur ton horizon, ne rien changer à cette classe est l'option la moins coûteuse/);
  assert.doesNotMatch(t3.slice(t3.indexOf("Les leviers")), /Fonds Actions Monde B/, "le nom de la ligne n'est pas dans les leviers (il ne figure que dans les données d'un constat)");
  assert.match(h3, /<span class="sv-bal-pm"/, "point mort marqué sur la barre du gain");
  assert.match(h3, /Comment c'est calculé/);
  assert.equal(SV.balanceHtml({ gain_annuel: 0, cout_unique: null, horizon_ans: 5 }), "");
});

test("« Comment c'est calculé » : étapes, hypothèses, ce qui manque et sources ; un levier sans verdict le dit", () => {
  const { L } = vueDe("VC-21");
  const h = SV.ligneSuiviHtml(L("fct"), { U: UI, today: TODAY }), t = texte(h);
  assert.match(t, /Pas de verdict : une donnée manque/);
  assert.match(t, /prix de revient/);
  assert.match(t, /Ce qui manque/);
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
      /* éléments graphiques (segments, arcs, graduation, bulles) : 3:1 contre la surface */
      ["--brand", "--surface", 3], ["--s3", "--surface", 3], ["--st-good", "--surface", 3], ["--st-watch", "--surface", 3], ["--st-work", "--surface", 3], ["--ink", "--surface", 3], ["--st-todo", "--surface", 3]]) {
      const r = contraste(c(fg), c(bg));
      if (r < min) echecs.push(fg + " sur " + bg + " : " + r.toFixed(2) + " < " + min);
    }
    assert.deepEqual(echecs, []);
  });
}
