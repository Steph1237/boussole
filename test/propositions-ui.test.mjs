// Agent › Propositions (web/src/propositions.*) : revue des changements proposés par Claude,
// pastille de navigation (app.js, shell.html), description en français de chaque proposition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const js = readFileSync("web/src/propositions.js", "utf8");
const css = readFileSync("web/src/propositions.css", "utf8");
const html = readFileSync("web/src/propositions.html", "utf8");
const app = readFileSync("web/src/app.js", "utf8");
const shell = readFileSync("web/src/shell.html", "utf8");
const H = require("../web/src/propositions.js");
const sp = s => String(s).replace(/[  ]/g, " ");
const d = (p, ctx) => sp(H.decrire(p, ctx));

test("propositions.js : se compile et s'enregistre sous « propositions »", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "propositions.js" }));
  assert.match(js, /App\.register\("propositions", api\)/);
  assert.match(js, /__pending/);
});

test("propositions.js : valide par Store.propositions.appliquer (avec les valeurs modifiées) et refuse par .refuser", () => {
  assert.match(js, /window\.Store && window\.Store\.propositions/);
  assert.match(js, /api\.appliquer\(ids, m\)/);
  assert.match(js, /api\.refuser\(ids\)/);
  assert.match(js, /out\[id\] = r\.apres/, "modifications { [id]: apresModifie }");
  assert.match(js, /function headline\(\) \{ const n = enAttente\(\)\.length; return n \? String\(n\) : ""; \}/);
});

