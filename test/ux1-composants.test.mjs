// Composants communs UX1 (web/src/ui.js + ui.css) : puce de statut, carte KPI (héros, compacte), ligne de liste, élément d'« À traiter »,
// boutons, fondu des onglets défilants, panneau (fermeture animée, glisser pour fermer), alias de formats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";
import { pour, regles } from "./helpers/css.mjs";

const require = createRequire(import.meta.url);
const UI = require("../web/src/ui.js");
const js = readFileSync("web/src/ui.js", "utf8");
const css = readFileSync("web/src/ui.css", "utf8");
const XSS = `<img src=x onerror="alert(1)">'&`;
const sain = h => !/<img/i.test(h) && !h.includes('onerror="');

/* ------------------------------------------------ puce de statut ------------------------------------------------ */

test("puce : 4 statuts, toujours un libellé en toutes lettres (point + texte), jamais une couleur seule", () => {
  assert.deepEqual(Object.keys(UI.STATUTS), ["bon", "surveiller", "travailler", "completer"]);
  const attendu = { bon: "Bon", surveiller: "À surveiller", travailler: "À travailler", completer: "À compléter" };
  for (const [k, lib] of Object.entries(attendu)) {
    const h = UI.puce(k);
    assert.match(h, new RegExp(`^<span class="ui-puce ${k}"><span class="ui-puce-point" aria-hidden="true"></span>${lib}</span>$`));
    assert.equal(UI.puce({ statut: k }), h);
  }
  assert.match(UI.puce({ statut: "bon", texte: "Correct" }), />Correct<\/span>$/, "libellé personnalisé");
  assert.equal(UI.puce("inconnu"), "", "statut inconnu : rien (pas de chip sans sens)");
  assert.equal(UI.puce(), "");
  assert.ok(sain(UI.puce({ statut: "bon", texte: XSS })), "texte échappé");
});

test("puce : couleurs AA par jetons de statut, « À compléter » neutre à contour pointillé", () => {
  for (const [k, c] of [["bon", "good"], ["surveiller", "watch"], ["travailler", "work"]]) {
    const d = pour(css, ".ui-puce." + k);
    assert.equal(d.color, `var(--st-${c})`);
    assert.equal(d.background, `var(--st-${c}-bg)`);
  }
  const todo = pour(css, ".ui-puce.completer");
  assert.equal(todo.color, "var(--st-todo)");
  assert.match(todo.outline, /1px dashed var\(--st-todo\)/);
  const base = pour(css, ".ui-puce");
  assert.match(base.font, /600 var\(--t-caption\)/, "12 px 600");
  assert.equal(base["letter-spacing"], ".02em");
  assert.equal(pour(css, ".ui-puce-point").width, "8px");
});

/* ------------------------------------------------ carte KPI ------------------------------------------------ */

test("carte : variantes héros et compacte, puce de statut, chevron ; l'API d'origine ne change pas", () => {
  const base = UI.carte({ id: "net", titre: "Patrimoine net", valeur: "512 300 €" });
  assert.match(base, /^<button type="button" class="ui-carte" data-ui-carte="net"/);
  const h = UI.carte({ id: "net", titre: "Patrimoine net", valeur: "193 490 €", variante: "heros", tendance: { sens: "hausse", texte: "+5,2 %" } });
  assert.match(h, /class="ui-carte heros"/);
  const c = UI.carte({ id: "bp", titre: "Bonnes pratiques", valeur: "79", variante: "compacte", statut: "bon" });
  assert.match(c, /class="ui-carte compacte"/);
  assert.match(c, /<span class="ui-carte-statut"><span class="ui-puce bon">/);
  assert.match(c, /ui-carte-ouvrir/, "chevron");
  assert.match(UI.carte({ id: "x", titre: "T", valeur: "1", variante: "autre" }), /class="ui-carte"/, "variante inconnue ignorée");
  assert.ok(sain(UI.carte({ id: "x", titre: XSS, valeur: XSS, statut: "bon" })));
});

