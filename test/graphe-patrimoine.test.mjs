// Graphe maître (SIM2, web/src/graphe-patrimoine.js) : fonctions PURES : fenêtres et axe du temps proportionnel, granularité, graduations rondes, échelle stable
// (500 → 2 000 chemins), courbes monotones, continuité à « Aujourd'hui », jalons (regroupement, objectifs), lecture à une date, textes honnêtes (phrase de titre,
// décomposition, événements, garde-fous), mode capacité, plan figé (Prévu vs réel), tableau de données, « Comment c'est calculé ». Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { G, donnees, AUJ, plusMois } from "./helpers/graphe-donnees.mjs";
import { lire, sansCommentaires } from "./helpers/css.mjs";

const src = readFileSync("web/src/graphe-patrimoine.js", "utf8");
const ms = G.msDe;
const M0 = () => G.normaliser(donnees());
const CTX = M => ({ today: M.today, debutPasse: M.debutPasse, finFutur: M.finFutur });
const svgDe = (M, fen = "5", mode = "carte", W = 358, extra) => {
  const dom = G.domaine(fen, CTX(M)), gran = G.granularite(dom.fin - dom.debut);
  const P = Object.assign(G.parametresMode(mode, W), { W, id: "t" });
  if (P.fill) P.H = 520;
  const r = G.construireSvg(M, Object.assign({ dom, gran, couches: {} }, extra), P);
  return Object.assign(r, { dom, gran, P });
};

test("fenêtres : un contrôle unique de 5 fenêtres, « N ans » = N ans avant ET après aujourd'hui", () => {
  assert.deepEqual(G.FENETRES.map(f => f.label), ["1 an", "5 ans", "10 ans", "20 ans", "Tout"]);
  const M = M0(), t = M.today;
  for (const [id, n] of [["1", 1], ["5", 5], ["10", 10], ["20", 20]]) {
    const d = G.domaine(id, { today: t, debutPasse: G.ajouterMois(t, -12 * 30), finFutur: G.ajouterMois(t, 12 * 25) });
    assert.equal(d.debut, G.ajouterMois(t, -12 * n), id + " an(s) avant");
    assert.equal(d.fin, G.ajouterMois(t, 12 * n), id + " an(s) après");
  }
});

test("axe du temps proportionnel : x(date) affine en jours, un an passé = un an futur (à 1 px près), toutes fenêtres", () => {
  const M = M0();
  for (const fen of ["1", "5", "10", "20", "tout"]) {
    const { geo } = svgDe(M, fen);
    const X = geo.X, j = 864e5, t = M.today;
    const a = X(t + 100 * j) - X(t), b = X(t + 200 * j) - X(t + 100 * j), c = X(t - 100 * j) - X(t - 200 * j);
    assert.ok(Math.abs(a - b) < 1e-6 && Math.abs(a - c) < 1e-6, fen + " : pente constante (100 jours = même largeur, passé comme futur)");
    const passe = X(t) - X(G.ajouterMois(t, -12)), futur = X(G.ajouterMois(t, 12)) - X(t);
    assert.ok(Math.abs(passe - futur) <= 1, fen + " : 1 an passé = " + passe.toFixed(2) + " px, 1 an futur = " + futur.toFixed(2) + " px");
  }
});

test("fenêtre « 5 ans » : 5 ans de chaque côté, ou l'historique disponible (la place libérée va au futur, largeur constante)", () => {
  const M = M0(); // 3 ans d'historique
  const d = G.domaine("5", CTX(M));
  assert.equal(d.debut, G.ajouterMois(M.today, -36), "le passé est borné par l'historique");
  assert.equal(d.fin, G.ajouterMois(d.debut, 120), "la largeur reste de 10 ans : le futur s'allonge de ce que le passé n'a pas");
  const long = G.domaine("5", { today: M.today, debutPasse: G.ajouterMois(M.today, -90), finFutur: G.ajouterMois(M.today, 300) });
  assert.equal(long.debut, G.ajouterMois(M.today, -60)); assert.equal(long.fin, G.ajouterMois(M.today, 60));
  const sans = G.domaine("5", { today: M.today, debutPasse: null, finFutur: G.ajouterMois(M.today, 300) });
  assert.equal(sans.debut, M.today, "aucun historique : le passé est un point « Aujourd'hui »");
  const tout = G.domaine("tout", CTX(M));
  assert.equal(tout.debut, M.debutPasse); assert.equal(tout.fin, M.finFutur, "Tout = tout l'historique et l'horizon maximal");
  const futurSeul = G.domaine("10", { today: M.today, debutPasse: M.debutPasse, finFutur: G.ajouterMois(M.today, 300), futurSeul: true });
  assert.equal(futurSeul.debut, M.today); assert.equal(futurSeul.fin, G.ajouterMois(M.today, 120), "mode capacité : 10 ans de futur, pas de passé");
  const libre = G.domaine("5", Object.assign(CTX(M), { periode: { du: ms("2025-01-01"), au: ms("2028-01-01") } }));
  assert.deepEqual(libre, { debut: ms("2025-01-01"), fin: ms("2028-01-01") }, "période libre");
});

test("granularité automatique : jour ≤ 3 mois, semaine ≤ 1 an, mois ≤ 10 ans, trimestre ≤ 20 ans, année au-delà ; un cran de plus fin en plein écran", () => {
  const j = 864e5;
  assert.equal(G.granularite(60 * j), "jour"); assert.equal(G.granularite(200 * j), "semaine"); assert.equal(G.granularite(5 * 365 * j), "mois");
  assert.equal(G.granularite(15 * 365 * j), "trimestre"); assert.equal(G.granularite(30 * 365 * j), "annee");
  assert.equal(G.granularite(30 * 365 * j, true), "trimestre"); assert.equal(G.granularite(60 * j, true), "jour");
  const M = M0();
  assert.equal(svgDe(M, "5").gran, "mois"); assert.equal(svgDe(M, "20").gran, "trimestre", "3 ans de passé + 10 ans de futur : 13 ans visibles");
});

