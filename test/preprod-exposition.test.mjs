import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portsDePreproduction, EXCLUS } from "../scripts/preprod/demarrer.mjs";
import { parserLsof, ecouteLarge, avertissement } from "../scripts/preprod/exposition.mjs";

const LSOF = `COMMAND   PID     USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
ssh     14063 stephane   11u  IPv4 0x6c4ca93daf3b4d10      0t0  TCP *:54521 (LISTEN)
ssh     14063 stephane   20u  IPv4 0x9161fec671a3bcea      0t0  TCP 127.0.0.1:54522 (LISTEN)
node    20000 stephane   20u  IPv6 0x9161fec671a3bcea      0t0  TCP [::1]:8780 (LISTEN)
node    20001 stephane   20u  IPv6 0x9161fec671a3bcea      0t0  TCP *:3000 (LISTEN)`;

describe("exposition réseau", () => {
  it("analyse lsof", () => {
    const e = parserLsof(LSOF);
    assert.equal(e.length, 4);
    assert.deepEqual(e[0], { processus: "ssh", adresse: "*", port: 54521 });
    assert.deepEqual(e[2], { processus: "node", adresse: "[::1]", port: 8780 });
  });
  it("repère l'écoute large des seuls ports demandés", () => {
    const l = ecouteLarge(parserLsof(LSOF), [54521, 54522, 8780]);
    assert.deepEqual(l.map(e => e.port), [54521]);
  });
  it("avertissement en français, vide quand tout est local", () => {
    assert.equal(avertissement([]), "");
    const a = avertissement(ecouteLarge(parserLsof(LSOF), [54521]));
    assert.match(a, /54521/);
    assert.match(a, /preprod:stop/);
  });
});

describe("démarrage", () => {
  it("ports de préproduction : 545xx, hors des ports par défaut du CLI", () => {
    const p = portsDePreproduction();
    assert.ok(p.includes(54521) && p.includes(54522));
    assert.ok(p.every(n => n >= 54500 && n < 54600), p.join(","));
  });
  it("services exclus : noms de conteneurs du CLI 2.107.0", () => {
    for (const n of ["logflare", "vector", "imgproxy", "mailpit"]) assert.ok(EXCLUS.split(",").includes(n));
  });
});
