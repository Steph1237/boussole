// Recommandations › Fiches (web/src/fiches-view.*) : savoir de l'agent consultable (fiches sourcées, repères chiffrés),
// recherche locale, filtres par thème, rendu markdown limité et sûr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/fiches-view.js", "utf8");
const css = readFileSync("web/src/fiches-view.css", "utf8");
const html = readFileSync("web/src/fiches-view.html", "utf8");
const F = require("../web/src/fiches-view.js");

test("fiches-view.js : se compile et s'enregistre sous « fiches-view »", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "fiches-view.js" }));
  assert.match(js, /App\.register\("fiches-view", api\)/);
  assert.match(js, /__pending/);
});

test("fiches-view.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
  assert.match(js, /const \$ = id => root\.querySelector\("#" \+ id\)/);
});

test("fiches-view.html : identifiants utilisés par le script, en-tête, légende pédagogique", () => {
  const ids = [...js.matchAll(/\$\("(fv[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length > 8);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.ok(html.includes("Ce que sait l'agent"));
  assert.ok(html.includes("Les fiches et les chiffres sur lesquels s'appuie l'agent de Boussole, avec leurs sources et leur date. Elles sont relues avant publication et mises à jour avec l'actualité."));
  assert.ok(html.includes("Indicateur pédagogique, pas un conseil en investissement."));
  assert.ok(html.includes("Chiffres de référence"));
  assert.ok(html.includes("Retour aux fiches"));
});

test("fiches-view.html : recherche étiquetée, filtres de thème groupés", () => {
  assert.match(html, /<label[^>]*for="fvQ"/);
  assert.match(html, /<input[^>]*type="search"[^>]*id="fvQ"|<input[^>]*id="fvQ"[^>]*type="search"/);
  assert.match(html, /id="fvThemes"[^>]*role="group"|role="group"[^>]*id="fvThemes"/);
});

test("fiches-view.css : entièrement scopé sous #view-fiches-view", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 15);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !x.startsWith("#view-fiches-view"));
  assert.deepEqual(bad, []);
});

