// Génère, à partir de supabase/migrations/0017_expertises_contenu.sql puis de la reformulation de 0032_suivi.sql, le bloc « expertises »
// des données de démo (web/src/demo-data.js, entre les marqueurs @genere:expertises), pour qu'il ne diverge jamais du contenu publié :
//   - les 8 expertises en liste (slug, nom, quand consulter, périmètre, version, date, marchés, angles, thèmes, repères) et
//     leurs points de contrôle ;
//   - le détail complet (méthode, garde-fous, forme de la réponse) pour COMPLETES seulement (allocation-risque, etf-fonds), afin
//     de garder un fichier de démo raisonnable ; les autres ont methode, garde_fous et format à null (détail court) ;
//   - les cas d'évaluation ne sont jamais repris (inutiles à l'app).
// Reformulation de 0032 (« Copilote » devient « Claude », « conseiller » est reformulé) : la migration écrit ses paires « ancien texte, nouveau
// texte » une seule fois, entre les marqueurs « @expertises-reformulation », en chaînant des replace() avec les citations $o$ancien$o$ et
// $n$nouveau$n$ ; lireReformulation les lit (dans l'ordre : le premier remplacement est le premier de la liste), appliquerReformulation les
// applique comme la base, à toutes les colonnes de texte, aux points de contrôle et aux cas d'évaluation, et pour chaque expertise dont un texte
// change passe la version à la suivante, avec la date et le résumé de l'entrée de journal de la migration (« 'le', '…', 'resume', $r$…$r$ »).
// test/suivi-pglite.test.mjs vérifie que le résultat est identique à celui de la base (0017 puis 0032 appliquées).
// Usage : npm run gen (node scripts/gen-expertises-demo.mjs). test/expertises-view.test.mjs échoue si le bloc n'est plus à jour.
// Lecture de 0017 sans base : colonnes prises dans l'en-tête de l'insert (« insert into public.expertises (…) values ») ; chaque ligne
// est une suite de valeurs $f$texte$f$, $j$json$j$::jsonb, array[…] ('…' ou array[]::text[]), 'texte' ou entier ; '' dans une chaîne
// SQL entre apostrophes vaut une apostrophe.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
export const SOURCE = "supabase/migrations/0017_expertises_contenu.sql";
export const SOURCE_MAJ = "supabase/migrations/0032_suivi.sql";
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

