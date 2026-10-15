// Graphe maître v3 (polissage) : objectifs en couleur (statut, anneau de progression, ligne de cible et halo au survol, puce de chances), teinte discrète par type d'événement, honnêteté
// déplacée (puce d'en-tête sur la carte et en paysage, carte « À savoir » dans le panneau sur ordinateur), fenêtre de relevés courte dite en toutes lettres, échelle robuste de la bande
// « épargne par mois ». Données fictives (helpers/graphe-donnees.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { G, donnees, monter, AUJ, plusMois } from "./helpers/graphe-donnees.mjs";
import { couleur, contraste, table } from "./helpers/contraste.mjs";

const sp = s => String(s).replace(/[  ]/g, " ");
const ms = G.msDe;
const M0 = o => G.normaliser(donnees(o));
const css = readFileSync("web/src/graphe-patrimoine.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const theme = readFileSync("web/src/theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const fenetre = (w, h, reduit) => ({ innerWidth: w, innerHeight: h, matchMedia: q => ({ matches: reduit && /prefers-reduced-motion/.test(q) ? true : /hover: hover|pointer: fine/.test(q), addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { hash: "" } });
const CTX = M => ({ today: M.today, debutPasse: M.debutPasse, finFutur: M.finFutur });
const svgDe = (M, fen = "5", mode = "carte", W = 358) => {
  const dom = G.domaine(fen, CTX(M)), gran = G.granularite(dom.fin - dom.debut);
  const P = Object.assign(G.parametresMode(mode, W), { W, id: "t" });
  if (P.fill) P.H = 520;
  return Object.assign(G.construireSvg(M, { dom, gran, couches: {} }, P), { dom, gran, P });
};
const jalonBut = (M, id) => M.jalons.find(j => j.objectifId === id);

/* ---------- 1. objectifs : statut en couleur, anneau de progression ---------- */
test("statut d'un objectif : atteint et en avance = vert, dans les temps = marque, en retard = ambre, hors de portée = rouge sourdine, sans verdict = muted ; toujours un mot", () => {
  const st = o => G.statutObjectif(o);
  assert.deepEqual(["atteint", "avance", "dans_les_temps", "retard", "hors_portee", "hors_horizon"].map(s => st({ statut: s }).ton), ["ok", "ok", "track", "late", "off", "idle"]);
  assert.deepEqual(["atteint", "avance", "dans_les_temps", "retard", "hors_portee", "hors_horizon"].map(s => st({ statut: s }).mot), ["Atteint", "En avance", "Dans les temps", "En retard", "Hors de portée", "Au-delà de la projection"]);
  assert.deepEqual([st({ probabilite: 0.9 }).ton, st({ probabilite: 0.6 }).ton, st({ probabilite: 0.2 }).ton, st({}).ton], ["track", "late", "off", "idle"], "sans statut du moteur, le mot de probabilité en tient lieu");
  assert.equal(st(undefined).mot, "Sans verdict");
  assert.equal(G.statutLigne({ statut: "retard", probabilite: 0.3 }), "En retard · 3 chances sur 10");
  assert.equal(G.statutLigne({ statut: "hors_horizon", probabilite: null }), "Au-delà de la projection");
});

test("progression d'un objectif : la part déjà de côté (0 à 1), 1 si atteint, null quand elle est inconnue (jamais inventée)", () => {
  assert.equal(G.progressionObjectif({ cible: 12000, deja: 3000 }), 0.25); assert.equal(G.progressionObjectif({ cible: 100, deja: 250 }), 1);
  assert.equal(G.progressionObjectif({ cible: 100, deja: 0 }), 0); assert.equal(G.progressionObjectif({ statut: "atteint", cible: 100 }), 1);
  assert.equal(G.progressionObjectif({ cible: 100 }), null); assert.equal(G.progressionObjectif(null), null);
});

test("plein écran : chaque objectif de la piste porte la couleur de son statut et un anneau dont l'arc est la part déjà de côté (pointillé si inconnue)", () => {
  const M = M0(), r = svgDe(M, "5", "bureau", 1100);
  const pins = [...r.svg.matchAll(/<g class="gp-pin gp-pin-i gp-pin-b st-(\w+)" data-ev="objectif:(\w+)" data-icone="cible">([\s\S]*?)<\/g>/g)].map(m => ({ ton: m[1], id: m[2], corps: m[3] }));
  const tons = Object.fromEntries(pins.map(p => [p.id, p.ton]));
  assert.equal(tons.matelas, "ok", "en avance : vert"); assert.equal(tons.voiture, "late", "en retard : ambre");
  assert.ok(pins.length >= 2, "au moins le matelas et la voiture sont seuls dans la fenêtre : " + pins.length);
  const arc = id => pins.find(p => p.id === id).corps.match(/class="gp-ring gp-ring-p st-\w+" data-pct="(\d+)"[^>]*pathLength="100" stroke-dasharray="([\d.]+) 100" transform="rotate\(-90 /);
  assert.equal(+arc("matelas")[1], 64, "11 200 / 17 400 = 64 %"); assert.equal(+arc("matelas")[2], 64.4);
  assert.equal(+arc("voiture")[1], 17, "2 000 / 12 000");
  pins.forEach(p => assert.match(p.corps, /class="gp-ring gp-ring-t st-\w+"/, "fond d'anneau"));
  const d = donnees(); d.objectifs[0].deja = null; delete d.objectifs[0].statut;
  const inconnu = svgDe(G.normaliser(d), "5", "bureau", 1100).svg;
  assert.match(inconnu, /class="gp-ring gp-ring-u st-track" cx="[\d.]+" cy="[\d.]+" r="[\d.]+" stroke-width="2" stroke-dasharray="1.6 3.2"/, "part inconnue : anneau pointillé, couleur de la probabilité (0,9 : dans les temps)");
});

test("les cibles sur la médiane (carte et plein écran) disent le statut dans data-ton et portent le même anneau ; le CSS les colore avec les jetons --ms-*", () => {
  const M = M0(), c = svgDe(M, "5", "carte", 358).svg;
  const tons = [...c.matchAll(/<g class="gp-tg" data-ton="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tons, ["ok", "late", "track"], "matelas, voiture, apport");
  assert.equal((c.match(/gp-ring-p/g) || []).length, 3, "un arc de progression par cible");
  for (const [sel, jeton] of [['data-ton="ok"', "--ms-ok"], ['data-ton="track"', "--ms-track"], ['data-ton="late"', "--ms-late"], ['data-ton="off"', "--ms-off"]]) assert.ok(css.includes("[" + sel + "]{--gp-t:var(" + jeton + ")}"), sel);
  for (const t of ["ok", "track", "late", "off", "idle"]) assert.match(css, new RegExp("\\.gp-ring\\.st-" + t + "\\{stroke:var\\(--ms-" + t + "\\)\\}"));
  assert.match(css, /\.gp-ring-t\{opacity:\.28\}/, "fond d'anneau atténué");
});

test("statut dit en toutes lettres : info-bulle et nom accessible du repère, liste des événements, feuille du jalon ; jamais la couleur seule", () => {
  const t = monter({ window: fenetre(1440, 900), largeur: 1300 }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), voiture = bu.querySelectorAll(".gp-mk-b").find(b => /Voiture 12 k€, échéance/.test(b.getAttribute("aria-label")));
  assert.match(sp(voiture.getAttribute("aria-label")), /^Voiture 12 k€, échéance sept\. 2028, en retard · 3 chances sur 10\. Ouvrir le détail$/);
  assert.equal(sp(voiture.getAttribute("title")), "Objectif Voiture 12 k€ · En retard · 3 chances sur 10");
  const ligne = bu.querySelectorAll(".gp-evrow").find(r => /Voiture/.test(r.textContent));
  assert.match(sp(ligne.textContent), /échéance sept\. 2028 · En retard · 3 chances sur 10/); assert.match(ligne.querySelector(".gp-pn").getAttribute("class"), /gl st-late/);
  assert.match(sp(G.jalonDetailHtml(M0(), jalonBut(M0(), "voiture"), {})), /Statut<\/span><b><span class="gp-chip watch">En retard<\/span>/);
  assert.match(sp(G.jalonDetailHtml(M0(), jalonBut(M0(), "matelas"), {})), /Statut<\/span><b><span class="gp-chip good">En avance<\/span>/);
  assert.match(sp(G.jalonDetailHtml(M0(), jalonBut(M0(), "apport"), {})), /Statut<\/span><b><span class="gp-chip brand">Dans les temps<\/span>/);
  assert.match(sp(G.jalonDetailHtml(M0(), jalonBut(M0(), "voiture"), {})), /Verdict<\/span><b><span class="gp-chip work">Peu probable/, "le verdict de probabilité reste");
});

/* ---------- 2. objectif survolé ou sélectionné : cible, halo, puce ---------- */
test("objectif sélectionné : sa cible en ligne horizontale pointillée dans la couleur du statut, un halo doux sur la médiane à l'échéance, la puce « 3 chances sur 10 » (survol du repère compris)", () => {
  const t = monter({ window: fenetre(1440, 900), largeur: 1300 }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), grp = () => bu.querySelector("[data-goal]");
  assert.equal(grp().innerHTML, "", "aucun objectif au curseur : rien de dessiné");
  const M = t.api.graphe.M, j = jalonBut(M, "voiture");
  t.api.curseur(j.t);
  const h = grp().innerHTML;
  assert.match(h, /<g class="gp-goal st-late" data-goal-sel="voiture" data-statut="retard">/);
  assert.match(h, /<line class="gp-goal-l" x1="[\d.]+" x2="[\d.]+" y1="([\d.]+)" y2="\1"/, "horizontale, sur toute la largeur du tracé");
  assert.match(h, /<circle class="gp-goal-halo pulse" cx="[\d.]+" cy="[\d.]+" r="16"\/><circle class="gp-goal-ring"/, "halo + anneau au point de la médiane");
  assert.match(sp(h), /<g class="gp-goal-puce"><rect[^>]*\/><text[^>]*>3 chances sur 10<\/text>/);
  assert.match(sp(h), />cible 12 k€[^<]*</, "la valeur de la cible est écrite sur la ligne");
  t.api.curseur(null); assert.equal(grp().innerHTML, "", "curseur effacé : le dessin disparaît");
  t.api.curseur(M.jalons.find(x => x.type === "naissance").t); assert.equal(grp().innerHTML, "", "un événement n'est pas un objectif");
  /* le repère touche la page : survol du bouton du repère = curseur sur son échéance = même dessin */
  const mk = bu.querySelectorAll(".gp-mk-b").find(b => /Matelas/.test(b.getAttribute("aria-label")));
  mk.dispatchEvent(new t.Ev("pointerover", { pointerType: "mouse", bubbles: true }));
  assert.match(grp().innerHTML, /gp-goal st-ok" data-goal-sel="matelas"/);
});

test("objectif sélectionné (pur) : la ligne de cible dedans ou hors cadre (repère au bord avec flèche), puce dessous quand il n'y a pas de place au-dessus, mot du statut sans probabilité", () => {
  const M = M0(), { geo } = svgDe(M, "5", "bureau", 1100), mes = (x, p) => String(x).length * 7;
  const voiture = M.objectifs.find(o => o.id === "voiture");
  const dedans = G.objectifSelectionSvg(M, Object.assign({}, voiture, { cible: (geo.lo + geo.hi) / 2 }), geo, mes, false);
  assert.equal(dedans.ligne.dedans, true); assert.ok(dedans.ligne.y > geo.DT && dedans.ligne.y < geo.B); assert.doesNotMatch(dedans.svg, /data-hors/);
  const haut = G.objectifSelectionSvg(M, Object.assign({}, voiture, { cible: geo.hi * 3 }), geo, mes, false), bas = G.objectifSelectionSvg(M, Object.assign({}, voiture, { cible: 0 }), geo, mes, false);
  assert.equal(haut.ligne.dedans, false); assert.match(haut.svg, /data-hors="1"/); assert.match(sp(haut.svg), /cible [\d, ]+ ?[k€M ]*↑/); assert.match(sp(bas.svg), /cible 0 € ↓/);
  assert.ok(haut.ligne.y < geo.DT + 4 && bas.ligne.y > geo.B - 4, "repère collé au bord");
  const horizon = G.objectifSelectionSvg(M, Object.assign({}, voiture, { statut: "hors_horizon", probabilite: null }), geo, mes, false);
  assert.equal(horizon.puce.texte, "Au-delà de la projection"); assert.match(horizon.svg, /gp-goal st-idle/);
  const reduit = G.objectifSelectionSvg(M, voiture, geo, mes, true); assert.doesNotMatch(reduit.svg, /pulse/, "mouvement réduit : le halo ne pulse pas");
  const loin = G.objectifSelectionSvg(M, Object.assign({}, voiture, { t: M.today - 864e5 * 400 }), geo, mes, false); assert.equal(loin.halo, null, "échéance passée : pas de halo sur la médiane");
  assert.ok(dedans.puce.x >= geo.L && dedans.puce.x + dedans.puce.w <= geo.R, "la puce reste dans le tracé");
  const bord = G.objectifSelectionSvg(M, Object.assign({}, voiture, { t: geo.dom.fin }), geo, mes, false); assert.ok(bord.puce.x + bord.puce.w <= geo.R, "au bord droit, la puce est ramenée dans le tracé");
});

test("mouvement : le halo ne pulse que si l'appareil l'accepte (classe pulse absente sous prefers-reduced-motion, et garde CSS dans les deux sens)", () => {
  const voiture = M0().jalons.find(j => j.objectifId === "voiture");
  const normal = monter({ window: fenetre(1440, 900, false) }); normal.api.pleinEcran(); normal.api.curseur(voiture.t);
  assert.match(normal.doc.body.querySelector(".gp-fsv-bureau").querySelector("[data-goal]").innerHTML, /gp-goal-halo pulse/);
  const calme = monter({ window: fenetre(1440, 900, true) }); calme.api.pleinEcran(); calme.api.curseur(voiture.t);
  assert.doesNotMatch(calme.doc.body.querySelector(".gp-fsv-bureau").querySelector("[data-goal]").innerHTML, /pulse/);
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\.gp-goal-halo\.pulse\{animation:gp-pulse/); assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.gp-goal-halo\.pulse\{animation:none\}\}/);
});

test("carte (doigt posé sur l'échéance d'un objectif) : la même ligne de cible, le même halo et la même puce que le plein écran", () => {
  const t = monter(), M = t.api.graphe.M, j = jalonBut(M, "voiture");
  t.api.curseur(j.t);
  assert.match(t.q("[data-goal]").innerHTML, /gp-goal st-late[\s\S]*gp-goal-l[\s\S]*gp-goal-halo[\s\S]*3 chances sur 10/);
  assert.match(t.q("[data-flab]").innerHTML, /Voiture 12 k€ · peu probable/, "l'étiquette du haut garde le mot, la puce porte les chances (pas de doublon)");
  assert.doesNotMatch(t.q("[data-flab]").innerHTML, /chances/);
});

/* ---------- 3. teinte discrète par type d'événement, jetons ---------- */
test("types d'événements : une teinte discrète par famille (vie, crédit et logement, fiscal, journal, crise), l'encre pour les autres ; la sélection reste pétrole, celle d'un objectif garde son statut", () => {
  assert.deepEqual(["enfant", "emploi", "credit", "maison", "fiscal", "journal", "crise", "etincelle", "cible"].map(G.familleIcone), ["vie", "vie", "credit", "credit", "fiscal", "journal", "crise", "autre", "but"]);
  for (const [sel, jeton] of [['"enfant"],.gp-pin[data-icone="emploi"]', "--ms-life"], ['"credit"],.gp-pin[data-icone="maison"]', "--ms-credit"], ['"fiscal"]', "--s8"], ['"journal"]', "--s5"], ['"crise"]', "--s6"]])
    assert.ok(css.includes(".gp-pin[data-icone=" + sel + "{--gp-t:var(" + jeton + ")}"), jeton);
  assert.match(css, /\.gp-pin\{--gp-t:var\(--ink\);color:var\(--gp-t\)\}/, "encre par défaut");
  assert.match(css, /\.gp-pin\.is-sel\{color:var\(--brand\)\}/, "un événement sélectionné reste pétrole"); assert.match(css, /\.gp-pin\.gp-pin-b\.is-sel\{color:var\(--gp-t\)\}/, "un objectif sélectionné garde la couleur de son statut");
  const t = monter({ window: fenetre(1440, 900) }); t.api.pleinEcran();
  const lignes = t.doc.body.querySelector(".gp-fsv-bureau").querySelectorAll(".gp-pn");
  const classes = lignes.map(l => l.getAttribute("class"));
  assert.ok(classes.some(c => /gp-t-vie/.test(c)) && classes.some(c => /gp-t-credit/.test(c)) && classes.some(c => /gp-t-fiscal/.test(c)), "la liste des événements reprend les teintes : " + classes.join(" | "));
  assert.equal(classes.filter(c => /\bgl st-/.test(c)).length, 3, "trois objectifs, trois anneaux de statut");
});

const tonsMs = ["--ms-ok", "--ms-track", "--ms-late", "--ms-off", "--ms-idle"];
for (const th of ["clair", "sombre"]) {
  test(`jetons de statut d'objectif (${th}) : --ms-ok, --ms-track, --ms-late, --ms-off, --ms-idle atteignent 4,5:1 (texte) sur la surface, le fond et le fond creusé ; teintes de type ≥ 3:1`, () => {
    const t = table(th), echecs = [];
    for (const n of tonsMs) for (const f of ["--surface", "--bg", "--sunk"]) { const r = contraste(couleur("var(" + n + ")", t), couleur("var(" + f + ")", t)); if (r < 4.5) echecs.push(n + " sur " + f + " = " + r.toFixed(2)); }
    for (const n of ["--ms-life", "--ms-credit", "--s5", "--s6", "--s8"]) for (const f of ["--surface", "--bg"]) { const r = contraste(couleur("var(" + n + ")", t), couleur("var(" + f + ")", t)); if (r < 3) echecs.push(n + " sur " + f + " = " + r.toFixed(2)); }
    assert.deepEqual(echecs, []);
    const [ok, track, late, off, idle] = tonsMs.map(n => couleur("var(" + n + ")", t).join());
    assert.equal(new Set([ok, track, late, off, idle]).size, 5, "cinq couleurs distinctes");
  });
}
test("jetons de statut d'objectif : alias des rôles existants (vert positif, marque, ambre des objectifs, muted) ; le rouge sourdine a une valeur sombre ; les deux blocs sombres restent identiques", () => {
  assert.match(theme, /--ms-ok:var\(--pos\); --ms-track:var\(--brand\); --ms-late:var\(--ms-goal\); --ms-off:#A64B42; --ms-idle:var\(--muted\);/);
  assert.equal((theme.match(/--ms-off:#E8897D;/g) || []).length, 2, "redéfini dans les deux blocs sombres (média et attribut)");
  const ambre = couleur("var(--ms-late)", table("clair")), vert = couleur("var(--ms-ok)", table("clair")), rouge = couleur("var(--ms-off)", table("clair"));
  assert.ok(ambre[0] > ambre[2] && rouge[0] > rouge[1] && vert[1] > vert[0], "ambre, rouge et vert se distinguent aussi par la teinte");
});

/* ---------- 4. honnêteté : puce d'en-tête (carte, paysage) et carte « À savoir » (ordinateur) ---------- */
const negative = o => donnees(Object.assign({ capaciteNegative: true }, o));
const courte = (mois, o) => { const d = negative(o); d.capacite.base.constatee_detail.mois = mois; d.capacite.base.constatee_detail.periode = "août à septembre 2026"; d.capacite.base.constatee = d.capacite.base.retenue = -2084; return d; };

test("carte : la puce ambre « Hypothèse : épargne négative » est dans l'en-tête, ouvre une feuille « À savoir » avec la même explication ; plus de bandeau sous le tracé", () => {
  const t = monter({ donnees: courte(2) }), chip = t.q("[data-alerte]");
  assert.equal(chip.hidden, false); assert.equal(chip.getAttribute("class"), "gp-chip-al"); assert.ok(chip.closest(".gp-tete"), "dans l'en-tête de la carte");
  assert.equal(sp(chip.textContent), "Hypothèse : épargne négative"); assert.match(chip.getAttribute("aria-label"), /^Hypothèse : épargne négative\. Ouvrir l'explication$/); assert.equal(chip.getAttribute("aria-haspopup"), "dialog");
  assert.equal(t.qa(".gp-alerte, .gp-asavoir").length, 0);
  assert.match(chip.innerHTML, /gp-chip-i[^>]*><svg/, "icône ⓘ");
  chip.click();
  assert.equal(t.UI.st.titre, "À savoir"); const corps = sp(t.UI.st.corps.textContent);
  assert.match(corps, /Ton épargne constatée sur seulement 2 mois de relevés est négative \(période sans salaire\)\. La projection suppose qu'elle continue ainsi\./); assert.match(corps, /Compléter avec Claude/);
  assert.match(corps, /Donne tes anciens relevés à Claude pour une mesure plus fiable/);
  const hrefs = t.UI.st.corps.querySelectorAll("a").map(a => decodeURIComponent(a.getAttribute("href")));
  assert.ok(hrefs.some(h => /aide-moi à compléter mes revenus\. Concerne : mon nouvel emploi/.test(h)), "déclarer le nouvel emploi"); assert.ok(hrefs.some(h => /aide-moi à établir mon budget mensuel\. Je peux te donner un relevé bancaire\. Concerne : mes anciens relevés bancaires/.test(h)), "importer d'anciens relevés");
});

test("plein écran ordinateur : la carte « À savoir » est en tête de l'onglet Lecture (icône, une phrase, Compléter avec Claude, Détails) et le tracé n'est pas poussé vers le bas", () => {
  const t = monter({ donnees: courte(2), window: fenetre(1440, 900) }); t.api.pleinEcran();
  const bu = t.doc.body.querySelector(".gp-fsv-bureau"), carte = bu.querySelector("[data-alerte]"), lecture = bu.querySelector('[data-panel="lecture"]');
  assert.equal(carte.getAttribute("class"), "gp-asavoir"); assert.equal(carte.parentNode, lecture, "enfant direct de l'onglet Lecture"); assert.equal(lecture.firstElementChild || lecture.children[0], carte, "en premier");
  assert.equal(bu.querySelector(".gp-fs-main").querySelector("[data-alerte]"), null, "rien dans la colonne du tracé");
  assert.equal(bu.querySelectorAll(".gp-chip-al").length, 0, "pas de puce en plein écran ordinateur");
  assert.match(carte.innerHTML, /gp-al-i"[^>]*><svg/, "icône"); assert.equal(sp(carte.querySelector(".gp-as-k").textContent), "À savoir");
  assert.equal(carte.querySelectorAll(".gp-as-p").length, 1, "une seule phrase"); assert.equal(sp(carte.querySelector(".gp-as-p").textContent), "Épargne négative (−2 084 €/mois) mesurée sur seulement 2 mois de relevés : la projection suppose qu'elle continue.");
  assert.match(sp(carte.textContent), /Compléter avec Claude/); const btn = carte.querySelector('[data-act="as-detail"]');
  assert.equal(sp(btn.textContent), "Détails"); assert.equal(btn.getAttribute("aria-expanded"), "false"); assert.equal(carte.querySelector("[data-as-d]").hidden, true, "l'explication longue est repliée");
  btn.click();
  const apres = bu.querySelector("[data-alerte]"); assert.equal(apres.querySelector('[data-act="as-detail"]').getAttribute("aria-expanded"), "true"); assert.equal(apres.querySelector("[data-as-d]").hidden, false);
  assert.match(sp(apres.querySelector("[data-as-d]").textContent), /Avec si peu de relevés, la mesure est fragile\./);
  assert.match(sp(apres.querySelector("[data-as-d]").textContent), /Ta capacité d'épargne constatée est de 950 € par mois/, "le garde-fou du moteur reste dans les détails");
  /* un autre onglet : la carte appartient à l'onglet Lecture */
  assert.equal(bu.querySelector('[data-panel="evenements"]').querySelector("[data-alerte]"), null);
  /* le tracé garde toute sa hauteur : la colonne principale n'a plus d'élément d'alerte */
  assert.equal(bu.querySelector(".gp-fs-main").querySelectorAll(".gp-alerte").length + bu.querySelector(".gp-fs-main").querySelectorAll(".gp-asavoir").length, 0);
});

test("plein écran paysage : puce dans la barre du haut, jamais dans le panneau ; elle ouvre la même feuille ; en portrait, la carte est dans l'onglet Lecture sous le tracé", () => {
  const pa = monter({ donnees: courte(2), window: fenetre(844, 390) }); pa.api.pleinEcran();
  const fs = pa.doc.body.querySelector(".gp-fsv-paysage"), chip = fs.querySelector("[data-alerte]");
  assert.ok(chip.closest(".gp-fs-bar")); assert.equal(fs.querySelector(".gp-fs-side").querySelector("[data-alerte]"), null); assert.equal(sp(chip.textContent), "Hypothèse : épargne négative");
  chip.click(); assert.equal(pa.UI.st.titre, "À savoir"); assert.match(sp(pa.UI.st.corps.textContent), /seulement 2 mois de relevés/);
  assert.match(css, /\.gp-fsv-paysage \.gp-fs-bar:has\(\.gp-chip-al:not\(\[hidden\]\)\) \.gp-ttl\{display:none\}/, "la barre fine garde la place : le titre cède devant la puce");
  const po = monter({ donnees: courte(2), window: fenetre(390, 844) }); po.api.pleinEcran();
  const pf = po.doc.body.querySelector(".gp-fsv-portrait"), carte = pf.querySelector("[data-alerte]");
  assert.equal(carte.getAttribute("class"), "gp-asavoir"); assert.ok(carte.closest('[data-panel="lecture"]'));
});

test("sans rien à dire, ni puce ni carte (visibles) ; la puce et la carte suivent la mise à jour des données", () => {
  const t = monter(); assert.equal(t.q("[data-alerte]").hidden, true);
  const p = monter({ window: fenetre(1440, 900) }); p.api.pleinEcran(); assert.equal(p.doc.body.querySelector(".gp-fsv-bureau").querySelector("[data-alerte]").hidden, true);
  t.api.mettreAJour(negative()); assert.equal(t.q("[data-alerte]").hidden, false); assert.match(sp(t.q("[data-alerte]").textContent), /Hypothèse : épargne négative/);
  t.api.mettreAJour(donnees()); assert.equal(t.q("[data-alerte]").hidden, true);
});

/* ---------- 5. fenêtre de relevés courte ---------- */
test("fenêtre de relevés courte (moins de 6 mois) : dite en toutes lettres (« seulement 2 mois de relevés ») avec l'invitation HIS2 ; 6 mois et plus : texte inchangé", () => {
  const a = G.alerteEpargne(G.normaliser(courte(2)));
  assert.equal(a.cle, "epargne_negative"); assert.equal(a.courte, true); assert.equal(a.mois, 2);
  assert.equal(sp(a.texte), "Ton épargne constatée sur seulement 2 mois de relevés est négative (période sans salaire). La projection suppose qu'elle continue ainsi. Ton changement d'emploi de déc. 2026 est pris en compte à partir de cette date. Avec si peu de relevés, la mesure est fragile.");
  assert.equal(sp(a.resume), "Épargne négative (−2 084 €/mois) mesurée sur seulement 2 mois de relevés : la projection suppose qu'elle continue.");
  assert.equal(a.releves.libelle, "Donne tes anciens relevés à Claude pour une mesure plus fiable"); assert.equal(a.releves.section, "budget"); assert.equal(a.titre, "Hypothèse : épargne négative");
  const un = G.alerteEpargne(G.normaliser(courte(1))); assert.match(sp(un.texte), /sur seulement 1 mois de relevés/);
  const cinq = G.alerteEpargne(G.normaliser(courte(5))); assert.equal(cinq.courte, true);
  for (const n of [6, 12]) { const b = G.alerteEpargne(G.normaliser(courte(n))); assert.equal(b.courte, false, n + " mois : fenêtre suffisante"); assert.equal(b.releves, null); assert.match(sp(b.texte), new RegExp("^Ton épargne constatée sur " + n + " mois est négative")); assert.doesNotMatch(sp(b.texte), /seulement/); }
  assert.equal(G.SEUIL_RELEVES_MOIS, 6);
  const sans = negative(); sans.jalons = sans.jalons.filter(j => j.type !== "changement_emploi"); sans.capacite.base.constatee_detail.mois = 2;
  assert.match(sp(G.alerteEpargne(G.normaliser(sans)).texte), /^Ton épargne constatée sur seulement 2 mois de relevés est négative \(période sans salaire\)\. La projection suppose qu'elle continue ainsi\. Déclare ton nouvel emploi à Claude pour la corriger\. Avec si peu de relevés/, "déclarer le nouvel emploi ET donner d'anciens relevés");
  const prevu = negative(); prevu.capacite.base.source = "prevu"; prevu.capacite.base.retenue = -50; prevu.capacite.base.constatee_detail.mois = 2; assert.equal(G.alerteEpargne(G.normaliser(prevu)).courte, false, "épargne prévue au budget : pas de relevés en cause");
});

test("fenêtre courte et épargne POSITIVE : une mention discrète « Hypothèse : épargne sur 3 mois », jamais de silence sur une mesure fragile ; 12 mois : rien", () => {
  const d = donnees(); d.capacite.base.constatee_detail = { montant: 950, mois: 3, revenus: 3000, depenses: 2050, periode: "juillet à septembre 2026" };
  const a = G.alerteEpargne(G.normaliser(d));
  assert.equal(a.cle, "historique_court"); assert.equal(a.niveau, "info"); assert.equal(a.titre, "Hypothèse : épargne sur 3 mois"); assert.equal(sp(a.resume), "Épargne de 950 €/mois mesurée sur seulement 3 mois de relevés : une mesure fragile.");
  assert.match(sp(a.texte), /^Ton épargne constatée \(950 €\/mois\) ne repose que sur 3 mois de relevés : c'est une mesure fragile/);
  assert.equal(G.alerteEpargne(M0()), null, "12 mois de relevés, épargne positive : aucune mention");
  const t = monter({ donnees: d, window: fenetre(1440, 900) }); t.api.pleinEcran();
  const carte = t.doc.body.querySelector(".gp-fsv-bureau").querySelector("[data-alerte]"); assert.equal(carte.hidden, false); assert.match(sp(carte.textContent), /Donne tes anciens relevés à Claude pour une mesure plus fiable/); assert.match(sp(carte.textContent), /Compléter avec Claude/);
  const mediane = G.alerteEpargne(M0({ medianeSousExistant: true })); assert.equal(mediane.cle, "mediane_sous_sans_versement"); assert.equal(mediane.courte, false, "autres cas : fenêtre de relevés non en cause");
});

test("les autres cas d'honnêteté ont leur puce et leur phrase : médiane sous « sans versement », épargne qui passe sous zéro plus tard", () => {
  const m = G.alerteEpargne(M0({ medianeSousExistant: true }));
  assert.equal(m.titre, "Hypothèse : événements coûteux"); assert.match(sp(m.resume), /^À l'horizon, ta médiane finit sous la ligne « sans versement »/);
  const d = donnees(); d.capacite.par_periode[2].montant_mensuel = -300; const f = G.alerteEpargne(G.normaliser(d));
  assert.equal(f.titre, "Hypothèse : épargne négative dès juin 2027"); assert.equal(sp(f.resume), "À partir de juin 2027, ton épargne par mois passe sous zéro (−300 €/mois).");
  for (const a of [m, f]) assert.ok(a.texte && a.section && a.contexte);
});

/* ---------- 6. échelle robuste de la bande d'épargne ---------- */
test("échelle robuste (pur) : un mois passé isolé est coupé (médiane ± 3 × MAD) ; les marches du futur ne le sont jamais ; trop peu de valeurs ou aucun passé : pas de coupe", () => {
  const e = G.echelleBande([-3680, -420], [-420, 1400, 1150, 1360]);
  assert.equal(e.robuste, true); assert.deepEqual(e.coupes, [{ v: -3680, cote: "bas" }]); assert.equal(e.mn, -420, "l'échelle est celle des autres valeurs"); assert.equal(e.mx, 1400);
  const calme = G.echelleBande(Array.from({ length: 12 }, (_, k) => 800 + 25 * k), [950, 1400, 1150, 1360]); assert.equal(calme.robuste, false); assert.deepEqual(calme.coupes, []); assert.equal(calme.mn, 0); assert.equal(calme.mx, 1400);
  const haut = G.echelleBande([900, 950, 1000, 5200, 980], [1000]); assert.deepEqual(haut.coupes, [{ v: 5200, cote: "haut" }]); assert.equal(haut.mx, 1000); assert.equal(haut.mn, 0);
  const futurExtreme = G.echelleBande([900, 950, 1000], [1000, -3680]); assert.equal(futurExtreme.mn, -3680, "une marche du futur extrême reste dans l'échelle"); assert.deepEqual(futurExtreme.coupes, []);
  assert.equal(G.echelleBande([-3680], [-420, 100]).robuste, false, "moins de 4 valeurs : on ne coupe pas"); assert.equal(G.echelleBande([], [1, 2, 3, 4, 5, 6000]).robuste, false, "pas de passé : pas de coupe");
  assert.equal(G.echelleBande([-3680, -3680, -430, -400, -420], [-420, 1400, 1150]).coupes.length, 1, "deux mois identiques : un seul repère");
  const brut = G.echelleBande([], []); assert.deepEqual([brut.mn, brut.mx], [0, 0]);
});

const bandeDe = (d, mode = "bureau", ouverte = true) => {
  const M = G.normaliser(d), r = svgDe(M, "5", mode, mode === "carte" ? 358 : 1100);
  return { M, b: G.construireBande(M, { dom: r.geo.dom }, r.geo, r.geo.P, ouverte), geo: r.geo };
};
const outlier = o => { const d = negative(o); const debut = plusMois(AUJ.slice(0, 8) + "01", -2); d.capacite.passe = [{ debut, montant: -3680 }, { debut: plusMois(debut, 1), montant: -420 }]; return d; };

test("bande d'épargne : le mois à −3 680 € est coupé, repère « −3 680 € » sur la barre coupée, échelle min / max sur les autres valeurs, marches du futur lisibles", () => {
  const { b } = bandeDe(outlier());
  assert.equal(b.robuste, true); assert.equal(b.coupes.length, 1); assert.equal(b.coupes[0].texte, "−3 680 €"); assert.equal(b.coupes[0].cote, "bas");
  assert.equal(b.mn, -420, "échelle min = le plus bas des autres mois"); assert.equal(b.mx, 1400);
  assert.match(sp(b.svg), /<rect class="gp-sb n pas cap"[^>]*data-cap="bas" data-v="-3680"\/>/, "la barre coupée est marquée");
  assert.match(sp(b.svg), /<g class="gp-cap" data-cap-l="bas" aria-hidden="true"><path class="gp-cap-f" d="[^"]+"\/><text class="gp-halo gp-tcap"[^>]*>−3 680 €<\/text><title>Mois à −3 680 € : barre coupée, hors de l&#39;échelle<\/title><\/g>/);
  assert.match(b.svg, /<path class="gp-brk-m" d="M[\d. ]+L[\d. ]+"\/>/, "trait de rupture en travers de la barre");
  /* repères min / max de la marge : l'échelle coupée, pas −3 680 */
  assert.match(sp(b.svg), />1 400 €\/mois</); assert.match(sp(b.svg), />−420 €\/mois</); assert.doesNotMatch(sp(b.svg), /−3 680 €\/mois/, "la vraie valeur n'est écrite que sur la barre coupée");
  /* la barre coupée prend toute la hauteur sous le zéro, pas plus */
  assert.equal(b.Ys(-3680), b.Ys(b.mn)); assert.equal(b.Ys(1e6), b.Ys(b.mx));
  /* les marches du futur restent lisibles : la marche de +1 820 € (−420 → 1 400) prend plus de la moitié de la hauteur de la bande, alors qu'à l'échelle brute (−3 680 → 1 400) elle n'en prendrait que 36 % */
  const marche = Math.abs(b.Ys(-420) - b.Ys(1400)), plage = Math.abs(b.Ys(b.mn) - b.Ys(b.mx));
  assert.ok(marche / plage > 0.9, "la marche occupe l'essentiel de la plage visible : " + (marche / plage).toFixed(2)); assert.ok(marche >= 0.36 * (b.H - 20) * 2, "au moins le double de ce qu'elle ferait à l'échelle brute (" + marche.toFixed(1) + " px)");
});

test("bande d'épargne : sans valeur isolée, l'échelle n'est pas touchée (aucune barre coupée, repères min / max réels) ; le curseur d'un mois coupé reste dans la bande", () => {
  const { b } = bandeDe(negative());
  assert.equal(b.robuste, false); assert.equal(b.coupes.length, 0); assert.doesNotMatch(b.svg, /gp-cap|data-cap=|gp-brk-m/);
  const o = bandeDe(outlier(), "bureau"), t = monter({ donnees: outlier(), window: fenetre(1440, 900) }); t.api.pleinEcran();
  t.api.curseur(ms(plusMois(AUJ.slice(0, 8) + "01", -2)) + 864e5 * 10);
  const dot = t.doc.body.querySelector(".gp-fsv-bureau").querySelector("[data-sxh]").querySelector("circle"); assert.ok(dot, "point du curseur sur la bande");
  assert.ok(+dot.getAttribute("cy") <= o.b.H, "dans la bande (valeur −3 680 € ramenée au bord)"); assert.ok(+dot.getAttribute("cy") >= 0);
  assert.match(sp(t.doc.body.querySelector(".gp-fsv-bureau").querySelector("[data-stripv]").textContent), /−3 680 €\/mois/, "l'en-tête de la bande donne la vraie valeur du mois");
});

test("bande d'épargne : le mot « négative » ne recouvre jamais le repère de coupe ; carte, paysage et ordinateur", () => {
  for (const mode of ["bureau", "paysage", "carte"]) {
    const { b } = bandeDe(outlier(), mode, true);
    assert.equal(b.coupes.length, 1, mode);
    const neg = sp(b.svg).match(/<text class="gp-tneg gp-halo" x="([\d.]+)" y="([\d.]+)">négative<\/text>/);
    if (neg) { const c = b.coupes[0]; if (Math.abs(c.y - +neg[2]) < 12) assert.ok(+neg[1] >= c.x1 + 4 || +neg[1] + 52 <= c.x0 - 4, mode + " : pas de recouvrement (" + neg[1] + " vs " + c.x0 + "-" + c.x1 + ")"); }
  }
});

test("bande d'épargne : le CSS dessine la flèche de coupe et le trait de rupture avec les jetons ; texte du repère à 12 px (jeton)", () => {
  assert.match(css, /\.gp-brk-m\{stroke:var\(--surface\)/); assert.match(css, /\.gp-cap-f\{fill:none;stroke:var\(--ink\)/); assert.match(css, /\.gp-s-svg text\.gp-tcap\{fill:var\(--ink\);font:600 var\(--t-caption\)/);
});