test("graduations : au plus 4 en portrait (8 sur ordinateur), pas de 1, 2 ou 5 × 10ⁿ, même format, zéro présent si une valeur est négative", () => {
  for (const [lo, hi] of [[137950, 972419], [180000, 260000], [-40000, 90000], [900, 4200], [1.2e6, 5.5e6]]) {
    const g = G.graduations(lo, hi, 4);
    assert.ok(g.valeurs.length >= 2 && g.valeurs.length <= 4, lo + " à " + hi + " : " + g.valeurs.length + " graduations");
    const m = g.pas / Math.pow(10, Math.floor(Math.log10(g.pas)));
    assert.ok([1, 2, 5].some(x => Math.abs(x - m) < 1e-9), "pas rond : " + g.pas);
    g.valeurs.forEach(v => assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6));
    g.libelles.forEach(l => assert.match(l, /^(0|−?[\d  ]+(,\d)? ?(€|k€|M€))$/, "libellé net : " + l));
  }
  const neg = G.graduations(-60000, 90000, 4);
  assert.ok(neg.valeurs.includes(0) && neg.libelles.some(l => /^0/.test(l)), "zéro affiché");
  assert.ok(neg.libelles.some(l => l.startsWith("−")), "signe moins typographique");
  assert.ok(G.graduations(0, 1e6, 8).valeurs.length <= 8);
  const dy = G.domaineY(-5000, 20000);
  assert.ok(dy.lo < -5000 && dy.hi >= 20000, "domaine élargi de 7 %");
  assert.equal(G.domaineY(-5000, -1000).hi, 0, "toutes valeurs négatives : le zéro reste dans le cadre");
});

test("libellés de l'axe : « 0 » jamais « 0,0 M€ », « 500 k€ » sous le million, une même décimale pour les M€ ; deux chiffres significatifs (1,0 M€ / 990 k€)", () => {
  const g = G.graduations(0, 1.1e6, 4), l = g.libelles.map(x => x.replace(/[  ]/g, " "));
  assert.equal(l[0], "0"); assert.ok(l.every(x => !/0,0 M€/.test(x)), l.join("|"));
  const demi = G.graduations(0, 1e6, 4).libelles.map(x => x.replace(/[  ]/g, " "));
  assert.deepEqual(demi, ["0", "500 k€", "1 M€"]);
  const deux = G.graduations(900000, 2.1e6, 4).libelles.map(x => x.replace(/[  ]/g, " "));
  assert.ok(deux.every(x => !/^\d+ M€$/.test(x) || !deux.some(y => /,\d M€/.test(y))), "même décimale : " + deux.join("|"));
  assert.ok(G.graduations(100000, 800000, 4).libelles.every(x => /k€$/.test(x) && !/M€/.test(x)));
  const f = n => G.fK(n).replace(/[  ]/g, " ");
  assert.equal(f(990000), "990 k€"); assert.equal(f(996000), "1,0 M€"); assert.equal(f(1000000), "1,0 M€"); assert.equal(f(1234567), "1,2 M€"); assert.equal(f(12.3e6), "12 M€");
  assert.equal(f(0), "0 €"); assert.equal(f(-990000), "−990 k€");
});

test("chances sur 10 : dès 95 % « plus de 9 chances sur 10 », jamais « 10 chances sur 10 »", () => {
  assert.equal(G.chancesTxt(1), "plus de 9 chances sur 10"); assert.equal(G.chancesTxt(0.97), "plus de 9 chances sur 10"); assert.equal(G.chancesTxt(0.95), "plus de 9 chances sur 10");
  assert.equal(G.chancesTxt(0.94), "9 chances sur 10"); assert.equal(G.chancesTxt(0.8), "8 chances sur 10"); assert.equal(G.chancesTxt(0.1), "1 chance sur 10"); assert.equal(G.chancesTxt(0.02), "moins de 1 chance sur 10");
});

test("échelle des y : jamais sous zéro pour un patrimoine positif ; resserrée quand le besoin rétrécit nettement, sans bouger entre l'aperçu et le complet", () => {
  assert.equal(G.domaineY(1000, 400000).lo, 0); assert.ok(G.domaineY(100000, 400000).lo > 0 && G.domaineY(100000, 400000).lo < 100000);
  const ap = G.echelleYStable(null, { lo: 2000, hi: 400000 }, { apercu: true });
  assert.equal(ap.lo, 0, "l'aperçu élargi ne descend pas sous zéro non plus");
  assert.equal(G.echelleYStable(ap, { lo: 2000, hi: 385000 }).change, false, "complet un peu plus bas que l'aperçu : l'échelle ne bouge pas");
  const large = G.echelleYStable(null, { lo: 100000, hi: 2000000 }), serre = G.echelleYStable(large, { lo: 150000, hi: 700000 });
  assert.equal(serre.change, true); assert.ok(serre.hi < 900000, "le besoin a rétréci de moitié : resserrée");
  assert.ok(G.graduations(serre.lo, serre.hi, 4).valeurs.length >= 2);
});

test("graduations dans le tracé : 4 libellés au plus à droite, en portrait ; jusqu'à 8 en plein écran ordinateur", () => {
  const M = M0();
  assert.ok(svgDe(M, "5", "carte").geo.ticks.length <= 4);
  assert.ok(svgDe(M, "5", "carte", 358).svg.match(/class="gp-ytk"/g).length <= 4);
  const bureau = svgDe(M, "5", "bureau", 1000);
  assert.ok(bureau.geo.ticks.length <= 8 && bureau.geo.ticks.length > 4);
  assert.match(svgDe(M, "5", "carte").svg, /text-anchor="end"[^>]*>[^<]*k€/, "montants alignés à droite, dans la gouttière");
});