test("carte : valeur en Schibsted Grotesk (kpi 22 px, héros 36 px), compacte de 104 px, rangée de 3 mini-KPI", () => {
  assert.match(pour(css, ".ui-carte-valeur").font, /700 var\(--t-kpi\)\/var\(--lh-kpi\) var\(--f-display\)/);
  assert.match(pour(css, ".ui-carte.heros .ui-carte-valeur").font, /700 var\(--t-hero\)\/var\(--lh-hero\) var\(--f-display\)/);
  assert.equal(pour(css, ".ui-carte.compacte")["min-height"], "104px");
  assert.match(pour(css, ".ui-cartes.compactes")["grid-template-columns"], /repeat\(3,/);
  assert.match(pour(css, ".ui-carte")["box-shadow"], /var\(--e1\)/);
  assert.match(pour(css, ".ui-carte")["border-radius"], /var\(--r-card\)/);
});

/* ------------------------------------------------ ligne de liste, à traiter, bouton ------------------------------------------------ */

test("ligne : bouton, lien ou simple ligne ; titre, sous-libellé, montant à droite, delta, chevron seulement si cliquable", () => {
  const b = UI.ligne({ id: "pea", titre: "PEA Camille", sous: "3 lignes · 26,8 %", montant: "24 380 €", delta: { texte: "+1 903 €", ton: "pos" } });
  assert.match(b, /^<button class="ui-ligne actif avec-sous" type="button" data-ui-ligne="pea"/);
  assert.match(b, /<span class="ui-ligne-titre">PEA Camille<\/span><span class="ui-ligne-sous">3 lignes · 26,8 %<\/span>/);
  assert.match(b, /<span class="ui-ligne-valeur num">24 380 €<\/span><span class="ui-ligne-delta num pos">\+1 903 €<\/span>/);
  assert.match(b, /ui-ligne-chevron/);
  const a = UI.ligne({ href: "#patrimoine/comptes", titre: "Comptes" });
  assert.match(a, /^<a class="ui-ligne actif" href="#patrimoine\/comptes">/);
  const ext = UI.ligne({ href: "https://claude.ai/new?q=l'export", titre: "Claude" });
  assert.match(ext, /href="https:\/\/claude\.ai\/new\?q=l&#39;export" target="_blank" rel="noopener noreferrer"/, "lien externe sûr, apostrophe échappée");
  const p = UI.ligne({ titre: "Total", montant: "1 €" });
  assert.match(p, /^<div class="ui-ligne">/);
  assert.doesNotMatch(p, /chevron/);
  assert.match(UI.ligne({ id: "x", titre: "T", barre: 140 }), /width:100\.0%/, "barre de part bornée à 100 %");
  assert.match(UI.ligne({ id: "x", titre: "T", barre: 26.8 }), /width:26\.8%/);
  assert.equal(UI.ligne({ href: "javascript:alert(1)", titre: "x" }).includes("javascript:"), false, "schéma non sûr refusé");
  assert.match(UI.ligne({ id: "x", titre: "T", icone: "maison" }), /<span class="ui-ligne-ico" aria-hidden="true"><svg/);
  assert.ok(sain(UI.ligne({ id: XSS, titre: XSS, sous: XSS, montant: XSS, delta: { texte: XSS, ton: XSS }, aria: XSS })));
});

test("liste : <ul> de lignes, séparateurs internes, sans carte par ligne", () => {
  const h = UI.liste([UI.ligne({ id: "a", titre: "A" }), UI.ligne({ id: "b", titre: "B" })], { label: "Comptes" });
  assert.match(h, /^<ul class="ui-liste" aria-label="Comptes"><li><button/);
  assert.equal((h.match(/<li>/g) || []).length, 2);
  assert.equal(UI.liste([]), '<ul class="ui-liste"></ul>');
  assert.match(pour(css, ".ui-liste>li+li")["border-top"], /1px solid var\(--line\)/);
});

test("aTraiter : icône de type, titre, raison, action à droite ; « Urgent » seulement si demandé", () => {
  const calme = UI.aTraiter({ titre: "5 changements à valider", raison: "Proposés par Claude", icone: "etincelle", action: { texte: "Examiner", href: "#agent/propositions" } });
  assert.match(calme, /^<div class="ui-item">/);
  assert.match(calme, /<a class="ui-item-action" href="#agent\/propositions"><span>Examiner<\/span><\/a>/);
  assert.doesNotMatch(calme, /Urgent|Bloquant|travailler/, "pas de chip d'urgence par défaut");
  const urgent = UI.aTraiter({ titre: "Néo Courtage : reconnecte ta banque", raison: "Soldes figés depuis le 11 oct.", icone: "banque", urgent: "Bloquant", action: { texte: "Reconnecter", id: "reco" } });
  assert.match(urgent, /class="ui-item urgent"/);
  assert.match(urgent, /<span class="ui-puce travailler">.*Bloquant<\/span>/);
  assert.match(urgent, /<button type="button" class="ui-item-action" data-ui-action="reco">/);
  assert.match(UI.aTraiter({ titre: "T", urgent: true }), />Urgent<\/span>/);
  assert.ok(sain(UI.aTraiter({ titre: XSS, raison: XSS, urgent: XSS, action: { texte: XSS, id: XSS, aria: XSS } })));
});

test("bouton : primaire, secondaire, tertiaire ; lien ou bouton ; pleine largeur", () => {
  assert.equal(UI.bouton({ texte: "Valider", id: "ok" }), '<button type="button" class="ui-btn" data-ui-bouton="ok">Valider</button>');
  assert.match(UI.bouton({ texte: "Modifier", variante: "secondaire" }), /class="ui-btn secondaire"/);
  assert.match(UI.bouton({ texte: "Voir", variante: "tertiaire", href: "#agent/journal" }), /^<a class="ui-btn tertiaire" href="#agent\/journal">Voir<\/a>$/);
  assert.match(UI.bouton({ texte: "Valider", pleineLargeur: true }), /class="ui-btn plein"/);
  assert.ok(sain(UI.bouton({ texte: XSS, id: XSS, href: "#" + XSS })));
  const p = pour(css, ".ui-btn");
  assert.equal(p.background, "var(--brand-fill)", "UX5 : bouton plein = --brand-fill (un cran plus sourd que --brand en sombre)");
  assert.equal(p.color, "var(--brand-fill-ink)");
  assert.match(pour(css, ".ui-btn.secondaire").background, /var\(--surface\)/);
  assert.match(pour(css, ".ui-btn.tertiaire")["text-decoration"], /underline/);
});

test("ui.js : alias de formats (UI.fmtEUR, fmtPct, fmtDate, fmtDelta, graduations) = format.js", () => {
  const F = require("../web/src/format.js");
  for (const k of ["fmtNombre", "fmtEUR", "fmtPct", "fmtDate", "fmtDelta", "classeMontant", "graduations", "fmtAxe"]) assert.equal(UI[k], F[k], k);
  assert.equal(UI.fmtEUR(193490, { compact: "kpi" }), "193 k€".replace(" ", " "));
});

test("ui.js : les nouveaux composants sont documentés dans l'en-tête de ui.js", () => {
  const tete = js.slice(0, js.indexOf("(function"));
  for (const nom of ["UI.puce", "UI.ligne", "UI.liste", "UI.aTraiter", "UI.bouton", "UI.defilant", "UI.fmtEUR", "UI.decisionGlisse"]) assert.ok(tete.includes(nom), "doc manquante : " + nom);
});

/* ------------------------------------------------ onglets défilants : fondu de bord ------------------------------------------------ */

test("etatFondu : rien ne déborde → none ; suite à droite → end ; à gauche → start ; des deux côtés → both", () => {
  assert.equal(UI.etatFondu(0, 390, 390), "none");
  assert.equal(UI.etatFondu(0, 390, 391), "none", "1 px d'arrondi : pas de fondu");
  assert.equal(UI.etatFondu(0, 390, 700), "end");
  assert.equal(UI.etatFondu(120, 390, 700), "both");
  assert.equal(UI.etatFondu(310, 390, 700), "start");
  assert.equal(UI.etatFondu(309.5, 390, 700), "start", "fin atteinte à un demi-pixel près");
});

test("defilant : pose data-fade, se met à jour au défilement, même instance si rappelé, ancre l'onglet actif", () => {
  const ls = {};
  const actif = { getBoundingClientRect: () => ({ left: 300, width: 80 }) };
  const el = {
    scrollLeft: 0, clientWidth: 390, scrollWidth: 700, attrs: {},
    addEventListener: (t, f) => { (ls[t] ||= []).push(f); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getBoundingClientRect: () => ({ left: 0, width: 390 }),
    querySelector: () => actif,
  };
  const d = UI.defilant(el);
  assert.equal(el.attrs["data-fade"], "end");
  assert.equal(UI.defilant(el), d, "même instance");
  assert.equal(ls.scroll.length, 1, "un seul écouteur");
  el.scrollLeft = 200; ls.scroll[0]();
  assert.equal(el.attrs["data-fade"], "both");
  el.scrollLeft = 0; d.montrerActif();
  assert.equal(el.scrollLeft, 300 - 0 - (390 - 80) / 2, "l'onglet actif est recentré");
  assert.equal(UI.defilant(null), null);
});

test("onglets : le conteneur .ui-onglets reçoit le fondu de bord (chips de 36 px)", () => {
  assert.match(js, /if \(cfg\.cle === "onglets"\) \{ const d = defilant\(racine\.querySelector\("\.ui-onglets"\)\)/);
  for (const f of ["end", "start", "both"]) assert.match(pour(css, `.ui-onglets[data-fade="${f}"]`)["mask-image"], /linear-gradient/);
  assert.equal(pour(css, ".ui-onglet").border, "1px solid var(--line)");
  assert.equal(pour(css, '.ui-onglet[aria-selected="true"]').background, "var(--ink)");
});

/* ------------------------------------------------ panneau : feuille, fermeture, glisser ------------------------------------------------ */

test("decisionGlisse : ferme au-delà de 96 px, ou 24 px avec une vitesse d'au moins 0,6 px/ms ; jamais vers le haut", () => {
  assert.equal(UI.decisionGlisse(96, 800), true);
  assert.equal(UI.decisionGlisse(95, 800), false);
  assert.equal(UI.decisionGlisse(30, 40), true, "geste rapide");
  assert.equal(UI.decisionGlisse(30, 200), false, "geste lent et court");
  assert.equal(UI.decisionGlisse(23, 10), false, "trop court même rapide");
  assert.equal(UI.decisionGlisse(-200, 100), false);
  assert.equal(UI.decisionGlisse(0, 0), false);
});

function monter(reduit) {
  const dom = miniDom(), ctx = { document: dom.doc, console };
  ctx.window = ctx; ctx.self = ctx;
  const ls = {}; ctx.addEventListener = (t, f) => { (ls[t] ||= []).push(f); }; ctx.removeEventListener = () => {};
  const minuteries = [];
  ctx.setTimeout = (f, ms) => { minuteries.push({ f, ms }); return minuteries.length; };
  ctx.clearTimeout = n => { if (minuteries[n - 1]) minuteries[n - 1].annule = true; };
  if (reduit !== undefined) ctx.matchMedia = q => ({ matches: /reduce/.test(q) ? reduit : false });
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: "ui.js" });
  return { U: ctx.UI, doc: dom.doc, minuteries };
}

test("panneau : sans animation (mouvement réduit ou environnement sans matchMedia) le panneau se masque aussitôt", () => {
  for (const reduit of [undefined, true]) {
    const { U, doc, minuteries } = monter(reduit);
    U.panneau.ouvrir({ titre: "T", contenu: "<p>x</p>" });
    U.panneau.fermer();
    assert.equal(doc.body.querySelector(".ui-panneau").hidden, true, "reduit=" + reduit);
    assert.equal(minuteries.length, 0);
  }
});

test("panneau : fermeture animée de 180 ms (classe « sort », masquage différé) ; rouvrir pendant la sortie annule le masquage", () => {
  const { U, doc, minuteries } = monter(false);
  U.panneau.ouvrir({ titre: "T", contenu: "<p>x</p>" });
  const el = doc.body.querySelector(".ui-panneau"), voile = doc.body.querySelector(".ui-voile");
  U.panneau.fermer();
  assert.equal(U.panneau.ouvert(), false, "l'état est fermé tout de suite (focus rendu, page réactivée)");
  assert.ok(el.classList.contains("sort") && voile.classList.contains("sort"));
  assert.equal(el.hidden, false, "encore visible pendant l'animation");
  assert.equal(minuteries.length, 1);
  assert.ok(minuteries[0].ms >= 180 && minuteries[0].ms <= 260);
  minuteries[0].f();
  assert.equal(el.hidden, true);
  assert.ok(!el.classList.contains("sort"));
  // rouvrir pendant la sortie
  U.panneau.ouvrir({ titre: "A", contenu: "" });
  U.panneau.fermer();
  U.panneau.ouvrir({ titre: "B", contenu: "" });
  assert.equal(el.hidden, false);
  assert.ok(!el.classList.contains("sort"), "plus de classe de sortie");
  assert.equal(U.panneau.ouvert(), true);
});

test("panneau : feuille du bas de 92 vh avec poignée et titre collant, volet de 480 px sur ordinateur, voile et ombre par jetons", () => {
  const mobile = regles(css).filter(r => r.media === "(max-width:899.98px)" && r.selectors.includes(".ui-panneau"))[0].decls;
  assert.match(mobile["max-height"], /92d?vh/);
  assert.match(mobile["border-radius"], /var\(--r-sheet\) var\(--r-sheet\) 0 0/);
  assert.match(mobile.animation, /ui-monte var\(--dur-open\) var\(--ease-sheet\)/, "220 ms, courbe de la feuille");
  const bureau = regles(css).filter(r => r.media === "(min-width:900px)" && r.selectors.includes(".ui-panneau"))[0].decls;
  assert.match(bureau.width, /min\(480px/);
  assert.match(pour(css, ".ui-panneau")["box-shadow"], /var\(--e3\)/);
  assert.match(pour(css, ".ui-voile").background, /var\(--veil\)/);
  assert.match(pour(css, ".ui-panneau.sort") === undefined ? "" : "ok", /ok/);
  assert.equal(pour(css, ".ui-panneau-poignee").width, "36px");
  assert.equal(pour(css, ".ui-panneau-fermer").width, "var(--hit)");
  assert.match(js, /pointerdown/);
  assert.match(js, /decisionGlisse\(d, dt\)/);
});

test("mouvement : durées par jetons (150 / 220 / 180 ms), plus de durée en dur dans ui.css (hors le squelette, qui boucle)", () => {
  const durs = [];
  for (const r of regles(css)) for (const [k, v] of Object.entries(r.decls)) if (/^(transition|animation)/.test(k) && !/ui-skel/.test(v) && /(^|[\s,])\.?\d*\.?\d+m?s\b/.test(v)) durs.push(r.selectors[0] + " " + k + ":" + v);
  assert.deepEqual(durs, []);
  assert.match(css, /transition:[^;]*var\(--dur-state\)/);
  assert.match(css, /var\(--dur-open\)/);
  assert.match(css, /var\(--dur-close\)/);
});

/* ---------- UX5 lot 1 : colonne d'état de la ligne, tuile, état vide, squelette ---------- */
test("ligne : colonne d'état (puce) avant le montant ; etat: \"\" réserve la colonne vide pour garder montant et chevron alignés", () => {
  const avec = UI.ligne({ id: "a", titre: "PEL", montant: "1 000 €", etat: "surveiller" });
  assert.match(avec, /<span class="ui-ligne-etat"><span class="ui-puce surveiller">/);
  assert.ok(avec.indexOf("ui-ligne-etat") < avec.indexOf("ui-ligne-montant"));
  assert.match(UI.ligne({ id: "b", titre: "CEL", montant: "2 000 €", etat: "" }), /<span class="ui-ligne-etat"><\/span>/);
  assert.doesNotMatch(UI.ligne({ id: "c", titre: "LDDS" }), /ui-ligne-etat/, "sans option, aucune colonne");
  assert.ok(sain(UI.ligne({ titre: XSS, etat: { statut: "bon", texte: XSS } })));
  const e = pour(css, ".ui-ligne-etat");
  assert.equal(e.flex, "none");
  assert.match(css, /@media \(min-width:600px\)\{\.ui-ligne-etat,\.ui-ligne-etat:empty\{display:flex;min-width:6\.5rem\}\}/, "largeur réservée dès 600 px");
  assert.equal(pour(css, ".ui-ligne-chevron").width, "16px");
});

test("tuile : libellé, valeur, sous-ligne ; fond --sunk, sans bordure ni ombre (jamais une carte dans une carte)", () => {
  const h = UI.tuile({ libelle: "Plus-values latentes", valeur: "+4 210 €", sous: "sur 3 lignes" });
  assert.match(h, /^<div class="ui-tuile"><span class="ui-tuile-l">Plus-values latentes<\/span><span class="ui-tuile-v num">\+4 210 €<\/span><span class="ui-tuile-s">sur 3 lignes<\/span><\/div>$/);
  assert.match(UI.tuile({ libelle: "x" }), /ui-tuile-v num">—</, "valeur absente → tiret");
  assert.ok(sain(UI.tuile({ libelle: XSS, valeur: XSS, sous: XSS })));
  const t = pour(css, ".ui-tuile");
  assert.equal(t.background, "var(--sunk)");
  assert.equal(t.border, "0");
  assert.equal(t["box-shadow"], "none");
  assert.equal(t.padding, "var(--tile-pad)");
});

test("vide : icône de 24 px, une phrase, une action secondaire ; sans action, sans bouton", () => {
  const h = UI.vide({ texte: "Aucun objectif pour l'instant.", action: { texte: "Compléter avec Claude", href: "https://claude.ai/new?q=a" } });
  assert.match(h, /^<div class="ui-vide"><span class="ui-vide-ico" aria-hidden="true"><svg /);
  assert.match(h, /<p class="ui-vide-texte">Aucun objectif pour l&#39;instant\.<\/p>/);
  assert.match(h, /<a class="ui-btn secondaire" href="https:\/\/claude\.ai\/new\?q=a"[^>]*>Compléter avec Claude<\/a>/);
  assert.doesNotMatch(UI.vide({ texte: "Rien." }), /ui-btn/);
  assert.ok(sain(UI.vide({ texte: XSS, action: { texte: XSS, id: XSS } })));
  assert.equal(pour(css, ".ui-vide-ico").width, "24px");
  assert.equal(pour(css, ".ui-vide-ico").color, "var(--muted)");
});

test("squelette : n blocs de la forme demandée (kpi 96 px, ligne 56 px, graphe 220 px puis 320 px), annoncés « chargement », pulsation coupée en mouvement réduit", () => {
  const h = UI.squelette(3, "kpi");
  assert.equal((h.match(/class="ui-skel-bloc kpi"/g) || []).length, 3);
  assert.match(h, /role="status" aria-busy="true" aria-label="Chargement en cours"/);
  assert.match(UI.squelette(1, "inconnue"), /ui-skel-bloc ligne/, "forme inconnue → ligne");
  assert.equal((UI.squelette(999, "ligne").match(/ui-skel-bloc/g) || []).length, 24, "plafonné à 24");
  assert.equal(pour(css, ".ui-skel-bloc.kpi").height, "96px");
  assert.equal(pour(css, ".ui-skel-bloc.ligne").height, "56px");
  assert.equal(pour(css, ".ui-skel-bloc.graphe").height, "220px");
  assert.match(css, /@media \(min-width:900px\)\{\.ui-skel-bloc\.graphe\{height:320px\}\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.ui-skel-bloc\{animation:none\}\}/);
});
