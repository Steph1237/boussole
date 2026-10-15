// SEC5 : resolve-symbol n'appelle pas Yahoo quand BOUSSOLE_HORS_LIGNE=1 (préproduction locale) ; sans la variable, il l'appelle comme avant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import vm from "node:vm";

const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const source = readFileSync(new URL("../supabase/functions/resolve-symbol/index.ts", import.meta.url), "utf8");

function monter(env) {
  const appels = [], servis = [];
  const fetchFactice = async (url) => { appels.push(String(url)); return new Response(JSON.stringify({ quotes: [{ symbol: "CW8.PA", shortname: "Fonds", exchange: "PAR" }] }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  const G = { Response, Request, Headers, URL, JSON, Promise, Object, Array, Set, RegExp, String, Number, encodeURIComponent, console, fetch: fetchFactice, Deno: { env: { get: k => env[k] }, serve: f => servis.push(f) } };
  vm.runInNewContext(strip(source, { mode: "strip" }), G);
  const appeler = (isin) => servis[0](new Request("http://kong:8000/functions/v1/resolve-symbol", { method: "POST", body: JSON.stringify({ isin }) }));
  return { appels, appeler };
}

test("resolve-symbol hors ligne : 502, aucun appel externe", { skip: SANS_STRIP }, async () => {
  const m = monter({ BOUSSOLE_HORS_LIGNE: "1" });
  const r = await m.appeler("ZZ0000000011");
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: "source indisponible" });
  assert.deepEqual(m.appels, []);
});

test("resolve-symbol hors ligne : un ISIN invalide reste un 400", { skip: SANS_STRIP }, async () => {
  const m = monter({ BOUSSOLE_HORS_LIGNE: "1" });
  assert.equal((await m.appeler("pas un isin")).status, 400);
  assert.deepEqual(m.appels, []);
});

test("resolve-symbol sans la variable : Yahoo interrogé, comportement inchangé", { skip: SANS_STRIP }, async () => {
  for (const env of [{}, { BOUSSOLE_HORS_LIGNE: "0" }, { BOUSSOLE_HORS_LIGNE: "" }]) {
    const m = monter(env);
    const r = await m.appeler("IE00B4L5Y983");
    assert.equal(r.status, 200, JSON.stringify(env));
    assert.equal(m.appels.length, 1);
    assert.match(m.appels[0], /^https:\/\/query2\.finance\.yahoo\.com\/v1\/finance\/search\?q=IE00B4L5Y983/);
  }
});