test("échelle des y calée sur la fourchette P10–P90 de la fenêtre visible ; l'aperçu à 500 chemins puis le complet à 2 000 ne font pas sauter l'échelle", () => {
  const M = M0(), dom = G.domaine("5", CTX(M)), ech = G.echantillons(M, dom, "mois"), b = G.besoinY(M, dom, ech, {});
  const F = M.futur;
  let hi = -Infinity; F.t.forEach((t, i) => { if (t <= dom.fin) hi = Math.max(hi, F.p90[i]); });
  assert.ok(Math.abs(b.hi - hi) < 1, "le haut du besoin est le P90 visible");
  const apercu = G.echelleYStable(null, { lo: 100000, hi: 400000 }, { apercu: true }), plein = G.echelleYStable({ lo: apercu.lo, hi: apercu.hi }, { lo: 98000, hi: 410000 });
  assert.equal(plein.change, false); assert.equal(plein.hi, apercu.hi); assert.equal(plein.lo, apercu.lo);
  assert.ok(apercu.hi > G.domaineY(100000, 400000).hi, "l'aperçu est élargi de 10 % : une marge pour le résultat complet");
  const sort = G.echelleYStable({ lo: apercu.lo, hi: apercu.hi }, { lo: 98000, hi: 900000 });
  assert.equal(sort.change, true, "le résultat complet sort de la marge : l'échelle est recalculée");
  assert.ok(sort.hi >= 900000);
});

test("courbes lissées monotones (Fritsch-Carlson) : pas de dépassement, pas d'ondulation inventée", () => {
  const pts = [[0, 100], [10, 100], [20, 100], [30, 160], [40, 160], [50, 160]];
  const sg = [...G.chemin(pts).matchAll(/C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)].map(m => m.slice(1).map(Number));
  assert.equal(sg.length, 5);
  sg.forEach(c => { for (const y of [c[1], c[3], c[5]]) assert.ok(y >= 99.9 && y <= 160.1, "contrôle hors de l'enveloppe des données : " + y); });
  assert.match(G.chemin([[1, 2], [3, 4]]), /^M1\.0 2\.0C/);
  assert.match(G.bande([[0, 1], [10, 2]], [[0, 5], [10, 6]]), /^M0\.0 1\.0C[^Z]+L10\.0 6\.0C[^Z]+Z$/);
  assert.equal(G.bande([[0, 1]], [[0, 2]]), "", "une bande demande deux points");
});