test("propositions.js : aucune requête DOM globale hors racine du module", () => {
  const bad = js.split("\n").filter(l => /document\.(querySelector|querySelectorAll|getElementById)\(/.test(l));
  assert.deepEqual(bad, []);
});

test("propositions.html : identifiants utilisés par le script, phrase d'en-tête et lien vers Avec Claude", () => {
  const ids = [...js.matchAll(/\$\("(pp[A-Za-z]+)"\)/g)].map(m => m[1]);
  assert.ok(ids.length > 5);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  assert.ok(html.includes("Claude a proposé ces changements. Rien n'est enregistré tant que tu ne les valides pas."));
  assert.match(html, /formulaires interactifs/, "l'état vide décrit la saisie avec Claude");
  assert.match(html, /data-goto="agent\/connexion"/);
});

test("propositions.css : entièrement scopé (vue, pastille de la barre latérale), plus de règles #propBanner", () => {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "}");
  const sels = [...c.matchAll(/(^|})\s*([^@{}][^{}]*)\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(sels.length > 20);
  const bad = sels.flatMap(s => s.split(",").map(x => x.trim())).filter(x => !/^(#view-propositions|#sideNav \[data-prop-count\]|#sideNav \.nav-item)/.test(x));
  assert.deepEqual(bad, []);
  assert.doesNotMatch(css, /propBanner/, "le bandeau global n'existe plus");
});

test("coque : plus de bandeau global #propBanner ; pastille Agent pilotée par headline() du module propositions", () => {
  assert.doesNotMatch(shell, /id="propBanner"/);
  assert.doesNotMatch(app, /propBanner/);
  assert.match(app, /sp\.space === "agent" \? '<span class="pill-count" data-prop-count hidden><\/span>'/);
  assert.match(app, /countOf\("agent", "propositions"\)/);
  assert.match(app, /countOf\("aujourdhui", "vue"\)/, "pastille Aujourd'hui (boîte de réception)");
  const { routeOfModule } = require("../web/src/app.js");
  assert.deepEqual(routeOfModule("propositions"), { space: "agent", sub: "propositions" });
});

/* ---------- description en français ---------- */
const CTX = {
  people: [{ id: "p1", nom: "Claire" }, { id: "p2", nom: "Alex" }],
  positions: [{ id: "pos-1", name: "Amundi MSCI World", envelope: "PEA", qty: 120 }],
  profil: { biens: [{ id: "bien-rp", nom: "Appartement", valeur: 240000, crd: 150000 }], credits: [{ id: "credit-auto", nom: "Prêt auto", crd: 6500, mensualite: 210 }] },
  objectifs: [{ id: "o1", nom: "Apport immobilier", cible: 40000 }],
  budget: { lignes: [{ id: "l1", type: "depense", libelle: "Courses", montant: 450, frequence: "mois" }] },
};

test("decrire : protection (oui / non renseignée)", () => {
  assert.equal(d({ cible: "protection", operation: "modifier", avant: { prevoyance: null }, apres: { prevoyance: true } }, CTX), "Assurance prévoyance : non renseignée → oui");
});

test("decrire : position (parts, nom de la ligne retrouvé par ref)", () => {
  assert.equal(d({ cible: "position", operation: "modifier", ref: "pos-1", avant: { qty: 120 }, apres: { qty: 135 } }, CTX), "PEA · Amundi MSCI World : 120 parts → 135 parts");
  assert.equal(d({ cible: "position", operation: "creer", apres: { name: "Livret A", envelope: "Livret A", value: 12000 } }, CTX), "Nouveau placement : Livret A · Livret A, valeur 12 000 €");
});

test("decrire : budget (nouvelle dépense, montant par mois / par an)", () => {
  assert.equal(d({ cible: "budget", operation: "creer", apres: { type: "depense", categorie: "Transport", libelle: "Assurance auto", montant: 45, frequence: "mois" } }, CTX), "Nouvelle dépense : Assurance auto 45 €/mois");
  assert.equal(d({ cible: "budget", operation: "creer", apres: { type: "epargne", libelle: "PEA", montant: 1200, frequence: "an" } }, CTX), "Nouvelle épargne : PEA 1 200 €/an");
  assert.equal(d({ cible: "budget", operation: "modifier", ref: "l1", avant: { montant: 450 }, apres: { montant: 500 } }, CTX), "Courses : montant 450 €/mois → 500 €/mois");
});

test("decrire : bien, crédit et objectif (libellés humains, euros)", () => {
  assert.equal(d({ cible: "bien", operation: "modifier", ref: "bien-rp", avant: { crd: 150000 }, apres: { crd: 145000 } }, CTX), "Appartement : reste à rembourser 150 000 € → 145 000 €");
  assert.equal(d({ cible: "credit", operation: "supprimer", ref: "credit-auto", avant: { nom: "Prêt auto" } }, CTX), "Supprimer le crédit : Prêt auto");
  assert.equal(d({ cible: "objectif", operation: "creer", apres: { nom: "Études", cible: 20000, dateCible: "2034-09-01" } }, CTX), "Nouvel objectif : Études, montant visé 20 000 €, date visée 1 sept. 2034");
  assert.equal(d({ cible: "credit", operation: "modifier", ref: "credit-auto", avant: { crd: 6500, mensualite: 210 }, apres: { crd: 6290, mensualite: 210 } }, CTX), "Prêt auto : reste à rembourser 6 500 € → 6 290 €");
});

test("decrire : profil (champs imbriqués, nom de la personne)", () => {
  assert.equal(d({ cible: "profil", operation: "modifier", avant: { foyer: { tmi: 11 } }, apres: { foyer: { tmi: 30 } } }, CTX), "Tranche marginale d'imposition : 11 % → 30 %");
  assert.equal(d({ cible: "profil", operation: "modifier", avant: {}, apres: { personnes: { p2: { salaire: 3200 } } } }, CTX), "Salaire d'Alex : non renseigné → 3 200 €");
});

test("decrire : profil de risque (thème et libellé de l'option si le questionnaire est fourni)", () => {
  const questions = [{ id: "horizon", options: [{ v: "8-15", label: "8 à 15 ans" }] }];
  assert.equal(d({ cible: "risque", operation: "modifier", avant: { reponses: {} }, apres: { reponses: { horizon: "8-15" } } }, { ...CTX, questions }), "Horizon de placement : non renseigné → 8 à 15 ans");
});

test("changements : seulement les champs modifiés ; appliquerSaisies : valeurs typées, erreurs en français", () => {
  const p = { cible: "position", operation: "modifier", ref: "pos-1", avant: { qty: 120, value: 1000 }, apres: { qty: 135, value: 1000 } };
  assert.deepEqual(H.changements(p, CTX).map(c => c.path), ["qty"]);
  assert.deepEqual(H.appliquerSaisies(p, { qty: "140,5" }, CTX).apres, { qty: 140.5, value: 1000 });
  assert.match(H.appliquerSaisies(p, { qty: "beaucoup" }, CTX).erreur, /n'est pas un nombre/);
  const prot = { cible: "protection", operation: "modifier", avant: {}, apres: { prevoyance: true } };
  assert.deepEqual(H.appliquerSaisies(prot, { prevoyance: "non" }, CTX).apres, { prevoyance: false });
  const prof = { cible: "profil", operation: "modifier", avant: {}, apres: { foyer: { tmi: 30 } } };
  assert.deepEqual(H.appliquerSaisies(prof, { "foyer.tmi": "41" }, CTX).apres, { foyer: { tmi: 41 } });
});

/* ---------- réglages (migration 0019) : matelas, versements programmés, classe d'une poche ---------- */
const CTX_R = { ...CTX, positions: [{ id: "pea", name: "ETF Monde", envelope: "PEA" }, { id: "liv", name: "Livret A", envelope: "Livrets" }] };
const MATELAS = { cible: "config", operation: "modifier", avant: { cushion: { mode: "amount", min: 15000, max: 20000 } }, apres: { cushion: { mode: "months", months: 6, depenses: 2500 } } };
const VERSEMENTS = { cible: "config", operation: "modifier",
  avant: { recurring: [{ id: "a", label: "Versement PEA", positionId: "pea", amount: 300, day: 5, lastApplied: "2026-10" }, { id: "b", label: "Livret", positionId: "liv", amount: 100, day: 1 }] },
  apres: { recurring: [{ id: "a", label: "Versement PEA", positionId: "pea", amount: 300, day: 5 }, { id: "c", label: "PEA bis", positionId: "pea", amount: 200, day: 5 }] } };

test("decrire : réglages — matelas de précaution, versements programmés, classe d'une poche", () => {
  assert.equal(H.CIBLES.config.label, "Réglages"); assert.ok(H.ORDRE_CIBLES.includes("config"));
  assert.equal(d({ ...MATELAS, avant: { cushion: null } }, CTX_R), "Matelas de précaution : 6 mois de dépenses (2 500 €/mois, soit 15 000 €)");
  assert.equal(d(MATELAS, CTX_R), "Matelas de précaution : 15 000 € à 20 000 € → 6 mois de dépenses (2 500 €/mois, soit 15 000 €)");
  assert.equal(d({ cible: "config", operation: "modifier", avant: { cushion: { mode: "amount", min: 0, max: 0 } }, apres: { cushion: { mode: "amount", min: 10000, max: null } } }, CTX_R),
    "Matelas de précaution : au moins 10 000 €", "matelas à 0 : pas d'avant affiché");
  assert.equal(d({ cible: "config", operation: "modifier", avant: { recurring: [] }, apres: { recurring: [{ id: "n", label: "PEA", positionId: "pea", amount: 200, day: 5 }] } }, CTX_R),
    "Versement programmé de 200 € le 5 du mois sur PEA · ETF Monde");
  assert.equal(d(VERSEMENTS, CTX_R), "Versement programmé de 200 € le 5 du mois sur PEA · ETF Monde ; Fin du versement programmé de 100 € le 1er du mois sur Livrets · Livret A",
    "versement inchangé (lastApplied ignoré) non cité");
  assert.equal(d({ ...VERSEMENTS, apres: { recurring: [{ id: "a", label: "Versement PEA", positionId: "pea", amount: 250, day: 10 }, VERSEMENTS.avant.recurring[1]] } }, CTX_R),
    "Versement programmé « Versement PEA » : 300 € le 5 du mois sur PEA · ETF Monde → 250 € le 10 du mois sur PEA · ETF Monde");
  assert.equal(d({ cible: "profil", operation: "modifier", avant: { classes: { Asie: null } }, apres: { classes: { Asie: "emergents" } } }, CTX_R), "Classe de la poche Asie : actions émergentes");
  assert.equal(d({ cible: "profil", operation: "modifier", avant: { classes: { Protection: "or" } }, apres: { classes: { Protection: "fonds_euros" } } }, CTX_R), "Classe de la poche Protection : or → fonds euros");
  assert.equal(d({ cible: "profil", operation: "modifier", avant: { classes: { Protection: "or" } }, apres: { classes: { Protection: null } } }, CTX_R), "Classe de la poche Protection : or → classe automatique");
});

test("réglages : corrigeables avant validation (cible du matelas, montant et jour d'un versement, classe)", () => {
  assert.deepEqual(H.changements(MATELAS, CTX_R).map(c => [c.path, c.kind]), [["cushion.mode", "enum"], ["cushion.months", "num"], ["cushion.depenses", "eur"]]);
  assert.deepEqual(H.changements(MATELAS, CTX_R)[0].opts.map(o => o[0]), ["amount", "months"]);
  assert.deepEqual(H.appliquerSaisies(MATELAS, { "cushion.months": "3", "cushion.depenses": "2 800" }, CTX_R).apres, { cushion: { mode: "months", months: 3, depenses: 2800 } });
  // versements : seuls l'ajouté (ou le modifié) se corrigent ; la liste reste une liste
  assert.deepEqual(H.changements(VERSEMENTS, CTX_R).map(c => c.path), ["recurring.1.amount", "recurring.1.day"]);
  assert.equal(H.changements(VERSEMENTS, CTX_R)[0].label, "montant de « PEA bis »");
  const v = H.appliquerSaisies(VERSEMENTS, { "recurring.1.amount": "150", "recurring.1.day": "12" }, CTX_R).apres;
  assert.ok(Array.isArray(v.recurring));
  assert.deepEqual(v.recurring[1], { id: "c", label: "PEA bis", positionId: "pea", amount: 150, day: 12 });
  assert.match(H.appliquerSaisies(VERSEMENTS, { "recurring.1.amount": "beaucoup" }, CTX_R).erreur, /n'est pas un nombre \(montant de « PEA bis »\)/);
  assert.match(d({ ...VERSEMENTS, apres: v }, CTX_R), /^Versement programmé de 150 € le 12 du mois sur PEA · ETF Monde/);
  // classe : liste fermée, vide = classe automatique
  const cl = { cible: "profil", operation: "modifier", avant: { classes: { Asie: null } }, apres: { classes: { Asie: "emergents" } } };
  const [c] = H.changements(cl, CTX_R);
  assert.equal(c.path, "classes.Asie"); assert.equal(c.vide, "classe automatique");
  assert.deepEqual(c.opts.map(o => o[0]), ["actions", "small_caps", "emergents", "levier", "obligations", "immobilier", "monetaire", "fonds_euros", "or", "crypto", "autres"]);
  assert.deepEqual(H.appliquerSaisies(cl, { "classes.Asie": "or" }, CTX_R).apres, { classes: { Asie: "or" } });
  assert.deepEqual(H.appliquerSaisies(cl, { "classes.Asie": "" }, CTX_R).apres, { classes: { Asie: null } });
  // l'option vide du sélecteur porte le libellé du champ (« classe automatique »), pas « non renseigné »
  assert.match(js, /'<option value="">' \+ esc\(x\.vide \|\| "non renseigné"\) \+ "<\/option>"/);
  assert.match(js, /p\.cible !== "config" && ch\.length > 1/, "réglages : une phrase, pas une liste champ par champ");
});

/* ---------- frais des contrats (0026, regler_frais_enveloppe) ---------- */
const FRAIS = { cible: "config", operation: "modifier",
  avant: { frais_enveloppes: { "Assurance-vie Linxea": { gestion_uc_pct: 0.6, source: "CG 2024", le: "2024-01-15" } } },
  apres: { frais_enveloppes: { "Assurance-vie Linxea": { gestion_uc_pct: 0.5, gestion_euro_pct: 0.6, source: "Conditions générales 2026, annexe de frais", le: "2026-09-30" } } } };

test("réglages : frais d'un contrat décrits en phrase (avant → après, source citée) et corrigeables avant validation", () => {
  assert.equal(d({ ...FRAIS, avant: { frais_enveloppes: { "Assurance-vie Linxea": null } } }, CTX_R),
    "Frais du contrat « Assurance-vie Linxea » : gestion des unités de compte 0,5 % par an, gestion du fonds en euros 0,6 % par an (source : Conditions générales 2026, annexe de frais)");
  assert.equal(d(FRAIS, CTX_R),
    "Frais du contrat « Assurance-vie Linxea » : gestion des unités de compte 0,6 % → 0,5 % par an, gestion du fonds en euros 0,6 % par an (source : Conditions générales 2026, annexe de frais)");
  assert.equal(d({ cible: "config", operation: "modifier", avant: { frais_enveloppes: { PEA: { garde_pct: 0, source: "x", le: "2026-01-01" } } }, apres: { frais_enveloppes: { PEA: null } } }, CTX_R),
    "Frais du contrat « PEA » : retirés");
  assert.equal(d({ cible: "config", operation: "modifier", avant: {}, apres: { cushion: { mode: "amount", min: 10000, max: null }, frais_enveloppes: { PER: { garde_pct: 0.1, source: "Notice" } } } }, CTX_R),
    "Matelas de précaution : au moins 10 000 € ; Frais du contrat « PER » : droits de garde 0,1 % par an (source : Notice)");
  const ch = H.changements(FRAIS, CTX_R);
  assert.deepEqual(ch.map(c => [c.path, c.kind]), [["frais_enveloppes.Assurance-vie Linxea.gestion_uc_pct", "pct"], ["frais_enveloppes.Assurance-vie Linxea.gestion_euro_pct", "pct"]]);
  assert.equal(ch[0].label, "gestion des unités de compte de « Assurance-vie Linxea »");
  assert.match(ch[0].avantTxt, /^0,6\s%$/); assert.match(ch[0].apresTxt, /^0,5\s%$/);
  const r = H.appliquerSaisies(FRAIS, { "frais_enveloppes.Assurance-vie Linxea.gestion_uc_pct": "0,45" }, CTX_R).apres;
  assert.deepEqual(r.frais_enveloppes["Assurance-vie Linxea"], { gestion_uc_pct: 0.45, gestion_euro_pct: 0.6, source: "Conditions générales 2026, annexe de frais", le: "2026-09-30" });
  assert.match(H.appliquerSaisies(FRAIS, { "frais_enveloppes.Assurance-vie Linxea.gestion_uc_pct": "beaucoup" }, CTX_R).erreur, /n'est pas un nombre/);
  // nom d'enveloppe avec un point : décrit, mais pas corrigeable champ par champ (chemin ambigu)
  const point = { cible: "config", operation: "modifier", avant: {}, apres: { frais_enveloppes: { "A.V. Spirit": { gestion_uc_pct: 0.5, source: "CG" } } } };
  assert.deepEqual(H.changements(point, CTX_R), []);
  assert.match(d(point, CTX_R), /^Frais du contrat « A\.V\. Spirit » : gestion des unités de compte 0,5 % par an/);
});

test("profil de risque recalculé après validation de réponses proposées par Claude", () => {
  const js = readFileSync("web/src/propositions.js", "utf8");
  assert.match(js, /cible === "risque"/);
  assert.match(js, /window\.Risque/);
  assert.match(js, /\.evaluer\(rq\.reponses/);
  assert.match(js, /update\(\{ risque:/);
});

/* Tutoiement (spec 2026-10-11-saisie-par-agent) : aucun « vous / votre / vos » ni impératif au vouvoiement dans les textes du module. */
test("propositions : tutoiement — aucun « vous / votre / vos » dans les textes du module", () => {
  const VOUVOIEMENT = /\b(vous|votre|vos)\b/i;
  const IMPERATIFS = /\b(Réessayez|réessayez|Commencez|Confirmez|Relisez|relisez|Corrigez|corrigez|Choisissez|choisissez|Utilisez|utilisez|Consultez|consultez|Copiez|copiez|Collez|collez|Revenez|Faites|faites|Sécurisez|Ajoutez|ajoutez|Validez|validez|Refusez|refusez)\b/;
  for (const [nomFichier, src] of [["propositions.js", js], ["propositions.html", html]]) {
    const texte = src.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(texte, VOUVOIEMENT, nomFichier);
    assert.doesNotMatch(texte, IMPERATIFS, nomFichier);
  }
});

/* ---------- calendrier patrimonial (0029 : regler_infos_enveloppe, regler_infos_pret, regler_donations, regler_avis_impot) ---------- */
const CAL = (apres, avant = {}) => ({ cible: "config", operation: "modifier", avant, apres });
const CREDIT_ID = "6f1c2a9e-0000-4000-8000-000000000001";
const CTX_CAL = { ...CTX_R, profil: { credits: [{ id: CREDIT_ID, nom: "Prêt auto" }], biens: [] } };
test("calendrier : les données proposées sont décrites en clair (date d'ouverture, prêt, donation, avis d'impôt), source citée", () => {
  assert.equal(d(CAL({ enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", source: "relevé annuel 2025", le: "2026-02-12" } } }), CTX_CAL),
    "Type de « PEA Exemple » : PEA ; Titulaire de « PEA Exemple » : p1 ; Date d'ouverture de « PEA Exemple » : 15/06/2021 (source : relevé annuel 2025)");
  assert.equal(d(CAL({ enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", versements_cumules: 92000, source: "relevé annuel 2025", le: "2026-02-12" } } },
    { enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture: "2021-06-15", source: "ancien", le: "2025-01-01" } } }), CTX_CAL),
    "Versements cumulés de « PEA Exemple » : 92 000 € (source : relevé annuel 2025)", "seul ce qui change est décrit");
  assert.match(d(CAL({ enveloppes_infos: { "PEL|p2": { type: "pel", titulaire: "p2", date_ouverture_approx: "2016-09", source: "dit", le: "2026-02-12" } } }), CTX_CAL), /Date d'ouverture de « PEL » : en 09\/2016 \(approximative\)/);
  assert.match(d(CAL({ enveloppes_infos: { "PEA Exemple": { type: "pea", titulaire: "p1", date_ouverture_approx: "2019", source: "dit" } } }), CTX_CAL), /en 2019 \(approximative\)/);
  assert.equal(d(CAL({ enveloppes_infos: { "PEA Exemple": null } }), CTX_CAL), "Informations de « PEA Exemple » : retirées");
  assert.equal(d(CAL({ prets_infos: { ["credit:" + CREDIT_ID]: { date_fin: "2029-04-30", duree_mois: 84, source: "offre de prêt", le: "2026-02-12" } } }), CTX_CAL),
    "Prêt « Prêt auto » : fin le 30/04/2029, 84 mois (source : offre de prêt)");
  assert.equal(d(CAL({ donations: [{ id: "a", date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation", source: "acte", le: "2026-02-12" }] }), CTX_CAL),
    "Donation à Enfant 1 du 01/07/2015 : 20 000 € (source : acte)");
  const dn = { id: "a", date: "2015-07-01", montant: 20000, donateur: "p1", lien: "enfant", beneficiaire: "Enfant 1", nature: "donation", source: "acte", le: "2026-02-12" };
  assert.equal(d(CAL({ donations: [] }, { donations: [dn] }), CTX_CAL), "Donation à Enfant 1 du 01/07/2015 : 20 000 € : retirée");
  assert.equal(d(CAL({ avis_impot: { annee_revenus: 2025, rfr: 31000, plafonds_per: { p1: [{ annee: 2024, montant: 1234 }] }, source: "avis 2026", le: "2026-09-01" } }), CTX_CAL),
    "Avis d'impôt (revenus 2025) : revenu fiscal de référence 31 000 €, plafond épargne retraite personne 1 : 2024 1 234 € (source : avis 2026)");
  assert.equal(d(CAL({ avis_impot: {} }), CTX_CAL), "Avis d'impôt : effacé");
  assert.equal(d(CAL({ cushion: { mode: "amount", min: 10000, max: null }, donations: [] }), CTX_CAL), "Matelas de précaution : au moins 10 000 € ; Donations : aucun changement");
  // pas de champ corrigeable champ par champ : valider ou refuser tels quels
  assert.deepEqual(H.changements(CAL({ enveloppes_infos: { X: { type: "pea", titulaire: "p1", source: "s" } } }), CTX_CAL), []);
});
test("propositions.js : aucun vouvoiement ni « conseiller » dans les nouvelles descriptions", () => {
  const bloc = js.slice(js.indexOf("calendrier patrimonial (DAT1, 0029)"), js.indexOf("function decrireConfig"));
  assert.ok(bloc.length > 1000);
  assert.equal((bloc.match(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu) || [])[0], undefined);
  assert.equal((bloc.match(/conseill/i) || [])[0], undefined);
});
