// Analyse TOML minimale (SEC5) : sections [a.b] et lignes « clé = valeur » sur une ligne, de quoi comparer et lire les config.toml du CLI.
/** Aplatit un TOML simple en { "section.clé": "valeur brute" } (commentaires et lignes vides ignorés). */
export function aplatir(src) {
  const out = {};
  let section = "";
  src.split("\n").forEach((brut, i) => {
    const l = brut.trim();
    if (!l || l.startsWith("#")) return;
    const sec = l.match(/^\[([^\]]+)\]$/);
    if (sec) { section = sec[1]; return; }
    const kv = l.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) throw new Error(`TOML non pris en charge, ligne ${i + 1} : ${l.slice(0, 60)}`);
    const v = kv[2];
    if (/^\[[^\]]*$/.test(v) || /^"""/.test(v)) throw new Error(`valeur sur plusieurs lignes non prise en charge, ligne ${i + 1}`);
    out[`${section}.${kv[1]}`.replace(/^\./, "")] = v.replace(/\s+#.*$/, "").trim();
  });
  return out;
}
