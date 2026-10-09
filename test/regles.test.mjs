// Profil et données › Règles (web/src/regles.*) : règles d'alerte et cible du matelas, extraites du Pilotage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const js = read("web/src/regles.js"), html = read("web/src/regles.html"), css = read("web/src/regles.css");
const pilotageHtml = read("web/src/pilotage.html"), pilotageJs = read("web/src/pilotage.js");

const scopedSelectors = (src, prefix) => {
  const c = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  return sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(prefix));
};
const FORM_IDS = ["ruleForm", "rfType", "rfBloc", "rfPos", "rfEnv", "rfPct", "rfPrice", "rfCap", "rfDays", "rfBtn", "rfMsg", "ruleList", "ruleCount",
  "cushForm", "cuMode", "cuMin", "cuMax", "cuMonths", "cuDep", "cuBtn", "cuMsg"];

test("règles : s'enregistre et écrit config.rules / config.cushion via Store.db", () => {
  assert.match(js, /App\.register\("regles",api\)/);
  assert.match(js, /db:window\.Store\.db/);
  assert.equal((js.match(/S\.db\.doc\("config\/main"\)\.update\(\{rules\}\)/g) || []).length, 2, "ajout et suppression");
  assert.match(js, /S\.db\.doc\("config\/main"\)\.update\(\{cushion\}\)/);
  assert.match(js, /window\.Rules\.normalize\(raw\)/);
  assert.match(js, /R\.describe\(r,ruleCtx\(\)\)/);
  assert.match(js, /function headline\(\)\{ const n=rulesOf\(\)\.length; return n\?n\+" règle"\+\(n>1\?"s":""\):"Aucune règle"; \}/);
});

test("règles : formulaires présents ici, et plus dans le Bilan › Placements", () => {
  for (const id of FORM_IDS) {
    assert.match(html, new RegExp(`id="${id}"`), id + " absent de regles.html");
    assert.doesNotMatch(pilotageHtml, new RegExp(`id="${id}"`), id + " encore dans pilotage.html");
  }
  assert.ok(html.includes("Ces règles alimentent vos alertes dans "), "phrase d'introduction");
  assert.match(html, /data-goto="recos\/actions"/);
  assert.doesNotMatch(pilotageJs, /config\/main"\)\.update\(\{(rules|cushion)\}\)/);
});

test("règles : CSS entièrement scopé sous #view-regles", () => {
  assert.deepEqual(scopedSelectors(css, "#view-regles"), []);
});
