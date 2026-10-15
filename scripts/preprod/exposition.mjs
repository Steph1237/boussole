// Interfaces sur lesquelles la pile locale écoute (SEC5, spec § 3.10). Docker (par colima) publie les ports de la pile sur
// TOUTES les interfaces (`*`), donc le réseau local atteint Postgres, l'API et Studio, qui n'ont qu'une authentification par
// clés par défaut, publiques. Ce module repère l'écoute large pour que le démarrage l'affiche en clair.
import { spawnSync } from "node:child_process";

/** Analyse la sortie de `lsof -iTCP -sTCP:LISTEN -n -P` : [{ processus, adresse, port }]. */
export function parserLsof(texte) {
  const out = [];
  for (const l of String(texte).split("\n")) {
    const m = l.match(/^(\S+)\s+\d+\s+\S+\s+.*\bTCP\s+(\*|\[[^\]]*\]|[0-9.]+):(\d+)\s+\(LISTEN\)/);
    if (m) out.push({ processus: m[1], adresse: m[2], port: Number(m[3]) });
  }
  return out;
}

const LOCAL = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** Parmi les écoutes, celles des `ports` demandés qui ne sont pas limitées au bouclage. */
export function ecouteLarge(ecoutes, ports) {
  const p = new Set(ports);
  return ecoutes.filter(e => p.has(e.port) && !LOCAL.has(e.adresse));
}

export function avertissement(larges) {
  if (!larges.length) return "";
  const ports = [...new Set(larges.map(e => e.port))].sort((a, b) => a - b).join(", ");
  return [
    `ATTENTION : les ports ${ports} de la préproduction écoutent sur toutes les interfaces (réseau local compris).`,
    "  Les clés et le secret JWT de la pile locale sont publics : quiconque joint ces ports peut lire et écrire dans la base fictive.",
    "  Règles : réseau de confiance seulement, pare-feu macOS activé si possible, aucune donnée réelle, et `npm run preprod:stop` après usage.",
  ].join("\n");
}

/** Mesure en direct (macOS/Linux, lsof). Renvoie un texte d'avertissement, vide si tout est local ou si lsof est indisponible. */
export function verifierExposition(ports) {
  const r = spawnSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P"], { encoding: "utf8" });
  if (r.error || r.status !== 0 && !r.stdout) return "";
  return avertissement(ecouteLarge(parserLsof(r.stdout), ports));
}
