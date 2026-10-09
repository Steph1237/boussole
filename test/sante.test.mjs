// Score de santé financière : vue Diagnostic › Santé (web/src/sante.*) et port TypeScript du score
// dans le connecteur MCP (supabase/functions/mcp/index.ts). Contrôles statiques + calcul sur la démo.
// Le Bilan › Placements (pilotage) ne porte plus ni la carte santé ni les alertes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const path = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
const read = rel => readFileSync(path(rel), "utf8");
const sansCommentaires = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const compact = s => s.replace(/\s+/g, "");

const js = read("web/src/sante.js"), html = read("web/src/sante.html"), css = read("web/src/sante.css");
const pilotageJs = sansCommentaires(read("web/src/pilotage.js")), pilotageHtml = read("web/src/pilotage.html");
const planJs = sansCommentaires(read("web/src/plan.js")), mcp = sansCommentaires(read("supabase/functions/mcp/index.ts"));

const scopedSelectors = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};

test("santé : la vue calcule le score avec Plan.score, dans le périmètre courant, et s'enregistre", () => {
  assert.match(js, /window\.Plan\.score\(\{[^}]*positions:S\.positions[^}]*profil:S\.profil[^}]*config:S\.config[^}]*budget:S\.budget[^}]*scope:S\.scope/);
  assert.match(js, /if\(!window\.Plan\|\|typeof window\.Plan\.score!=="function"\) return null;/, "sans plan.js : pas de score, pas d'erreur");
  assert.match(js, /scope:snap\.scope/);
  assert.match(js, /profil:snap\.profil/);
  assert.match(js, /budget:snap\.budget/);
  assert.match(js, /last=calcule\(\)/, "recalculé à chaque mise à jour du store");
  assert.match(js, /App\.register\("sante",api\)/);
});

test("santé : verdicts (80 / 60), jauges sur 20 et liens vers les vues à compléter", () => {
  assert.match(js, /sc\.total>=80\?"Solide"/);
  assert.match(js, /sc\.total>=60\?"Correct, "/);
  assert.match(js, /"À consolider"/);
  assert.match(js, /i\.points>=16\?"good":i\.points>=10\?"warn":"crit"/);
  assert.match(js, /matelas:"avenir\/plan",epargne:"avenir\/plan",endettement:"profil\/donnees",patrimoine:"profil\/donnees"/);
  assert.match(js, /data-goto="\$\{lien\}"/);
  assert.match(js, /"Score calculé sur "/);
  assert.match(js, /esc\(i\.piste\)/, "piste toujours affichée");
  assert.doesNotMatch(js, /data-goto-tab/);
});

test("santé : chiffre clé « 94/100 », mention permanente et explication du calcul", () => {
  assert.match(js, /function headline\(\)\{ return last&&last\.items\.some\(i=>!i\.aCompleter\)\?last\.total\+"\/100":"–"; \}/);
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement."));
  assert.match(html, /<details[^>]*>\s*<summary>Comment ce score est calculé<\/summary>/);
  // Paliers de l'explication = barèmes de plan.js.
  for (const b of ["[[1, 5], [3, 15]]", "[[6, 20], [12, 15]]", "[[0, 0], [5, 6], [10, 12], [15, 16], [20, 20]]", "[[25, 20], [35, 12], [45, 0]]", "[[10, 20], [20, 14], [40, 0]]"])
    assert.ok(compact(planJs).includes(compact(b)), `plan.js : barème ${b} absent`);
  for (const t of ["de 1 à 3 mois : de 5 à 15 points", "de 3 à 6 mois : 20 points", "jusqu'à 15 points à 12 mois",
    "0 % : 0 point ; 5 % : 6 ; 10 % : 12 ; 15 % : 16 ; 20 % ou plus : 20", "25 % ou moins : 20 points ; 35 %", "45 % ou plus : 0",
    "10 % ou moins : 20 points ; 20 % : 14 ; 40 % ou plus : 0", "Moins de 3 poches différentes : 5 points de moins", "Au-dessus de 80", "à partir de 16 points"])
    assert.ok(html.includes(t), `sante.html : « ${t} » absent`);
  assert.match(js, /window\.Plan&&window\.Plan\.REPERES_AGE/, "repères d'âge lus dans plan.js");
});

test("santé : CSS entièrement scopé sous #view-sante", () => {
  assert.deepEqual(scopedSelectors(css, "#view-sante"), []);
});

