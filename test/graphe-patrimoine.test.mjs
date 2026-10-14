// Graphe maître d'Aujourd'hui (web/src/graphe-patrimoine.js) : rendus purs du passé (observé plein, reconstitué en pointillés), du cône de
// projection, de « Aujourd'hui », de la légende, du tableau des données et du panneau « Comment c'est calculé ». Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const G = require("../web/src/graphe-patrimoine.js");
const Historique = require("../web/src/historique.js");
const src = readFileSync("web/src/graphe-patrimoine.js", "utf8");

const T = "2026-10-14";
const row = (date, valeur, nature, label) => ({ date, label: label || date, valeur, nature: nature || "observe", variation: null });
const PASSE = [row("2026-07-01", 100000, "reconstitue", "juil. 2026"), row("2026-08-01", 104000, "reconstitue", "août 2026"), row("2026-09-01", 110000, "observe", "sept. 2026"), row(T, 120000, "observe", "oct. 2026")];
const cone = (annees, pas = 12) => ({ annees, versement: 200, points: Array.from({ length: annees * 12 + 1 }, (_, k) => ({ date: Historique.plusMois(T, k), mois: k, pessimiste: 120000 + k * 300, central: 120000 + k * 700, optimiste: 120000 + k * 1200 })) });
const attr = (svg, re) => (svg.match(re) || [])[1];

test("construire : rien à dessiner sans point ni projection", () => {
  assert.deepEqual(G.construire({ points: [] }, null, {}), { svg: "", points: [], geo: null });
  assert.equal(G.construire({ points: [row(T, 1)] }, null, {}).svg, "", "un seul point : pas de courbe");
  assert.equal(G.construire(null, null).svg, "");
  assert.ok(G.construire({ points: [row(T, 1)] }, cone(1), { today: T }).svg.includes("aj-proj"), "un seul point mais une projection : le cône part d'aujourd'hui");
});

