// Monte Pilotage › Scénarios (web/src/scenarios-view.*) dans le mini-DOM, avec les modules purs du calcul, sans Web Worker (repli sur le fil
// principal, window.ScenariosCalcul) ; données de la démo (Camille et Sam). Partagé par test/scenarios-view.test.mjs.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { miniDom } from "./mini-dom.mjs";

const src = f => readFileSync(new URL("../../web/src/" + f, import.meta.url), "utf8");
const MODULES = ["format.js", "ui.js", "claude-prompts.js", "calc.js", "reperes.js", "calendrier.js", "plan.js", "marche.js", "projection-outils.js", "projection-fiscalite.js",
  "projection-evenements.js", "projection-credit.js", "projection-donnees.js", "projection.js", "projection-immo.js", "scenarios.js", "scenarios-worker.js", "scenarios-catalogue.gen.js", "scenarios-view.js"];
const CODE = Object.fromEntries(MODULES.map(f => [f, src(f)]));
export const HTML = src("scenarios-view.html");
const J = v => JSON.parse(JSON.stringify(v));

/** État du store de la démo (S) : données de demo-data.js, catalogue embarqué, repères des scénarios ajoutés, comme store-demo.js. */
export function etatDemo(o = {}) {
  const ctx = { console };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("demo-data.js"), ctx);
  vm.runInContext(CODE["scenarios-catalogue.gen.js"], ctx);
  const D = J(ctx.DEMO), CAT = J(ctx.ScenariosCatalogue);
  const deja = new Set(D.savoir.reperes.map(r => r.cle)), lus = new Set(CAT.reperes_scenarios);
  const reperes = D.savoir.reperes.concat(CAT.reperes.filter(r => lus.has(r.cle) && !deja.has(r.cle)));
  return Object.assign(D, { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null,
    savoir: { fiches: [], reperes }, scenarios: { catalogue: CAT.catalogue, joues: D.scenariosJoues, source: "demo", lu: true, mfaRequise: false } }, o);
}

/** Monte la vue. o = { largeur, parametres, today }. → { ctx, dom, doc, root, api, lien(params), largeur(w), attendre() }. */
export function monter(S0, o = {}) {
  const dom = miniDom(), { doc } = dom;
  let params = o.parametres || {}, S = J(S0);
  const modules = {}, aller = [];
  const ctx = { document: doc, console, setTimeout, clearTimeout, innerWidth: o.largeur || 390, navigator: {} };
  ctx.window = ctx; ctx.self = ctx;
  ctx.addEventListener = () => {}; ctx.removeEventListener = () => {};
  ctx.RoutineEtat = { aujParis: () => o.today || "2026-10-26" };
  ctx.App = { register: (n, api) => { modules[n] = api; }, parametres: () => { const p = params; params = {}; return p; }, go: r => aller.push(r) };
  vm.createContext(ctx);
  for (const f of MODULES) vm.runInContext(CODE[f], ctx, { filename: f });
  const sec = doc.body.appendChild(doc.createElement("section"));
  sec.setAttribute("id", "view-scenarios-view");
  sec.innerHTML = HTML + '<div class="scn-outil" data-scn-outil hidden><p><a class="scn-retour" href="#pilotage/scenarios" data-scn-outil-retour>Tous les scénarios</a></p><div id="view-simu"></div></div>';
  const api = modules["scenarios-view"];
  api.mount(sec);
  api.update(S, true);
  return {
    ctx, dom, doc, root: sec, api, aller,
    lien(p) { params = p; api.show(); },
    largeur(w) { ctx.innerWidth = w; api.update(S, true); },
    maj(S1) { S = J(S1); api.update(S, true); },
  };
}
/** Laisse passer les calculs différés (fil principal, une étape par tâche). */
export async function attendre(n = 12) { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); }