test("continuité à « Aujourd'hui » : médiane, bandes, existant et variante partent exactement de la dernière valeur observée (même x, même y)", () => {
  const d = donnees();
  d.futur.variante = { nom: "2ᵉ enfant", p25: d.futur.p25.map(v => v + 1000), p50: d.futur.p50.map(v => v + 1500), p75: d.futur.p75.map(v => v + 2000) };
  d.futur.p50[0] = d.passe.points[d.passe.points.length - 1].valeur + 7; // le moteur part de 7 € plus haut : la courbe est recalée, pas décalée
  const M = G.normaliser(d), obs = M.passe.v[M.passe.v.length - 1];
  for (const k of ["p10", "p25", "p50", "p75", "p90"]) assert.equal(M.futur[k][0], obs, k);
  for (const k of ["p25", "p50", "p75"]) { assert.equal(M.futur.existant[k][0], obs, "existant " + k); assert.equal(M.futur.variante[k][0], obs, "variante " + k); }
  assert.ok(Math.abs(M.ecartDepart - 7) < 1e-6, "l'écart de départ du moteur est connu (et dit dans « Comment c'est calculé »)");
  const { svg, geo } = svgDe(M, "5", "carte", 358, { couches: { existant: true } });
  const pt = svg.match(/<circle class="gp-dot-ink" data-today cx="([\d.]+)" cy="([\d.]+)"/);
  assert.ok(pt, "pastille de la valeur d'aujourd'hui");
  assert.equal(+pt[1], +geo.X(M.today).toFixed(1)); assert.equal(+pt[2], +geo.Y(obs).toFixed(1));
  const med = svg.match(/<path class="gp-med" d="M([\d.]+) ([\d.]+)C/);
  assert.deepEqual(med.slice(1).map(Number), [+pt[1], +pt[2]], "la médiane démarre sur la pastille");
  const ex = svg.match(/<path class="gp-sv" d="M([\d.]+) ([\d.]+)C/);
  assert.deepEqual(ex.slice(1).map(Number), [+pt[1], +pt[2]], "l'existant démarre sur la pastille");
});

test("couche « existant » : calculée aux anniversaires seulement, tracée avec ses points connus (jamais des zéros entre eux), lue par interpolation", () => {
  const M = M0(), F = M.futur;
  assert.equal(F.existant.p50[5], null); assert.notEqual(F.existant.p50[12], null);
  const i = G.valeurCreuse(F.t, F.existant.p50, 18);
  assert.ok(i > F.existant.p50[12] && i < F.existant.p50[24], "interpolation entre deux anniversaires");
  assert.equal(G.valeurCreuse(F.t, F.existant.p50, 12), F.existant.p50[12]);
  const { svg } = svgDe(M, "10", "carte", 358, { couches: { existant: true } });
  const d = svg.match(/<path class="gp-sv" d="([^"]+)"/)[1];
  assert.ok((d.match(/C/g) || []).length <= 12, "un segment par anniversaire, pas un par mois");
  assert.doesNotMatch(d, /NaN|Infinity/);
  const l = G.lecture(M, null, F.t[18]);
  assert.ok(l.existant <= l.p50, "existant ≤ complet en médiane quand la capacité est positive");
  assert.ok(l.epargneFuture > 0 && l.versements > 0);
});

test("euros d'aujourd'hui : le passé est converti par l'indice des prix (Insee) ; indice absent ou incomplet : jamais de facteur inventé", () => {
  const idx = [{ mois: "2025-10-01", valeur: 100 }, { mois: "2026-09-01", valeur: 102 }, { mois: "2026-10-01", valeur: 103 }];
  assert.equal(G.facteurPrix(idx, "2025-10-20", "2026-10-14").toFixed(4), (103 / 100).toFixed(4));
  assert.equal(G.facteurPrix(idx, "2026-10-14", "2026-10-14"), 1, "aujourd'hui : facteur 1");
  assert.equal(G.facteurPrix(idx, "2026-11-20", "2026-10-14"), 1, "mois récent sans indice : le dernier indice publié");
  assert.equal(G.facteurPrix(idx, "2024-01-01", "2026-10-14"), null, "avant le premier indice : pas de facteur");
  assert.equal(G.facteurPrix([], "2025-10-20", "2026-10-14"), null);
  assert.equal(G.facteurPrix(null, "2025-10-20", "2026-10-14"), null);
});

test("jalons : regroupés quand leurs pastilles se touchent (compte « 4 »), objectifs en cibles sur la médiane", () => {
  const M = M0(), { geo, svg } = svgDe(M, "5", "carte");
  const groupes = geo.marqueurs.filter(m => m.type === "groupe");
  const gros = groupes.find(m => m.jalons.length > 1);
  assert.ok(gros && gros.jalons.length === 4, "les 4 événements des 10 prochains mois sont regroupés : " + groupes.map(g => g.jalons.length).join(","));
  assert.match(svg, /<g class="gp-mkc gp-mkn"[^>]*><circle[^>]*r="7\.5"\/><text[^>]*>4<\/text>/, "le compte est écrit dans la pastille");
  assert.match(svg, /<circle class="gp-mkc"[^>]*r="4"\/>/, "un jalon seul : un point de 8 px sur la ligne de base");
  assert.equal(geo.marqueurs.filter(m => m.type === "objectif").length, 3, "trois objectifs en petites cibles");
  assert.equal((svg.match(/class="gp-tg"/g) || []).length, 3);
  geo.marqueurs.filter(m => m.type === "objectif").forEach(o => assert.ok(o.y < geo.B, "sur la médiane, au-dessus de la ligne de base"));
  assert.deepEqual(G.regrouperJalons([{ t: 0, id: "a" }, { t: 1e9, id: "b" }, { t: 1.05e9, id: "c" }], t => t / 1e7, 4).map(g => g.jalons.length), [1, 1, 1], "5 px séparent b et c, seuil de 4 px : pas de fusion");
  assert.deepEqual(G.regrouperJalons([{ t: 0, id: "a" }, { t: 1e9, id: "b" }, { t: 1.05e9, id: "c" }], t => t / 1e9 * 20, 12).map(g => g.jalons.length), [1, 2]);
});

test("jalons : une seule étiquette flottante, celle du jalon le plus proche du réticule, avec plusieurs formes (de la plus longue à la plus courte)", () => {
  const M = M0(), { geo } = svgDe(M, "5", "carte");
  const gr = G.plusProcheGroupe(geo.groupes, geo.X(M.jalons[0].t), 24);
  assert.ok(gr && gr.jalons.some(j => j.id === "ev:emploi"));
  const t = G.etiquettesJalon(M, { x: 0, jalons: [M.jalons.find(j => j.id === "ev:emploi")] }).map(x => x.replace(/[  ]/g, " "));
  assert.ok(t.length >= 3 && t[0].length > t[t.length - 1].length);
  assert.match(t[0], /Nouvel emploi de Sam · déc\. 2026 · \+450 €\/mois/);
  const obj = G.etiquettesJalon(M, { x: 0, jalons: [M.jalons.find(j => j.id === "objectif:voiture")] });
  assert.match(obj[0], /Objectif Voiture 12 k€ : peu probable · 3 chances sur 10/, "objectif : mot ET probabilité");
  assert.equal(G.plusProcheGroupe(geo.groupes, -500, 24), null, "rien de proche : aucune étiquette");
  assert.match(G.etiquettesJalon(M, geo.groupes.find(g => g.jalons.length === 4))[0], / · \+3$/);
});

test("lecture : date, valeur, nature (observé, reconstitué, aujourd'hui, projeté avec P10–P90), existant, capacité du mois et événements de la date", () => {
  const M = M0(), F = M.futur;
  const passeR = G.lecture(M, null, M.passe.t[0]), passeO = G.lecture(M, null, M.passe.t[M.passe.t.length - 3]), auj = G.lecture(M, null, M.today), fut = G.lecture(M, null, F.t[26]);
  assert.equal(passeR.nature, "reconstitue"); assert.equal(passeO.nature, "observe"); assert.equal(auj.nature, "aujourdhui"); assert.equal(fut.nature, "projete");
  assert.equal(auj.valeur, M.valeurAuj);
  assert.ok(fut.p10 < fut.p25 && fut.p25 < fut.p50 && fut.p50 < fut.p75 && fut.p75 < fut.p90);
  assert.ok(fut.capacite && fut.capacite.montant > 0 && fut.capacite.raison);
  const emploi = G.lecture(M, null, F.t[2]);
  assert.deepEqual(emploi.jalons.map(j => j.id), ["ev:emploi"], "l'événement de ce mois");
  assert.equal(G.lecture(M, null, F.t[40]).jalons.length, 0);
  const txt = G.ligneLecture(M, null, emploi, false).replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
  assert.match(txt, /^Déc\. 2026 · ≈ \d+ k€ · \d+–\d+ k€ · Nouvel emploi de Sam$/);
  const html = G.lectureHtml(M, null, fut, { def: false }).replace(/[  ]/g, " ");
  assert.match(html, /projection/); assert.match(html, /1 chance sur 2/); assert.match(html, /sans nouveau versement/); assert.match(html, /\+ ton épargne future et tes projets/);
  assert.match(html, /Capacité d'épargne ce mois-là/);
  assert.match(G.lectureHtml(M, null, passeR, { def: false }), /Reconstitué à partir de tes cours/);
  assert.match(G.lectureHtml(M, null, passeO, { def: false }), /Relevé sur tes comptes/);
});

test("lecture : un objectif à sa date dit son verdict en mots et en couleur (jamais la couleur seule), avec « N chances sur 10 »", () => {
  const M = M0(), l = G.lecture(M, null, M.objectifs.find(o => o.id === "voiture").t);
  const h = G.lectureHtml(M, null, l, { def: false });
  assert.match(h, /<span class="gp-chip work">Peu probable<\/span>/);
  assert.match(h, /3 chances sur 10 d'atteindre la cible à l'échéance/);
  const sans = G.objectifLigne(M, { id: "x", nom: "Retraite", cible: 400000, t: ms("2058-01-01"), probabilite: null, statut: "hors_horizon" });
  assert.match(sans, /Au-delà de la projection|sans verdict/i); assert.match(sans, /aucune probabilité calculée/);
  assert.equal(G.motProba(0.8), "probable"); assert.equal(G.motProba(0.79), "incertain"); assert.equal(G.motProba(0.49), "peu probable"); assert.equal(G.motProba(null), null);
  assert.equal(G.chancesTxt(0.8), "8 chances sur 10"); assert.equal(G.chancesTxt(0.1), "1 chance sur 10"); assert.equal(G.chancesTxt(0.02), "moins de 1 chance sur 10");
});

test("en-tête : phrase de titre, décomposition, « Événements pris en compte », ou la question ; garde-fous ; source de l'épargne (jamais deux)", () => {
  const M = M0(), fin = M.futur.t[120];
  const phrase = G.phraseTitre(M, fin).replace(/[  ]/g, " ");
  assert.match(phrase, /^Aujourd'hui : 193 k€ · dans 10 ans : médiane \d+ k€ \(\d+ k€ à \d+ k€\), en euros d'aujourd'hui\.$/);
  assert.match(G.phraseTitre(Object.assign({}, M, { euros: "courants" }), fin), /, en euros de 2036\.$/);
  assert.match(G.phraseTitre(G.normaliser(Object.assign(donnees(), { couverture: 0.5 })), fin), /\(provisoire\)\.$/);
  const lec = G.lecture(M, null, fin), h = G.enteteHtml(M, lec).replace(/[  ]/g, " ");
  assert.match(h, /Dont \d+ k€ de ton patrimoine actuel et \d+ k€ de ton épargne future, après 20 k€ de frais\./);
  assert.match(h, /Événements pris en compte : Nouvel emploi de Sam, Naissance, Crèche, Achat de la résidence principale\./);
  assert.match(h, /data-gf="ecart_capacite"[^>]*>Ta capacité d&#39;épargne constatée est de 950 €/);
  assert.match(h, /Épargne mensuelle projetée : 950 € — ta capacité d&#39;épargne constatée \(avril à septembre 2026, comptes courants\)\./);
  assert.doesNotMatch(h, /prévue au budget \(pas encore/, "jamais deux sources à la fois");
  const vide = G.normaliser(donnees({ sansEvenement: true })), h2 = G.enteteHtml(vide, G.lecture(vide, null, vide.futur.t[60]));
  assert.match(h2, /gp-en-q[^>]*>Aucun événement renseigné — as-tu des changements prévus \?/);
  const prevu = Object.assign(donnees(), { capacite_source: "prevu" }); prevu.capacite.base.source = "prevu"; prevu.capacite.base.retenue = 1500;
  assert.match(G.capaciteSourceTxt(prevu).replace(/[  ]/g, " "), /1 500 € — ta capacité d'épargne prévue au budget \(pas encore de comptes connectés\)/);
  assert.match(G.capaciteSourceTxt({ capacite_source: null }), /Pas encore de capacité d'épargne connue : la projection suppose 0 € par mois/);
});

test("bande « capacité d'épargne » : une marche par période (sa raison, son montant), à partir d'aujourd'hui, le zéro marqué ; négative = alerte ET le mot", () => {
  const M = M0(), { geo } = svgDe(M, "10", "bureau", 1000);
  const b = G.construireBande(M, { dom: geo.dom }, geo, geo.P, true);
  assert.equal(b.marches.length, M.capacite.periodes.length - 1, "une marche entre deux périodes consécutives");
  assert.deepEqual(b.marches.map(m => Math.round(m.dv)), [450, -250, 210]);
  assert.ok(b.marches.every(m => m.raison.length > 5), "chaque marche porte sa raison");
  assert.match(b.svg, /<path class="gp-st-l"/); assert.match(b.svg, /class="gp-st-z"/, "ligne du zéro");
  assert.match(b.svg, />\+450<\/text>/); assert.match(b.svg, />\+210<\/text>/, "les montants des marches, sans se chevaucher (la marche voisine trop proche est omise)");
  const neg = donnees(); neg.capacite.par_periode[2].montant_mensuel = -300;
  const Mn = G.normaliser(neg), gn = svgDe(Mn, "10", "bureau", 1000).geo;
  assert.match(G.construireBande(Mn, { dom: gn.dom }, gn, gn.P, true).svg, /class="gp-tneg"[^>]*>négative<\/text>/);
  const sans = donnees(); sans.capacite = null;
  assert.equal(G.construireBande(G.normaliser(sans), { dom: geo.dom }, geo, geo.P, true).vide, true, "aucune capacité connue : pas de bande inventée");
});

test("mode capacité (IMMO1) : éventail du budget d'achat P10–P90, médiane, ligne du montant empruntable, bande de taux, phrase de titre, jalons", () => {
  const mois = Array.from({ length: 11 }, (_, k) => plusMois(AUJ, 12 * k));
  const d = { today: AUJ, mode: "capacite", vue: "financier", euros: "constants", etat: "pret", passe: null, jalons: [{ id: "credit:x", date: plusMois(AUJ, 20), titre: "Fin du prêt auto", type: "fin_credit", source: "credit", effet: { texte: "+210 €/mois", montants: {} } }],
    objectifs: [], capacite_demain: { mois, montant_empruntable: mois.map((_, k) => 200000 + k * 8000), mensualite_max: mois.map(() => 1500), apport: { p10: mois.map((_, k) => 30000 + k * 2000), p50: mois.map((_, k) => 55000 + k * 4000), p90: mois.map((_, k) => 80000 + k * 7000) },
      budget_achat: { p10: mois.map((_, k) => 250000 + k * 9000), p50: mois.map((_, k) => 310000 + k * 12000), p90: mois.map((_, k) => 370000 + k * 15000) },
      budget_achat_par_taux: { bas: mois.map((_, k) => 330000 + k * 13000), central: mois.map((_, k) => 310000 + k * 12000), haut: mois.map((_, k) => 290000 + k * 11000) }, taux: { central: 3.3, bas: 2.3, haut: 4.3 }, duree_ans: 25,
      serie_mensuelle: { mois: Array.from({ length: 121 }, (_, k) => plusMois(AUJ, k)), montant_empruntable: Array.from({ length: 121 }, (_, k) => 200000 + k * 670) } } };
  const M = G.normaliser(d);
  assert.equal(M.mode, "capacite"); assert.equal(M.passe.t.length, 0);
  const dom = G.domaine("10", { today: M.today, debutPasse: null, finFutur: M.finFutur, futurSeul: true });
  assert.equal(dom.debut, M.today);
  const { svg, geo } = svgDe(M, "10", "carte");
  assert.match(svg, /<path class="gp-emprunt"/, "ligne du montant empruntable"); assert.equal((svg.match(/class="gp-taux"/g) || []).length, 2, "bande de taux : deux lignes fines à ±1 point");
  assert.match(svg, /<path class="gp-med"/); assert.ok(geo.marqueurs.some(m => m.jalons[0].id === "credit:x"), "jalon de fin de prêt");
  const l = G.lecture(M, null, M.futur.t[3]);
  assert.match(G.phraseTitre(M, M.futur.t[3]).replace(/[  ]/g, " "), /^En 2029, budget d'achat médian 346 000 € avec 67 000 € d'apport \(9 chances sur 10 d'avoir au moins 36 000 €\)\.$/);
  assert.equal(l.demain.p50, 346000);
  assert.match(G.lectureHtml(M, null, l, { def: false }).replace(/[  ]/g, " "), /Montant empruntable : <b>224 000 €<\/b>/);
  assert.match(G.lectureHtml(M, null, l, { def: false }), /1 point plus bas/);
});

test("plan figé (Prévu vs réel) : plan P50 en tirets avec sa bande claire à partir de sa date, écart teinté et écrit ; avant sa date, il n'existait pas", () => {
  const M = M0(), t0 = ms(plusMois(AUJ, -9)), mois = Array.from({ length: 121 }, (_, k) => ms(plusMois(plusMois(AUJ, -9), k)));
  const plan = { id: "plan-1", cree: t0, raison: "revue_mensuelle", t: mois, p10: mois.map((_, k) => 150000 + k * 600), p25: mois.map((_, k) => 155000 + k * 700), p50: mois.map((_, k) => 160000 + k * 800), p75: mois.map((_, k) => 165000 + k * 900), p90: mois.map((_, k) => 170000 + k * 1000) };
  plan.valeurs = [].concat(plan.p10, plan.p90);
  const etat = { plan, euros: "courants" };
  const { svg } = svgDe(M, "5", "carte", 358, { couches: { plan } });
  assert.match(svg, /<path class="gp-plan-b" d="M/); assert.match(svg, /<path class="gp-plan-l" d="M/); assert.match(svg, /class="gp-gap-(neg|pos)" d="M/, "écart teinté");
  assert.match(svg, /class="[^"]*gp-t(neg|pos)"/, "l'écart est écrit (« −8 k€ »), pas seulement teinté");
  const l = G.lecture(M, etat, M.today);
  assert.ok(l.plan && l.plan.ecart != null && !l.plan.avant);
  assert.match(G.lectureHtml(M, etat, l, { def: false }).replace(/[  ]/g, " "), /<span>Prévu<\/span><b>[\d ]+ €<\/b>.*<span>Réel<\/span>.*<span>Écart<\/span>/);
  assert.equal(G.lecture(M, etat, ms(plusMois(AUJ, -20))).plan.avant, true, "avant la date du plan : il n'existait pas");
  const T = G.titreLecture(M, etat, l, true);
  assert.match(T.k, /^Écart avec le plan du /); assert.match(T.s.replace(/[  ]/g, " "), /(en dessous de|au-dessus de) ce qui était prévu à ce jour/);
  assert.equal(G.planA(plan, ms(plusMois(AUJ, -9))).p50, 160000); assert.equal(G.planA(plan, ms("2000-01-01")), null);
});

test("décomposition : patrimoine actuel + épargne future = la médiane affichée, à chaque point (parts arrondies comme elles s'écrivent)", () => {
  const M = M0(), F = M.futur;
  const val = t => Number(t.replace(/[^\d,]/g, "").replace(",", ".")) * (/M€/.test(t) ? 1e6 : 1000);
  let vus = 0;
  for (const i of [12, 24, 36, 50, 71, 90, 119]) {
    const l = G.lecture(M, null, F.t[i]);
    if (l.existant == null) continue;
    const ph = G.decompositionPhrase(M, l), m = ph.replace(/[  ]/g, " ").match(/^Dont ([\d, ]+ (?:k|M)€) de ton patrimoine actuel et ([\d, ]+ (?:k|M)€) de ton épargne future/);
    assert.ok(m, ph);
    assert.equal(Math.round(val(m[1]) + val(m[2])), Math.round(val(G.fK(l.p50).replace(/[  ]/g, " "))), "point " + i + " : " + ph + " / médiane " + G.fK(l.p50));
    vus++;
  }
  assert.ok(vus >= 3);
});

test("couverture faible : « provisoire » dit dans l'en-tête visible de la lecture, pas seulement dans la phrase lue ; rien quand la couverture est bonne", () => {
  const faible = G.normaliser(Object.assign(donnees(), { couverture: 0.4 })), bonne = G.normaliser(Object.assign(donnees(), { couverture: 0.9 }));
  const fin = ms(plusMois(AUJ, 60));
  const tf = G.titreLecture(faible, {}, G.lecture(faible, {}, fin), false), tb = G.titreLecture(bonne, {}, G.lecture(bonne, {}, fin), false);
  assert.match(tf.s, /provisoire/); assert.doesNotMatch(tb.s, /provisoire/);
});

test("tableau de données équivalent : une ligne par pas (date, nature, P10, P25, médiane, P75, P90, existant, variante, écart), puis les jalons avec leur effet", () => {
  const M = M0(), dom = G.domaine("5", CTX(M)), h = G.tableauHtml(M, dom, "mois", {});
  assert.match(h, /^<div class="gp-tab-wrap" tabindex="0" role="region" aria-label="Données du graphique"><table class="gp-tab"><caption class="ui-sr">/);
  assert.equal((h.match(/<th scope="col">/g) || []).length, 10);
  assert.match(h, /<td>reconstitué<\/td>/); assert.match(h, /<td>observé<\/td>/); assert.match(h, /<td>aujourd&#39;hui<\/td>/); assert.match(h, /<td>projeté<\/td>/);
  assert.match(h, /Jalons<\/th>/); assert.match(h, /Nouvel emploi de Sam — \+450 €\/mois d&#39;épargne/);
  assert.ok((h.match(/<tr data-t=/g) || []).length > 80, "une ligne par mois de la fenêtre");
  assert.equal(G.tableauHtml(G.normaliser({ today: AUJ }), { debut: ms("2000-01-01"), fin: ms("2001-01-01") }, "mois", {}), "", "rien à tabuler hors des données");
  const mauvais = donnees(); mauvais.jalons[0].titre = '<img src=x onerror="alert(1)">';
  assert.doesNotMatch(G.tableauHtml(G.normaliser(mauvais), dom, "mois", {}), /<img/);
});

test("« Comment c'est calculé » : méthode, passé reconstitué, base de l'épargne, hypothèses sourcées, ce qui manque, limites, graine et version ; échappé", () => {
  const M = M0(), h = G.calculHtml(M, { claude: (q, l) => '<a class="ui-claude">' + l + "</a>", tableau: "<table></table>" });
  for (const t of ["Projection, pas une promesse", "Méthode", "Reconstitution du passé", "Base de l'épargne", "Hypothèses", "Données utilisées et ce qui manque", "Limites", "2000 trajectoires", "graine fixe 20261014", "proj-1.0.0"]) assert.ok(h.includes(t), t);
  assert.match(h, /ETF Monde/); assert.match(h, /décalé de −1 500 €/);
  assert.match(h, /<a href="https:\/\/www\.ecb\.europa\.eu[^"]*" target="_blank" rel="noopener noreferrer">BCE<span class="ui-sr"> \(nouvel onglet\)<\/span><\/a>/);
  assert.match(h, /Inflation supposée : <strong>2 %<\/strong>/); assert.match(h, /vérifié le 25 sept\. 2026/);
  assert.match(h, /Prix de revient de « PER » : sans lui, l&#39;impôt à la sortie est sous-estimé <a class="ui-claude">Compléter avec Claude<\/a>/);
  assert.match(h, /Couverture des données : 80 %/);
  assert.match(h, /Rétro-contrôle<\/h3><p class="gp-sh-note">Pas encore assez d&#39;historique/, "sans rétro-contrôle : la raison honnête, jamais un chiffre");
  const r = donnees(); r.retro = { n: 30, phrase: "Sur 30 dates de départ passées, le patrimoine réel est resté 22 fois dans la bande 8 chances sur 10.", limites: ["Les périodes de 12 mois se chevauchent : c'est indicatif."], affichable: true }; r.avertissements = ["Prêt auto : assurance du crédit inconnue, supposée comprise dans la mensualité"];
  const hr = G.calculHtml(G.normaliser(r), {});
  assert.match(hr, /Sur 30 dates de départ passées/); assert.match(hr, /se chevauchent/);
  assert.match(hr, /Hypothèses prises par défaut<\/h3><ul class="gp-liste gp-av"><li>Prêt auto : assurance du crédit inconnue/, "un avertissement de donnée est une hypothèse, pas une alarme");
  assert.match(G.calculHtml(G.normaliser(Object.assign(donnees(), { retro_raison: "Aucune photo du patrimoine avec sa composition." })), {}), /Aucune photo du patrimoine avec sa composition\./);
  assert.match(h, /euros d'aujourd'hui/); assert.match(G.calculHtml(G.normaliser(Object.assign(donnees(), { euros: "courants" })), {}), /euros courants/);
  const hostile = donnees(); hostile.hypotheses[0].libelle = "<script>x</script>"; hostile.passe.drapeaux.viaTransactions = ["<b>y</b>"];
  assert.doesNotMatch(G.calculHtml(G.normaliser(hostile), {}), /<script>|<b>y<\/b>/);
  assert.match(G.calculHtml(G.normaliser(donnees({ sansPasse: true })), {}), /Méthode/);
});

test("jalon : détail (effet en €/mois, capacité avant → après, effet sur la médiane, effet immédiat de l'achat) ; objectif : verdict, cible, probabilité, leviers", () => {
  const M = M0();
  const emploi = G.jalonDetailHtml(M, M.jalons.find(j => j.id === "ev:emploi"), { impact: { montant: 38000, mois: 120 } }).replace(/[  ]/g, " ");
  assert.match(emploi, /Effet sur ta capacité d&#39;épargne<\/span><b>\+450 €\/mois<\/b>/); assert.match(emploi, /Effet sur la médiane dans 10 ans<\/span><b>≈ \+38 k€<\/b>/);
  assert.match(emploi, /Capacité avant → après<\/span><b>950 → 1 400 €\/mois/);
  assert.match(G.jalonDetailHtml(M, M.jalons.find(j => j.id === "ev:emploi"), { impact: "calcul" }), /data-impact>calcul en cours/);
  const achat = G.jalonDetailHtml(M, M.jalons.find(j => j.id === "ev:achat"), {}).replace(/[  ]/g, " ");
  assert.match(achat, /Effet immédiat sur le patrimoine net<\/span><b>−24 k€ \(frais d'acquisition\)/);
  const voiture = G.jalonDetailHtml(M, M.jalons.find(j => j.id === "objectif:voiture"), { claude: (q, l) => "<a>" + l + "</a>" }).replace(/[  ]/g, " ");
  assert.match(voiture, /Verdict<\/span><b><span class="gp-chip work">Peu probable/); assert.match(voiture, /Cible<\/span><b>12 000 € en sept\. 2028/); assert.match(voiture, /3 chances sur 10/);
  assert.match(voiture, /il manque 3 k€|il manque 3,0 k€/); assert.match(voiture, /<h4>Leviers<\/h4>.*\+140 €\/mois/);
  assert.match(G.jalonsListeHtml(M, G.domaine("1", CTX(M)), []), /hors fenêtre/);
  assert.equal((G.jalonsListeHtml(M, G.domaine("5", CTX(M)), []).match(/data-jdet=/g) || []).length, M.jalons.length);
  assert.match(G.groupeHtml(M, M.jalons.slice(0, 2), {}), /data-go="ev:emploi"/);
});

test("préréglages par écran : Aujourd'hui (net), Placements (financier, sans objectif), Objectifs (financier, jusqu'à l'échéance), capacité (futur seul)", () => {
  assert.equal(G.PRESETS.aujourdhui.vue, "net"); assert.equal(G.PRESETS.placements.vue, "financier"); assert.equal(G.PRESETS.placements.objectifs, "aucun");
  assert.equal(G.PRESETS.objectifs.vue, "financier"); assert.equal(G.PRESETS.capacite.mode, "capacite"); assert.equal(G.PRESETS.capacite.futurSeul, true);
  assert.deepEqual(G.PRESETS.aujourdhui.fenetre, { mobile: "5", bureau: "10" }, "5 ans sur mobile, 10 ans sur ordinateur");
  const M = M0();
  assert.equal(G.fenetreDefaut(G.PRESETS.aujourdhui, false, M), "5"); assert.equal(G.fenetreDefaut(G.PRESETS.aujourdhui, true, M), "10");
  assert.equal(G.fenetreDefaut(G.PRESETS.objectifs, false, M, "apport"), "5", "échéance dans 32 mois : au moins 5 ans");
  const loin = G.normaliser(Object.assign(donnees(), { objectifs: [{ id: "retraite", nom: "Retraite", cible: 4e5, date: plusMois(AUJ, 12 * 12), probabilite: 0.5 }] }));
  assert.equal(G.fenetreDefaut(G.PRESETS.objectifs, false, loin, "retraite"), "20");
});

test("plein écran : mise en page selon la fenêtre (ordinateur ≥ 1024 × 560, paysage si bas et large, sinon portrait) ; invitation : dense, première visite, jamais après fermeture", () => {
  assert.equal(G.modePleinEcran(1440, 900), "bureau"); assert.equal(G.modePleinEcran(1024, 560), "bureau"); assert.equal(G.modePleinEcran(844, 390), "paysage");
  assert.equal(G.modePleinEcran(390, 844), "portrait"); assert.equal(G.modePleinEcran(1000, 500), "paysage", "bas : paysage même large");
  assert.equal(G.invitationVisible(0, "5", false, false), true, "première visite"); assert.equal(G.invitationVisible(0, "5", true, false), false, "déjà vue, peu dense");
  assert.equal(G.invitationVisible(4, "5", true, false), true, "4 jalons ou plus"); assert.equal(G.invitationVisible(0, "10", true, false), true, "fenêtre de 10 ans ou plus");
  assert.equal(G.invitationVisible(9, "tout", false, true), false, "fermée : plus jamais");
});

test("dessin accessible : graduations dans la gouttière, aucun texte hors cadre de 320 à 400 px, tracé de 284 px", () => {
  const M = M0();
  for (const W of [320, 358, 400]) {
    const { svg, geo } = svgDe(M, "5", "carte", W);
    assert.ok(geo.R <= W - 40, "gouttière de montants à droite");
    for (const m of svg.matchAll(/<text[^>]* x="(-?[\d.]+)"[^>]*text-anchor="(\w+)"/g)) { const x = +m[1]; assert.ok(x >= -1 && x <= W + 1, W + " px : texte hors du cadre à x=" + x); }
    assert.equal(geo.plotH, 284);
  }
});

test("graphe-patrimoine.js : tutoiement, échappement, aucune écriture hors préférences d'interface ; feuille de style : jetons seulement, mouvement réduit, 44 px", () => {
  assert.doesNotMatch(src, /\b(vous|votre|vos)\b/i);
  assert.doesNotThrow(() => new vm.Script(src));
  const stockage = [...src.matchAll(/lsSet\(([^)]*)\)/g)].map(m => m[1]).filter(s => s !== "k, v");
  assert.ok(stockage.every(s => /CLES_LS\.invitation/.test(s)), "seules les clés d'invitation sont écrites (préférence d'interface, jamais un réglage de projection) : " + stockage.join(" ; "));
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /(?<!Array)\.from\(|supabase|\.insert\(|\.upsert\(|fetch\(/);
  const css = sansCommentaires(lire("web/src/graphe-patrimoine.css"));
  assert.doesNotMatch(css, /(?<![\w-])#[0-9a-fA-F]{3,8}\b/, "aucune couleur hexadécimale : jetons de theme.css");
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /\.gp-icon\{[^}]*width:var\(--hit\);height:var\(--hit\)/); assert.match(css, /\.gp-mk-b\{[^}]*height:44px/);
  assert.doesNotMatch(css, /font-size\s*:\s*\d+px|font\s*:[^;}]*\b\d+px/, "tailles de police : jetons --t-* seulement");
});
