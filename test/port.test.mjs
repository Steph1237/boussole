// Non-régression des portages : les moteurs de calcul de la Toise et du Simulateur doivent être
// recopiés à l'identique (ligne par ligne, espaces de début ignorés). Toute divergence = calcul modifié.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const lines = (file, a, b) => readFileSync(file, "utf8").split("\n").slice(a - 1, b).map(l => l.trim()).filter(Boolean);
const norm = file => readFileSync(file, "utf8").split("\n").map(l => l.trim()).filter(Boolean).join("\n");
const BLOCKS = [
  ["toise", "sources/toise.html", 718, 946],
  ["simu", "sources/simu.html", 725, 780],
  ["simu", "sources/simu.html", 782, 838], // 781 = le sélecteur $ global, volontairement remplacé
  ["simu", "sources/simu.html", 878, 1030],
];

for (const [mod, src, a, b] of BLOCKS) {
  test(`${mod} : moteur ${src}:${a}-${b} recopié à l'identique`, () => {
    const out = `web/src/${mod}.js`;
    assert.ok(existsSync(out), `${out} absent`);
    const block = lines(src, a, b).join("\n");
    assert.ok(norm(out).includes(block), `le bloc ${a}-${b} de ${src} a été modifié dans ${out}`);
  });
}

for (const mod of ["toise", "simu"]) {
  test(`${mod} : aucune requête DOM globale hors racine du module`, () => {
    const js = readFileSync(`web/src/${mod}.js`, "utf8");
    const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
    assert.deepEqual(bad, [], "utiliser root.querySelector* au lieu de document.*");
  });
  test(`${mod} : s'enregistre auprès de l'App`, () => {
    assert.match(readFileSync(`web/src/${mod}.js`, "utf8"), new RegExp(`App\\.register\\(["']${mod}["']`));
  });
  test(`${mod} : CSS entièrement scopé sous #view-${mod}`, () => {
    const css = readFileSync(`web/src/${mod}.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const sels = [...css.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d+%)$/.test(s));
    const unscoped = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith(`#view-${mod}`));
    assert.deepEqual(unscoped, []);
  });
}
