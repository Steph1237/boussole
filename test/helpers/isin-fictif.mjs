// ISIN fictifs pour les tests (HIS2, tâche 0 ; spec docs/superpowers/specs/2026-10-16-his2-historique-design.md § 12) :
// préfixe pays (FR ou XS) + « 999 » + numéro sur 6 chiffres + clé de contrôle valide (algorithme de l'ISIN : lettres converties
// en nombres, A = 10 … Z = 35, puis clé de Luhn). Le « 999 » rend ces codes reconnaissables comme fictifs (convention du plan HIS2,
// non vérifiée contre un répertoire d'ISIN) ; le dépôt ne doit contenir aucun ISIN tiré d'un relevé réel.
//   isinFictif(1)          → "FR9990000013"
//   isinFictif(2, "XS")    → ISIN fictif à clé valide, préfixe XS
//   isinFictifFaux(1)      → même base, clé de contrôle fausse (cas de refus)
//   cleIsin("FR999000001") → "3" ; isinValide("FR9990000013") → true

const PREFIXES = new Set(["FR", "XS"]);

/** Chiffres de l'ISIN, lettres converties (A = 10 … Z = 35). */
function enChiffres(s) {
  let out = "";
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch >= "A" && ch <= "Z") out += String(ch.charCodeAt(0) - 55);
    else throw new Error("caractère invalide dans un ISIN : " + ch);
  }
  return out;
}

/** Clé de contrôle (un chiffre, en texte) des 11 premiers caractères d'un ISIN. */
export function cleIsin(base) {
  const b = String(base || "").toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}$/.test(b)) throw new Error("base d'ISIN attendue : 2 lettres + 9 caractères, reçu " + base);
  const d = enChiffres(b);
  let somme = 0;
  // La clé sera ajoutée à droite : en partant du chiffre le plus à droite de la base, un chiffre sur deux est doublé (le premier l'est).
  for (let i = d.length - 1, double = true; i >= 0; i--, double = !double) {
    let v = +d[i];
    if (double) { v *= 2; if (v > 9) v -= 9; }
    somme += v;
  }
  return String((10 - (somme % 10)) % 10);
}

/** Vrai si s a le format d'un ISIN et une clé de contrôle juste. */
export function isinValide(s) {
  const t = String(s || "");
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(t) && cleIsin(t.slice(0, 11)) === t[11];
}

/** ISIN fictif n° n (1 à 999 999), préfixe FR (défaut) ou XS. */
export function isinFictif(n, prefixe = "FR") {
  if (!PREFIXES.has(prefixe)) throw new Error("préfixe fictif attendu : FR ou XS");
  if (!Number.isInteger(n) || n < 1 || n > 999999) throw new Error("numéro attendu entre 1 et 999 999");
  const base = prefixe + "999" + String(n).padStart(6, "0");
  return base + cleIsin(base);
}

/** Même base que isinFictif(n), clé de contrôle volontairement fausse. */
export function isinFictifFaux(n, prefixe = "FR") {
  const juste = isinFictif(n, prefixe);
  return juste.slice(0, 11) + String((+juste[11] + 1) % 10);
}