test("pilotage (Bilan › Placements) : plus de carte santé, d'alertes ni de règles", () => {
  assert.doesNotMatch(pilotageJs, /Plan\.score/);
  assert.doesNotMatch(pilotageJs, /Rules\.evaluate/);
  assert.doesNotMatch(pilotageJs, /Rules\.builtins/);
  assert.doesNotMatch(pilotageHtml, /id="sante"|id="alerts"|id="ruleForm"|id="cushForm"/);
  assert.match(pilotageJs, /function headline\(\)\{ return S\.positions\.length\?eur\(/, "le chiffre clé reste le total financier");
});

test("pilotage : courbe d'évolution filtrée par période et par pas (periodes.js), choix mémorisés", () => {
  assert.match(pilotageJs, /const P=window\.Periodes/);
  assert.match(pilotageJs, /P\.agreger\(pts,b,g,p=>p\.v\)/);
  assert.match(pilotageJs, /P\.resume\(ag,pts,b,p=>p\.v\)/);
  assert.match(pilotageJs, /P\.bornes\(/);
  assert.match(pilotageJs, /P\.auto\(b\)/);
  assert.match(pilotageJs, /const EVO_KEY="pilotage-evo"/);
  assert.match(pilotageJs, /serie\[serie\.length-1\]\.live=true/, "la valeur en direct reste le dernier point");
  assert.match(pilotageJs, /sur la période/);
  for (const id of ["evoCtl", "evoPer", "evoPerso", "evoDu", "evoAu", "evoGran", "evoRes"]) assert.match(pilotageHtml, new RegExp(`id="${id}"`), id);
  assert.match(pilotageHtml, /<input type="date" id="evoDu">/);
  assert.match(pilotageHtml, /<input type="date" id="evoAu">/);
});

test("pilotage : CSS entièrement scopé sous #view-pilotage", () => {
  assert.deepEqual(scopedSelectors(read("web/src/pilotage.css"), "#view-pilotage"), []);
});

test("parité plan.js / MCP : mêmes barèmes d'interpolation, dans le même ordre", () => {
  const baremes = src => [...src.matchAll(/interp\([^,]+,\s*(\[\[[^\n]*?\]\])\)/g)].map(m => compact(m[1]));
  const a = baremes(planJs), b = baremes(mcp);
  assert.equal(a.length, 5, "plan.js : 5 barèmes attendus (matelas ×2, épargne, endettement, concentration)");
  assert.deepEqual(b, a);
});

test("parité plan.js / MCP : seuils et repères identiques", () => {
  const SEUILS = [
    "mois < 1 ? 0", "mois <= 6 ? 20", "mois <= 12 ?",                 // matelas : 1, 3, 6, 12 mois
    "t >= 0.15 ?",                                                     // épargne : 0 / 5 / 10 / 15 / 20 %
    "t <= 0.35 ?",                                                     // endettement : 25 / 35 / 45 %
    "nb < 3 ? 5 : 0", "max <= 0.2 && nb >= 3",                         // concentration : 10 / 20 / 40 %, 3 poches
    "{ u30: 0.5, a30: 1, a40: 3, a50: 6, a60: 8, a70: 10 }",           // patrimoine : repères par âge
    "clamp(annees / repere, 0, 1) * 20",
    "Math.round(sum(complets, (i) => i.points) / (20 * complets.length) * 100)",
    "versementAlloue >= 1.1 * effort - EPS", "versementAlloue >= 0.95 * effort - EPS", // statut des objectifs
    "Math.max(0, (c - d * f) * r / (f - 1))",                          // effort mensuel (annuité)
    "Math.pow(1 + n(tauxAnnuel) / 100, 1 / 12) - 1",
  ];
  const norm = s => compact(s).replace(/\(i\)=>/g, "i=>").replace(/num\(/g, "n(");
  for (const s of SEUILS) {
    assert.ok(norm(planJs).includes(norm(s)), `plan.js : « ${s} » absent`);
    assert.ok(norm(mcp).includes(norm(s)), `index.ts : « ${s} » absent`);
  }
});

test("score sur la démo : complet, cinq critères sur 20, total cohérent", () => {
  global.window = global.window || {};
  require("../web/src/demo-data.js");
  const Plan = require("../web/src/plan.js");
  const D = global.window.DEMO;
  for (const scope of ["foyer", "p1", "p2"]) {
    const r = Plan.score({ positions: D.positions, profil: D.profil, config: D.config, budget: D.budget, scope, today: new Date("2026-10-09T12:00:00") });
    assert.equal(r.items.length, 5);
    assert.ok(r.items.every(i => i.sur === 20 && i.points >= 0 && i.points <= 20 && i.titre && i.texte && i.piste));
    assert.ok(r.total >= 0 && r.total <= 100);
    if (scope === "foyer") { assert.equal(r.complet, true); assert.ok(r.total >= 80, `démo foyer : ${r.total}`); }
  }
});
