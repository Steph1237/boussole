// Génère, à partir de supabase/migrations/0017_expertises_contenu.sql, le bloc « expertises » des données de démo
// (web/src/demo-data.js, entre les marqueurs @genere:expertises), pour qu'il ne diverge jamais du contenu publié :
//   - les 8 expertises v1 en liste (slug, nom, quand consulter, périmètre, version, date, marchés, angles, thèmes, repères) et
//     leurs points de contrôle ;
//   - le détail complet (méthode, garde-fous, forme de la réponse) pour COMPLETES seulement (allocation-risque, etf-fonds), afin
//     de garder un fichier de démo raisonnable ; les autres ont methode, garde_fous et format à null (détail court) ;
//   - les cas d'évaluation ne sont jamais repris (inutiles à l'app).
// Usage : npm run gen (node scripts/gen-expertises-demo.mjs). test/expertises-view.test.mjs échoue si le bloc n'est plus à jour.
// Lecture de 0017 sans base : colonnes prises dans l'en-tête de l'insert (« insert into public.expertises (…) values ») ; chaque ligne
// est une suite de valeurs $f$texte$f$, $j$json$j$::jsonb, array[…] ('…' ou array[]::text[]), 'texte' ou entier ; '' dans une chaîne
// SQL entre apostrophes vaut une apostrophe.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
export const SOURCE = "supabase/migrations/0017_expertises_contenu.sql";
export const CIBLE = "web/src/demo-data.js";
export const COMPLETES = ["allocation-risque", "etf-fonds"];
export const DEBUT = "  /* @genere:expertises — début (scripts/gen-expertises-demo.mjs, npm run gen ; ne pas modifier à la main) */\n";
export const FIN = "  /* @genere:expertises — fin */\n";
/** Lignes de l'insert de 0017 → [{ colonne: valeur }] (valeurs JS : texte, tableau, objet, nombre). */
export function lireExpertises(sql) {
  const debut = sql.indexOf("insert into public.expertises");
  const fin = sql.indexOf("on conflict (slug)", debut);
  if (debut < 0 || fin < 0) throw new Error(SOURCE + " : insert des expertises introuvable");
  const tete = /^insert into public\.expertises\s*\(([^)]*)\)\s*values\b/.exec(sql.slice(debut, fin));
  if (!tete) throw new Error(SOURCE + " : colonnes de l'insert des expertises introuvables");
  const COLONNES = tete[1].split(",").map(c => c.trim()).filter(Boolean);
  const t = sql.slice(debut + tete[0].length, fin);
  const lignes = [];
  let i = 0, valeurs = null;
  const blanc = () => { for (;;) { while (/[\s,]/.test(t[i] || "")) i++; if (t.startsWith("--", i)) { i = t.indexOf("\n", i); if (i < 0) i = t.length; } else return; } };
  /* Chaîne SQL entre apostrophes (i juste après l'ouvrante) ; '' → '. */
  const chaine = () => {
    let v = "";
    for (;;) {
      const j = t.indexOf("'", i);
      if (j < 0) throw new Error("chaîne non fermée à " + i);
      v += t.slice(i, j); i = j + 1;
      if (t[i] === "'") { v += "'"; i++; } else return v;
    }
  };
  const jusqua = fermant => { const j = t.indexOf(fermant, i); if (j < 0) throw new Error("valeur non fermée à " + i); const v = t.slice(i, j); i = j + fermant.length; return v; };
  const type = () => { const m = /^::[\w[\]]+/.exec(t.slice(i)); if (m) i += m[0].length; };
  while (blanc(), i < t.length) {
    if (t[i] === "(") { valeurs = []; i++; continue; }
    if (t[i] === ")") {
      if (valeurs.length !== COLONNES.length) throw new Error(SOURCE + " : ligne " + (lignes.length + 1) + " : " + COLONNES.length + " colonnes, " + valeurs.length + " valeurs");
      lignes.push(Object.fromEntries(COLONNES.map((c, k) => [c, valeurs[k]]))); valeurs = null; i++; continue;
    }
    if (t.startsWith("$f$", i)) { i += 3; valeurs.push(jusqua("$f$")); continue; }
    if (t.startsWith("$j$", i)) { i += 3; valeurs.push(JSON.parse(jusqua("$j$"))); type(); continue; }
    if (t.startsWith("array[", i)) {
      i += 6;
      const a = [];
      for (;;) {
        while (/[\s,]/.test(t[i] || "")) i++;
        if (t[i] === "]") { i++; break; }
        if (t[i] !== "'") throw new Error(SOURCE + " : élément de tableau illisible : " + t.slice(i, i + 40));
        i++; a.push(chaine());
      }
      valeurs.push(a); type(); continue;
    }
    if (t[i] === "'") { i++; valeurs.push(chaine()); continue; }
    const m = /^\d+/.exec(t.slice(i));
    if (!m) throw new Error(SOURCE + " : valeur illisible : " + t.slice(i, i + 40));
    valeurs.push(+m[0]); i += m[0].length;
  }
  return lignes;
}

