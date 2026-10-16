// Non-régression du moteur PROJ (SCN1 tâche 7) : empreintes des sorties de proj-1.2.0 sur les cas de test/fixtures/projection-cas.json (déterministe et Monte-Carlo
// à 200 chemins) et sur une variante sans enveloppe_scenario. Les empreintes de test/fixtures/proj-nonreg-1.2.0.json ont été relevées avant la modification du moteur :
// la version proj-1.4.0 doit les retrouver à l'identique (seul version_modele change, et il n'est pas dans l'empreinte).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { FIXTURE, entreeDe } from "./projection-cas.mjs";
const req = createRequire(import.meta.url);

const arrondi = (v) => {
  if (v == null) return v;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : String(v);
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v, arrondi);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, arrondi(v[k])]));
  return String(v);
};
export const empreinte = x => createHash("sha256").update(JSON.stringify(arrondi(x))).digest("hex").slice(0, 16);
/** Sorties comparables d'un résultat de simulation : tout sauf la version du modèle et les clés d'identité de session. */
export function sorties(r) {
  const c = { ...r }; delete c.version_modele;
  // proj-1.4.0 (BUD1) : la base de l'épargne dit d'où vient le budget prévu ; la fixture de 1.2.0 n'a pas ces deux champs d'affichage
  if (c.capacite_base && typeof c.capacite_base === "object") { c.capacite_base = { ...c.capacite_base }; delete c.capacite_base.prevue_source; delete c.capacite_base.prevue_libelle; }
  return c;
}
/** { cas: empreinte } pour tous les cas de la fixture que le moteur sait préparer et simuler. */
export function empreintes() {
  const P = req("../../web/src/projection.js"), out = {};
  for (const c of FIXTURE.cas) {
    if (!c.data || typeof c.data !== "object" || !c.options || !c.options.horizon_ans) continue;
    for (const mode of ["det", "mc"]) {
      try {
        const opts = { ...c.options }; delete opts.volatilite;
        const M = P.preparer(entreeDe(c), opts);
        const r = P.simuler(M, mode === "det" ? { volatilite: 0 } : { chemins: 200, graine: 20261014 });
        out[c.id + ":" + mode] = empreinte(sorties(r));
      } catch (e) { out[c.id + ":" + mode] = "erreur:" + String(e.message).slice(0, 60); }
    }
  }
  return out;
}