test("construire : observé en trait plein, reconstitué en pointillés rejoignant la première photo, projection en bande et ligne centrale", () => {
  const g = G.construire({ points: PASSE }, cone(5), { today: T, largeur: 720, scopeLabel: "du foyer" });
  assert.match(g.svg, /^<svg class="aj-svg" viewBox="0 0 720 300"/);
  assert.match(g.svg, /<path class="aj-ligne-rec" d="M[^"]+"\/>/);
  assert.match(g.svg, /<path class="aj-ligne" d="M[^"]+"\/>/);
  assert.match(g.svg, /<path class="aj-bande" d="M[^"]+Z"\/>/);
  assert.equal((g.svg.match(/class="aj-borne"/g) || []).length, 2, "bords pessimiste et optimiste");
  assert.match(g.svg, /<path class="aj-proj" d="M/);
  const rec = attr(g.svg, /class="aj-ligne-rec" d="([^"]+)"/).split(/[ML]/).filter(Boolean);
  assert.equal(rec.length, 3, "deux points reconstitués + la première photo (jonction sans cassure)");
  assert.equal(attr(g.svg, /class="aj-ligne" d="([^"]+)"/).split(/[ML]/).filter(Boolean).length, 2, "deux photos");
  assert.match(g.svg, /<line class="aj-auj" /);
  assert.match(g.svg, /<text class="aj-auj-t"[^>]*>Aujourd'hui<\/text>/);
  assert.match(g.svg, /<circle class="aj-pt fin"/, "point du jour");
  assert.match(g.svg, /<line class="aj-cur-l"[^>]*\/><circle class="aj-cur-d"/, "curseur de l'infobulle (masqué tant qu'on ne survole pas)");
  // sans reconstitué ni futur : ni pointillés ni bande
  const seul = G.construire({ points: PASSE.slice(2).concat([row("2026-10-10", 119000)]).sort((a, b) => (a.date < b.date ? -1 : 1)) }, null, { today: T });
  assert.doesNotMatch(seul.svg, /aj-ligne-rec|aj-bande|aj-proj|aj-auj-t/);
});

test("construire : « Aujourd'hui » sépare deux échelles de temps, le passé garde entre 30 et 60 % de la largeur", () => {
  const W = 1000, L = 62, R = 14, PW = W - L - R;
  const long = G.construire({ points: PASSE }, cone(20), { today: T, largeur: W });
  assert.ok(Math.abs((long.geo.xAuj - L) / PW - 0.3) < 1e-9, "passé court, futur long : 30 % au moins");
  assert.equal(long.geo.deformee, true, "échelle modifiée : la note de la vue le dit");
  const court = G.construire({ points: [row("2020-01-01", 1), row(T, 2)] }, cone(1), { today: T, largeur: W });
  assert.ok(Math.abs((court.geo.xAuj - L) / PW - 0.6) < 1e-9, "passé long, futur court : 60 % au plus");
  const sans = G.construire({ points: PASSE }, null, { today: T, largeur: W });
  assert.equal(sans.geo.xAuj, L + PW, "sans futur : « Aujourd'hui » est le bord droit");
  assert.equal(sans.geo.deformee, false);
  // points interactifs triés par abscisse, passé puis futur, avec leur nature
  const p = long.points;
  assert.ok(p.every((q, i) => !i || p[i - 1].x <= q.x));
  assert.deepEqual([...new Set(p.map(q => q.nature))], ["reconstitue", "observe", "projete"]);
  assert.equal(p.filter(q => q.nature === "projete").length, 240, "un point par mois (le mois 0 est le point du jour)");
  const proj = p.find(q => q.nature === "projete");
  assert.ok(proj.min <= proj.valeur && proj.valeur <= proj.max);
  assert.ok(p.every(q => q.x >= L - 1e-9 && q.x <= W - R + 1e-9 && q.y >= 0 && q.y <= long.geo.H));
});

test("construire : libellés de l'axe sans chevauchement (années du futur, mobile compris) ; échelle verticale ronde", () => {
  for (const [N, W] of [[1, 320], [5, 320], [10, 360], [20, 320], [20, 1000]]) {
    const g = G.construire({ points: PASSE }, cone(N), { today: T, largeur: W });
    const xs = [...g.svg.matchAll(/<text class="aj-ax" x="([\d.]+)" y="\d+" text-anchor="(\w+)">(\d{4})<\/text>/g)].map(m => ({ x: +m[1], a: m[2], t: m[3] }));
    assert.ok(xs.length >= 1, N + " ans : au moins un libellé d'année");
    assert.equal(xs[0].t, String(2026 + N) === xs[0].t ? xs[0].t : "", "horizon porté en premier");
    const tri = xs.slice().sort((a, b) => a.x - b.x);
    tri.forEach((q, i) => { if (i) assert.ok(q.x - tri[i - 1].x >= 38, N + " ans, " + W + " px : " + tri.map(z => z.t + "@" + z.x).join(" ")); });
  }
  const gr = G.graduations(97300, 183200, 4);
  assert.ok(gr.lo <= 97300 && gr.hi >= 183200);
  assert.ok(gr.ticks.every(t => t.v % 10000 === 0 || t.v % 20000 === 0 || t.v % 25000 === 0));
  assert.match(gr.ticks[0].label, /k€$/);
  assert.match(G.graduations(900000, 2300000, 4).ticks[1].label, /M€|k€/);
  assert.match(G.graduations(120, 480, 4).ticks[0].label, / €$/);
});

test("construire : titre accessible complet (valeur du jour, projection, pas une promesse, reconstitué) ; tout est échappé ; repères du journal focalisables", () => {
  const g = G.construire({ points: PASSE, reperes: [{ id: "x<y", date: "2026-08-15", titre: '<img src=x onerror="alert(1)">', statut: "actif" }] }, cone(10), { today: T, scopeLabel: 'du foyer <b>"' });
  assert.match(g.svg, /^<svg[^>]*role="group"[^>]*aria-label="Patrimoine net estimé du foyer &lt;b&gt;&quot; : 120 000 € aujourd&#39;hui\. Projection à 10 ans : 204 000 € au centre, entre 156 000 € et 264 000 €, ce n&#39;est pas une promesse\. Le passé avant la première photo est reconstitué \(estimation\)\. 1 décision du journal \(repères verticaux\)\./);
  assert.doesNotMatch(g.svg, /<img|<b>/);
  assert.match(g.svg, /data-journal="x&lt;y" tabindex="0" role="button" aria-label="Décision du 15 août 2026 : &lt;img/);
  assert.match(g.svg, /Les données sont dans le tableau sous le graphique/);
  assert.match(G.construire({ points: PASSE }, null, { today: T }).svg, /^<svg[^>]*role="img"/);
});

test("infobulle : date, valeur, nature en toutes lettres (jamais la couleur ou le trait seuls)", () => {
  assert.equal(G.infobulle({ date: T, valeur: 120000, nature: "observe" }).replace(/[  ]/g, " "), "14 oct. 2026 : 120 000 € (observé)");
  assert.match(G.infobulle({ date: "2026-08-01", valeur: 104000, nature: "reconstitue" }), /\(reconstitué\) : estimation, moins fiable qu'une photo/);
  assert.match(G.infobulle({ date: "2031-10-14", valeur: 155000, min: 140000, max: 170000, nature: "projete" }).replace(/[  ]/g, " "), /155 000 € au centre, entre 140 000 € et 170 000 € \(projeté, pas une promesse\)/);
  assert.equal(G.infobulle(null), "");
});

test("legendeHtml : une entrée par nature présente (observé, reconstitué, projection centrale, bande), avec un trait distinct", () => {
  const h = G.legendeHtml({ points: PASSE }, cone(5));
  assert.match(h, /^<ul class="aj-legende" aria-label="Légende du graphique">/);
  for (const t of ["Observé", "Reconstitué", "Projection centrale", "Entre pessimiste et optimiste"]) assert.ok(h.includes(t), t);
  assert.match(h, /<path class="aj-ligne-rec" d="M1,5H27"\/>/, "même classe que la courbe : les pointillés viennent de la feuille de style");
  assert.match(readFileSync("web/src/aujourdhui.css", "utf8"), /\.aj-ligne-rec\{[^}]*stroke-dasharray:5 4/);
  assert.equal((h.match(/<li class="aj-lg">/g) || []).length, 4);
  const seul = G.legendeHtml({ points: PASSE.slice(2) }, null);
  assert.ok(seul.includes("Observé") && !seul.includes("Reconstitué") && !seul.includes("Projection"));
  assert.equal(G.legendeHtml({ points: [] }, null), "");
});

test("tableauHtml : équivalent accessible (en-têtes de colonnes et de lignes, nature de chaque point, projection année par année)", () => {
  const h = G.tableauHtml({ points: PASSE }, cone(3), { scopeLabel: "du foyer" });
  assert.match(h, /<div class="aj-tab-wrap" tabindex="0" role="region" aria-label="Données du graphique"><table class="aj-tab"><caption class="ui-sr">Patrimoine net du foyer/);
  assert.equal((h.match(/<th scope="col">/g) || []).length, 5);
  assert.equal((h.match(/<th scope="row">/g) || []).length, PASSE.length + 3, "4 points du passé + 3 années de projection");
  assert.equal((h.match(/<td>reconstitué<\/td>/g) || []).length, 2);
  assert.equal((h.match(/<td>observé<\/td>/g) || []).length, 2);
  assert.equal((h.match(/<td>projeté \(valeur centrale\)<\/td>/g) || []).length, 3);
  assert.match(h.replace(/[  ]/g, " "), /<th scope="row">14 oct\. 2027<\/th><td class="n">128 400 €<\/td><td class="n">123 600 €<\/td><td class="n">134 400 €<\/td>/, "valeur centrale, pessimiste, optimiste");
  assert.equal(G.tableauHtml({ points: [] }, null), "");
  assert.doesNotMatch(G.tableauHtml({ points: [row(T, 1, "observe", "<script>alert(1)</script>")] }, null), /<script>/);
});

test("calculHtml : natures du passé, reconstitution (lignes cotées, bancaires, constantes, recalage), hypothèses de la projection, repères publics https ; échappé", () => {
  const rec = { debut: "2021-10-14", points: [{}], drapeaux: { viaTransactions: ["ETF <A>"], compositionActuelle: ["Action B"], bancaires: ["Compte joint"], constantes: { noms: ["Livret", "Assurance vie"], montant: 52000 }, courteHistoire: ["Récent"], sansCours: [] } };
  const parBloc = { Monde: { capital: 30000 }, "Épargne": { capital: 20000 }, _autre: { capital: 1000 } };
  const h = G.calculHtml({ rec, decalage: -1500, fut: cone(10), rendements: { Monde: { pessimiste: 3, central: 6, optimiste: 8.5 }, "Épargne": { pessimiste: 1.7, central: 2.4, optimiste: 3 }, _autre: { pessimiste: 1.5, central: 4, optimiste: 6 } }, parBloc,
    versementSource: "d'après l'épargne prévue au budget", scopeLabel: "du foyer", deformee: true,
    sources: [{ libelle: "Taux du Livret A", valeur: "1,7 %", dateEffet: "2026-08-01", sourceTitre: "Ministère <Éco>", sourceUrl: "https://www.example.org/livret" }, { libelle: "PFU", valeur: "31,4 %", sourceTitre: "Source", sourceUrl: "javascript:alert(1)" }] }).replace(/[  ]/g, " ");
  for (const t of ["Observé", "Reconstitué (pointillés)", "Projection (zone colorée)", "Repères publics", "Projection, pas une promesse"]) assert.ok(h.includes(t), t);
  assert.match(h, /ETF &lt;A&gt;/); assert.doesNotMatch(h, /ETF <A>|Ministère <Éco>/);
  assert.match(h, /sans transaction, la quantité d'aujourd'hui est utilisée, « à composition actuelle » \(Action B\)/);
  assert.match(h, /sur les 90 derniers jours seulement \(Compte joint\)/);
  assert.match(h, /Livret, Assurance vie : 52 000 €/);
  assert.match(h, /décalé de −1 500 € pour rejoindre ta première photo/);
  assert.match(h, /avec 200 € versés chaque mois \(d(?:'|&#39;)après l(?:'|&#39;)épargne prévue au budget\)/);
  assert.match(h, /<th scope="row">Monde<\/th><td class="n">30 000 €<\/td><td class="n">3 %<\/td><td class="n">6 %<\/td><td class="n">8,5 %<\/td>/);
  assert.match(h, /<th scope="row">Autres<\/th>/);
  assert.match(h, /<a href="https:\/\/www\.example\.org\/livret" target="_blank" rel="noopener noreferrer">Ministère &lt;Éco&gt;<span class="ui-sr"> \(nouvel onglet\)<\/span><\/a>/);
  assert.doesNotMatch(h, /javascript:/);
  assert.match(h, /Taux du Livret A : <strong>1,7 %<\/strong> depuis le 1 août 2026/);
  assert.match(h, /Échelle : le passé et le futur n'ont pas la même échelle de temps/);
  assert.match(h, /Impôts, frais, inflation et aléas de marché ne sont pas pris en compte/);
  assert.match(h, /L'immobilier, les autres biens et les dettes restent à leur valeur d'aujourd'hui/);
  // sans reconstitué ni projection : seulement l'observé
  const min = G.calculHtml({});
  assert.ok(min.includes("Observé") && !min.includes("Reconstitué") && !min.includes("Projection"));
  assert.match(G.calculHtml({ fut: Object.assign(cone(1), { versement: 0 }), parBloc: {} }), /sans versement mensuel \(aucune épargne mensuelle connue\)/);
});

test("graphe-patrimoine.js : module pur (ni DOM, ni réseau, ni stockage) ; tutoiement", () => {
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|\bfetch\(|XMLHttpRequest|localStorage|innerHTML/);
  assert.doesNotMatch(src, /\b(vous|votre|vos)\b/i);
  assert.doesNotThrow(() => new (require("node:vm").Script)(src));
});
