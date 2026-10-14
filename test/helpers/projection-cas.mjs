// Cas de référence du moteur de projection (test/fixtures/projection-cas.json) : chargement, repères complets, entrée du moteur.
// La fixture ne contient que les repères NOUVEAUX de la migration 0030 : les repères antérieurs (taux des livrets, prélèvements sociaux,
// durées du calendrier, HCSF, abattements de l'assurance-vie…) sont lus dans les migrations 0010 et 0029, comme la base les porte.
// Données fictives uniquement.
import { readFileSync } from "node:fs";

export const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/projection-cas.json", import.meta.url), "utf8"));
const lire = nom => readFileSync(new URL("../../supabase/migrations/" + nom, import.meta.url), "utf8");

/** Valeurs SQL d'une ligne « ('a', 'b''c', 12.5, null, ...) » → tableau JS. */
function champs(ligne) {
  const out = [];
  let i = ligne.indexOf("(") + 1;
  const n = ligne.length;
  while (i < n) {
    while (ligne[i] === " ") i++;
    if (ligne[i] === "'") {
      let s = "";
      i++;
      for (; i < n; i++) {
        if (ligne[i] === "'") { if (ligne[i + 1] === "'") { s += "'"; i++; } else { i++; break; } } else s += ligne[i];
      }
      out.push(s);
    } else {
      let j = i;
      while (j < n && ligne[j] !== "," && ligne[j] !== ")") j++;
      const t = ligne.slice(i, j).trim();
      out.push(t === "null" ? null : isFinite(+t) ? +t : t);
      i = j;
    }
    while (ligne[i] === " ") i++;
    if (ligne[i] === ",") i++; else break;
  }
  return out;
}

/** Repères insérés par une migration (blocs « insert into public.reperes (…) values … »), forme de l'app. */
export function reperesDeMigration(nom) {
  const sql = lire(nom), out = new Map();
  const re = /insert into public\.reperes \(([^)]*)\) values([\s\S]*?)on conflict/g;
  let m;
  while ((m = re.exec(sql))) {
    const cols = m[1].split(",").map(s => s.trim());
    for (const ligne of m[2].split("\n")) {
      if (!/^\s*\('/.test(ligne)) continue;
      const v = champs(ligne), o = Object.fromEntries(cols.map((c, k) => [c, v[k]]));
      out.set(o.cle, { cle: o.cle, libelle: o.libelle, valeur: +o.valeur, unite: o.unite, dateEffet: o.date_effet || null, dateFin: o.date_fin || null,
        sourceTitre: o.source_titre, sourceUrl: o.source_url, verifieLe: o.verifie_le });
    }
  }
  return out;
}

let cache = null;
/** Repères complets des cas : migrations 0010 et 0029 (repères antérieurs), puis ceux de la fixture (qui l'emportent). */
export function reperesComplets() {
  if (!cache) {
    const m = new Map([...reperesDeMigration("0010_savoir_reperes.sql"), ...reperesDeMigration("0029_calendrier.sql")]);
    for (const r of FIXTURE.reperes) m.set(r.cle, { cle: r.cle, libelle: r.libelle, valeur: r.valeur, unite: r.unite, dateEffet: r.dateEffet, dateFin: r.dateFin,
      sourceTitre: r.sourceTitre, sourceUrl: r.sourceUrl, verifieLe: r.verifieLe });
    cache = [...m.values()];
  }
  return JSON.parse(JSON.stringify(cache));
}

export const cas = id => FIXTURE.cas.find(c => c.id === id);

/** Entrée du moteur pour un cas : data du cas + repères complets (moins `ctx.reperes_retirer`, avec `reperes_remplacer`). */
export function entreeDe(c) {
  const d = JSON.parse(JSON.stringify(c.data || {}));
  let reperes = d.reperes || reperesComplets();
  for (const r of c.reperes_remplacer || []) reperes = reperes.map(x => (x.cle === r.cle ? { ...x, valeur: r.valeur } : x));
  const retirer = (c.options && c.options.ctx && c.options.ctx.reperes_retirer) || c.reperes_retirer || [];
  if (retirer.length) reperes = reperes.filter(r => !retirer.includes(r.cle));
  d.reperes = reperes;
  return d;
}

/** Options du moteur pour un cas (clés propres au cas retirées). */
export function optionsDe(c) {
  const o = JSON.parse(JSON.stringify(c.options || {}));
  return o;
}
