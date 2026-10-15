// Graphe maître (SIM2) : contrôleur DOM `monter` sous le mini-DOM : commandes visibles, curseur toucher-glisser / survol / clavier, panneau de lecture, jalons en vrais
// boutons, feuilles (réglages, liste, détail), états (squelette, erreur, vide, progressif), plein écran (API Fullscreen et couche role="dialog"), zoom, comparaison à
// un plan, 100 avenirs, invitation, lecture seule. Les 12 tests d'acceptation de l'interface (spec § 10.8) sont répartis ici et dans graphe-patrimoine.test.mjs.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { G, donnees, monter, AUJ, plusMois } from "./helpers/graphe-donnees.mjs";

const sp = s => String(s).replace(/[  ]/g, " ");
const glisser = (t, x0, x1, type = "touch") => {
  const hit = t.q("[data-hit]"), E = (n, x) => new t.Ev(n, { clientX: x, clientY: 50, pointerId: 1, pointerType: type, timeStamp: 1 });
  hit.dispatchEvent(E("pointerdown", x0)); hit.dispatchEvent(E("pointermove", (x0 + x1) / 2)); hit.dispatchEvent(E("pointermove", x1)); hit.dispatchEvent(E("pointerup", x1));
};
const ro = t => sp(t.q("[data-roline]").textContent);
const ytk = t => t.qa(".gp-ytk");
const sur = (t, el, type = "change") => el.dispatchEvent(new t.Ev(type));

