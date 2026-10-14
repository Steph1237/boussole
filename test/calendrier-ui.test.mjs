// DAT1 : interface du calendrier patrimonial — Aujourd'hui (carte « Prochaines échéances », carte « Prochaine échéance », boîte, revue
// mensuelle, panneaux d'un jalon et des informations à compléter) et fiche d'enveloppe (Patrimoine › Comptes). Fonctions pures et rendus HTML ;
// la vue montée en vm est couverte par test/aujourdhui.test.mjs. Données fictives. Tutoiement, accessibilité (liste sémantique, vrais boutons,
// jauge avec texte équivalent, état en mots), jamais une date sans donnée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { FIXTURE } from "./helpers/calendrier-cas.mjs";

const require = createRequire(import.meta.url);
const A = require("../web/src/aujourdhui.js");
const CV = require("../web/src/comptes-view.js");
const Cal = require("../web/src/calendrier.js");
const Calc = require("../web/src/calc.js");
const UI = require("../web/src/ui.js");
const js = readFileSync(new URL("../web/src/aujourdhui.js", import.meta.url), "utf8");
const jsCV = readFileSync(new URL("../web/src/comptes-view.js", import.meta.url), "utf8");
const sp = s => String(s).replace(/&#39;/g, "'").replace(/[\s\u00a0\u202f]/g, " ");
const TODAY = "2026-10-14";
const J = v => JSON.parse(JSON.stringify(v));
const DEPS = { Calc, Calendrier: Cal, ClaudePrompts: require("../web/src/claude-prompts.js") };
const decode = h => decodeURIComponent(((/q=([^"]*)/.exec(String(h).replace(/&#39;/g, "'"))) || [])[1] || "");

const base = o => Object.assign({ ready: true, dbOk: true, positions: [], snapshots: [], tx: [], config: {}, status: null, profil: { personnes: { p1: { nom: "Alex" } } }, budget: null, objectifs: [],
  risque: null, classes: {}, propositions: [], connexions: [], memoire: [], routines: [], scope: "foyer", people: [{ id: "p1", nom: "Alex" }],
  savoir: { fiches: [], reperes: FIXTURE.reperes }, error: null }, o);
const ligne = (id, env, owner = "p1", status = "actif") => ({ id, name: "Ligne " + id, envelope: env, owner, bloc: "Monde", mode: "manual", value: 1000, status });
const infos = (type, o = {}) => Object.assign({ type, titulaire: "p1", source: "Relevé annuel 2025 (exemple)", le: "2026-02-12" }, o);
/** Foyer : PEA ouvert le 2021-10-24 (5 ans le 2026-10-25, dans 11 jours), assurance-vie de 8 ans passés, PEA sans date, PEL de 2016. */
const foyer = () => base({
  positions: [ligne("a", "PEA Exemple"), ligne("b", "Assurance vie Exemple"), ligne("c", "PEA Vide"), ligne("d", "PEL Exemple"), ligne("e", "Compte Exemple")],
  config: { enveloppes_infos: {
    "PEA Exemple": infos("pea", { date_ouverture: "2021-10-24", versements_cumules: 92000 }),
    "Assurance vie Exemple": infos("assurance_vie", { date_ouverture: "2018-03-01" }),
    "PEA Vide": infos("pea"),
    "PEL Exemple": infos("pel", { date_ouverture: "2016-09-12" }),
  } },
  profil: { personnes: { p1: { nom: "Alex", naissance: "1960-05-20" } } },
});
const ind = (S = foyer()) => A.indicateurs(S, TODAY, { id: "1a" }, DEPS);

/* ---------------------------------------------------------------- échéances et carte « Prochaine échéance » */
test("echeances : les jalons à venir du calendrier (source calendrier) rejoignent jalons, objectifs et points à reprendre ; jamais un jalon passé", () => {
  const S = foyer();
  S.config.milestones = [{ title: "Fin de période d'essai", date: "2026-11-30", text: "" }];
  const e = A.echeances(S, TODAY, DEPS);
  const cal = e.filter(x => x.source === "calendrier");
  assert.ok(cal.length >= 4);
  assert.ok(cal.every(x => x.jalon && x.jalon.statut !== "passe" && x.jours >= 0));
  assert.equal(e[0].source, "calendrier", "le plus proche d'abord : le PEA dans 11 jours");
  assert.equal(e[0].date, "2026-10-25");
  assert.equal(e[0].titre, "PEA Exemple : 5 ans révolus");
  assert.match(e[0].texte, /Un retrait partiel ne clôture plus le plan/);
  assert.ok(e.some(x => x.source === "jalon"), "les jalons de config restent");
  assert.deepEqual(e.map(x => x.jours), [...e.map(x => x.jours)].sort((a, b) => a - b), "triées par date");
  assert.equal(A.echeances(foyer(), TODAY, { Calendrier: null }).filter(x => x.source === "calendrier").length, 0, "moteur absent : rien, sans lever");
});
test("carte « Prochaine échéance » : la plus proche, calendrier compris ; le panneau liste les suivantes et mène à la fiche de l'enveloppe", () => {
  const i = ind();
  assert.equal(i.echeance.prochaine.titre, "PEA Exemple : 5 ans révolus");
  assert.equal(i.echeance.liste.length, 4);
  const html = A.cartes(i, UI, { id: "1a" });
  assert.match(sp(html), /aria-label="Prochaine échéance : dans 11 jours, PEA Exemple : 5 ans révolus, le 25 oct\. 2026, proche"/);
  const d = A.detail("echeance", i, { id: "1a" });
  assert.match(sp(d.contenu), /PEA Exemple : 5 ans révolus/);
  assert.match(d.lien.href, /^#patrimoine\/comptes\?/);
  assert.equal(d.lien.label, "Voir l'enveloppe");
  assert.match(d.contenu, /calendrier de tes enveloppes/);
});
test("indicateurs : calendrier = jalons à venir (5 pour la carte), données à compléter, règles indisponibles ; sans moteur, indisponible", () => {
  const c = ind().calendrier;
  assert.equal(c.disponible, true);
  assert.ok(c.prochains.length <= 5 && c.prochains.every(j => j.statut !== "passe"));
  assert.ok(c.aCompleter.some(a => a.enveloppe === "PEA Vide" && a.champ === "date_ouverture"));
  assert.ok(c.seuils.some(s => s.enveloppe === "PEA Exemple" && s.reste === 58000));
  const sans = A.indicateurs(foyer(), TODAY, { id: "1a" }, { ...DEPS, Calendrier: null }).calendrier;
  assert.equal(sans.disponible, false);
  assert.deepEqual(sans.prochains, []);
});

/* ---------------------------------------------------------------- carte « Prochaines échéances » */
test("prochainesHtml : <ol> de 5 jalons au plus, boutons, <time datetime>, délai, enveloppe, effet, mot d'état en plus de la couleur", () => {
  const h = A.prochainesHtml(ind().calendrier, UI);
  assert.match(h, /^<ol class="aj-ech-liste" role="list" aria-label="Prochaines échéances, par date">/, "role=\"list\" : la liste garde sa sémantique malgré list-style: none (VoiceOver)");
  const lignes = h.match(/<li class="aj-ech-it">/g) || [];
  assert.ok(lignes.length >= 1 && lignes.length <= 5);
  assert.match(h, /<button type="button" class="aj-ech-l t-attention" data-ech="pea_5_ans:PEA Exemple:2026-10-25" aria-haspopup="dialog">/);
  assert.match(h, /<time datetime="2026-10-25">25 oct\. 2026<\/time>/);
  assert.match(sp(h), /dans 11 jours/);
  assert.match(sp(h), /PEA Exemple · 5 ans révolus/);
  assert.match(sp(h), /Un retrait partiel ne clôture plus le plan/);
  assert.match(h, /ui-puce surveiller"><span class="ui-puce-point" aria-hidden="true"><\/span>Bientôt</, "mot d'état « Bientôt » (≤ 92 jours), en puce avec son mot");
  assert.doesNotMatch(h, /à venir</, "plus de puce « à venir » sur chaque ligne : le délai (« dans 4 mois ») suffit");
  assert.match(sp(h), /<span class="ui-sr">Date 25\/10\/2026, date exacte\. Ouvre le détail\.<\/span>/);
});
test("prochainesHtml : 5 lignes au plus, « Et N autres plus tard » ; un jalon approché le dit (badge et phrase)", () => {
  const S = foyer();
  S.config.enveloppes_infos["PEA Exemple"] = infos("pea", { date_ouverture_approx: "2022-03" });
  const c = A.indicateurs(S, TODAY, { id: "1a" }, DEPS).calendrier;
  const h = A.prochainesHtml(c, UI);
  assert.match(h, /ui-badge neutre">approchée</);
  assert.match(sp(h), /<span class="ui-sr">Date au plus tard le 01\/04\/2027\. Ouvre le détail\.<\/span>/);
  assert.doesNotMatch(sp(h), /au plus tard[^<]*au plus tard/, "le mot de confiance n'est dit qu'une fois");
  assert.match(sp(A.prochainesHtml({ ...c, prochains: [{ ...c.prochains[0], cle: "av_70_ans", confiance: "approchee" }] }, UI)), /Date dès le \d{2}\/\d{2}\/\d{4}\. Ouvre le détail\./);
  assert.equal((h.match(/<li class="aj-ech-it">/g) || []).length, 5);
});
test("prochainesHtml : plus de 5 jalons → les 5 premiers et « Et N autres plus tard »", () => {
  const S = foyer();
  ["PEL B", "PEL C"].forEach((n, i) => { S.positions.push(ligne("p" + i, n)); S.config.enveloppes_infos[n] = infos("pel", { date_ouverture: "2019-0" + (i + 3) + "-10" }); });
  const c = A.indicateurs(S, TODAY, { id: "1a" }, DEPS).calendrier;
  assert.equal(c.prochains.length, 5);
  assert.ok(c.nPlus >= 1);
  assert.match(sp(A.prochainesHtml(c, UI)), new RegExp("Et " + c.nPlus + " autres? plus tard\\."));
});
test("prochainesHtml : « N informations à compléter » (bouton) ; état vide honnête, aucune date quand la donnée manque", () => {
  const h = A.prochainesHtml(ind().calendrier, UI);
  assert.match(sp(h), /<button type="button" class="aj-ech-completer" data-ech-completer aria-haspopup="dialog">\d+ informations? à compléter<\/button>/);
  const S = base({ positions: [ligne("a", "PEA Vide"), ligne("b", "PEA Autre", "p1")], config: { enveloppes_infos: { "PEA Vide": infos("pea"), "PEA Autre": infos("pea") } } });
  const v = A.prochainesHtml(A.indicateurs(S, TODAY, { id: "1a" }, DEPS).calendrier, UI);
  assert.match(sp(v), /Aucune échéance connue pour l'instant\./);
  assert.match(sp(v), /Il manque la date d'ouverture de 2 enveloppes\./);
  assert.doesNotMatch(v, /<time /, "aucune date");
  assert.match(sp(v), /Compléter avec Claude/);
  const rien = A.prochainesHtml(A.indicateurs(base(), TODAY, { id: "1a" }, DEPS).calendrier, UI);
  assert.match(sp(rien), /Aucune échéance connue pour l'instant\./);
  assert.match(sp(rien), /Claude les relève dans tes documents/);
  assert.match(A.prochainesHtml({ disponible: false }, UI), /pas disponible/);
});
test("prochainesHtml : règle indisponible signalée (un repère manque), texte échappé", () => {
  const S = foyer();
  S.savoir.reperes = S.savoir.reperes.filter(r => r.cle !== "pea_duree_ans");
  const h = A.prochainesHtml(A.indicateurs(S, TODAY, { id: "1a" }, DEPS).calendrier, UI);
  assert.match(sp(h), /1 règle indisponible : un repère chiffré manque/);
  const X = foyer();
  X.config.enveloppes_infos["PEL <b>"] = infos("pel", { date_ouverture: "2016-09-12" });
  X.positions.push(ligne("z", "PEL <b>"));
  const hx = A.prochainesHtml(A.indicateurs(X, TODAY, { id: "1a" }, DEPS).calendrier, UI);
  assert.doesNotMatch(hx, /<b>/);
  assert.match(hx, /PEL &lt;b&gt;/);
});

/* ---------------------------------------------------------------- boîte et revue mensuelle */
test("boîte : un jalon à 30 jours ou moins devient un élément (urgence 3 ; 2 à 7 jours), vers le calendrier ; aucun élément pour un jalon passé", () => {
  const S = foyer();
  const e = A.boite(S, TODAY, DEPS).filter(x => x.type === "echeance");
  assert.equal(e.length, 1, "le PEA seul est à 30 jours ou moins");
  assert.equal(e[0].titre, "PEA Exemple : 5 ans révolus");
  assert.equal(e[0].urgence, 3);
  assert.deepEqual(J(e[0].action), { label: "Voir l'échéance", route: "aujourdhui?echeances=1" });
  assert.match(e[0].contexte, /^Le 25 oct\. 2026 \(dans 11 jours\)\./);
  const proche = A.boite(S, "2026-10-20", DEPS).filter(x => x.type === "echeance");
  assert.equal(proche[0].urgence, 2, "5 jours");
  const passe = A.boite(S, "2026-10-26", DEPS).filter(x => x.type === "echeance" && /PEA Exemple/.test(x.titre));
  assert.deepEqual(passe, [], "jalon passé : aucun élément");
});
test("revue mensuelle : le contexte ajoute « N échéances dans les 3 prochains mois » (en retard comme prête) ; rien quand il n'y en a pas", () => {
  const routine = (o) => ({ type: "revue_mensuelle", jour: 1, active: true, consentementJournal: true, prochainPassage: "2026-10-01", dernierPassage: "2026-09-01T06:00:00Z", questions: [], ...o });
  const S = foyer(); S.routines = [routine()]; S.routinesLues = true;
  const r = A.boite(S, TODAY, DEPS).find(x => x.type === "routine");
  assert.match(r.contexte, / \d+ échéances? dans les 3 prochains mois\.$/);
  const P = foyer(); P.routines = [routine({ prochainPassage: "2026-11-01", questions: [{ question: "Ton salaire a-t-il changé ?" }] })]; P.routinesLues = true;
  const p = A.boite(P, TODAY, DEPS).find(x => x.type === "routine");
  assert.match(p.contexte, /^Ton salaire a-t-il changé \? · \d+ échéances? dans les 3 prochains mois\.$/);
  const V = base(); V.routines = [routine()]; V.routinesLues = true;
  assert.doesNotMatch(A.boite(V, TODAY, DEPS).find(x => x.type === "routine").contexte, /échéance/);
});

/* ---------------------------------------------------------------- panneaux */
test("jalonDetail : l'effet d'abord, « Comment c'est calculé » (calcul, donnée et sa source, règle et sa source datée, confiance), mention fixe, Demander à Claude", () => {
  const j = ind().calendrier.jalons.find(x => x.cle === "pea_5_ans" && x.enveloppe === "PEA Exemple");
  const d = A.jalonDetail(j);
  assert.equal(d.titre, "PEA Exemple : 5 ans révolus");
  assert.ok(d.contenu.indexOf("aj-det-effet") < d.contenu.indexOf("ui-acc"), "l'effet avant le calcul");
  assert.match(sp(d.contenu), /Un retrait partiel ne clôture plus le plan/);
  assert.match(sp(d.contenu), /Comment c'est calculé/);
  assert.match(sp(d.contenu), /premier versement le 24\/10\/2021 \+ 5 ans → 24\/10\/2026, révolus le 25\/10\/2026/);
  assert.match(sp(d.contenu), /25 octobre 2026 \(date exacte\)/);
  assert.match(sp(d.contenu), /Relevé annuel 2025 \(exemple\), relevée le 12\/02\/2026/);
  assert.match(d.contenu, /<a href="https:\/\/www\.service-public\.gouv\.fr\/particuliers\/vosdroits\/F22449" target="_blank" rel="noopener noreferrer">/);
  assert.match(sp(d.contenu), /vérifiée le 14\/10\/2026/);
  assert.match(sp(d.contenu), /Information générale sur la règle, pas une recommandation\. Vérifie auprès de ton établissement/);
  assert.match(d.lien.href, /^#patrimoine\/comptes\?enveloppe=PEA/);
  assert.match(d.question, /expertise fiscalite-enveloppes/);
  assert.match(d.question, /25\/10\/2026/);
});
test("jalonDetail : jalon du foyer sans lien d'enveloppe ; avertissement de repère à revérifier ; échappement", () => {
  const S = foyer();
  const j = A.indicateurs(S, TODAY, { id: "1a" }, DEPS).calendrier.jalons.find(x => x.cle === "av_abattement_annee");
  assert.equal(A.jalonDetail(j).lien, undefined);
  const x = { ...j, avertissements: ["Chiffre « <i> » à revérifier."], titre: "<b>T</b>", effet: "<i>e</i>" };
  const d = A.jalonDetail(x);
  assert.doesNotMatch(d.contenu, /<i>|<b>/);
  assert.match(d.contenu, /&lt;i&gt;/);
});
test("« Voir l'enveloppe » seulement si l'enveloppe a des lignes (jalonDetail et panneau de la prochaine échéance)", () => {
  const S = foyer();
  S.config.enveloppes_infos["PEL Sans Ligne"] = infos("pel", { date_ouverture: "2014-01-10" }); // informations sans aucune ligne
  const jalons = A.indicateurs(S, TODAY, { id: "1a" }, DEPS).calendrier.jalons;
  const pea = jalons.find(x => x.cle === "pea_5_ans" && x.enveloppe === "PEA Exemple"), pel = jalons.find(x => x.enveloppe === "PEL Sans Ligne");
  assert.ok(pel, "le PEL sans ligne a bien des jalons");
  assert.match(A.jalonDetail(pea, S).lien.href, /^#patrimoine\/comptes\?enveloppe=PEA/);
  assert.equal(A.jalonDetail(pel, S).lien, undefined, "pas de fiche à ouvrir : pas de lien");
  // lignes toutes clôturées : pas de fiche non plus
  const C = foyer(); C.positions.find(p => p.envelope === "PEA Exemple").status = "clôturé";
  assert.equal(A.jalonDetail(pea, C).lien, undefined);
  // sans état fourni, on ne peut pas savoir : le lien reste (comportement antérieur)
  assert.ok(A.jalonDetail(pel).lien);
  // titulaire : les lignes de l'enveloppe appartiennent à l'autre personne
  assert.equal(A.jalonDetail({ ...pea, titulaire: "p2" }, S).lien, undefined);
  // carte « Prochaine échéance » : l'indicateur dit si la fiche existe, le panneau n'envoie pas vers une fiche absente
  assert.equal(A.indicateurs(S, TODAY, { id: "1a" }, DEPS).echeance.enveloppeALignes, true);
  const T = foyer(); T.positions = T.positions.filter(p => p.envelope !== "PEA Exemple");
  const iT = A.indicateurs(T, TODAY, { id: "1a" }, DEPS);
  assert.equal(iT.echeance.prochaine.jalon.enveloppe, "PEA Exemple");
  assert.equal(iT.echeance.enveloppeALignes, false);
  const d = A.detail("echeance", iT, { id: "1a" });
  assert.doesNotMatch(d.lien.href, /comptes\?enveloppe/);
  assert.doesNotMatch(d.lien.label, /enveloppe/);
});
test("aCompleterDetail : chaque donnée avec son pourquoi, où la trouver et « Compléter avec Claude » (phrase prête, lien claude.ai)", () => {
  const l = ind().calendrier.aCompleter;
  const d = A.aCompleterDetail(l, UI);
  assert.match(d.titre, /^\d+ informations? à compléter$/);
  assert.match(sp(d.contenu), /Date d'ouverture de « PEA Vide »/);
  assert.match(sp(d.contenu), /Où la trouver : le relevé annuel du PEA, ou l'attestation d'ouverture/);
  const liens = [...d.contenu.matchAll(/href="(https:\/\/claude\.ai\/new\?q=[^"]*)"/g)].map(m => decode(m[1]));
  assert.equal(liens.length, l.length);
  assert.match(liens.find(x => /PEA Vide/.test(x)), /^Boussole : je veux compléter la date d'ouverture de mon PEA Vide\. Lis cette information dans le document que je te donne, sinon demande-la-moi une seule fois\./);
  assert.equal(A.contexteACompleter({ champ: "naissance", titre: "Date de naissance de Camille" }), "la date de naissance de Camille");
  assert.equal(A.contexteACompleter({ champ: "avis_impot", titre: "x" }), "mon avis d'impôt (plafond épargne retraite)");
  assert.equal(A.contexteACompleter({ champ: "date_fin", enveloppe_nom: "Prêt auto", titre: "x" }), "la date de fin de mon prêt « Prêt auto »");
});
test("calendrierDetail (lien profond ?echeances=1) : jalons à venir par date, passés repliés, données à compléter ; jamais de date sans donnée", () => {
  const d = A.calendrierDetail(ind().calendrier, UI);
  assert.equal(d.titre, "Calendrier patrimonial");
  assert.match(d.contenu, /<ol class="aj-det aj-det-ol aj-det-pile">/);
  assert.match(sp(d.contenu), /Déjà passées \(\d+\)/);
  assert.match(sp(d.contenu), /\d+ informations? à compléter/);
  assert.match(sp(d.contenu), /jamais d'une estimation/);
  const vide = A.calendrierDetail({ jalons: [], aCompleter: [], prochains: [] }, UI);
  assert.match(vide.contenu, /Aucune échéance à venir/);
});
test("accessibilité : liste sémantique, vrais boutons, état en mots, dates en <time>, focus rendu au bouton (surFermeture), clic délégué", () => {
  const h = A.prochainesHtml(ind().calendrier, UI);
  assert.doesNotMatch(h, /<div[^>]*(role="button"|onclick)/);
  assert.match(h, /<ol /);
  assert.ok(!/<li(?![^>]*aj-ech-it)/.test(h), "chaque <li> est une ligne");
  assert.match(js, /\$\("ajEch"\)\.addEventListener\("click"/);
  assert.match(js, /surFermeture: \(\) => \{ if \(!el\.isConnected\)/);
  assert.match(js, /retour: el/);
  assert.match(js, /App\.parametres\(\)/, "lien profond lu une fois au show()");
});
test("aujourdhui.js (calendrier) : tutoiement, aucun « conseiller », aucun produit nommé", () => {
  const bloc = js.slice(js.indexOf("carte « Prochaines échéances » et panneaux du calendrier"), js.indexOf("const STATUT_TXT"));
  assert.ok(bloc.length > 3000);
  assert.equal((bloc.match(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu) || [])[0], undefined);
  assert.equal((bloc.match(/conseill/i) || [])[0], undefined);
});

/* ---------------------------------------------------------------- fiche d'enveloppe */
test("ficheEnveloppe : calendrier de l'enveloppe (jalons, seuil), foyer par type (abattement de l'assurance-vie), dernier jalon passé seulement", () => {
  const S = foyer();
  const pea = CV.ficheEnveloppe(S, { enveloppe: "PEA Exemple" }, TODAY, DEPS);
  assert.deepEqual(pea.calendrier.jalons.map(j => j.cle), ["pea_5_ans"]);
  assert.equal(pea.calendrier.seuils[0].reste, 58000);
  const av = CV.ficheEnveloppe(S, { enveloppe: "Assurance vie Exemple" }, TODAY, DEPS).calendrier;
  assert.deepEqual(av.jalons.map(j => j.cle), ["av_8_ans", "av_abattement_annee", "av_70_ans"], "8 ans passés, abattement du foyer, 70 ans");
  const pel = CV.ficheEnveloppe(S, { enveloppe: "PEL Exemple" }, TODAY, DEPS).calendrier;
  assert.deepEqual(pel.jalons.map(j => j.cle), ["pel_10_ans", "pel_12_ans", "pel_15_ans"], "un seul jalon passé (le dernier), puis ce qui vient");
  const vide = CV.ficheEnveloppe(S, { enveloppe: "Compte Exemple" }, TODAY, DEPS);
  assert.equal(vide.calendrier, null, "enveloppe sans règle : aucune section");
  const sans = CV.ficheEnveloppe(S, { enveloppe: "PEA Exemple" }, TODAY, { ...DEPS, Calendrier: null });
  assert.equal(sans.calendrier, null);
});
test("fiche d'enveloppe : lignes « 5 ans dans … », date à compléter + « Compléter avec Claude », jauge avec texte équivalent, lien vers le calendrier", () => {
  const S = foyer();
  const f = CV.ficheEnveloppe(S, { enveloppe: "PEA Exemple" }, TODAY, DEPS);
  const h = sp(CV.ficheEnveloppeHtml(f, UI, DEPS));
  assert.match(h, /<h3 id="cvEchTitre">Échéances de ce compte<\/h3>/);
  assert.match(h, /<ul class="cv-ech">/);
  assert.match(h, /5 ans révolus<\/span> <span class="cv-ech-q"><time datetime="2026-10-25">dans 11 jours \(25\/10\/2026\)<\/time><\/span> <span class="ui-badge attention">bientôt<\/span>/);
  assert.match(h, /92 000 € versés sur 150 000 €, il reste 58 000 €/);
  assert.match(h, /<div class="cv-seuil-barre" role="img" aria-label="Plafond de versements du PEA : 92 000 € versés sur 150 000 €, il reste 58 000 €">/);
  assert.match(h, /Donnée relevée le 12\/02\/2026 \(Relevé annuel 2025 \(exemple\)\)\./);
  assert.match(h, /<a class="cv-lien" href="#aujourdhui\?echeances=1" data-goto="aujourdhui\?echeances=1">Voir le calendrier<\/a>/);
  const vide = sp(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: "PEA Vide" }, TODAY, DEPS), UI, DEPS));
  assert.match(vide, /<p class="cv-ech-cmp"><span>Date d'ouverture à compléter<\/span>/);
  assert.doesNotMatch(vide, /<ul class="cv-ech">/, "aucune date sans donnée");
  const liens = [...CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: "PEA Vide" }, TODAY, DEPS), UI, DEPS).matchAll(/href="(https:\/\/claude\.ai\/new\?q=[^"]*)"/g)].map(m => decode(m[1]));
  assert.ok(liens.some(x => /je veux compléter la date d'ouverture de mon PEA Vide\./.test(x)));
  const av = sp(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: "Assurance vie Exemple" }, TODAY, DEPS), UI, DEPS));
  assert.match(av, /8 ans révolus<\/span> <span class="cv-ech-q"><time datetime="2020-03-02">depuis le 02\/03\/2020<\/time><\/span> <span class="ui-badge neutre">passé<\/span>|8 ans révolus<\/span> <span class="cv-ech-q"><time datetime="2026-03-02">depuis le 02\/03\/2026/);
  assert.match(av, /70 ans de l'assuré/);
  assert.match(av, /<span class="ui-badge neutre">passé<\/span>/, "le passé est dit en mots");
  const sansCal = sp(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: "Compte Exemple" }, TODAY, DEPS), UI, DEPS));
  assert.doesNotMatch(sansCal, /Échéances de ce compte/);
});
test("fiche d'enveloppe : jalon approché (« au plus tard le … ») et tutoiement du bloc", () => {
  const S = foyer();
  S.config.enveloppes_infos["PEA Exemple"] = infos("pea", { date_ouverture_approx: "2019" });
  const h = sp(CV.ficheEnveloppeHtml(CV.ficheEnveloppe(S, { enveloppe: "PEA Exemple" }, TODAY, DEPS), UI, DEPS));
  assert.match(h, /depuis le 01\/01\/2025/);
  assert.match(h, /<span class="ui-badge neutre">approchée<\/span>/);
  const bloc = jsCV.slice(jsCV.indexOf("Échéances d'une enveloppe (DAT1)"), jsCV.indexOf("/** Fiche enveloppe (f = ficheEnveloppe()) : squelette"));
  assert.ok(bloc.length > 2000);
  assert.equal((bloc.match(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu) || [])[0], undefined);
  assert.equal((bloc.match(/conseill/i) || [])[0], undefined);
});