test("fiches-view.js : puces de thème en bouton avec aria-pressed, cartes en bouton, focus rendu à la carte au retour", () => {
  assert.match(js, /aria-pressed="/);
  assert.match(js, /<button type="button" class="fv-carte" data-slug="/);
  assert.match(js, /\[data-slug="' \+ CSS\.escape\(/);
  assert.match(js, /\.focus\(\)/);
});

test("fiches-view.js : contenu chargé à l'ouverture par Store.savoir.fiche, repères lus avec Reperes.format / aVerifier", () => {
  assert.match(js, /\.savoir\.fiche\(slug\)/);
  assert.match(js, /Reperes\.aVerifier\(/);
  assert.match(js, /Reperes\.format\(/);
  assert.ok(js.includes("à vérifier"));
  assert.ok(html.includes("Le savoir de l'agent arrive bientôt."), "état vide");
  assert.match(js, /\$\("fvVide"\)\.hidden = charge/, "pas d'état vide pendant le chargement");
});

/* ---------- rendreMarkdown : sûr ---------- */
test("rendreMarkdown : tout HTML est échappé", () => {
  const out = F.rendreMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
  assert.ok(!/<script/i.test(out));
  assert.ok(!/<img/i.test(out));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(!F.rendreMarkdown('**"x" & y**').includes('"x"'), "guillemets échappés");
});

test("rendreMarkdown : seuls les liens https:// deviennent des <a>, ouverts dans un nouvel onglet", () => {
  const ok = F.rendreMarkdown("Voir [service-public](https://www.service-public.fr/a?b=1&c=2).");
  assert.match(ok, /<a href="https:\/\/www\.service-public\.fr\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"[^>]*>service-public/);
  for (const u of ["javascript:alert(1)", "http://exemple.fr", "data:text/html,x", "JAVASCRIPT:alert(1)", "//exemple.fr"]) {
    const out = F.rendreMarkdown("[clic](" + u + ")");
    assert.ok(!/<a\b/i.test(out), u + " ne doit pas devenir un lien");
  }
  const inj = F.rendreMarkdown('[x](https://a.fr" onclick="alert(1))');
  assert.ok(!/onclick="/.test(inj), "pas de sortie d'attribut");
});

test("rendreMarkdown : titres, listes, gras, paragraphes ; aucun autre balisage", () => {
  assert.equal(F.rendreMarkdown("## T"), "<h3>T</h3>");
  assert.equal(F.rendreMarkdown("### Sous-titre"), "<h4>Sous-titre</h4>");
  assert.equal(F.rendreMarkdown("- un\n- deux"), "<ul><li>un</li><li>deux</li></ul>");
  assert.equal(F.rendreMarkdown("Le **Livret A** est sûr."), "<p>Le <strong>Livret A</strong> est sûr.</p>");
  assert.equal(F.rendreMarkdown("Premier.\n\nSecond\nsuite."), "<p>Premier.</p><p>Second suite.</p>");
  assert.equal(F.rendreMarkdown("## Titre\nTexte"), "<h3>Titre</h3><p>Texte</p>");
  assert.equal(F.rendreMarkdown(""), "");
  assert.equal(F.rendreMarkdown(null), "");
  const tags = new Set([...F.rendreMarkdown("# a\n\n## b\n\n- **c** [d](https://e.fr)\n\n`f` _g_ > h").matchAll(/<([a-z0-9]+)/g)].map(m => m[1]));
  assert.deepEqual([...tags].filter(t => !["h3", "h4", "p", "ul", "li", "strong", "a", "span"].includes(t)), []);
});

test("rendreMarkdown : contenu d'exemple de la démo rendu sans balise brute", () => {
  const D = readFileSync("web/src/demo-data.js", "utf8");
  assert.ok(D.includes("## À quoi servent ces livrets"));
  const out = F.rendreMarkdown("## À quoi servent ces livrets\n\nLe **Livret A** et le **LDDS**.\n\n- Un seul.\n- Plafond.\n\nPour aller plus loin : [la fiche](https://www.service-public.fr/particuliers/vosdroits/F2365).");
  assert.match(out, /^<h3>À quoi servent ces livrets<\/h3><p>Le <strong>Livret A<\/strong>/);
  assert.match(out, /<ul><li>Un seul\.<\/li><li>Plafond\.<\/li><\/ul>/);
  assert.match(out, /<a href="https:\/\/www\.service-public\.fr\/particuliers\/vosdroits\/F2365"/);
});

test("lienSur : n'accepte que les URL https://", () => {
  assert.equal(F.lienSur("https://www.amf-france.org"), "https://www.amf-france.org");
  for (const u of ["javascript:alert(1)", "http://a.fr", " https://a.fr", "", null, undefined, 42, "https://"]) assert.equal(F.lienSur(u), null, String(u));
});

/* ---------- recherche et thèmes ---------- */
const FICHES = [
  { slug: "a", theme: "epargne", titre: "Epargne de précaution", resume: "Le matelas.", motsCles: ["livret"] },
  { slug: "b", theme: "enveloppes", titre: "Le PEA", resume: "Actions européennes, fiscalité après 5 ans.", motsCles: ["plan d'épargne en actions"] },
  { slug: "c", theme: "credit", titre: "Taux d'effort", resume: "Norme du HCSF.", motsCles: ["endettement", "Crédit immobilier"] },
];

test("normaliser : minuscules sans accents", () => {
  assert.equal(F.normaliser("Épargne À Crédit"), "epargne a credit");
  assert.equal(F.normaliser(null), "");
});

test("filtrer : insensible à la casse et aux accents, sur titre, résumé et mots-clés ; par thème", () => {
  assert.deepEqual(F.filtrer(FICHES, "épargne", "").map(f => f.slug), ["a", "b"]);
  assert.deepEqual(F.filtrer(FICHES, "EPARGNE", "epargne").map(f => f.slug), ["a"]);
  assert.deepEqual(F.filtrer(FICHES, "fiscalite", "").map(f => f.slug), ["b"]);
  assert.deepEqual(F.filtrer(FICHES, "credit immo", "").map(f => f.slug), ["c"], "plusieurs mots : tous présents");
  assert.deepEqual(F.filtrer(FICHES, "", "credit").map(f => f.slug), ["c"]);
  assert.deepEqual(F.filtrer(FICHES, "  ", null).map(f => f.slug), ["a", "b", "c"]);
  assert.deepEqual(F.filtrer(FICHES, "introuvable", ""), []);
  assert.deepEqual(F.filtrer(null, "x", ""), []);
});

test("THEMES : libellés français des neuf thèmes", () => {
  assert.deepEqual(F.THEMES, { epargne: "Épargne", enveloppes: "Enveloppes", fiscalite: "Fiscalité", immobilier: "Immobilier", retraite: "Retraite",
    protection: "Protection", marches: "Marchés", comportement: "Comportement", credit: "Crédit" });
  assert.deepEqual(F.themesPresents(FICHES), ["epargne", "enveloppes", "credit"]);
});