test("commandes : un contrôle segmenté de 5 fenêtres, « Réglages » et « Plein écran » (3 commandes), aucun bouton de granularité, aucun sélecteur de périmètre", () => {
  const t = monter();
  const seg = t.qa(".gp-seg");
  assert.equal(seg.length, 1); assert.deepEqual(t.qa("[data-win]").map(b => b.textContent), ["1 an", "5 ans", "10 ans", "20 ans", "Tout"]);
  assert.equal(seg[0].getAttribute("role"), "group"); assert.match(seg[0].getAttribute("aria-label"), /années avant et après aujourd'hui/);
  assert.equal(t.qa('[data-act="reglages"]').length, 1); assert.equal(t.q('[data-act="reglages"]').getAttribute("aria-label"), "Réglages du graphique");
  assert.equal(t.qa('.gp-icon[data-act="plein"]').length, 1); assert.equal(t.q('.gp-icon[data-act="plein"]').getAttribute("aria-label"), "Ouvrir en grand");
  const html = t.host.innerHTML.toLowerCase();
  assert.doesNotMatch(html, /granularit|périmètre|perimetre|data-gran|data-scope/);
  assert.equal(t.qa(".gp-eur").length + t.qa(".gp-icon").length, 3, "l'en-tête : puce euros, Réglages, Ouvrir en grand");
  assert.equal(t.qa("[data-win]").length + t.qa(".gp-jal").length, 6, "5 fenêtres + la puce « N jalons »");
  assert.equal(sp(t.texte("[data-njal]")), "9 jalons");
  assert.equal(sp(t.texte("[data-eur]")), "€ d'aujourd'hui", "puce « en euros d'aujourd'hui » (le réglage est dans la feuille)");
});

test("rendu initial : titre qui suit la lecture, une ligne de lecture, role=\"img\" et aria-label égal à la phrase de titre ; 5 ans par défaut", () => {
  const t = monter();
  assert.equal(t.q("[data-svg]").getAttribute("role"), "img");
  assert.match(sp(t.q("[data-svg]").getAttribute("aria-label")), /^Aujourd'hui : 193 k€ · dans 7 ans : médiane \d+ k€ \(\d+ k€ à \d+ k€\), en euros d'aujourd'hui\.$/);
  assert.equal(t.q("[data-win][aria-pressed=\"true\"]").textContent, "5 ans");
  assert.equal(t.texte('[data-hl="k"]'), "Dans 7 ans · oct. 2033");
  assert.match(sp(t.texte('[data-hl="v"]')), /^≈ \d+ k€$/); assert.match(sp(t.texte('[data-hl="s"]')), /^8 chances sur 10 entre \d+ et \d+ k€$/);
  assert.match(ro(t), /^Oct\. 2033 · ≈ \d+ k€ · \d+–\d+ k€ · prochain : Nouvel emploi de Sam$/);
  assert.equal(t.q("[data-roline]").getAttribute("aria-live"), "polite", "lecture annoncée aux lecteurs d'écran");
  assert.equal(t.q("[data-hit]").getAttribute("role"), "slider"); assert.equal(t.q("[data-hit]").getAttribute("tabindex"), "0");
  assert.ok(t.q("[data-sr]").textContent.includes("Événements :"));
  const fen = t.api.etat.fenetre; assert.equal(fen, "5");
});

test("préréglage ordinateur : 10 ans par défaut quand la fenêtre est large ; Placements : vue financier, aucun objectif affiché", () => {
  const large = { innerWidth: 1280, innerHeight: 800, matchMedia: q => ({ matches: /min-width: 900px/.test(q), addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } };
  assert.equal(monter({ window: large }).api.etat.fenetre, "10");
  const p = monter({ opt: { preset: "placements" }, donnees: Object.assign(donnees(), { vue: "financier" }) });
  assert.equal(p.api.etat.reglages.vue, "financier"); assert.equal(sp(p.texte("[data-njal]")), "6 jalons", "les 3 objectifs ne sont pas des jalons de Placements");
  assert.equal(p.qa(".gp-tg").length, 0);
});

test("curseur : un glisser (événements de pointeur) place la lecture sur le pas le plus proche ; date, valeur, nature, P10–P90 et événements de la date", () => {
  const t = monter();
  glisser(t, 160, 250);
  const l = sp(ro(t));
  assert.match(l, /^[A-ZÉ][a-zéû]+\.? \d{4} · (≈ )?\d+ k€/);
  const x = t.q("[data-xh]"); assert.equal(x.getAttribute("style"), "opacity:1");
  assert.equal(t.q("[data-endpill]").getAttribute("style"), "display:none", "la pastille de fin cède la place à celle du curseur");
  assert.match(t.q("[data-hit]").getAttribute("aria-valuetext"), /^\S+\.? \d{4} : environ \d+ k€$/);
  // au passé : observé / reconstitué dits en mots
  glisser(t, 5, 8);
  assert.match(sp(t.texte('[data-hl="s"]')), /Estimé à partir de tes relevés/); assert.match(sp(t.texte("[data-hl=\"v\"]")), /^\d+ \d{3} €$/, "valeur exacte pour le passé");
  glisser(t, 150, 152);
  assert.match(sp(t.texte('[data-hl="k"]')), /il y a|Aujourd'hui|dans/);
  // le survol à la souris fait la même chose en plein écran ordinateur (hover) ; ici la carte mobile ne réagit qu'au toucher
  const avant = ro(t); t.q("[data-hit]").dispatchEvent(new t.Ev("pointermove", { clientX: 280, pointerId: 9, pointerType: "mouse" })); assert.equal(ro(t), avant, "pas de survol sur mobile");
});

test("curseur : ← / → d'un pas, Origine / Fin aux bornes, T = aujourd'hui, Échap efface ; chaque pas annoncé (aria-live) ; rien n'est disponible seulement au survol", () => {
  const t = monter(), hit = t.q("[data-hit]");
  t.touche(hit, "T");
  assert.match(ro(t), /^Aujourd'hui · 193 490 €( |$)/);
  t.touche(hit, "ArrowRight"); const a = ro(t); assert.match(a, /^Nov\. 2026 /);
  t.touche(hit, "ArrowRight"); assert.match(ro(t), /^Déc\. 2026 · ≈ \d+ k€ · \d+–\d+ k€ · Nouvel emploi de Sam$/, "l'événement de la date est écrit dans la ligne");
  t.touche(hit, "ArrowLeft"); assert.equal(ro(t), a);
  t.touche(hit, "End"); assert.match(ro(t), /^Oct\. 2033 /); t.touche(hit, "Home"); assert.match(ro(t), /^Oct\. 2023 · \d+ \d{3} € · estimé/);
  t.touche(hit, "Escape"); assert.equal(t.q("[data-xh]").getAttribute("style"), "opacity:0");
  t.touche(hit, "ArrowRight"); const n = t.touche(hit, "ArrowRight"); assert.equal(n.defaultPrevented, true);
  // la lecture en une ligne ouvre le détail : tout est lisible sans survol
  t.q('[data-act="lecture"]').click(); assert.equal(t.UI.st.ouvert, true); assert.match(t.UI.st.titre, /^Lecture · /);
  assert.match(sp(t.UI.st.corps.innerHTML), /gp-ro/); assert.match(sp(t.UI.st.corps.innerHTML), /Événements pris en compte/);
});

test("fenêtres : un clic change la fenêtre (aria-pressed), le curseur hors fenêtre est retiré, « Tout » prend tout l'historique et l'horizon", () => {
  const t = monter();
  t.q('[data-win="1"]').click();
  assert.equal(t.q('[data-win="1"]').getAttribute("aria-pressed"), "true"); assert.equal(t.q('[data-win="5"]').getAttribute("aria-pressed"), "false");
  assert.equal(t.texte('[data-hl="k"]'), "Dans 1 an · oct. 2027");
  t.q('[data-win="tout"]').click(); assert.match(t.q("[data-svg]").getAttribute("aria-label"), /dans 10 ans/);
  t.api.curseur(G.msDe(plusMois(AUJ, 100))); t.q('[data-win="1"]').click();
  assert.equal(t.q("[data-xh]").getAttribute("style"), "opacity:0", "curseur sorti de la fenêtre");
  assert.equal(ytk(t).length <= 4, true);
});

test("jalons : de vrais boutons (nom accessible), un jalon seul ouvre sa feuille, un groupe « 5 » ouvre la liste de ses événements, Entrée sur le curseur ouvre la feuille", () => {
  const t = monter(), marks = t.qa(".gp-mk-b");
  assert.ok(marks.length >= 5 && marks.every(b => b.localName === "button" && b.getAttribute("aria-label")));
  const groupe = marks.find(b => /5 jalons rapprochés/.test(b.getAttribute("aria-label")));
  assert.ok(groupe, marks.map(b => b.getAttribute("aria-label")).join(" | "));
  groupe.click();
  assert.equal(t.UI.st.titre, "5 événements rapprochés"); assert.match(t.UI.st.corps.innerHTML, /Nouvel emploi de Sam/); assert.match(t.UI.st.corps.innerHTML, /data-go="ev:crèche"|data-go="ev:creche"/);
  t.UI.panneau.fermer();
  const achat = marks.find(b => /Achat de la résidence principale/.test(b.getAttribute("aria-label")));
  achat.click(); assert.equal(t.UI.st.titre, "Achat de la résidence principale"); assert.match(t.UI.st.corps.innerHTML, /Voir sur la courbe/);
  t.UI.panneau.fermer();
  assert.match(ro(t), /Achat de la résidence principale/, "toucher un jalon place la lecture à sa date");
  const hit = t.q("[data-hit]"); t.UI.panneau.fermer(); t.touche(hit, "Enter");
  assert.match(t.UI.st.titre, /Achat de la résidence principale|2 événements/, "Entrée ouvre la feuille de l'événement sous le curseur");
  assert.ok(marks.every(b => /width:(4[4-9]|[5-9]\d|\d{3,})/.test(b.getAttribute("style"))), "zones cliquables d'au moins 44 px de large");
  // « Modifier avec Claude » pour un événement du foyer
  t.UI.panneau.fermer(); t.api.curseur(G.msDe(plusMois(AUJ, 2))); t.touche(hit, "Enter");
  assert.equal(t.UI.st.titre, "Nouvel emploi de Sam"); assert.match(t.UI.st.corps.innerHTML, /Modifier avec Claude/); assert.match(t.UI.st.corps.innerHTML, /Capacité avant → après/);
});

test("jalons : le bouton « N jalons » ouvre la liste chronologique ; toucher une ligne place le curseur ; › ouvre le détail ; Échap rend le focus (UI.panneau)", () => {
  const t = monter();
  const chip = t.q('[data-act="jalons"]'); chip.focus(); chip.click();
  assert.equal(t.UI.st.titre, "9 jalons"); assert.equal(t.UI.st.corps.querySelectorAll(".gp-jrow").length, 9);
  assert.match(sp(t.UI.st.corps.innerHTML), /Nouvel emploi de Sam<\/span><span class="gp-ev-d num">déc\. 2026 · dans 2 mois<\/span><\/span><span class="gp-ev-e num">\+450 €\/mois/);
  const jump = t.UI.st.corps.querySelector('[data-jump="ev:naissance"]'); jump.click();
  assert.equal(t.UI.st.ouvert, false); assert.match(ro(t), /^Avr\. 2027 .*Naissance$/);
  chip.click(); t.UI.st.corps.querySelector('[data-jdet="objectif:voiture"]').click();
  assert.equal(t.UI.st.titre, "Voiture 12 k€");
  const html = sp(t.UI.st.corps.innerHTML);
  assert.match(html, /Peu probable/); assert.match(html, /3 chances sur 10/); assert.match(html, /Leviers/); assert.match(html, /\+140 €\/mois/);
  t.UI.panneau.fermer(); assert.equal(t.doc.activeElement, chip, "le focus revient au bouton qui a ouvert");
});

test("objectifs : cibles sur la médiane (boutons), statut en mots et probabilité dans l'étiquette flottante, jamais la couleur seule", () => {
  const t = monter();
  const voiture = t.qa(".gp-mk-b").find(b => /Voiture 12 k€, échéance/.test(b.getAttribute("aria-label")));
  voiture.click();
  assert.match(t.q("[data-flab]").innerHTML, /Objectif Voiture 12 k€ : peu probable · 3 chances sur 10|Voiture 12 k€ · peu probable/);
  assert.match(sp(ro(t)), /Voiture 12 k€ : peu probable$/);
  const matelas = t.qa(".gp-mk-b").find(b => /Matelas/.test(b.getAttribute("aria-label"))); matelas.click();
  assert.match(t.q("[data-flab]").innerHTML, /probable/);
});

test("bande « capacité d'épargne » : repliée (28 px), un toucher la déplie avec le montant du mois ; la lecture suit le curseur", () => {
  const t = monter(), b = t.q('[data-act="bande"]');
  assert.equal(b.getAttribute("aria-expanded"), "false"); assert.equal(t.q("[data-bandeh]").hidden, true);
  b.click();
  assert.equal(t.q('[data-act="bande"]').getAttribute("aria-expanded"), "true"); assert.equal(t.q("[data-bandeh]").hidden, false);
  assert.match(sp(t.texte("[data-stripv]")), /950 €\/mois aujourd'hui/);
  t.api.curseur(G.msDe(plusMois(AUJ, 4))); assert.match(sp(t.texte("[data-stripv]")), /1 400 €\/mois en févr\. 2027/);
  assert.ok(t.q("[data-sxh]").innerHTML.includes("gp-xh-v"), "curseur sur la bande, au même axe du temps");
  const sans = donnees(); sans.capacite = null; const t2 = monter({ donnees: sans });
  assert.equal(t2.q('[data-act="bande"]').hidden, true, "aucune capacité connue : pas de bande inventée");
});

test("réglages : vue, euros, net d'impôts, existant seul, variante, crise, 100 avenirs, période libre, plan ; locaux ; un changement de calcul relance le moteur (surReglages)", async () => {
  const t = monter();
  t.q('[data-act="reglages"]').click();
  const html = sp(t.UI.st.corps.textContent);
  assert.equal(t.UI.st.titre, "Réglages du graphique");
  for (const x of ["Patrimoine net", "Patrimoine financier", "Patrimoine disponible", "En euros d'aujourd'hui", "En euros courants", "Net d'impôts", "Ton patrimoine actuel, sans nouveau versement", "2ᵉ enfant", "Crise financière", "100 avenirs possibles", "Période libre", "Comparer à un plan", "Plan du", "ne sont jamais enregistrés"]) assert.ok(html.includes(x), x);
  const corps = t.UI.st.corps;
  const radio = corps.querySelectorAll('input[type="radio"]').find(r => r.getAttribute("value") === "financier"); radio.setAttribute("name", t.api.graphe.id + "vue"); radio.value = "financier";
  sur(t, radio);
  assert.equal(t.calculs.length, 1); assert.equal(t.calculs[0].vue, "financier");
  assert.equal(t.api.etat.reglages.vue, "financier");
  assert.ok(t.q("[data-hit]").getAttribute("style") !== null);
  // « existant seul » : local, aucun calcul
  const sw = corps.querySelector('[data-set="existant"]'); sw.checked = true; sur(t, sw);
  assert.equal(t.calculs.length, 1, "réglage local : pas de nouveau calcul"); assert.ok(t.q("[data-svg]").innerHTML.includes("gp-sv"), "couche « existant » tracée");
  assert.match(t.api.graphe.etat.reglages.existant === true ? "ok" : "non", /ok/);
  assert.equal(t.stockage.size >= 0, true);
});

test("réglages : période libre locale (dates du / au), puis retour aux fenêtres ; euros d'aujourd'hui ↔ courants dans sa feuille", () => {
  const t = monter();
  t.q('[data-act="eur"]').click(); assert.equal(t.UI.st.titre, "En euros d'aujourd'hui"); assert.match(sp(t.UI.st.corps.innerHTML), /indice des prix de l&#39;Insee|indice des prix de l'Insee/);
  t.UI.st.corps.querySelector("[data-sw]").click(); assert.equal(t.calculs.at(-1).euros, "courants"); assert.equal(sp(t.texte("[data-eur]")), "€ courants");
  t.q('[data-act="reglages"]').click();
  const corps = t.UI.st.corps, du = corps.querySelector('[data-periode="du"]'), au = corps.querySelector('[data-periode="au"]');
  du.value = "2025-01-01"; sur(t, du); au.value = "2028-01-01"; sur(t, au);
  assert.deepEqual(t.api.etat.reglages.periode, { du: "2025-01-01", au: "2028-01-01" });
  assert.equal(t.qa("[data-win][aria-pressed=\"true\"]").length, 0, "aucune fenêtre active en période libre");
  assert.match(t.texte('[data-hl="k"]'), /déc\. 2027/, "le dernier mois projeté de la période libre");
});

test("états : squelette à la taille finale pendant le calcul (aria-busy, jamais un chiffre), erreur avec « Réessayer », vide honnête", () => {
  const t = monter({ donnees: { today: AUJ, etat: "calcul" } });
  assert.equal(t.q(".gp").getAttribute("aria-busy"), "true"); assert.equal(t.texte('[data-hl="v"]'), ""); assert.ok(t.q(".gp").classList.contains("gp-charge"));
  assert.match(t.q("[data-cadre]").getAttribute("style"), /height:\d+px/, "taille finale réservée : pas de saut");
  assert.equal(t.q("[data-hit]").getAttribute("style").includes("display:none"), true);
  t.api.mettreAJour(donnees()); assert.equal(t.q(".gp").getAttribute("aria-busy"), null); assert.match(t.texte('[data-hl="v"]'), /k€/);
  let n = 0; const e = monter({ donnees: { today: AUJ, etat: "erreur", erreur: "Le calcul de la projection n'a pas abouti." }, opt: { reessayer: () => { n++; } } });
  assert.match(e.q("[data-etat]").textContent, /n'a pas abouti/); e.q('[data-act="reessayer"]').click(); assert.equal(n, 1);
  const v = monter({ donnees: { today: AUJ, etat: "vide" } });
  assert.match(v.q("[data-etat]").textContent, /Pas encore assez de données|photo de ton patrimoine/); assert.equal(v.qa(".gp-mk-b").length, 0);
});

test("partiel : sans futur (moteur en échec) le passé reste tracé ; sans passé le point « Aujourd'hui » ; sans événement la question est posée", () => {
  const p = monter({ donnees: donnees({ sansFutur: true }) });
  assert.match(p.q("[data-svg]").innerHTML, /gp-obs/); assert.doesNotMatch(p.q("[data-svg]").innerHTML, /class="gp-med"/); assert.match(p.texte('[data-hl="k"]'), /^Aujourd'hui/);
  const s = monter({ donnees: donnees({ sansPasse: true }) });
  assert.match(s.q("[data-svg]").innerHTML, /data-today/); assert.doesNotMatch(s.q("[data-svg]").innerHTML, /gp-recon|gp-obs/);
  assert.equal(s.api.graphe.domaineBase().debut, G.msDe(AUJ), "aucun historique : la fenêtre part d'aujourd'hui");
  const e = monter({ donnees: donnees({ sansEvenement: true }), largeur: 700 });
  assert.match(e.q("[data-notes]").innerHTML, /Aucun événement renseigné — as-tu des changements prévus/);
});

test("progressif : le résultat à 500 chemins puis à 2 000 ne change pas l'échelle des y tant qu'il reste dans la marge ; le fondu de 120 ms ne dessine pas de saut", () => {
  const a = donnees(); a.progressif = true; a.chemins = 500;
  const t = monter({ donnees: a });
  const ticks = () => ytk(t).map(n => n.getAttribute("data-y")).join(",");
  const avant = ticks();
  const b = donnees(); b.chemins = 2000; b.futur.p90 = b.futur.p90.map(v => Math.round(v * 1.03)); b.futur.p10 = b.futur.p10.map(v => Math.round(v * 0.97));
  t.api.mettreAJour(b);
  assert.equal(ticks(), avant, "mêmes graduations, mêmes positions");
  const c = donnees(); c.futur.p90 = c.futur.p90.map(v => v * 3); t.api.mettreAJour(c);
  assert.notEqual(ticks(), avant, "le résultat complet sort de la marge : l'échelle est recalculée");
});

test("zoom : Ctrl + molette, + / − / 0, double touche, « Réinitialiser le zoom » ; l'aperçu (plein écran) déplace et redimensionne le cadre", () => {
  const t = monter(), hit = t.q("[data-hit]");
  assert.equal(t.q('[data-act="zreset"]').hidden, true);
  hit.dispatchEvent(Object.assign(new t.Ev("wheel"), { ctrlKey: true, deltaY: -50, clientX: 150, deltaX: 0 }));
  assert.ok(t.api.etat.zoom, "zoom actif"); assert.equal(t.q('[data-act="zreset"]').hidden, false);
  const dom = t.api.graphe.domaineCourant(); assert.ok(dom.fin - dom.debut < 3650 * 864e5 && t.qa("[data-win][aria-pressed=\"true\"]").length === 0);
  t.touche(hit, "+"); const z2 = t.api.graphe.domaineCourant(); assert.ok(z2.fin - z2.debut < dom.fin - dom.debut);
  t.touche(hit, "-"); t.touche(hit, "0"); assert.equal(t.api.etat.zoom, null); assert.equal(t.q('[data-act="zreset"]').hidden, true);
  glisser(t, 100, 101); glisser(t, 101, 101); assert.ok(t.api.etat.zoom, "double touche : zoom ×2 autour du point");
  t.q('[data-act="zreset"]').click(); assert.equal(t.api.etat.zoom, null);
  // le zoom ne dépasse pas l'historique ni l'horizon
  t.api.graphe.reglerZoom(0, 4e12); const bo = t.api.graphe.bornes(); assert.deepEqual(t.api.etat.zoom, bo, "plus large que tout : borné à l'historique et à l'horizon");
  t.api.graphe.reglerZoom(G.msDe("2030-01-01"), G.msDe("2030-01-10")); const d = t.api.graphe.domaineCourant(); assert.ok(d.fin - d.debut >= 59 * 864e5, "étendue minimale de 2 mois");
});

test("comparer à un plan : barre « Comparé au plan du … », plan en tirets et bande claire, lecture Prévu / Réel / Écart ; « Pourquoi cet écart » dit que la décomposition n'existe pas encore", () => {
  const t = monter();
  const mois = Array.from({ length: 121 }, (_, k) => plusMois(plusMois(AUJ, -9), k)), d = donnees();
  d.plan = { id: "plan-1", cree_le: plusMois(AUJ, -9), raison: "revue_mensuelle", serie: { mois, p10: mois.map((_, k) => 150000 + k * 600), p25: mois.map((_, k) => 155000 + k * 700), p50: mois.map((_, k) => 160000 + k * 800), p75: mois.map((_, k) => 165000 + k * 900), p90: mois.map((_, k) => 170000 + k * 1000) },
    comparaison: { n: 6, dans_la_bande: 5, dernier: { ecart: -8400, plan_p50: 200000, reel: 191600 } } };
  t.api.mettreAJour(d);
  assert.equal(t.q("[data-planbar]").hidden, false); assert.match(sp(t.q("[data-planbar]").textContent), /Comparé au plan du .* revue mensuelle/);
  assert.match(t.q("[data-svg]").innerHTML, /gp-plan-l/); assert.match(t.q("[data-svg]").innerHTML, /gp-plan-b/);
  assert.match(sp(t.texte('[data-hl="k"]')), /^Écart avec le plan du/);
  const why = sp(t.q("[data-why]").innerHTML);
  assert.match(why, /Pourquoi cet écart/); assert.match(why, /n&#39;est pas encore calculée : elle arrive|n'est pas encore calculée : elle arrive/); assert.match(why, /dans la bande 8 chances sur 10 pour 5 mois sur 6/);
  assert.doesNotMatch(why, /gp-wf|Ton épargne<|Les marchés<|waterfall/i, "aucune cascade inventée");
  assert.doesNotMatch(why, /[−+]\d[\d ]* €.*(épargne|marchés)/);
  t.q('[data-act="plan-off"]').click(); assert.equal(t.api.etat.reglages.plan, null);
});

test("100 avenirs : désactivé par défaut ; activé : 100 trajectoires fines, points dans la marge, l'échelle ne change pas, avenirs hors cadre comptés", () => {
  const t = monter(), avant = ytk(t).map(n => n.getAttribute("data-y")).join(",");
  assert.equal(t.api.etat.reglages.avenirs, false); assert.doesNotMatch(t.q("[data-svg]").innerHTML, /gp-hopp/);
  const d = donnees(); d.futur.avenirs = Array.from({ length: 100 }, (_, i) => d.futur.p50.map((v, k) => (k === 0 ? v : Math.round(v * Math.exp(0.07 * Math.sqrt(k / 12) * ((i - 49.5) / 30))))));
  t.api.reglagesAppliques({ avenirs: true }); t.api.mettreAJour(d);
  assert.equal((t.q("[data-svg]").innerHTML.match(/class="gp-hopp"/g) || []).length, 100);
  assert.ok((t.q("[data-svg]").innerHTML.match(/class="gp-qd"/g) || []).length > 50, "points de l'horizon dans la marge");
  assert.equal(ytk(t).map(n => n.getAttribute("data-y")).join(","), avant, "aucun changement d'échelle");
  assert.doesNotMatch(t.q("[data-svg]").innerHTML, /class="gp-med"[^>]*d="M[^"]*"\/>.*class="gp-hopp"/s);
});

test("invitation : en paysage sur téléphone, elle ne propose pas de tourner l'appareil ; l'étiquette de la carte ne promet pas les touches de zoom", () => {
  const fen = (w, h) => ({ innerWidth: w, innerHeight: h, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } });
  const p = monter({ window: fen(844, 390) }), v = monter({ window: fen(390, 844) });
  assert.match(sp(p.q("[data-invite]").textContent), /^Plus de détail en grand\./); assert.doesNotMatch(sp(p.q("[data-invite]").textContent), /tournant/);
  assert.match(sp(v.q("[data-invite]").textContent), /en tournant ton téléphone/);
  assert.doesNotMatch(v.q("[data-hit]").getAttribute("aria-label"), /zoomer/); assert.match(v.q("[data-hit]").getAttribute("aria-label"), /Flèches pour se déplacer/);
  v.api.pleinEcran(); assert.match(v.doc.body.querySelector(".gp-fsv").querySelector("[data-hit]").getAttribute("aria-label"), /plus et moins pour zoomer/, "en plein écran, la promesse est tenue");
  v.api.fermerPleinEcran();
});

test("carte IMMO1 : marquée pour que son titre tienne sur une ligne au téléphone (puce des euros repliée dans les réglages) ; les autres cartes gardent la puce", () => {
  const capa = monter({ opt: { preset: "capacite" } });
  assert.ok(capa.q(".gp-carte").getAttribute("class").includes("gp-capa"), "classe de la carte capacité");
  assert.ok(!monter().q(".gp-carte").getAttribute("class").includes("gp-capa"));
  assert.match(readFileSync("web/src/graphe-patrimoine.css", "utf8"), /@media \(max-width:430px\)\{\.gp-capa \.gp-tete \.gp-eur\{display:none\}\}/);
});

test("cadre de focus du tracé : seulement au clavier (pas après un geste de souris, ni après le focus posé à l'ouverture) ; la virgule des montants garde sa largeur", () => {
  const b = monter(); b.api.pleinEcran();
  const hit = b.doc.body.querySelector(".gp-fsv").querySelector("[data-hit]");
  assert.equal(hit.getAttribute("data-clavier"), null, "focus posé par le code : pas de cadre");
  b.touche(hit, "ArrowRight"); assert.equal(hit.getAttribute("data-clavier"), "1", "touche au clavier : le cadre apparaît");
  hit.dispatchEvent(new b.Ev("pointerdown", { clientX: 200, pointerId: 1, pointerType: "mouse" })); assert.equal(hit.getAttribute("data-clavier"), null, "geste de souris : le cadre disparaît");
  const css = readFileSync("web/src/graphe-patrimoine.css", "utf8");
  assert.match(css, /\.gp-hit:focus-visible\{outline:none\}/); assert.match(css, /\.gp-hit\[data-clavier\]:focus-visible\{outline:2px solid var\(--focus\)/);
  assert.match(css, /\.gp-ro-v b\{[^}]*proportional-nums/); assert.match(css, /\.gp-hl \.gp-hl-v\{[^}]*proportional-nums/); assert.match(css, /\.gp-svg \.gp-pill text\{font-variant-numeric:proportional-nums/);
  b.api.fermerPleinEcran();
});

test("sous la carte : une seule ligne de décomposition et les alertes ; événements pris en compte et base de l'épargne vont dans « Comment c'est calculé », une seule phrase sur la capacité", () => {
  const t = monter(), notes = sp(t.q("[data-notes]").textContent);
  assert.doesNotMatch(notes, /Événements pris en compte|Épargne mensuelle projetée/);
  assert.ok(notes.length < 400, "pied de carte court : " + notes.length);
  const M = G.normaliser(donnees()), h = G.calculHtml(M, {});
  assert.match(sp(h), /Événements pris en compte/);
  const full = G.enteteHtml(M, null, {}), nb = (full.match(/capacité d.épargne/gi) || []).length; assert.ok(nb <= 1, "la capacité n'est dite qu'une fois dans la feuille de lecture : " + nb);
  assert.ok((sp(h).match(/Épargne mensuelle projetée|capacité d.épargne constatée sur tes comptes/g) || []).length <= 1, "calcul : une phrase sur la base de l'épargne");
});

test("invitation « ouvrir en grand » : à la première visite ou quand c'est dense, fermable, mémorisée (localStorage en try/catch), jamais bloquante", () => {
  const t = monter();
  const inv = t.q("[data-invite]"); assert.equal(inv.hidden, false); assert.match(sp(inv.textContent), /Plus de détail en grand/);
  assert.equal(t.stockage.get("boussole.graphe.invitation.vue"), "1");
  inv.querySelector('[data-act="invite-off"]').click(); assert.equal(t.q("[data-invite]").hidden, true); assert.equal(t.stockage.get("boussole.graphe.invitation.off"), "1");
  t.q('[data-win="10"]').click(); assert.equal(t.q("[data-invite]").hidden, true, "fermée : plus jamais, même quand c'est dense");
  const casse = monter({ opt: {}, window: undefined }); // localStorage qui lève : le composant reste utilisable
  casse.deps.localStorage.getItem = () => { throw new Error("quota"); }; casse.deps.localStorage.setItem = () => { throw new Error("quota"); };
  assert.doesNotThrow(() => casse.api.mettreAJour(donnees()));
  assert.equal(t.qa('[role="alertdialog"]').length, 0, "jamais de fenêtre bloquante");
});

test("plein écran (couche) : role=\"dialog\" aria-modal, focus piégé, Échap ferme, le focus revient au bouton, la fenêtre, le zoom, le curseur et les réglages sont conservés", () => {
  const t = monter(), btn = t.q('[data-act="plein"]');
  t.q('[data-win="10"]').click(); t.api.curseur(G.msDe(plusMois(AUJ, 30))); t.api.reglagesAppliques({ existant: true });
  btn.focus(); btn.click();
  const ov = t.doc.body.querySelector(".gp-plein");
  assert.ok(ov); assert.equal(ov.getAttribute("role"), "dialog"); assert.equal(ov.getAttribute("aria-modal"), "true"); assert.equal(ov.getAttribute("aria-label"), "Graphe en plein écran");
  assert.ok(t.doc.body.classList.contains("gp-bloque")); assert.equal(t.host.inert, true, "la page derrière est inerte");
  assert.equal(ov.querySelector('[data-win="10"]').getAttribute("aria-pressed"), "true", "même fenêtre à l'entrée");
  assert.match(sp(ov.querySelector("[data-roline]") ? "" : ov.querySelector("[data-ro]").innerHTML), /Juin 2029|projection/, "même curseur : lu dans le panneau");
  assert.equal(t.doc.activeElement, ov.querySelector("[data-hit]"), "le focus entre dans la couche");
  // focus piégé : Tab depuis le dernier élément revient au premier
  const f = ov.querySelectorAll("button,[href],input,select,textarea,[tabindex]").filter(n => !n.hasAttribute("disabled") && n.getAttribute("tabindex") !== "-1" && !n.hidden && !(n.closest && n.closest("[hidden]")));
  f[f.length - 1].focus(); const tab = t.touche(t.doc.body, "Tab"); assert.equal(tab.defaultPrevented, true); assert.equal(t.doc.activeElement, f[0]);
  const shiftTab = new t.Ev("keydown", { key: "Tab", shiftKey: true }); f[0].focus(); t.doc.body.dispatchEvent(shiftTab); assert.equal(t.doc.activeElement, f[f.length - 1]);
  // Échap ferme
  const esc = t.touche(t.doc.body, "Escape"); assert.equal(esc.defaultPrevented, true);
  assert.equal(t.doc.body.querySelector(".gp-plein"), null); assert.equal(t.host.inert, false); assert.equal(t.doc.body.classList.contains("gp-bloque"), false);
  assert.equal(t.doc.activeElement, t.q('[data-act="plein"]'), "le focus revient au bouton d'origine");
  assert.equal(t.api.etat.fenetre, "10"); assert.equal(t.api.etat.reglages.existant, true); assert.equal(t.api.etat.curseur, G.msDe(plusMois(AUJ, 30)));
  // un panneau ouvert reçoit Échap lui-même : la couche reste
  btn.click(); t.UI.st.ouvert = true; t.touche(t.doc.body, "Escape"); assert.ok(t.doc.body.querySelector(".gp-plein"), "Échap appartient au panneau tant qu'il est ouvert"); t.UI.st.ouvert = false;
  t.doc.body.querySelector(".gp-plein").querySelector('.gp-icon[data-act="plein"]').click(); assert.equal(t.doc.body.querySelector(".gp-plein"), null, "le bouton « Quitter » ferme aussi");
});

test("plein écran (API Fullscreen) : requestFullscreen appelé, la sortie par le navigateur ferme la couche et rend le focus ; sans l'API, la couche suffit", () => {
  const t = monter();
  let demande = 0, sortie = 0; t.doc.documentElement.requestFullscreen = () => { demande++; t.doc.fullscreenElement = t.doc.documentElement; return Promise.resolve(); };
  t.doc.exitFullscreen = () => { sortie++; t.doc.fullscreenElement = null; return Promise.resolve(); };
  t.api.pleinEcran(); assert.equal(demande, 1); assert.ok(t.doc.body.querySelector(".gp-plein"));
  t.api.fermerPleinEcran(); assert.equal(sortie, 1); assert.equal(t.doc.body.querySelector(".gp-plein"), null);
  t.api.pleinEcran(); t.doc.fullscreenElement = null; t.doc.ls.fullscreenchange.forEach(l => l.f(new t.Ev("fullscreenchange")));
  assert.equal(t.doc.body.querySelector(".gp-plein"), null, "sortie par la touche Échap du navigateur : la couche se ferme aussi");
  const sans = monter(); sans.api.pleinEcran(); assert.ok(sans.doc.body.querySelector(".gp-plein"), "variante en couche, sans API"); sans.api.fermerPleinEcran();
});

test("plein écran : mises en page selon la fenêtre : paysage (lecture ancrée à droite, ronds numérotés, aperçu) et ordinateur (panneau latéral avec lecture, liste des événements, tableau)", () => {
  const fen = (w, h) => ({ innerWidth: w, innerHeight: h, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } });
  const p = monter({ window: fen(844, 390) }); p.api.pleinEcran();
  const pa = p.doc.body.querySelector(".gp-fsv-paysage"); assert.ok(pa, "paysage 844 × 390");
  assert.ok(pa.querySelector(".gp-fs-side").querySelector("[data-ro]")); assert.ok(pa.querySelectorAll(".gp-pin").length >= 2, "ronds numérotés"); assert.doesNotMatch(pa.querySelector("[data-svg]").innerHTML, /class="lb"/, "aucun texte sur la piste des jalons");
  assert.ok(pa.querySelector("[data-bsvg]"), "aperçu complet"); assert.equal(pa.querySelector("[data-list]"), null);
  p.api.fermerPleinEcran();
  const b = monter({ window: fen(1440, 900) }); b.api.pleinEcran();
  const bu = b.doc.body.querySelector(".gp-fsv-bureau"); assert.ok(bu, "ordinateur 1440 × 900");
  assert.ok(bu.querySelector(".gp-evl")); assert.ok(bu.querySelector(".gp-tab")); assert.equal(bu.querySelectorAll(".gp-evrow").length, 9, "liste des événements dans le panneau");
  const onglets = bu.querySelectorAll('[role="tab"]'); assert.deepEqual(onglets.map(o => o.textContent), ["Lecture", "Événements", "Données"]);
  assert.deepEqual(onglets.map(o => o.getAttribute("aria-selected")), ["true", "false", "false"], "Lecture d'abord");
  assert.equal(bu.querySelector('[data-panel="evenements"]').hidden, true); assert.equal(bu.querySelector('[data-panel="lecture"]').hidden, false);
  onglets[1].click();
  assert.equal(bu.querySelector('[data-panel="evenements"]').hidden, false); assert.equal(bu.querySelector('[data-panel="lecture"]').hidden, true); assert.equal(onglets[1].getAttribute("aria-selected"), "true");
  onglets[0].click();
  assert.ok(bu.querySelectorAll(".gp-ytk").length >= 3 && bu.querySelectorAll(".gp-ytk").length <= 6, "jusqu'à 6 graduations");
  assert.match(bu.querySelector("[data-svg]").innerHTML, /gp-ex-b/, "plein écran : la bande P25–P75 de l'existant est visible");
  const svgB = bu.querySelector("[data-svg]").innerHTML; assert.match(svgB, /médiane/, "la médiane se lit dans la pastille de fin"); assert.match(svgB, /8 chances sur 10<\/text>/, "étiquettes des bandes dans la marge de droite"); assert.match(svgB, /sans nouveau versement|sans versement/);
  assert.equal(bu.querySelector(".gp-fs-hint"), null, "plus de texte d'aide sur deux lignes"); assert.ok(bu.querySelector('[data-act="aide"]'), "une icône d'aide à la place");
  assert.match(sp(bu.querySelector(".gp-apercu-h").textContent), /Aperçu complet/); assert.doesNotMatch(sp(bu.querySelector(".gp-apercu-h").textContent), /fais glisser le cadre/);
  assert.ok(bu.querySelector(".gp-b-svg"));
  // survol à la souris : lecture dans le panneau latéral
  const hit = bu.querySelector("[data-hit]"); hit.dispatchEvent(new b.Ev("pointermove", { clientX: 300, pointerId: 3, pointerType: "mouse" }));
  assert.match(sp(bu.querySelector("[data-ro]").innerHTML), /gp-ro-h/);
  // glisser-sélectionner (souris) zoome ; double-clic zoome ×2 ; « Réinitialiser le zoom »
  const E = (n, x) => new b.Ev(n, { clientX: x, pointerId: 4, pointerType: "mouse" });
  hit.dispatchEvent(E("pointerdown", 100)); hit.dispatchEvent(E("pointermove", 160)); hit.dispatchEvent(E("pointermove", 200)); hit.dispatchEvent(E("pointerup", 200));
  assert.ok(b.api.etat.zoom, "sélection d'une période : zoom"); b.api.fermerPleinEcran();
});

test("plein écran ordinateur : onglets au clavier, aide en feuille, lecture compacte sans explication répétée, survol d'un repère, passé sans aplat hachuré, années de l'aperçu sous le cadre", () => {
  const fen = (w, h) => ({ innerWidth: w, innerHeight: h, matchMedia: q => ({ matches: /hover: hover|pointer: fine/.test(q), addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } });
  const b = monter({ window: fen(1440, 900) }); b.api.pleinEcran();
  const bu = b.doc.body.querySelector(".gp-fsv-bureau"), onglets = bu.querySelectorAll('[role="tab"]');
  onglets[0].focus(); b.touche(onglets[0], "ArrowRight");
  assert.equal(onglets[1].getAttribute("aria-selected"), "true", "flèche droite : onglet suivant"); assert.equal(bu.querySelector('[data-panel="evenements"]').hidden, false);
  b.touche(onglets[1], "End"); assert.equal(onglets[2].getAttribute("aria-selected"), "true"); b.touche(onglets[2], "Home"); assert.equal(onglets[0].getAttribute("aria-selected"), "true");
  // lecture : lignes « libellé · valeur », une seule fois la capacité, pas de paragraphe d'explication
  const hit = bu.querySelector("[data-hit]"); hit.dispatchEvent(new b.Ev("pointermove", { clientX: 420, pointerId: 3, pointerType: "mouse" }));
  const lec = sp(bu.querySelector('[data-panel="lecture"]').textContent);
  assert.ok(bu.querySelectorAll(".gp-kv").length >= 4, "lignes de lecture");
  assert.equal((lec.match(/capacité d.épargne/gi) || []).length, 1, "la capacité n'est dite qu'une fois : " + lec);
  assert.doesNotMatch(lec, /Épargne mensuelle projetée|Événements pris en compte|Dont .* de ton patrimoine actuel/);
  assert.equal(bu.querySelectorAll('[data-act="calcul"]').length, 1, "un seul lien « Comment c'est calculé »");
  // aide : une feuille, pas un texte permanent
  bu.querySelector('[data-act="aide"]').click();
  assert.equal(b.UI.st.titre, "Lire et zoomer le graphique"); assert.match(sp(b.UI.st.corps.textContent), /survole la courbe/); b.UI.panneau.fermer();
  // survol d'un repère : le réticule se place à sa date, une seule étiquette flotte dans le tracé
  const marque = bu.querySelectorAll(".gp-mk-b").find(m => !/rapprochés/.test(m.getAttribute("aria-label")));
  marque.dispatchEvent(new b.Ev("pointerover", { pointerType: "mouse", bubbles: true }));
  assert.ok(b.api.etat.curseur != null, "le réticule suit le repère survolé"); assert.match(bu.querySelector("[data-flab]").innerHTML, /gp-flab/);
  // passé : pas d'aplat hachuré, un voile léger, une puce « estimé »
  const svg = bu.querySelector("[data-svg]").innerHTML;
  assert.doesNotMatch(svg, /url\(#[^)]*h\)/, "aucun rectangle hachuré"); assert.doesNotMatch(svg, /gp-hatch|<pattern/); assert.match(svg, /class="gp-recon-f"/); assert.match(svg, /class="gp-recon"/);
  // aperçu : les années sous le cadre
  const bs = bu.querySelector("[data-bsvg]"), H = +bs.getAttribute("viewBox").split(" ")[3], ann = [...bs.innerHTML.matchAll(/y="([\d.]+)" text-anchor="middle" class="gp-axl">(\d{4})</g)];
  assert.ok(ann.length >= 3 && ann.every(m => +m[1] > H - 17 && +m[1] <= H), "années sous le cadre de l'aperçu");
  b.api.fermerPleinEcran();
});

test("plein écran : lien profond ?graphe=plein-ecran ouvre à l'affichage ; la fermeture retire le paramètre (history.replaceState)", () => {
  const t = monter({ hash: "#aujourdhui?graphe=plein-ecran", opt: { lienProfond: true } });
  assert.ok(t.doc.body.querySelector(".gp-plein"), "ouvert au montage");
  t.api.fermerPleinEcran();
  assert.equal(t.win.location.hash, "#aujourdhui", "le paramètre est retiré de l'URL"); assert.match(t.win.__remplace, /#aujourdhui$/);
  const sans = monter({ opt: { lienProfond: true } }); assert.equal(sans.doc.body.querySelector(".gp-plein"), null);
  const diff = monter({ donnees: { today: AUJ, etat: "calcul" }, hash: "#aujourdhui?graphe=plein-ecran", opt: { lienProfond: true } });
  assert.equal(diff.doc.body.querySelector(".gp-plein"), null, "pas avant que les données soient prêtes"); diff.api.mettreAJour(donnees()); assert.ok(diff.doc.body.querySelector(".gp-plein"));
  const q = monter({ donnees: { today: AUJ, etat: "calcul" } }); q.api.pleinEcranQuandPret(); assert.equal(q.doc.body.querySelector(".gp-plein"), null); q.api.mettreAJour(donnees()); assert.ok(q.doc.body.querySelector(".gp-plein"), "variante pour la coque (App.parametres)");
});

test("rotation en paysage sur téléphone : offre discrète « Ouvrir en grand » (jamais forcée) ; double-clic à la souris sur la carte ouvre le plein écran", () => {
  let cb = null;
  const win = { innerWidth: 844, innerHeight: 390, matchMedia: q => ({ matches: /landscape/.test(q), addEventListener(_, f) { cb = f; }, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } };
  const t = monter({ window: win });
  assert.equal(typeof cb, "function"); cb();
  const offre = t.doc.body.querySelector(".gp-offre"); assert.ok(offre); assert.equal(offre.getAttribute("role"), "status"); assert.match(offre.textContent, /plus lisible en grand/);
  assert.equal(t.doc.body.querySelector(".gp-plein"), null, "jamais de rotation ni d'ouverture forcées");
  offre.querySelector("[data-go]").onclick(); assert.ok(t.doc.body.querySelector(".gp-plein")); t.api.fermerPleinEcran();
  const u = monter(), hit = u.q("[data-hit]"), E = (n, x) => new u.Ev(n, { clientX: x, pointerId: 5, pointerType: "mouse", timeStamp: 1 });
  hit.dispatchEvent(E("pointerdown", 120)); hit.dispatchEvent(E("pointerup", 120)); hit.dispatchEvent(E("pointerdown", 121)); hit.dispatchEvent(E("pointerup", 121));
  assert.ok(u.doc.body.querySelector(".gp-plein"), "double-clic de bureau : plein écran");
});

test("lecture seule : le composant n'enregistre aucun réglage ; seules deux clés d'interface (invitation) touchent le stockage local", () => {
  const t = monter();
  t.q('[data-act="reglages"]').click(); t.q('[data-act="eur"]').click(); t.q('[data-win="10"]').click(); t.api.pleinEcran(); t.api.fermerPleinEcran();
  assert.deepEqual([...t.stockage.keys()].sort(), ["boussole.graphe.invitation.vue"]);
});

test("détruire : retire les écouteurs, la couche et l'offre ; plus aucun rendu après", () => {
  const t = monter(); t.api.pleinEcran(); t.api.detruire();
  assert.equal(t.doc.body.querySelector(".gp-plein"), null); assert.equal(t.host.innerHTML, "");
  assert.doesNotThrow(() => t.api.mettreAJour(donnees()));
});