const s = v => JSON.stringify(v);
const sa = a => "[" + a.map(s).join(", ") + "]";
const lignesDe = (t, ind) => "[\n" + t.split("\n").map(l => ind + "  " + s(l)).join(",\n") + ",\n" + ind + "].join(\"\\n\")";
const cl = a => "[" + a.map(v => "{ version: " + v.version + ", le: " + s(v.le) + ", resume: " + s(v.resume) + " }").join(", ") + "]";
const tableau = (a, ind) => (a.length ? "[\n" + a.map(x => ind + "  " + s(x)).join(",\n") + ",\n" + ind + "]" : "[]");

/** Bloc JS (marqueurs compris) à poser dans demo-data.js. */
export function bloc(sql) {
  const xs = lireExpertises(sql).filter(x => x.statut === "publie");
  if (xs.length !== 8) throw new Error(SOURCE + " : 8 expertises publiées attendues, " + xs.length + " lues");
  const I = "      ";
  const items = xs.map(x => {
    const f = [];
    if (x.marches.length) f.push(I + "marches: " + sa(x.marches));
    f.push(I + "angles: " + sa(x.angles), I + "themesSavoir: " + sa(x.themes_savoir), I + "reperes: " + sa(x.reperes));
    if (x.version !== 1 || x.mis_a_jour_le !== "2026-10-11") f.push(I + "version: " + x.version, I + "misAJourLe: " + s(x.mis_a_jour_le));
    if (s(x.changelog) !== s(xs[0].changelog)) f.push(I + "changelog: " + cl(x.changelog));
    f.push(I + "controles: " + tableau(x.controles, I));
    if (COMPLETES.includes(x.slug)) for (const k of ["methode", "garde_fous", "format"]) f.push(I + k + ": " + lignesDe(x[k], I));
    return "    Ex(" + s(x.slug) + ", " + s(x.nom) + ",\n" + I + s(x.quand_consulter) + ",\n" + I + s(x.perimetre) + ",\n" + I + "{\n" + f.join(",\n") + ",\n" + I + "})";
  });
  return DEBUT +
    "  /* Expertises du Copilote patrimonial (tables publiques expertises et expertises_versions, 0016 ; EX1), reprises de " + SOURCE + ".\n" +
    "     Les 8 expertises v1 publiées en liste, avec leurs points de contrôle ; détail complet (méthode, garde-fous, forme de la réponse)\n" +
    "     pour " + COMPLETES.join(" et ") + " seulement ; les autres ont un détail court (methode, garde_fous et format à null), signalé\n" +
    "     par Agent › Savoir › Expertises. Les textes s'adressent au Copilote (« tu ») et parlent de l'utilisateur à la troisième personne. */\n" +
    "  const V1 = " + cl(xs[0].changelog) + ";\n" +
    "  const Ex = (slug, nom, quandConsulter, perimetre, o) => Object.assign({ slug, nom, quandConsulter, perimetre, version: " + xs[0].version +
    ", misAJourLe: " + s(xs[0].mis_a_jour_le) + ",\n" +
    "    marches: [], angles: [], themesSavoir: [], reperes: [], controles: [], methode: null, garde_fous: null, format: null, changelog: V1 }, o);\n" +
    "  const expertises = [\n" + items.join(",\n") + ",\n  ];\n" + FIN;
}

/** demo-data.js avec le bloc régénéré (lève si les marqueurs manquent). */
export function generer() {
  const cible = readFileSync(racine(CIBLE), "utf8");
  const a = cible.indexOf(DEBUT), b = cible.indexOf(FIN);
  if (a < 0 || b < a) throw new Error(CIBLE + " : marqueurs @genere:expertises introuvables");
  return cible.slice(0, a) + bloc(readFileSync(racine(SOURCE), "utf8")) + cible.slice(b + FIN.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(racine(CIBLE), generer());
  console.log("écrit : " + CIBLE + " (bloc expertises)");
}