/** Reformulation de 0032 : { paires: [[ancien, nouveau], …], le, resume } (lève si les marqueurs, les paires ou l'entrée de journal manquent). */
export function lireReformulation(sql) {
  const a = sql.indexOf("-- @expertises-reformulation — début"), b = sql.indexOf("-- @expertises-reformulation — fin");
  if (a < 0 || b < a) throw new Error(SOURCE_MAJ + " : marqueurs @expertises-reformulation introuvables");
  const corps = sql.slice(a, b);
  const paires = [...corps.matchAll(/\$o\$([\s\S]*?)\$o\$,\s*\$n\$([\s\S]*?)\$n\$/g)].map(m => [m[1], m[2]]);
  const nbO = (corps.match(/\$o\$/g) || []).length, nbN = (corps.match(/\$n\$/g) || []).length;
  if (!paires.length || nbO !== 2 * paires.length || nbN !== 2 * paires.length) throw new Error(SOURCE_MAJ + " : paires de reformulation illisibles");
  for (const [o, n] of paires) {
    if (!o) throw new Error(SOURCE_MAJ + " : ancien texte vide");
    if (/["\\]/.test(o + n)) throw new Error(SOURCE_MAJ + " : une paire contient un guillemet ou une barre oblique inverse (elle ne s'appliquerait pas pareil dans le JSON)");
  }
  const j = /@expertises-journal[\s\S]*?'le',\s*'(\d{4}-\d{2}-\d{2})',\s*'resume',\s*\$r\$([\s\S]*?)\$r\$/.exec(sql);
  if (!j) throw new Error(SOURCE_MAJ + " : entrée de journal de la reformulation introuvable");
  return { paires, le: j[1], resume: j[2] };
}

const COLONNES_TEXTE = ["nom", "quand_consulter", "perimetre", "methode", "garde_fous", "format"];
const COLONNES_JSON = ["controles", "evals"];
/** Texte après les remplacements, dans l'ordre (comme replace() de la base : occurrences successives, sans recouvrement). */
const remplacer = (t, paires) => paires.reduce((acc, [o, n]) => acc.split(o).join(n), t);
/** Expertises de 0017 après la reformulation de 0032 : version + 1, date et journal de la migration pour celles dont un texte change. */
export function appliquerReformulation(lignes, maj) {
  return lignes.map(x => {
    const y = { ...x };
    for (const c of COLONNES_TEXTE) y[c] = remplacer(x[c], maj.paires);
    for (const c of COLONNES_JSON) y[c] = JSON.parse(remplacer(JSON.stringify(x[c]), maj.paires));
    const change = [...COLONNES_TEXTE, ...COLONNES_JSON].some(c => JSON.stringify(y[c]) !== JSON.stringify(x[c]));
    if (!change) return x;
    return { ...y, version: x.version + 1, mis_a_jour_le: maj.le, changelog: [...x.changelog, { version: x.version + 1, le: maj.le, resume: maj.resume }] };
  });
}
/** Expertises telles que la base les a après 0017 puis 0032 (les textes les plus récents). */
export function lireExpertisesAJour(sql17, sql32) { return appliquerReformulation(lireExpertises(sql17), lireReformulation(sql32)); }

const s = v => JSON.stringify(v);
const sa = a => "[" + a.map(s).join(", ") + "]";
const lignesDe = (t, ind) => "[\n" + t.split("\n").map(l => ind + "  " + s(l)).join(",\n") + ",\n" + ind + "].join(\"\\n\")";
const cl = a => "[" + a.map(v => "{ version: " + v.version + ", le: " + s(v.le) + ", resume: " + s(v.resume) + " }").join(", ") + "]";
const tableau = (a, ind) => (a.length ? "[\n" + a.map(x => ind + "  " + s(x)).join(",\n") + ",\n" + ind + "]" : "[]");

/** Bloc JS (marqueurs compris) à poser dans demo-data.js. */
export function bloc(sql17, sql32) {
  const xs = lireExpertisesAJour(sql17, sql32).filter(x => x.statut === "publie");
  if (xs.length !== 8) throw new Error(SOURCE + " : 8 expertises publiées attendues, " + xs.length + " lues");
  const I = "      ";
  const items = xs.map(x => {
    const f = [];
    if (x.marches.length) f.push(I + "marches: " + sa(x.marches));
    f.push(I + "angles: " + sa(x.angles), I + "themesSavoir: " + sa(x.themes_savoir), I + "reperes: " + sa(x.reperes));
    if (x.version !== xs[0].version || x.mis_a_jour_le !== xs[0].mis_a_jour_le) f.push(I + "version: " + x.version, I + "misAJourLe: " + s(x.mis_a_jour_le));
    if (s(x.changelog) !== s(xs[0].changelog)) f.push(I + "changelog: " + cl(x.changelog));
    f.push(I + "controles: " + tableau(x.controles, I));
    if (COMPLETES.includes(x.slug)) for (const k of ["methode", "garde_fous", "format"]) f.push(I + k + ": " + lignesDe(x[k], I));
    return "    Ex(" + s(x.slug) + ", " + s(x.nom) + ",\n" + I + s(x.quand_consulter) + ",\n" + I + s(x.perimetre) + ",\n" + I + "{\n" + f.join(",\n") + ",\n" + I + "})";
  });
  return DEBUT +
    "  /* Expertises de Boussole que Claude consulte (tables publiques expertises et expertises_versions, 0016 ; EX1), reprises de " + SOURCE + "\n" +
    "     puis de la reformulation de " + SOURCE_MAJ + ". Les 8 expertises publiées en liste, avec leurs points de contrôle ; détail complet (méthode, garde-fous, forme de la réponse)\n" +
    "     pour " + COMPLETES.join(" et ") + " seulement ; les autres ont un détail court (methode, garde_fous et format à null), signalé\n" +
    "     par Agent › Savoir › Expertises. Les textes s'adressent à Claude (« tu ») et parlent de l'utilisateur à la troisième personne. */\n" +
    "  const JOURNAL = " + cl(xs[0].changelog) + ";\n" +
    "  const Ex = (slug, nom, quandConsulter, perimetre, o) => Object.assign({ slug, nom, quandConsulter, perimetre, version: " + xs[0].version +
    ", misAJourLe: " + s(xs[0].mis_a_jour_le) + ",\n" +
    "    marches: [], angles: [], themesSavoir: [], reperes: [], controles: [], methode: null, garde_fous: null, format: null, changelog: JOURNAL }, o);\n" +
    "  const expertises = [\n" + items.join(",\n") + ",\n  ];\n" + FIN;
}

/** demo-data.js avec le bloc régénéré (lève si les marqueurs manquent). */
export function generer() {
  const cible = readFileSync(racine(CIBLE), "utf8");
  const a = cible.indexOf(DEBUT), b = cible.indexOf(FIN);
  if (a < 0 || b < a) throw new Error(CIBLE + " : marqueurs @genere:expertises introuvables");
  return cible.slice(0, a) + bloc(readFileSync(racine(SOURCE), "utf8"), readFileSync(racine(SOURCE_MAJ), "utf8")) + cible.slice(b + FIN.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(racine(CIBLE), generer());
  console.log("écrit : " + CIBLE + " (bloc expertises)");
}
