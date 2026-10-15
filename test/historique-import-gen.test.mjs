// HIS2, tâche 4 : la copie générée du module d'import (supabase/functions/mcp/historique-import.gen.js) est à jour et donne, sur tous les cas de la
// fixture, exactement les mêmes sorties que le module de l'app (web/src/historique-import.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { genererHistoriqueImport, SORTIE_HISTORIQUE_IMPORT } from "../scripts/gen-catalogue.mjs";
import { parFonction, resoudre, contexteDe, HistoriqueImport as App } from "./helpers/his2.mjs";

const src = readFileSync(new URL("../" + SORTIE_HISTORIQUE_IMPORT, import.meta.url), "utf8");
export function chargerHistoriqueImportGen(code = src) {
  const js = code.replace(/^export const (\w+) = /gm, "const $1 = ");
  const noms = [...code.matchAll(/^export const (\w+) = /gm)].map(m => m[1]);
  return vm.runInThisContext(`(function(){ ${js}\n;return { ${noms.join(", ")} }; })()`).HistoriqueImport;
}

test("historique-import.gen.js est à jour (npm run gen)", () => {
  assert.equal(src, genererHistoriqueImport(), "historique-import.gen.js périmé : lancer npm run gen");
});

test("parité : la copie du connecteur et le module de l'app donnent les mêmes sorties sur tous les cas d'import", async () => {
  const Gen = chargerHistoriqueImportGen();
  assert.deepEqual(Object.keys(Gen).sort(), Object.keys(App).sort(), "mêmes exports");
  assert.deepEqual(JSON.parse(JSON.stringify(Gen.LIMITES)), JSON.parse(JSON.stringify(App.LIMITES)));
  let n = 0;
  for (const c of [...parFonction("controler"), ...parFonction("empreinte"), ...parFonction("clesNaturelles"), ...parFonction("doublons")]) {
    const ctx = contexteDe(c), e = resoudre(c.entree);
    const a = App.verifier(c.type, e, ctx), g = Gen.verifier(c.type, e, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), JSON.parse(JSON.stringify(a)), c.id + " : verifier");
    if (!a.bloquants.length) {
      const extras = { empreinte: a.empreinte, resume: a.resume, avertissements: a.avertissements, doublons: a.doublons, today: c.today };
      assert.deepEqual(JSON.parse(JSON.stringify(Gen.versApres(c.type, g.contenu, extras))), JSON.parse(JSON.stringify(App.versApres(c.type, a.contenu, extras))), c.id + " : versApres");
      assert.equal(await Gen.empreinte(c.type, g.contenu), a.empreinte, c.id + " : empreinte");
    }
    n++;
  }
  assert.ok(n > 70, n + " cas parcourus");
});
