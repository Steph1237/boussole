// BQ1 (Powens), côté app (spec docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 5, plan Task 4) :
//   - banque-etat.js : table des états Powens en français, urgences, comptes à rattacher, réel moyen du budget, validation du
//     rattachement (seule copie, partagée par les deux stores et les vues) ;
//   - Agent › Connexion : section « Banques connectées » (banqueHtml, pure ; montage en vm : connecter, reconnecter, rattacher,
//     déconnecter avec confirmation dans la page) ;
//   - Aujourd'hui : reconnexion et comptes à rattacher ; Patrimoine › Budget : « réel (moy. 3 mois) » par catégorie ;
//   - app.js : retour de la page Powens (?connection_id=…, ?error=…) ; account.js : /powens/supprimer avant delete_me ;
//   - stores : S.banque et Store.banque.{connecter, deconnecter, rattacher} (démo exécutée, store Supabase exécuté avec un faux client) ;
//   - compte ignoré (banque_comptes.ignore, « Ne pas suivre ce compte ») : exclu des comptes à rattacher, réversible ;
//   - auth.js : retour Powens retiré de l'URL avant la création du client Supabase (detectSessionInUrl lit tout ?error=).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const BE = require("../web/src/banque-etat.js");
const G = require("../web/src/claude-guide.js");
const A = require("../web/src/aujourdhui.js");
const PV = require("../web/src/plan-view.js");
const AppMod = require("../web/src/app.js");
const UI = require("../web/src/ui.js");
const Plan = require("../web/src/plan.js");
const Calc = require("../web/src/calc.js");
const DEMO = require("../web/src/demo-data.js");
const src = f => readFileSync("web/src/" + f, "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[  ]/g, " ");
const texteDe = h => sp(h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim());
const AUJ = "2026-10-12";
const VOUVOIEMENT = /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu;

const ETATS_POWENS = ["SCARequired", "webauthRequired", "additionalInformationNeeded", "wrongpass", "decoupled", "validating", "actionNeeded",
  "passwordExpired", "rateLimiting", "websiteUnavailable", "bug"];
const cx = (id, etat, o) => Object.assign({ id, etablissement: "Banque " + id, etat, message: null, derniereSynchro: "2026-10-12T05:42:00Z" }, o);
const cpt = (id, connexionId, o) => Object.assign({ id, connexionId, nom: "Compte " + id, type: "courant", solde: 1000, devise: "EUR", soldeLe: "2026-10-12", actif: true,
  positionId: null, enveloppe: null, titulaire: null, creditId: null, ignore: false }, o);
const POSITIONS = [
  { id: "p-livret", name: "Livret A", envelope: "Livrets Camille", owner: "p1", status: "actif" },
  { id: "p-etf", name: "ETF Monde", envelope: "PEA Camille", owner: "p1", status: "actif" },
  { id: "p-vieux", name: "Vieux fonds", envelope: "CTO Sam", owner: "p2", status: "clôturé" },
];
const CREDITS = [{ id: "c-auto", nom: "Prêt auto", owner: "commun", crd: 6500, mensualite: 210 }];
const banque = o => Object.assign({ actif: true, lu: true, connexions: [cx(1, null), cx(2, "SCARequired")], comptes: [cpt(10, 1, { positionId: "p-livret", type: "livret" }), cpt(11, 1), cpt(20, 2, { type: "pea", enveloppe: "PEA Camille", titulaire: "p1" })], mois: [] }, o);
const S0 = o => Object.assign({ ready: true, dbOk: true, positions: POSITIONS, profil: { credits: CREDITS, personnes: { p1: { nom: "Camille" }, p2: { nom: "Sam" } } },
  people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], scope: "foyer", banque: banque() }, o);

/* =================================================================== banque-etat.js =================================================================== */

const A_RECONNECTER = ["SCARequired", "webauthRequired", "additionalInformationNeeded", "wrongpass", "decoupled", "actionNeeded", "passwordExpired"];
test("BanqueEtat : chaque état Powens a un libellé français ; null = à jour ; reconnexion seulement pour les états qui demandent une action", () => {
  assert.deepEqual(Object.keys(BE.ETATS).sort(), [...ETATS_POWENS].sort());
  for (const k of ETATS_POWENS) {
    const e = BE.etat(k);
    assert.equal(e.aJour, false, k);
    assert.ok(e.libelle && !/[A-Z][a-z]+[A-Z]/.test(e.libelle), k + " : libellé français, pas le code");
    assert.doesNotMatch(e.libelle, VOUVOIEMENT, k);
    assert.equal(e.action, A_RECONNECTER.includes(k), k + " : action");
    assert.equal(e.urgence, ["SCARequired", "wrongpass", "webauthRequired", "passwordExpired"].includes(k) ? 1 : A_RECONNECTER.includes(k) ? 2 : null, k);
  }
  assert.deepEqual(J(BE.etat(null)), { code: null, aJour: true, connu: true, libelle: "À jour", action: false, urgence: null });
  assert.equal(BE.etat(undefined).aJour, true);
  const inconnu = BE.etat("nouvelEtat");
  assert.equal(inconnu.aJour, false); assert.equal(inconnu.connu, false); assert.equal(inconnu.action, false, "comme le connecteur : pas de reconnexion réclamée");
  assert.match(inconnu.libelle, /nouvelEtat/);
  assert.ok(BE.etat("SCARequired").action, "SCA : l'utilisateur doit agir");
  assert.equal(BE.etat("websiteUnavailable").action, false, "site indisponible : Powens réessaie seul");
});

test("BanqueEtat : mêmes états et mêmes libellés que le connecteur (ETATS_RECONNEXION, ETATS_LIBELLES de supabase/functions/mcp/banque.ts)", () => {
  const ts = readFileSync("supabase/functions/mcp/banque.ts", "utf8");
  const rec = JSON.parse(ts.match(/export const ETATS_RECONNEXION = (\[[^\]]*\]);/)[1]);
  assert.deepEqual(Object.keys(BE.ETATS).filter(k => BE.ETATS[k].action).sort(), rec.slice().sort());
  const bloc = ts.match(/export const ETATS_LIBELLES[^=]*= \{([\s\S]*?)\};/)[1];
  const lib = Object.fromEntries([...bloc.matchAll(/(\w+): "((?:[^"\\]|\\.)*)"/g)].map(m => [m[1], JSON.parse('"' + m[2] + '"')]));
  assert.deepEqual(Object.keys(lib).sort(), Object.keys(BE.ETATS).sort());
  for (const k of Object.keys(lib)) assert.equal(BE.ETATS[k].libelle, lib[k].charAt(0).toUpperCase() + lib[k].slice(1), k);
});

test("BanqueEtat : comptes à rattacher = actifs sans ligne, enveloppe ni crédit, et suivis (pas ignorés)", () => {
  const b = banque({ comptes: [cpt(1, 1, { positionId: "x" }), cpt(2, 1), cpt(3, 1, { actif: false }), cpt(4, 1, { creditId: "c" }), cpt(5, 1, { enveloppe: "PEA", titulaire: "p1" }),
    cpt(6, 1, { ignore: true })] });
  assert.deepEqual(BE.comptesARattacher(b).map(c => c.id), [2], "le compte ignoré n'est pas à rattacher");
  assert.deepEqual(BE.comptesARattacher(null), []);
  assert.deepEqual(BE.comptesARattacher({ actif: false, comptes: [cpt(2, 1)] }), [], "interrupteur éteint : rien");
});

test("BanqueEtat.reelMoyen : moyenne des 3 derniers mois complets (mois en cours exclu), par catégorie, en positif", () => {
  const m = (mois, categorie, entrees, sorties) => ({ mois, categorie, entrees, sorties, nombre: 3 });
  const mois = [
    m("2026-05-01", "alimentation", 0, 900), // trop ancien
    m("2026-07-01", "alimentation", 0, 700), m("2026-08-01", "alimentation", 30, 830), m("2026-09-01", "alimentation", 0, 760),
    m("2026-10-01", "alimentation", 0, 200), // mois en cours, exclu
    m("2026-07-01", "revenus", 5100, 0), m("2026-08-01", "revenus", 5100, 0), m("2026-09-01", "revenus", 5400, 0),
    m("2026-08-01", "epargne", 0, 650), m("2026-09-01", "epargne", 50, 700), // juillet sans épargne : 0
  ];
  const r = BE.reelMoyen(mois, AUJ);
  assert.equal(r.n, 3);
  assert.deepEqual([r.du, r.au], ["2026-07-01", "2026-09-01"]);
  assert.equal(r.parCategorie.alimentation, (700 + 800 + 760) / 3, "sorties moins remboursements");
  assert.equal(r.parCategorie.revenus, (5100 + 5100 + 5400) / 3);
  assert.equal(r.parCategorie.epargne, (650 + 650) / 3);
  assert.equal(BE.reelMoyen([], AUJ), null);
  assert.equal(BE.reelMoyen([m("2026-10-01", "alimentation", 0, 10)], AUJ), null, "seulement le mois en cours : pas de réel");
  const deux = BE.reelMoyen([m("2026-08-01", "loisirs", 0, 100), m("2026-09-01", "loisirs", 0, 300)], AUJ);
  assert.equal(deux.n, 2, "moins de 3 mois : moyenne sur les mois connus");
  assert.equal(deux.parCategorie.loisirs, 200);
});

test("BanqueEtat : catégorie Boussole d'un titre de budget (accents, casse, « Autres » → divers)", () => {
  assert.equal(BE.categoriePourTitre("Santé"), "sante");
  assert.equal(BE.categoriePourTitre("  impôts "), "impots");
  assert.equal(BE.categoriePourTitre("Épargne"), "epargne");
  assert.equal(BE.categoriePourTitre("Autres"), "divers");
  assert.equal(BE.categoriePourTitre("Crédits"), null);
  assert.deepEqual(BE.CATEGORIES.map(c => c.cle), ["logement", "alimentation", "transport", "enfants", "sante", "loisirs", "abonnements", "impots", "divers", "revenus", "epargne"]);
});

test("BanqueEtat.normRattachement : 5 colonnes toujours écrites (ignore compris), refus en français", () => {
  const ctx = (type, o) => Object.assign({ compte: cpt(1, 1, { type }), positions: POSITIONS, credits: CREDITS }, o);
  assert.deepEqual(J(BE.normRattachement({ positionId: "p-livret" }, ctx("livret"))), { position_id: "p-livret", enveloppe: null, titulaire: null, credit_id: null, ignore: false });
  assert.deepEqual(J(BE.normRattachement({ enveloppe: " PEA Camille ", titulaire: "p1" }, ctx("pea"))), { position_id: null, enveloppe: "PEA Camille", titulaire: "p1", credit_id: null, ignore: false });
  assert.deepEqual(J(BE.normRattachement({ creditId: "c-auto" }, ctx("credit"))), { position_id: null, enveloppe: null, titulaire: null, credit_id: "c-auto", ignore: false });
  assert.deepEqual(J(BE.normRattachement({ aucun: true }, ctx("courant"))), { position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: false });
  // « Ne pas suivre ce compte » : ignore = true et les 4 autres colonnes à null (comme le déclencheur de 0021), pour tout type de compte
  for (const type of ["courant", "livret", "pea", "credit"])
    assert.deepEqual(J(BE.normRattachement({ ignorer: true }, ctx(type))), { position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: true }, type);
  assert.throws(() => BE.normRattachement({ ignorer: true, positionId: "p-livret" }, ctx("livret")), e => e.code === "invalid_argument" && /ne pas suivre/i.test(e.message));
  assert.throws(() => BE.normRattachement({ ignorer: true, aucun: true }, ctx("livret")), e => e.code === "invalid_argument");
  const refus = (cible, c, re) => assert.throws(() => BE.normRattachement(cible, c), e => e.code === "invalid_argument" && re.test(e.message) && !VOUVOIEMENT.test(e.message), re);
  refus({ positionId: "inconnue" }, ctx("livret"), /^Ligne introuvable : choisis une de tes lignes\.$/);
  refus({ positionId: "p-vieux" }, ctx("livret"), /^Ligne introuvable/);
  refus({ enveloppe: "PEA", titulaire: "p3" }, ctx("pea"), /Titulaire « p3 » inconnu/);
  refus({ enveloppe: "", titulaire: "p1" }, ctx("pea"), /Enveloppe/);
  refus({ creditId: "x" }, ctx("credit"), /^Crédit introuvable : choisis un de tes crédits\.$/);
  refus({ creditId: "c-auto" }, ctx("courant"), /Seul un compte de crédit/);
  refus({ positionId: "p-livret" }, ctx("credit"), /compte de crédit se rattache à un crédit/);
  refus({ positionId: "p-livret", enveloppe: "PEA", titulaire: "p1" }, ctx("pea"), /^Rattachement invalide : un compte se rattache à une ligne ou à une enveloppe, pas aux deux\.$/);
  refus(null, ctx("courant"), /Rattachement invalide/);
  refus({}, ctx("courant"), /Rattachement invalide/);
});

test("BanqueEtat : adresse de redirection acceptée seulement chez Powens, en https", () => {
  assert.ok(BE.urlPowensOk("https://webview.powens.com/connect?domain=x.biapi.pro&code=1"));
  assert.ok(BE.urlPowensOk("https://boussole2-sandbox.biapi.pro/2.0/auth/webview/reconnect?code=1"));
  for (const u of ["http://webview.powens.com/connect", "https://powens.com.evil.example/", "javascript:alert(1)", "https://evil.example/?x=webview.powens.com", "", null])
    assert.equal(BE.urlPowensOk(u), false, String(u));
});

/* =================================================================== Agent › Connexion =================================================================== */

test("banqueHtml : rien si l'interrupteur est éteint ou absent ; lecture en cours ; aucune banque", () => {
  assert.equal(G.banqueHtml(S0({ banque: { actif: false, lu: true, connexions: [], comptes: [], mois: [] } }), AUJ), "");
  assert.equal(G.banqueHtml(S0({ banque: undefined }), AUJ), "");
  assert.equal(G.banqueHtml(null, AUJ), "");
  assert.match(texteDe(G.banqueHtml(S0({ banque: banque({ lu: false, connexions: [], comptes: [] }) }), AUJ)), /Lecture de tes banques/);
  const vide = G.banqueHtml(S0({ banque: banque({ connexions: [], comptes: [] }) }), AUJ);
  assert.match(texteDe(vide), /Aucune banque connectée pour le moment/);
  assert.match(vide, /<button type="button" class="cg-btn" data-cg-banque-connecter><svg[^>]*>[\s\S]*?<\/svg>Connecter une banque<\/button>/);
  assert.match(texteDe(vide), /identifiants bancaires .* jamais dans Boussole/i, "Boussole ne voit pas les identifiants");
});

test("banqueHtml : chaque état Powens en français ; pastille « À reconnecter » et bouton « Reconnecter » seulement si l'état demande une action", () => {
  for (const etat of [null, ...ETATS_POWENS]) {
    const h = G.banqueHtml(S0({ banque: banque({ connexions: [cx(7, etat, { etablissement: "Banque test" })], comptes: [] }) }), AUJ), t = texteDe(h);
    assert.ok(t.includes(BE.etat(etat).libelle), etat + " : libellé");
    assert.ok(!t.includes(String(etat)) || etat === null, etat + " : le code Powens n'est pas affiché");
    if (etat === null) assert.match(t, /À jour/);
    if (BE.etat(etat).action) {
      assert.match(h, /<button type="button" class="cg-btn" data-cg-banque-reconnecter="7"><svg[^>]*>[\s\S]*?<\/svg>Reconnecter<span class="cg-sr"> Banque test<\/span><\/button>/, etat);
      assert.match(t, /À reconnecter/);
    } else {
      assert.doesNotMatch(h, /data-cg-banque-reconnecter/, String(etat));
      if (etat !== null) assert.match(t, /Incident passager/, etat);
    }
    assert.match(h, /data-cg-banque-deconnecter="7"/);
  }
  const t = texteDe(G.banqueHtml(S0(), AUJ));
  assert.match(t, /Dernière synchronisation aujourd'hui à 07:42/, "heure de Paris");
  assert.match(texteDe(G.banqueHtml(S0({ banque: banque({ connexions: [cx(1, null, { derniereSynchro: "2026-10-03T21:30:00Z" })] }) }), AUJ)), /le 03\/10 à 23:30/);
  assert.match(texteDe(G.banqueHtml(S0({ banque: banque({ connexions: [cx(1, null, { derniereSynchro: null })] }) }), AUJ)), /Pas encore synchronisée/);
});

test("banqueHtml : comptes avec solde, type, et sélecteur de rattachement (lignes, enveloppes, crédits, aucun) selon le type", () => {
  const S = S0({ banque: banque({ connexions: [cx(1, null)], comptes: [
    cpt(10, 1, { nom: "Livret A", type: "livret", solde: 12000, positionId: "p-livret" }),
    cpt(11, 1, { nom: "PEA", type: "pea", solde: 25443.5, enveloppe: "PEA Camille", titulaire: "p1" }),
    cpt(12, 1, { nom: "Prêt auto", type: "credit", solde: -6500, creditId: "c-auto" }),
    cpt(13, 1, { nom: "Compte Sam", type: "courant", solde: 1180.4 }),
    cpt(14, 1, { nom: "Ancien livret", type: "livret", actif: false }),
    cpt(15, 1, { nom: "Compte à terme", type: "autre" }),
  ] }) });
  const h = sp(G.banqueHtml(S, AUJ)), t = texteDe(h);
  assert.match(t, /Livret A Livret · 12 000,00 € au 12\/10/);
  assert.match(t, /Prêt auto Crédit · [−-]6 500,00 €/);
  assert.match(t, /Ancien livret .*Compte fermé/);
  const sel = id => (h.match(new RegExp('<select id="cgBq-' + id + '" data-cg-banque-compte="' + id + '"[^>]*>([\\s\\S]*?)</select>')) || [])[1];
  const opts = id => [...sel(id).matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map(m => ({ v: m[1], sel: !!m[2], l: m[3] }));
  assert.match(h, /<label for="cgBq-10">Rattaché à<\/label>/, "étiquette liée au sélecteur");
  // livret : lignes ouvertes seulement (pas de clôturée, pas d'enveloppe, pas de crédit), puis « Ne pas suivre ce compte »
  assert.deepEqual(opts(10).map(o => o.v), ["", "pos:p-livret", "pos:p-etf", "ign"]);
  assert.equal(opts(10).find(o => o.v === "ign").l, "Ne pas suivre ce compte");
  assert.equal(opts(10).find(o => o.sel).v, "pos:p-livret");
  // PEA : enveloppes (titulaire compris) et lignes
  assert.ok(opts(11).some(o => o.v === "env:p1:" + encodeURIComponent("PEA Camille") && o.sel), "enveloppe actuelle sélectionnée");
  assert.ok(opts(11).some(o => o.v.startsWith("pos:")));
  assert.ok(!opts(11).some(o => o.v.startsWith("cre:")));
  assert.match(sel(11), /PEA Camille · Camille/);
  // crédit : crédits seulement (et « Ne pas suivre »)
  assert.deepEqual(opts(12).map(o => o.v), ["", "cre:c-auto", "ign"]);
  assert.equal(opts(12)[0].l, "Aucun crédit");
  // non rattaché : « aucune » sélectionnée, et le compte est signalé
  assert.equal(opts(13).find(o => o.sel).v, "");
  assert.equal(opts(13)[0].l, "Aucune", "compte courant : plus de proposition de ligne (0022 : ligne créée par la synchronisation)");
  assert.match(opts(15)[0].l, /nouvelle ligne proposée/, "compte « autre » : proposition de ligne");
  assert.match(t, /Compte Sam .*À rattacher/);
  // rattachement vers une ligne disparue : option conservée et signalée
  const S2 = S0({ banque: banque({ connexions: [cx(1, null)], comptes: [cpt(15, 1, { positionId: "disparue" })] }) });
  assert.match(G.banqueHtml(S2, AUJ), /<option value="pos:disparue" selected>Ligne introuvable<\/option>/);
});

test("banqueHtml : option crédit seulement pour les comptes de type crédit (comme le déclencheur de 0021)", () => {
  for (const type of Object.keys(BE.TYPES)) {
    const vals = G.optionsRattachement(cpt(1, 1, { type }), S0()).map(o => o.valeur);
    if (type === "credit") assert.ok(vals.some(v => v.startsWith("cre:")) && !vals.some(v => v.startsWith("pos:") || v.startsWith("env:")), type);
    else assert.ok(!vals.some(v => v.startsWith("cre:")), type + " : pas de crédit proposé");
  }
  // compte non crédit portant (à tort) un crédit : pas d'option « cre: » sélectionnée, retour à « Aucune »
  const h = G.banqueHtml(S0({ banque: banque({ connexions: [cx(1, null)], comptes: [cpt(30, 1, { type: "courant", creditId: "c-auto" })] }) }), AUJ);
  assert.doesNotMatch(h, /value="cre:/);
  assert.equal(G.cibleDe("cre:c-auto").creditId, "c-auto");
});

test("banqueHtml : compte ignoré affiché discrètement (« Non suivi »), option « Ne pas suivre ce compte » sélectionnée, distincte de « Aucune »", () => {
  const S = S0({ banque: banque({ connexions: [cx(1, null)], comptes: [cpt(40, 1, { nom: "Compte pro", ignore: true }), cpt(41, 1, { nom: "Compte libre" })] }) });
  const h = sp(G.banqueHtml(S, AUJ)), t = texteDe(h);
  assert.match(h, /<li class="cg-bq-cpt ignore">/, "classe discrète");
  assert.match(t, /Compte pro Non suivi/);
  assert.doesNotMatch(t, /Compte pro À rattacher/);
  assert.match(t, /Compte libre À rattacher/);
  const sel40 = h.match(/<select id="cgBq-40"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.match(sel40, /<option value="ign" selected>Ne pas suivre ce compte<\/option>/);
  assert.match(sel40, /<option value="">Aucune<\/option>/, "retour en arrière possible");
  assert.deepEqual(J(G.cibleDe("ign")), { ignorer: true });
  assert.deepEqual(J(G.cibleDe("")), { aucun: true });
});

test("banqueHtml : confirmation de déconnexion dans la page, erreurs en ligne (role=alert)", () => {
  const h = G.banqueHtml(S0(), AUJ, null, { confirmer: 2, erreur: "Panne", erreurs: { 11: "Ligne introuvable : choisis une de tes lignes." } });
  assert.match(h, /<div class="cg-bq-conf" role="group" aria-labelledby="cgBqConf-2"><p id="cgBqConf-2">Déconnecter <b>Banque 2<\/b> \?/);
  assert.match(h, /data-cg-banque-confirmer="2"/);
  assert.match(h, /data-cg-banque-annuler="2"/);
  assert.equal((h.match(/data-cg-banque-confirmer=/g) || []).length, 1, "une seule confirmation à la fois");
  assert.match(texteDe(h), /lignes rattachées restent, en saisie manuelle/);
  assert.match(h, /<p class="cg-rt-err" role="alert">Panne<\/p>/);
  assert.match(h, /<p class="cg-rt-err" role="alert" id="cgBqErr-11">Ligne introuvable : choisis une de tes lignes\.<\/p>/);
  assert.match(h, /<select id="cgBq-11" data-cg-banque-compte="11" aria-describedby="cgBqErr-11"/);
});

test("banqueHtml : échappement de tout texte venu des données (établissement, nom de compte, message, erreurs)", () => {
  const X = '<img src=x onerror="alert(1)">';
  const S = S0({ banque: banque({ connexions: [cx(1, "wrongpass", { etablissement: X, message: X })], comptes: [cpt(10, 1, { nom: X, devise: X })] }), positions: [{ id: 'a"b', name: X, envelope: X, owner: "p1", status: "actif" }] });
  const h = G.banqueHtml(S, AUJ, null, { confirmer: 1, erreur: X, erreurs: { 10: X } });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(h, /value="pos:a"b"/, "identifiant de ligne échappé dans l'attribut");
});

test("banqueHtml : tutoiement dans tous les états", () => {
  for (const etat of [null, ...ETATS_POWENS]) {
    const S = S0({ banque: banque({ connexions: [cx(1, etat)], comptes: [cpt(10, 1), cpt(11, 1, { type: "credit" })] }) });
    assert.doesNotMatch(texteDe(G.banqueHtml(S, AUJ, null, { confirmer: 1 })), VOUVOIEMENT, String(etat));
  }
});

const AIDE_GERER = "Pour ajouter un compte d'une banque déjà connectée (livret, PEA…), utilise « Gérer les comptes » : ne connecte pas la même banque une deuxième fois.";
test("banqueHtml : « Gérer les comptes » sur chaque connexion, quel que soit son état (webview Manage de Powens)", () => {
  for (const etat of [null, ...ETATS_POWENS]) {
    const h = G.banqueHtml(S0({ banque: banque({ connexions: [cx(7, etat, { etablissement: "LCL" })], comptes: [] }) }), AUJ);
    assert.match(h, /<button type="button" class="cg-btn ghost" data-cg-banque-gerer="7"><svg[^>]*>[\s\S]*?<\/svg>Gérer les comptes<span class="cg-sr"> LCL<\/span><\/button>/, String(etat));
  }
  const h = G.banqueHtml(S0(), AUJ);
  assert.deepEqual([...h.matchAll(/data-cg-banque-gerer="(\d+)"/g)].map(m => m[1]), ["1", "2"], "un bouton par connexion");
});

test("banqueHtml : doublon évité — avec une banque connectée, « Connecter une banque » passe sous la liste avec le rappel « Gérer les comptes »", () => {
  const h = G.banqueHtml(S0(), AUJ), t = texteDe(h);
  assert.equal(t.split(AIDE_GERER).length - 1, 1, "rappel affiché une fois");
  const iListe = h.indexOf('<ul class="cg-bq-cx">'), iBouton = h.indexOf("data-cg-banque-connecter"), iAide = h.indexOf("cg-bq-aide");
  assert.ok(iListe >= 0 && iListe < iBouton && iBouton < iAide, "liste, puis « Connecter une banque », puis le rappel juste dessous");
  assert.match(h, /<p class="cg-rt-p cg-bq-aide">Pour ajouter un compte d&#39;une banque déjà connectée \(livret, PEA…\), utilise « Gérer les comptes » : ne connecte pas la même banque une deuxième fois\.<\/p>/);
  // Sans connexion (ou pendant la lecture) : pas de rappel, bouton en tête.
  for (const b of [banque({ connexions: [], comptes: [] }), banque({ lu: false, connexions: [], comptes: [] })]) {
    const v = G.banqueHtml(S0({ banque: b }), AUJ);
    assert.ok(!texteDe(v).includes(AIDE_GERER));
    assert.match(v, /data-cg-banque-connecter/);
  }
  // L'erreur générale suit le bouton.
  const e = G.banqueHtml(S0(), AUJ, null, { erreur: "Panne" });
  assert.ok(e.indexOf("data-cg-banque-connecter") < e.indexOf('<p class="cg-rt-err" role="alert">Panne</p>'));
  assert.doesNotMatch(t, VOUVOIEMENT);
});

test("claude-guide.html : section « Banques connectées » après « Ta revue mensuelle », masquée par défaut, zone d'état", () => {
  const html = src("claude-guide.html");
  assert.match(html, /<section class="panel cg-banques" id="cgBanques" aria-labelledby="cgBqTitle" hidden>/);
  assert.match(html, /<h2 id="cgBqTitle">Banques connectées<\/h2>/);
  assert.ok(html.indexOf('id="cgRoutines"') < html.indexOf('id="cgBanques"') && html.indexOf('id="cgBanques"') < html.indexOf('id="cgAltTitle"'));
  assert.match(html, /<p class="cg-msg ok" id="cgBqMsg" role="status" aria-live="polite"><\/p>/);
  const js = src("claude-guide.js");
  assert.match(js, /banqueHtml\(S, RE\(\)\.aujParis\(\), window\.UI \|\| null, etatBq\)/);
  for (const k of ["window.Store.banque.connecter(", "window.Store.banque.gerer(", "window.Store.banque.deconnecter(", "window.Store.banque.rattacher(", "window.location.assign(res.url)"]) assert.ok(js.includes(k), k);
  assert.doesNotMatch(js.replace(/\/\*[\s\S]*?\*\//g, ""), /\bconfirm\(/, "pas de confirm() natif");
});

/* ---------- montage en vm (mini-DOM) : Store.banque espionné ---------- */
function guideVm(reponses, S) {
  const dom = miniDom(), { doc } = dom, reg = {}, appels = [], assigns = [];
  const repondre = async (nom, args) => {
    appels.push([nom, ...args]);
    await new Promise(r => setImmediate(r));
    const x = reponses.shift();
    if (x instanceof Error) throw x;
    return x;
  };
  const ctx = { document: doc, console, Intl, Date, Math, JSON, encodeURIComponent, decodeURIComponent, navigator: {},
    setTimeout: () => 0, clearTimeout() {}, location: { assign: u => assigns.push(u) },
    App: { register: (n, a) => { reg[n] = a; } },
    Store: { mode: "supabase", routines: { pause: async () => ({ ok: true }) }, banque: {
      connecter: (...a) => repondre("connecter", a), gerer: (...a) => repondre("gerer", a), deconnecter: (...a) => repondre("deconnecter", a), rattacher: (...a) => repondre("rattacher", a),
      synchroniser: (...a) => repondre("synchroniser", a) } } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["claude-prompts.js", "routine-etat.js", "banque-etat.js"]) vm.runInContext(src(f), ctx, { filename: f });
  vm.runInContext(src("claude-guide.js"), ctx, { filename: "claude-guide.js" });
  const root = doc.body.appendChild(doc.createElement("section"));
  root.innerHTML = src("claude-guide.html");
  const api = reg["claude-guide"];
  api.mount(root);
  api.update(Object.assign({ ready: true, dbOk: true, routinesLues: true, routines: [], propositions: [] }, S || S0()), true);
  const fin = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r)); };
  const $ = sel => root.querySelector(sel);
  return { doc, dom, root, api, appels, assigns, fin, $, msg: () => $("#cgBqMsg").textContent };
}

test("Banques (vm) : section visible seulement si S.banque.actif", () => {
  const v = guideVm([]);
  assert.equal(v.$("#cgBanques").hidden, false);
  assert.ok(v.$("[data-cg-banque-connecter]"));
  v.api.update(S0({ banque: { actif: false, lu: true, connexions: [], comptes: [], mois: [] } }), true);
  assert.equal(v.$("#cgBanques").hidden, true);
});

test("Banques (vm) : « Connecter une banque » → Store.banque.connecter() puis redirection ; erreur affichée en ligne", async () => {
  const v = guideVm([{ ok: true, url: "https://webview.powens.com/connect?code=abc" }, { erreur: "La connexion bancaire n'est pas encore ouverte pour ton compte." }]);
  const b = v.$("[data-cg-banque-connecter]");
  b.click(); b.click();
  assert.equal(b.getAttribute("aria-busy"), "true");
  await v.fin();
  assert.deepEqual(v.appels, [["connecter"]], "un seul appel, sans identifiant de connexion");
  assert.deepEqual(v.assigns, ["https://webview.powens.com/connect?code=abc"]);
  assert.match(v.msg(), /Ouverture de la page de connexion/);
  v.$("[data-cg-banque-connecter]").click();
  await v.fin();
  assert.equal(v.assigns.length, 1, "pas de redirection en cas d'erreur");
  const err = v.$("#cgBanquesCorps").querySelector(".cg-rt-err");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(err.textContent, "La connexion bancaire n'est pas encore ouverte pour ton compte.");
  assert.equal(v.doc.activeElement, v.$("[data-cg-banque-connecter]"), "focus rendu au bouton");
  assert.ok(!v.$("[data-cg-banque-connecter]").disabled);
});

test("Banques (vm) : « Reconnecter » passe l'identifiant de la connexion ; exception → message générique", async () => {
  const v = guideVm([new Error("fetch failed")]);
  v.$('[data-cg-banque-reconnecter="2"]').click();
  await v.fin();
  assert.deepEqual(v.appels, [["connecter", 2]]);
  assert.equal(v.$("#cgBanquesCorps").querySelector(".cg-rt-err").textContent, "Connexion bancaire impossible pour le moment. Réessaie.");
  assert.equal(v.assigns.length, 0);
});

test("Banques (vm) : « Gérer les comptes » → Store.banque.gerer(id) puis redirection vers la page Powens ; erreur en ligne, focus rendu", async () => {
  const URL_MANAGE = "https://webview.powens.com/manage?domain=x.biapi.pro&code=abc&connection_id=1";
  const v = guideVm([{ ok: true, url: URL_MANAGE }, { erreur: "Connexion introuvable." }]);
  const b = v.$('[data-cg-banque-gerer="1"]');
  b.click(); b.click();
  assert.equal(b.getAttribute("aria-busy"), "true");
  await v.fin();
  assert.deepEqual(v.appels, [["gerer", 1]], "un seul appel, avec l'identifiant de la connexion");
  assert.deepEqual(v.assigns, [URL_MANAGE]);
  assert.match(v.msg(), /Ouverture de la page de gestion de Powens/);
  v.$('[data-cg-banque-gerer="2"]').click();
  await v.fin();
  assert.deepEqual(v.appels[1], ["gerer", 2]);
  assert.equal(v.assigns.length, 1, "pas de redirection en cas d'erreur");
  assert.equal(v.$("#cgBanquesCorps").querySelector(".cg-rt-err").textContent, "Connexion introuvable.");
  assert.equal(v.doc.activeElement, v.$('[data-cg-banque-gerer="2"]'), "focus rendu au bouton");
});

test("Banques (vm) : rattachement par sélecteur → Store.banque.rattacher(id, cible) ; message ; erreur sous le compte, focus rendu", async () => {
  const v = guideVm([{ ok: true }, { ok: true }, { ok: true }, { erreur: "Ligne introuvable : choisis une de tes lignes." }]);
  const changer = (id, valeur) => { const s = v.$('[data-cg-banque-compte="' + id + '"]'); s.value = valeur; v.dom.changer(s); return s; };
  changer(11, "pos:p-etf"); await v.fin();
  changer(20, "env:p2:" + encodeURIComponent("CTO Sam")); await v.fin();
  changer(10, ""); await v.fin();
  assert.deepEqual(J(v.appels), [["rattacher", 11, { positionId: "p-etf" }], ["rattacher", 20, { enveloppe: "CTO Sam", titulaire: "p2" }], ["rattacher", 10, { aucun: true }]]);
  assert.match(v.msg(), /« Compte 10 » n'est plus rattaché/);
  changer(11, "pos:p-livret"); await v.fin();
  const err = v.$("#cgBqErr-11");
  assert.equal(err.textContent, "Ligne introuvable : choisis une de tes lignes.");
  assert.equal(v.doc.activeElement, v.$('[data-cg-banque-compte="11"]'), "focus rendu au sélecteur");
  assert.equal(v.$('[data-cg-banque-compte="11"]').getAttribute("aria-describedby"), "cgBqErr-11");
});

test("Banques (vm) : « Ne pas suivre ce compte » → rattacher(id, { ignorer: true }) ; le compte passe « Non suivi » ; retour en arrière", async () => {
  const v = guideVm([{ ok: true }, { ok: true }]);
  const changer = (id, valeur) => { const s = v.$('[data-cg-banque-compte="' + id + '"]'); s.value = valeur; v.dom.changer(s); return s; };
  changer(11, "ign"); await v.fin();
  assert.deepEqual(J(v.appels), [["rattacher", 11, { ignorer: true }]]);
  assert.match(v.msg(), /« Compte 11 » n'est plus suivi/);
  assert.ok(v.$('[data-cg-banque-compte="11"]').closest(".ignore"), "affiché discrètement");
  assert.equal(v.doc.activeElement, v.$('[data-cg-banque-compte="11"]'), "focus rendu au sélecteur");
  changer(11, ""); await v.fin();
  assert.deepEqual(J(v.appels[1]), ["rattacher", 11, { aucun: true }]);
  assert.equal(v.$('[data-cg-banque-compte="11"]').closest(".ignore"), null, "de nouveau suivi");
});

test("Banques (vm) : « Déconnecter » demande une confirmation dans la page ; Annuler rend le focus ; Confirmer appelle deconnecter", async () => {
  const v = guideVm([{ ok: true }]);
  v.$('[data-cg-banque-deconnecter="2"]').click();
  assert.ok(v.$('[data-cg-banque-confirmer="2"]'), "confirmation affichée");
  assert.equal(v.doc.activeElement, v.$('[data-cg-banque-confirmer="2"]'), "focus sur la confirmation");
  assert.deepEqual(v.appels, [], "rien n'est appelé avant confirmation");
  v.$('[data-cg-banque-annuler="2"]').click();
  assert.equal(v.$("[data-cg-banque-confirmer]"), null);
  assert.equal(v.doc.activeElement, v.$('[data-cg-banque-deconnecter="2"]'), "focus rendu au bouton Déconnecter");
  v.$('[data-cg-banque-deconnecter="2"]').click();
  v.$('[data-cg-banque-confirmer="2"]').click();
  await v.fin();
  assert.deepEqual(v.appels, [["deconnecter", 2]]);
  assert.match(v.msg(), /Banque 2 déconnectée/);
  assert.equal(v.doc.activeElement, v.$("[data-cg-banque-connecter]"));
});

/* =================================================================== Aujourd'hui =================================================================== */

const vide = o => Object.assign({ ready: true, dbOk: true, positions: [], snapshots: [], tx: [], config: {}, status: null, profil: null, budget: null, objectifs: [],
  risque: null, classes: {}, propositions: [], connexions: [], memoire: [], scope: "foyer", people: [{ id: "p1", nom: "Camille" }], error: null }, o);
const sansRegles = { Rules: null };

test("Aujourd'hui : reconnexion (urgence 1 pour SCA, mot de passe…, sinon 2) et comptes à rattacher (urgence 2) vers Agent › Connexion", () => {
  const b = A.boite(vide({ banque: banque({ connexions: [cx(1, null), cx(2, "SCARequired", { etablissement: "Néo Courtage" }), cx(3, "decoupled", { etablissement: "Banque B" }),
    cx(4, "websiteUnavailable", { etablissement: "Banque C" })], comptes: [cpt(10, 1), cpt(11, 1, { nom: "Livret" }), cpt(12, 1, { positionId: "x" })] }) }), AUJ, sansRegles)
    .filter(x => x.type === "banque");
  const par = t => b.find(x => x.titre === t);
  assert.equal(par("Néo Courtage : reconnecte ta banque").urgence, 1);
  assert.equal(par("Banque B : reconnecte ta banque").urgence, 2);
  assert.equal(par("Synchronisation de Banque C interrompue"), undefined, "incident passager : rien dans Aujourd'hui");
  assert.match(par("Néo Courtage : reconnecte ta banque").contexte, new RegExp(BE.etat("SCARequired").libelle));
  const r = par("2 comptes à rattacher");
  assert.equal(r.urgence, 2);
  assert.match(r.contexte, /Compte 10, Livret/);
  for (const x of b) assert.equal(x.action.route, "agent/connexion");
  assert.equal(b.length, 3, "rien pour une connexion à jour ni pour un incident passager");
  assert.deepEqual(A.boite(vide({ banque: banque({ actif: false }) }), AUJ, sansRegles).filter(x => x.type === "banque"), [], "interrupteur éteint");
  assert.deepEqual(A.boite(vide(), AUJ, sansRegles).filter(x => x.type === "banque"), [], "store sans banque");
  assert.equal(A.boite(vide({ banque: banque({ comptes: [cpt(10, 1)], connexions: [cx(1, null)] }) }), AUJ, sansRegles).find(x => x.type === "banque").titre, "1 compte à rattacher");
  assert.deepEqual(A.boite(vide({ banque: banque({ comptes: [cpt(10, 1, { ignore: true })], connexions: [cx(1, null)] }) }), AUJ, sansRegles).filter(x => x.type === "banque"), [], "compte ignoré : rien à rattacher");
});

test("Aujourd'hui : établissement échappé au rendu ; type « banque » nommé pour les lecteurs d'écran", () => {
  const b = A.boite(vide({ banque: banque({ connexions: [cx(1, "wrongpass", { etablissement: "<b>x</b>" })], comptes: [] }) }), AUJ, sansRegles);
  const h = A.boiteHtml(b, UI);
  assert.doesNotMatch(h, /<b>x<\/b>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(h, /data-type="banque"/);
  assert.match(h, /Banque connectée, urgent : /);
});

/* =================================================================== Budget =================================================================== */

const PEOPLE = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }];
test("Budget : « réel (moy. 3 mois) » par catégorie à côté du prévu, hors budget listé, ×12 par an", () => {
  const lignes = [{ id: "a", type: "depense", categorie: "Alimentation", libelle: "Courses", montant: 750, frequence: "mois" },
    { id: "s", type: "depense", categorie: "Santé", libelle: "Mutuelle", montant: 60, frequence: "mois" },
    { id: "e", type: "epargne", categorie: "Épargne", libelle: "Livret", montant: 200, frequence: "mois" }];
  const { groupes, totaux } = PV.regrouper(lignes, { profil: null, scope: "foyer", people: PEOPLE, Plan, Calc });
  const reel = { n: 3, du: "2026-07-01", au: "2026-09-01", parCategorie: { alimentation: 790, sante: 48.4, loisirs: 120, epargne: 650, revenus: 5200 } };
  const h = sp(PV.groupesHtml(groupes, { mode: "mois", totaux, U: UI, reel }));
  const cat = t => (h.match(new RegExp('data-pv-cat="' + t + '"[\\s\\S]*?</summary>')) || [""])[0];
  assert.match(cat("depense:Alimentation"), /<span class="pv-cat-reel" aria-hidden="true"><span class="pv-reel-l">réel<\/span> 790 €\/mois<\/span>/);
  assert.match(cat("depense:Alimentation"), /<span class="ui-sr">, réel moyen sur 3 mois : 790 €\/mois<\/span>/);
  assert.match(cat("depense:Santé"), /réel<\/span> 48 €\/mois/);
  assert.match(cat("epargne:Épargne"), /réel<\/span> 650 €\/mois/);
  assert.match(texteDe(h), /Dans tes comptes, hors budget : Loisirs \(réel 120 €\/mois\)/);
  assert.doesNotMatch(texteDe(h), /hors budget[^.]*Revenus/, "les revenus ne sont pas des dépenses hors budget");
  const an = sp(PV.groupesHtml(groupes, { mode: "an", totaux, U: UI, reel }));
  assert.match(an, /réel<\/span> 9 480 €\/an/);
  assert.doesNotMatch(sp(PV.groupesHtml(groupes, { mode: "mois", totaux, U: UI })), /pv-cat-reel|hors budget/, "sans banque : rendu inchangé");
});

test("Budget : réel calculé depuis S.banque.mois (foyer seulement, interrupteur actif), note de période", () => {
  const S = { scope: "foyer", banque: banque({ mois: [{ mois: "2026-09-01", categorie: "loisirs", entrees: 0, sorties: 90, nombre: 2 }] }) };
  assert.equal(PV.reelDe(S, AUJ).parCategorie.loisirs, 90);
  assert.equal(PV.reelDe(Object.assign({}, S, { scope: "p1" }), AUJ), null, "les comptes ne sont pas répartis par personne");
  assert.equal(PV.reelDe(Object.assign({}, S, { banque: Object.assign({}, S.banque, { actif: false }) }), AUJ), null);
  assert.equal(PV.reelDe({ scope: "foyer" }, AUJ), null);
  assert.equal(PV.noteReel({ n: 3, du: "2026-07-01", au: "2026-09-01" }), "« Réel » : moyenne de juillet à septembre 2026, d'après tes comptes connectés.");
  assert.equal(PV.noteReel({ n: 1, du: "2026-09-01", au: "2026-09-01" }), "« Réel » : septembre 2026, d'après tes comptes connectés.");
  assert.match(src("plan-view.js"), /PV_NOTE|noteReel\(reel\)/);
});

/* =================================================================== retour de Powens (app.js) =================================================================== */

test("BanqueEtat.retourPowens : retour filtré par /powens/retour (?connection_id=<chiffres> | ?error=<code>), libellés français, sans error_description", () => {
  assert.deepEqual(J(BE.retourPowens("?connection_id=42")), { ok: true, message: "Connexion enregistrée, synchronisation en cours.", recherche: "" });
  assert.equal(BE.retourPowens("?demo&connection_id=42").recherche, "?demo=", "les autres paramètres sont gardés");
  assert.deepEqual(J(BE.retourPowens("?error=access_denied")), { ok: false, message: "Connexion annulée.", recherche: "" });
  for (const code of ["wrongpass", "server_error", "temporarily_unavailable", "invalid_request", "nouveau_code"]) {
    const r = BE.retourPowens("?error=" + code);
    assert.equal(r.ok, false, code);
    assert.ok(r.message && !r.message.includes(code), code + " : le code n'est jamais affiché");
    assert.doesNotMatch(r.message, VOUVOIEMENT, code);
  }
  assert.equal(BE.retourPowens("?error=nouveau_code").message, "La connexion à ta banque n'a pas abouti. Réessaie depuis Agent › Connexion.", "message générique");
  assert.match(BE.retourPowens("?error=server_error").message, /momentanément indisponible/);
  assert.equal(BE.retourPowens("?connection_id=7&error=access_denied").ok, false, "erreur prioritaire");
  // pas un retour Powens : valeurs hors format (le retour les filtre), ou retour d'authentification Supabase (laissé à supabase-js)
  for (const q of ["", "?demo", "?connection_id=<script>", "?error=Access%20Denied", "?error=access_denied&error_description=User%20cancelled",
    "?error=server_error&error_code=bad_oauth_state", "?code=abc", null])
    assert.equal(BE.retourPowens(q), null, String(q));
});

test("app.js : retour de Powens → message (BanqueEtat.retourPowens), paramètres retirés de l'URL, Agent › Connexion, rechargements", () => {
  assert.deepEqual(J(AppMod.retourBanque("?connection_id=42")), J(BE.retourPowens("?connection_id=42")));
  assert.equal(AppMod.retourBanque("?error=access_denied").message, "Connexion annulée.");
  assert.equal(AppMod.retourBanque("?error=access_denied&error_description=x"), null, "retour d'authentification : pas un message bancaire");
  assert.equal(AppMod.retourBanque(""), null);
  const app = src("app.js");
  assert.match(app, /const retour = retourBanque\(window\.BOUSSOLE_RETOUR_BANQUE \|\| location\.search\)/, "query d'origine gardée par auth.js");
  assert.match(app, /history\.replaceState\(null, "", location\.pathname \+ retour\.recherche \+ "#agent\/connexion"\)/);
  assert.match(app, /\[5000, 15000\]\.forEach\(ms => setTimeout\(\(\) => Store\.reload\(\), ms\)\)/);
  assert.match(app, /route = resolve\("agent\/connexion"\)/);
  const shell = src("shell.html");
  assert.match(shell, /<div id="banqueBanner" class="banner retour" role="status" hidden><span id="banqueBannerTxt"><\/span><button type="button" class="banner-x" id="banqueBannerClose" aria-label="Masquer ce message">×<\/button><\/div>/);
  assert.match(app, /\$\("banqueBannerTxt"\)\.textContent = retour\.message/, "texte posé sans HTML");
});

/* ---------- auth.js exécuté : l'URL du retour est nettoyée AVANT createClient (detectSessionInUrl) ---------- */
function authRetour(search, avecBE = true) {
  const vu = [];
  const location = { search, pathname: "/boussole/app.html", hash: "#agent/connexion", href: "https://ex.org/boussole/app.html" + search + "#agent/connexion" };
  const history = { state: { x: 1 }, replaceState(st, t, url) { const u = new URL(url, "https://ex.org"); location.search = u.search; location.hash = u.hash; location.href = u.href; vu.push([st, url]); } };
  const auth = { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
  const window = { BOUSSOLE: { supabaseUrl: "https://x.supabase.co", supabaseKey: "k", base: "./" }, location, history,
    supabase: { createClient: () => { vu.push(["createClient", location.search]); return { auth }; } } };
  const ctx = { window, location, history, URL, URLSearchParams, console };
  vm.createContext(ctx);
  if (avecBE) vm.runInContext(src("banque-etat.js"), ctx, { filename: "banque-etat.js" }); // window.BanqueEtat, chargé avant auth.js (build.mjs)
  vm.runInContext(src("auth.js"), ctx, { filename: "auth.js" });
  return { window, location, vu };
}

test("auth.js (exécuté) : ?connection_id / ?error de Powens retirés de l'URL avant la création du client Supabase ; query d'origine gardée pour app.js", () => {
  const a = authRetour("?error=access_denied");
  assert.deepEqual(a.vu.map(x => x[0] === "createClient" ? x : "replaceState"), ["replaceState", ["createClient", ""]], "nettoyée avant createClient");
  assert.equal(a.location.hash, "#agent/connexion", "ancre gardée");
  assert.equal(a.window.BOUSSOLE_RETOUR_BANQUE, "?error=access_denied");
  const b = authRetour("?demo&connection_id=42");
  assert.equal(b.location.search, "?demo=");
  assert.equal(b.window.BOUSSOLE_RETOUR_BANQUE, "?demo&connection_id=42");
  // retour d'authentification Supabase (error_description) : laissé à supabase-js
  const c = authRetour("?error=access_denied&error_description=x");
  assert.deepEqual(c.vu, [["createClient", "?error=access_denied&error_description=x"]]);
  assert.equal(c.window.BOUSSOLE_RETOUR_BANQUE, undefined);
  // page sans banque-etat.js (index.html, compte.html) : rien ne change
  assert.deepEqual(authRetour("?error=access_denied", false).vu, [["createClient", "?error=access_denied"]]);
});

/* =================================================================== suppression du compte (account.js) =================================================================== */

/* account.js exécuté : faux document (éléments créés à la demande), faux Auth, faux fetch. */
async function compteVm({ fetchRep, jeton = "jeton-factice" } = {}) {
  const els = {}, appels = [], fetchs = [], remplace = [];
  const el = id => (els[id] ||= { id, value: "", textContent: "", className: "", hidden: false, disabled: false, type: "", innerHTML: "", ls: {},
    addEventListener(t, f) { (this.ls[t] ||= []).push(f); }, querySelector() { return null; }, focus() {} });
  const user = { id: "u1", email: "camille@example.org" };
  const requete = table => { const f = { table }; const b = {}; for (const m of ["select", "eq", "order"]) b[m] = () => b; b.maybeSingle = () => b;
    b.then = (ok, ko) => { appels.push(table); return Promise.resolve({ data: null, error: null }).then(ok, ko); }; return b; };
  const client = { from: requete, rpc: async n => { appels.push("rpc:" + n); return { data: null, error: null }; }, auth: { signOut: async () => ({}) } };
  const Auth = { client, session: async () => (jeton ? { access_token: jeton, user } : null), requireSession: async () => ({ access_token: jeton, user }), isAnonymous: () => false,
    onChange() {}, signOut: async () => {}, urls: { home: () => "https://ex.org/index.html", connexion: () => "https://ex.org/index.html#connexion" }, passwordProblem: () => null };
  const ctx = { console, setTimeout, clearTimeout, URL, Blob: class {},
    document: { getElementById: el, addEventListener() {}, createElement: () => el("tmp"), body: { appendChild() {} } },
    location: { href: "https://ex.org/compte.html", pathname: "/compte.html", search: "", hash: "", replace: u => remplace.push(u) },
    navigator: {}, BOUSSOLE: { supabaseUrl: "https://projet.supabase.co/" }, Auth,
    fetch: async (url, init) => { fetchs.push({ url, init }); appels.push("fetch"); const x = typeof fetchRep === "function" ? fetchRep() : fetchRep || { status: 200, body: { ok: true } }; if (x instanceof Error) throw x;
      return { ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => x.body }; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("account.js"), ctx, { filename: "account.js" });
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  const supprimer = async () => {
    el("delConfirm").value = user.email;
    el("delForm").ls.submit[0]({ preventDefault() {} });
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
  };
  return { appels, fetchs, remplace, supprimer, msg: () => el("delMsg").textContent, btn: el("delBtn") };
}

test("account.js (exécuté) : /powens/supprimer toujours appelé avant delete_me, sans lire fonctionnalites ni S.banque", async () => {
  const v = await compteVm();
  const avant = v.appels.length;
  await v.supprimer();
  const flux = v.appels.slice(avant);
  assert.deepEqual(flux, ["fetch", "rpc:delete_me"], "Powens d'abord, puis delete_me ; aucune lecture de fonctionnalites");
  assert.equal(v.fetchs[0].url, "https://projet.supabase.co/functions/v1/powens/supprimer");
  assert.equal(v.fetchs[0].init.method, "POST");
  assert.equal(v.fetchs[0].init.headers.Authorization, "Bearer jeton-factice");
  assert.deepEqual(v.remplace, ["https://ex.org/index.html?compte-supprime"]);
  assert.doesNotMatch(src("account.js"), /fonctionnalites|banqueActive/, "plus de condition sur l'interrupteur");
});

test("account.js (exécuté) : échec réseau, 5xx ou autre refus → suppression bloquée avec un message ; 401 → session expirée", async () => {
  const cas = [
    [new TypeError("Failed to fetch"), /^Suppression impossible : connexion au serveur impossible\. Ton compte est conservé\. Vérifie ta connexion internet et réessaie\.$/],
    [{ status: 503, body: { error: "Connexion bancaire non configurée." } }, /^Suppression impossible : la déconnexion de tes banques \(Powens\) n'a pas abouti, ton compte est conservé\. Réessaie dans un instant\.$/],
    [{ status: 502, body: {} }, /n'a pas abouti, ton compte est conservé/],
    [{ status: 404 }, /n'a pas abouti, ton compte est conservé/],
    [{ status: 401, body: { error: "Invalid JWT" } }, /^Ta session a expiré\. Reconnecte-toi, puis recommence la suppression\. Ton compte est conservé\.$/],
  ];
  for (const [rep, re] of cas) {
    const v = await compteVm({ fetchRep: rep });
    const avant = v.appels.length;
    await v.supprimer();
    assert.deepEqual(v.appels.slice(avant), ["fetch"], String(rep.status || rep) + " : delete_me n'est pas appelé");
    assert.match(v.msg(), re, String(rep.status || rep));
    assert.doesNotMatch(v.msg(), VOUVOIEMENT);
    assert.deepEqual(v.remplace, []);
    assert.equal(v.btn.textContent, "Supprimer définitivement");
  }
  const s = await compteVm({ jeton: null });
  const avant = s.appels.length;
  await s.supprimer();
  assert.deepEqual(s.appels.slice(avant), [], "sans session : rien n'est envoyé");
  assert.match(s.msg(), /^Ta session a expiré/);
});

/* =================================================================== stores =================================================================== */

function demoStore(prep) {
  const ctx = { console, setTimeout, clearTimeout, location: { href: "http://x/app.html?demo", search: "?demo", hash: "" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["demo-data.js", "sensible.js", "routine-etat.js", "banque-etat.js"]) vm.runInContext(src(f), ctx, { filename: f });
  if (prep) prep(ctx.DEMO);
  vm.runInContext(src("store-demo.js"), ctx, { filename: "store-demo.js" });
  return ctx;
}
const pret = ctx => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("jamais prêt")), 2000);
  const ok = S => { if (S.ready) { clearTimeout(t); res(S); } };
  ctx.Store.on(ok); ok(ctx.Store.get());
});
const BQ_KEYS = ["actif", "comptes", "connexions", "lu", "mois"];
const CX_KEYS = ["derniereSynchro", "doublonDe", "etablissement", "etat", "id", "message"];
const CPT_KEYS = ["actif", "connexionId", "creditId", "creeAuto", "devise", "doublonDe", "enveloppe", "id", "ignore", "nom", "positionId", "rattacheAuto", "solde", "soldeLe", "suggestion", "titulaire", "type"];
const MOIS_KEYS = ["categorie", "compteId", "entrees", "mois", "nombre", "sorties"];

test("démo : S.banque au contrat — 2 connexions (une à jour, une SCARequired), 6 comptes dont un non rattaché et un ignoré, 6 mois de totaux cohérents", async () => {
  const ctx = demoStore();
  const S = await pret(ctx), b = S.banque;
  assert.deepEqual(Object.keys(b).sort(), BQ_KEYS);
  assert.equal(b.actif, true); assert.equal(b.lu, true);
  assert.equal(b.connexions.length, 2);
  b.connexions.forEach(c => assert.deepEqual(Object.keys(c).sort(), CX_KEYS));
  assert.deepEqual(J(b.connexions.map(c => c.etat)).sort(), [null, "SCARequired"].sort());
  assert.equal(b.comptes.length, 6);
  const ign = b.comptes.filter(c => c.ignore === true);
  assert.equal(ign.length, 1, "un compte ignoré (« Non suivi »)");
  assert.deepEqual([ign[0].positionId, ign[0].enveloppe, ign[0].titulaire, ign[0].creditId], [null, null, null, null], "ignoré : aucun rattachement");
  b.comptes.forEach(c => assert.equal(typeof c.ignore, "boolean"));
  b.comptes.forEach(c => { assert.deepEqual(Object.keys(c).sort(), CPT_KEYS); assert.ok(b.connexions.some(x => x.id === c.connexionId), "connexion existante"); assert.ok(Object.keys(BE.TYPES).includes(c.type)); });
  assert.equal(BE.comptesARattacher(b).length, 1, "un compte non rattaché (l'ignoré n'en est pas)");
  // rattachements valides : lignes et crédit de la démo, enveloppe existante avec son titulaire
  for (const c of b.comptes) {
    if (c.positionId) { const p = S.positions.find(x => x.id === c.positionId); assert.ok(p, c.nom); assert.equal(c.solde, p.value, "solde = valeur de la ligne rattachée : " + c.nom); }
    if (c.creditId) { const k = S.profil.credits.find(x => x.id === c.creditId); assert.ok(k); assert.equal(-c.solde, k.crd, "solde du crédit = −capital restant dû"); }
    if (c.enveloppe) assert.ok(S.positions.some(p => p.envelope === c.enveloppe && p.owner === c.titulaire), c.enveloppe);
  }
  b.mois.forEach(m => { assert.deepEqual(Object.keys(m).sort(), MOIS_KEYS); assert.match(m.mois, /^\d{4}-\d{2}-01$/); assert.ok(BE.CATEGORIES.some(c => c.cle === m.categorie), m.categorie); });
  assert.equal(new Set(b.mois.map(m => m.mois)).size, 6, "6 mois de totaux");
  assert.ok(b.mois.every(m => m.compteId === 1001), "démo : totaux détaillés par compte (compte joint)");
  const r = BE.reelMoyen(b.mois, new Date().toISOString().slice(0, 10));
  assert.equal(r.n, 3);
  assert.ok(r.parCategorie.alimentation > 700 && r.parCategorie.alimentation < 900, "proche du budget de la démo (750 €)");
  assert.ok(r.parCategorie.revenus > 4800 && r.parCategorie.revenus < 5600, "≈ salaires de la démo (5 100 €)");
});

test("démo : Store.banque — connecter indisponible (erreur douce), rattacher et deconnecter en mémoire, validations partagées", async () => {
  const ctx = demoStore();
  await pret(ctx);
  const B = ctx.Store.banque, get = () => ctx.Store.get().banque;
  assert.match((await B.connecter()).erreur, /^Indisponible en démonstration/);
  assert.match((await B.connecter(102)).erreur, /^Indisponible en démonstration/);
  const g = await B.gerer(get().connexions[0].id);
  assert.match(g.erreur, /^Indisponible en démonstration/, "gérer les comptes : erreur douce en démo");
  assert.equal(g.url, undefined);
  const libre = BE.comptesARattacher(get())[0];
  assert.deepEqual(J(await B.rattacher(libre.id, { positionId: "compte-commun" })), { ok: true });
  assert.equal(get().comptes.find(c => c.id === libre.id).positionId, "compte-commun");
  assert.equal(BE.comptesARattacher(get()).length, 0);
  assert.deepEqual(J(await B.rattacher(libre.id, { aucun: true })), { ok: true });
  assert.equal(get().comptes.find(c => c.id === libre.id).positionId, null);
  assert.match((await B.rattacher(libre.id, { positionId: "inconnue" })).erreur, /Ligne introuvable/);
  assert.match((await B.rattacher(999, { aucun: true })).erreur, /Compte introuvable/);
  // ne pas suivre, puis revenir en arrière
  assert.deepEqual(J(await B.rattacher(libre.id, { positionId: "compte-commun" })), { ok: true });
  assert.deepEqual(J(await B.rattacher(libre.id, { ignorer: true })), { ok: true });
  const ig = get().comptes.find(c => c.id === libre.id);
  assert.deepEqual([ig.ignore, ig.positionId], [true, null], "ignore = true, rattachement effacé");
  assert.deepEqual(J(await B.rattacher(libre.id, { aucun: true })), { ok: true });
  assert.equal(get().comptes.find(c => c.id === libre.id).ignore, false, "de nouveau suivi");
  const sca = get().connexions.find(c => c.etat === "SCARequired");
  assert.deepEqual(J(await B.deconnecter(sca.id)), { ok: true });
  assert.equal(get().connexions.some(c => c.id === sca.id), false);
  assert.equal(get().comptes.some(c => c.connexionId === sca.id), false, "ses comptes partent avec elle");
  assert.match((await B.deconnecter(sca.id)).erreur, /Connexion introuvable/);
  assert.equal(ctx.DEMO.banque.connexions.length, 2, "window.DEMO n'est pas modifié (copie)");
});

/* ---------- store-supabase.js exécuté : faux client (session ouverte), faux fetch ---------- */
function storeSup({ banqueActive = true, tables = {}, fetchRep, erreurFonct } = {}) {
  const appels = [], fetchs = [];
  const session = { access_token: "jeton-utilisateur-factice", user: { id: "u1", email: "a@b.c" } };
  const requete = table => {
    const f = { table, op: "select", cols: null, filtres: [], valeurs: null };
    const b = {};
    for (const m of ["eq", "gte", "in", "order", "limit", "range"]) b[m] = (...a) => { f.filtres.push([m, ...a]); return b; };
    b.select = (c, o) => { if (f.op === "select") f.cols = c; f.head = !!(o && o.head); return b; };
    b.update = v => { f.op = "update"; f.valeurs = v; return b; };
    b.maybeSingle = () => { f.unique = true; return b; };
    b.then = (ok, ko) => {
      appels.push(f);
      let r = { data: f.unique ? null : [], error: null, count: 0 };
      if (table === "fonctionnalites") r = erreurFonct ? { data: null, error: erreurFonct } : { data: { cle: "banque", active: banqueActive }, error: null };
      else if (tables[table]) r = typeof tables[table] === "function" ? tables[table](f) : tables[table];
      return Promise.resolve(r).then(ok, ko);
    };
    return b;
  };
  const client = { from: requete, rpc: () => Promise.resolve({ data: null, error: null }), auth: { getSession: async () => ({ data: { session } }) } };
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout,
    location: { href: "https://x/app.html", search: "", hash: "", pathname: "/app.html" },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    BOUSSOLE: { supabaseUrl: "https://projet.supabase.co/", supabaseKey: "cle-publique-factice" },
    supabase: { createClient: () => client },
    Auth: { client, session: async () => session, onChange() {}, requireSession() {} },
    fetch: async (url, init) => {
      fetchs.push({ url, init });
      const x = typeof fetchRep === "function" ? fetchRep(url, init) : fetchRep || { status: 200, body: { ok: true } };
      if (x instanceof Error) throw x;
      return { ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => { if (x.body === undefined) throw new Error("pas de JSON"); return x.body; } };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["sensible.js", "routine-etat.js", "banque-etat.js", "store-supabase.js"]) vm.runInContext(src(f), ctx, { filename: f });
  return { ctx, appels, fetchs, session };
}
const CX_ROW = { id: 7, etablissement: "Banque test", etat: "SCARequired", message: "Validation requise", derniere_synchro: "2026-10-12T05:00:00Z" };
const CPT_ROW = { id: 70, connexion_id: 7, nom: "Compte joint", type: "courant", solde: "1234.56", devise: "EUR", solde_le: "2026-10-12", actif: true, position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: false };
const CPT_IGN = { id: 71, connexion_id: 7, nom: "Compte pro", type: "courant", solde: "10", devise: "EUR", solde_le: "2026-10-12", actif: true, position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: true };
const MOIS_ROW = { mois: "2026-09-01", categorie: "alimentation", entrees: "0", sorties: "812.30", nombre: 14 };
const tablesBq = { banque_connexions: { data: [CX_ROW], error: null }, banque_comptes: { data: [CPT_ROW], error: null }, banque_mois: { data: [MOIS_ROW], error: null } };

test("store-supabase (exécuté) : interrupteur éteint → seul fonctionnalites est lu ; S.banque = { actif: false, lu: true, … }", async () => {
  const { ctx, appels } = storeSup({ banqueActive: false, tables: tablesBq });
  const S = await pret(ctx);
  assert.deepEqual(J(S.banque), { actif: false, lu: true, connexions: [], comptes: [], mois: [] });
  assert.deepEqual(appels.filter(a => a.table.startsWith("banque_")), [], "rien d'autre n'est lu");
  const f = appels.find(a => a.table === "fonctionnalites");
  assert.deepEqual(J(f.filtres), [["eq", "cle", "banque"]]);
});

test("store-supabase (exécuté) : table fonctionnalites absente → banque éteinte, sans casse", async () => {
  const { ctx } = storeSup({ erreurFonct: { code: "42P01", message: "relation does not exist" } });
  const S = await pret(ctx);
  assert.equal(S.banque.actif, false);
  assert.equal(S.ready, true);
});

test("store-supabase (exécuté) : interrupteur actif → connexions, comptes et 6 mois lus, au contrat (nombres, camelCase)", async () => {
  const { ctx, appels } = storeSup({ tables: tablesBq });
  const S = await pret(ctx);
  assert.deepEqual(J(S.banque), { actif: true, lu: true,
    connexions: [{ id: 7, etablissement: "Banque test", etat: "SCARequired", message: "Validation requise", derniereSynchro: "2026-10-12T05:00:00Z", doublonDe: null }],
    comptes: [{ id: 70, connexionId: 7, nom: "Compte joint", type: "courant", solde: 1234.56, devise: "EUR", soldeLe: "2026-10-12", actif: true, positionId: null, enveloppe: null, titulaire: null, creditId: null, ignore: false,
      doublonDe: null, rattacheAuto: null, creeAuto: false, suggestion: null }],
    mois: [{ mois: "2026-09-01", compteId: null, categorie: "alimentation", entrees: 0, sorties: 812.3, nombre: 14 }] });
  assert.match(appels.find(a => a.table === "banque_comptes").cols, /\bignore\b/, "colonne ignore lue");
  assert.match(appels.find(a => a.table === "banque_mois").cols, /\bcompte_id\b/, "compte_id lu (migration 0025)");
  const ig = storeSup({ tables: Object.assign({}, tablesBq, { banque_comptes: { data: [CPT_ROW, CPT_IGN], error: null } }) });
  const S2 = await pret(ig.ctx);
  assert.deepEqual(J(S2.banque.comptes.map(c => c.ignore)), [false, true]);
  assert.deepEqual(J(BE.comptesARattacher(S2.banque).map(c => c.id)), [70]);
  const m = appels.find(a => a.table === "banque_mois");
  const gte = m.filtres.find(x => x[0] === "gte");
  assert.equal(gte[1], "mois");
  assert.match(gte[2], /^\d{4}-\d{2}-01$/);
  const d = new Date(), attendu = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 5, 1)).toISOString().slice(0, 10);
  assert.equal(gte[2], attendu, "depuis le 1er du mois, 5 mois avant le mois en cours (6 mois)");
});

test("store-supabase (exécuté) : connecter → POST /functions/v1/powens/connecter avec le JWT de la session ; URL vérifiée", async () => {
  const URL_OK = "https://webview.powens.com/connect?domain=boussole2-sandbox.biapi.pro&code=c";
  const a = storeSup({ tables: tablesBq, fetchRep: { status: 200, body: { url: URL_OK } } });
  await pret(a.ctx);
  assert.deepEqual(J(await a.ctx.Store.banque.connecter()), { ok: true, url: URL_OK });
  assert.equal(a.fetchs[0].url, "https://projet.supabase.co/functions/v1/powens/connecter");
  assert.equal(a.fetchs[0].init.method, "POST");
  assert.equal(a.fetchs[0].init.headers.Authorization, "Bearer jeton-utilisateur-factice");
  assert.equal(a.fetchs[0].init.headers["Content-Type"], "application/json");
  assert.equal(a.fetchs[0].init.body, "{}");
  await a.ctx.Store.banque.connecter(7);
  assert.equal(a.fetchs[1].init.body, '{"connection_id":7}', "reconnexion : identifiant de la connexion");
  assert.match((await a.ctx.Store.banque.connecter("7; drop")).erreur, /Connexion introuvable/);
  // URL hors Powens : refusée, rien n'est ouvert
  const b = storeSup({ tables: tablesBq, fetchRep: { status: 200, body: { url: "https://evil.example/" } } });
  await pret(b.ctx);
  assert.match((await b.ctx.Store.banque.connecter()).erreur, /Adresse de connexion inattendue/);
  // erreurs : message du serveur (403), session expirée (401), réseau
  const c = storeSup({ tables: tablesBq, fetchRep: { status: 403, body: { error: "La connexion bancaire n'est pas encore ouverte pour ton compte." } } });
  await pret(c.ctx);
  assert.deepEqual(J(await c.ctx.Store.banque.connecter()), { erreur: "La connexion bancaire n'est pas encore ouverte pour ton compte." });
  const d = storeSup({ tables: tablesBq, fetchRep: { status: 401, body: { error: "Invalid JWT" } } });
  await pret(d.ctx);
  assert.equal((await d.ctx.Store.banque.connecter()).erreur, "Ta session a expiré. Reconnecte-toi.");
  const e = storeSup({ tables: tablesBq, fetchRep: new TypeError("Failed to fetch") });
  await pret(e.ctx);
  assert.match((await e.ctx.Store.banque.connecter()).erreur, /Connexion au serveur impossible/);
  const f = storeSup({ tables: tablesBq, fetchRep: { status: 503 } });
  await pret(f.ctx);
  assert.match((await f.ctx.Store.banque.connecter()).erreur, /indisponible pour le moment/);
});

test("store-supabase (exécuté) : gerer → POST /powens/connecter { connection_id, mode: \"gerer\" } ; URL Powens vérifiée ; connexion inconnue refusée", async () => {
  const URL_MANAGE = "https://webview.powens.com/manage?domain=boussole2-sandbox.biapi.pro&client_id=1&code=c&connection_id=7";
  const a = storeSup({ tables: tablesBq, fetchRep: { status: 200, body: { url: URL_MANAGE } } });
  await pret(a.ctx);
  assert.deepEqual(J(await a.ctx.Store.banque.gerer(7)), { ok: true, url: URL_MANAGE });
  assert.equal(a.fetchs[0].url, "https://projet.supabase.co/functions/v1/powens/connecter");
  assert.equal(a.fetchs[0].init.method, "POST");
  assert.equal(a.fetchs[0].init.headers.Authorization, "Bearer jeton-utilisateur-factice");
  assert.equal(a.fetchs[0].init.body, '{"connection_id":7,"mode":"gerer"}');
  for (const v of [undefined, null, "7; drop", 99]) assert.match((await a.ctx.Store.banque.gerer(v)).erreur, /Connexion introuvable/, String(v));
  assert.equal(a.fetchs.length, 1, "rien n'est envoyé pour une connexion inconnue");
  for (const u of ["https://evil.example/manage", "http://webview.powens.com/manage", "javascript:alert(1)"]) {
    const b = storeSup({ tables: tablesBq, fetchRep: { status: 200, body: { url: u } } });
    await pret(b.ctx);
    assert.match((await b.ctx.Store.banque.gerer(7)).erreur, /Adresse de connexion inattendue/, u);
  }
  const c = storeSup({ tables: tablesBq, fetchRep: { status: 404, body: { erreur: "Connexion introuvable." } } });
  await pret(c.ctx);
  assert.deepEqual(J(await c.ctx.Store.banque.gerer(7)), { erreur: "Connexion introuvable." });
});

test("store-supabase (exécuté) : deconnecter → POST /powens/deconnecter { connection_id } puis rechargement ; connexion inconnue refusée", async () => {
  const a = storeSup({ tables: tablesBq, fetchRep: { status: 200, body: { ok: true } } });
  await pret(a.ctx);
  const avant = a.appels.length;
  assert.deepEqual(J(await a.ctx.Store.banque.deconnecter(7)), { ok: true });
  assert.equal(a.fetchs[0].url, "https://projet.supabase.co/functions/v1/powens/deconnecter");
  assert.equal(a.fetchs[0].init.body, '{"connection_id":7}');
  assert.ok(a.appels.length > avant, "rechargé après la déconnexion");
  assert.match((await a.ctx.Store.banque.deconnecter(8)).erreur, /Connexion introuvable/);
  assert.equal(a.fetchs.length, 1, "rien n'est envoyé pour une connexion inconnue");
});

test("store-supabase (exécuté) : rattacher → update banque_comptes des 5 colonnes (ignore compris), filtré par id ; validation avant envoi", async () => {
  const maj = [];
  const tables = Object.assign({}, tablesBq, { banque_comptes: f => { if (f.op === "update") { maj.push(f); return { data: [{ id: 70 }], error: null }; } return tablesBq.banque_comptes; } });
  const { ctx } = storeSup({ tables });
  await pret(ctx);
  assert.deepEqual(J(await ctx.Store.banque.rattacher(70, { aucun: true })), { ok: true });
  assert.deepEqual(J(maj[0].valeurs), { position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: false });
  assert.deepEqual(J(maj[0].filtres), [["eq", "id", 70]]);
  assert.deepEqual(J(await ctx.Store.banque.rattacher(70, { ignorer: true })), { ok: true });
  assert.deepEqual(J(maj[1].valeurs), { position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: true });
  maj.pop();
  assert.match((await ctx.Store.banque.rattacher(70, { positionId: "inconnue" })).erreur, /Ligne introuvable/);
  assert.match((await ctx.Store.banque.rattacher(71, { aucun: true })).erreur, /Compte introuvable/);
  assert.equal(maj.length, 1, "rien n'est envoyé si la validation échoue");
});

/* =================================================================== rapprochement automatique, doublons, synchronisation (0022) =================================================================== */
test("BanqueEtat (0022) : comptes en double exclus des comptes à rattacher ; connexions en double ; cible d'une suggestion", () => {
  const b = banque({ connexions: [cx(1, null, { etablissement: "LCL", doublonDe: 2 }), cx(2, null, { etablissement: "LCL" })],
    comptes: [cpt(10, 1, { doublonDe: 20 }), cpt(20, 2), cpt(21, 2, { positionId: "p-livret" })] });
  assert.deepEqual(J(BE.comptesARattacher(b).map(c => c.id)), [20]);
  assert.deepEqual(J(BE.connexionsEnDouble(b).map(x => [x.connexion.id, x.autre.id])), [[1, 2]]);
  assert.deepEqual(J(BE.connexionsEnDouble(banque({ actif: false, connexions: b.connexions }))), []);
  assert.deepEqual(J(BE.cibleSuggestion({ type: "ligne", id: "p-livret", libelle: "x" })), { positionId: "p-livret" });
  assert.deepEqual(J(BE.cibleSuggestion({ type: "enveloppe", enveloppe: "PEA", titulaire: "p2", libelle: "x" })), { enveloppe: "PEA", titulaire: "p2" });
  assert.deepEqual(J(BE.cibleSuggestion({ type: "credit", id: "c-auto", libelle: "x" })), { creditId: "c-auto" });
  for (const s of [null, "x", {}, { type: "ligne" }, { type: "autre", id: "x" }, { type: "enveloppe", enveloppe: "PEA", titulaire: "p3" }]) assert.equal(BE.cibleSuggestion(s), null, JSON.stringify(s));
});

const B22 = () => banque({
  connexions: [cx(1, null, { etablissement: "LCL", doublonDe: 2 }), cx(2, null, { etablissement: "LCL" })],
  comptes: [
    cpt(10, 1, { nom: "Compte courant", doublonDe: 20 }),
    cpt(20, 2, { nom: "Compte courant", positionId: "p-livret", rattacheAuto: "2026-10-12T08:00:00Z", creeAuto: true }),
    cpt(21, 2, { nom: "PEA", type: "pea", enveloppe: "PEA Camille", titulaire: "p1", rattacheAuto: "2026-10-12T08:00:00Z" }),
    cpt(22, 2, { nom: "Livret <b>", type: "livret", suggestion: { type: "ligne", id: "p-livret", libelle: "Livret A · <i>Livrets</i>", raison: "2 lignes possibles : la plus proche du solde est proposée." } }),
  ],
});

test("banqueHtml (0022) : connexion en double — alerte et « Déconnecter » mis en avant ; comptes en double grisés « En double », sans sélecteur", () => {
  const h = sp(G.banqueHtml(S0({ banque: B22() }), AUJ)), t = texteDe(h);
  assert.match(t, /Connexion LCL en double : elle ne contient que des comptes déjà présents dans l'autre connexion LCL\. Déconnecte-la\./);
  assert.match(h, /<div class="cg-bq-doublon" role="note">[\s\S]*?<button type="button" class="cg-btn danger" data-cg-banque-deconnecter="1">Déconnecter<span class="cg-sr"> LCL<\/span><\/button>/);
  assert.equal([...h.matchAll(/data-cg-banque-deconnecter="1"/g)].length, 1, "un seul bouton Déconnecter pour cette connexion");
  assert.match(h, /<button type="button" class="cg-btn ghost" data-cg-banque-deconnecter="2">/, "l'autre connexion garde le bouton ordinaire");
  assert.match(h, /<li class="cg-bq-cpt doublon">[\s\S]*?<span class="cg-bq-tag">En double<\/span>/);
  assert.doesNotMatch(h, /data-cg-banque-compte="10"/, "pas de rattachement pour un compte en double");
  assert.match(t, /Déjà suivi par l'autre connexion LCL/);
});

test("banqueHtml (0022) : « Rattaché automatiquement à … », « Créé automatiquement », suggestion avec « Rattacher » ; échappement", () => {
  const h = sp(G.banqueHtml(S0({ banque: B22() }), AUJ)), t = texteDe(h);
  assert.match(t, /Créé automatiquement : Livret A · Livrets Camille\. Tu peux changer ou ne pas suivre ce compte\./);
  assert.match(t, /Rattaché automatiquement à PEA Camille · Camille\. Tu peux changer ci-dessous\./);
  assert.match(h, /data-cg-banque-compte="20"/, "rattachement automatique : sélecteur pour changer");
  assert.match(t, /Suggestion : Livret A · &lt;i&gt;Livrets&lt;\/i&gt; — 2 lignes possibles : la plus proche du solde est proposée\./);
  assert.match(h, /<button type="button" class="cg-btn" data-cg-banque-suggestion="22">Rattacher<span class="cg-sr"> Livret &lt;b&gt;<\/span><\/button>/);
  assert.doesNotMatch(h, /<i>Livrets|Livret <b>/, "texte venu des données échappé");
  assert.doesNotMatch(t, VOUVOIEMENT);
  // suggestion invalide : rien
  const b = B22(); b.comptes[3].suggestion = { type: "inconnu", libelle: "x" };
  assert.doesNotMatch(G.banqueHtml(S0({ banque: b }), AUJ), /data-cg-banque-suggestion/);
});

test("banqueHtml (0022) : « Synchroniser maintenant » sur chaque connexion", () => {
  const h = G.banqueHtml(S0(), AUJ);
  assert.deepEqual([...h.matchAll(/data-cg-banque-synchroniser="(\d+)"/g)].map(m => m[1]), ["1", "2"]);
  assert.match(h, /<button type="button" class="cg-btn ghost" data-cg-banque-synchroniser="1">Synchroniser maintenant<span class="cg-sr"> Banque 1<\/span><\/button>/);
});

test("Banques (vm, 0022) : « Rattacher » une suggestion → Store.banque.rattacher(id, cible suggérée) ; « Synchroniser maintenant » → Store.banque.synchroniser(id)", async () => {
  const v = guideVm([{ ok: true }, { ok: true, rapport: { comptes: 3, rattaches_auto: 1, erreurs: 0 } }, { erreur: "Synchronisation déjà en cours pour cette banque : réessaie dans un instant." }], S0({ banque: B22() }));
  v.$('[data-cg-banque-suggestion="22"]').click();
  await v.fin();
  assert.deepEqual(J(v.appels[0]), ["rattacher", 22, { positionId: "p-livret" }]);
  assert.match(v.msg(), /rattaché à Livret A/);
  const b = v.$('[data-cg-banque-synchroniser="2"]');
  b.click(); b.click();
  await v.fin();
  assert.deepEqual(J(v.appels[1]), ["synchroniser", 2]);
  assert.equal(v.appels.length, 2, "un seul appel (bouton occupé)");
  assert.match(v.msg(), /LCL synchronisée : 3 comptes lus, 1 rattaché automatiquement\./);
  v.$('[data-cg-banque-synchroniser="2"]').click();
  await v.fin();
  const err = v.$("#cgBanquesCorps").querySelector(".cg-rt-err");
  assert.equal(err.textContent, "Synchronisation déjà en cours pour cette banque : réessaie dans un instant.");
  assert.equal(v.doc.activeElement, v.$('[data-cg-banque-synchroniser="2"]'), "focus rendu au bouton");
});

test("Aujourd'hui (0022) : connexion en double (urgence 2, « Déconnecter ») ; comptes en double jamais « à rattacher »", () => {
  const b = A.boite(vide({ banque: B22() }), AUJ, sansRegles).filter(x => x.type === "banque");
  const d = b.find(x => x.titre === "Connexion LCL en double");
  assert.ok(d, JSON.stringify(b.map(x => x.titre)));
  assert.equal(d.urgence, 2);
  assert.equal(d.contexte, "Elle ne contient que des comptes déjà présents dans l'autre connexion LCL : déconnecte-la.");
  assert.deepEqual(J(d.action), { label: "Déconnecter", route: "agent/connexion" });
  assert.equal(b.find(x => /à rattacher/.test(x.titre)).titre, "1 compte à rattacher", "le compte en double n'est pas compté");
});

test("store-supabase (exécuté, 0022) : doublons, rattachement automatique et suggestion lus ; synchroniser → POST /powens/synchroniser puis rechargement", async () => {
  const SUGG = { type: "enveloppe", enveloppe: "PEA", titulaire: "p1", libelle: "PEA (p1)", raison: "r" };
  const tables = { ...tablesBq, banque_connexions: { data: [{ ...CX_ROW, doublon_de: 8 }], error: null },
    banque_comptes: { data: [{ ...CPT_ROW, doublon_de: 80, rattache_auto: "2026-10-12T08:00:00Z", cree_auto: true, suggestion: SUGG }, { ...CPT_IGN, suggestion: { type: "pirate" } }], error: null } };
  const a = storeSup({ tables, fetchRep: { status: 200, body: { ok: true, rapport: { ok: true, comptes: 1 } } } });
  const S = await pret(a.ctx);
  assert.equal(S.banque.connexions[0].doublonDe, 8);
  assert.deepEqual(J([S.banque.comptes[0].doublonDe, S.banque.comptes[0].rattacheAuto, S.banque.comptes[0].creeAuto, S.banque.comptes[0].suggestion]), [80, "2026-10-12T08:00:00Z", true, SUGG]);
  assert.equal(S.banque.comptes[1].suggestion, null, "suggestion de forme inconnue : ignorée");
  assert.match(a.appels.find(x => x.table === "banque_comptes").cols, /doublon_de, rattache_auto, cree_auto, suggestion/);
  assert.match(a.appels.find(x => x.table === "banque_connexions").cols, /doublon_de/);
  const avant = a.appels.length;
  assert.deepEqual(J(await a.ctx.Store.banque.synchroniser(7)), { ok: true, rapport: { ok: true, comptes: 1 } });
  assert.equal(a.fetchs[0].url, "https://projet.supabase.co/functions/v1/powens/synchroniser");
  assert.equal(a.fetchs[0].init.body, '{"connection_id":7}');
  assert.equal(a.fetchs[0].init.headers.Authorization, "Bearer jeton-utilisateur-factice");
  assert.ok(a.appels.length > avant, "rechargé après la synchronisation");
  for (const v of [undefined, "7; drop", 99]) assert.match((await a.ctx.Store.banque.synchroniser(v)).erreur, /Connexion introuvable/);
  assert.equal(a.fetchs.length, 1);
  const c = storeSup({ tables, fetchRep: { status: 409, body: { erreur: "Synchronisation déjà en cours pour cette banque : réessaie dans un instant." } } });
  await pret(c.ctx);
  assert.deepEqual(J(await c.ctx.Store.banque.synchroniser(7)), { erreur: "Synchronisation déjà en cours pour cette banque : réessaie dans un instant." });
});

test("démo (0022) : Store.banque.synchroniser en mémoire (date de synchronisation mise à jour) ; connexion inconnue refusée", async () => {
  const ctx = demoStore();
  const S = await pret(ctx);
  const id = S.banque.connexions[0].id;
  const r = await ctx.Store.banque.synchroniser(id);
  assert.equal(r.ok, true);
  assert.equal(typeof r.rapport.comptes, "number");
  assert.ok(Date.parse(ctx.Store.get().banque.connexions[0].derniereSynchro) > Date.now() - 60000);
  assert.match((await ctx.Store.banque.synchroniser(999)).erreur, /Connexion introuvable/);
});

test("store-supabase (exécuté) : banque_mois.compte_id → compteId (0 → null) ; colonne absente (42703) → relecture sans elle", async () => {
  const a = storeSup({ tables: Object.assign({}, tablesBq, { banque_mois: { data: [Object.assign({}, MOIS_ROW, { compte_id: 70 }), Object.assign({}, MOIS_ROW, { compte_id: 0 })], error: null } }) });
  const S = await pret(a.ctx);
  assert.deepEqual(J(S.banque.mois.map(m => m.compteId)), [70, null]);
  let n = 0;
  const b = storeSup({ tables: Object.assign({}, tablesBq, { banque_mois: f => (n++ === 0 ? { data: null, error: { code: "42703", message: "column banque_mois.compte_id does not exist" } } : { data: [MOIS_ROW], error: null }) }) });
  const S2 = await pret(b.ctx);
  assert.equal(S2.banque.lu, true);
  assert.deepEqual(J(S2.banque.mois.map(m => m.compteId)), [null]);
  const lus = b.appels.filter(x => x.table === "banque_mois");
  assert.equal(lus.length, 2); assert.match(lus[0].cols, /compte_id/); assert.doesNotMatch(lus[1].cols, /compte_id/);
});

test("Store.banque.operations : supabase lit banque_operations (comptes, depuis, plus récentes d'abord) ; démo : opérations du compte joint", async () => {
  const OPS = [{ id: 5, compte_id: 70, date: "2026-10-02", montant: "-19.99", libelle: "PRLV FREE", categorie: "abonnements" }];
  const a = storeSup({ tables: Object.assign({}, tablesBq, { banque_operations: { data: OPS, error: null } }) });
  await pret(a.ctx);
  assert.deepEqual(J(await a.ctx.Store.banque.operations([70, "x", 70], "2026-07-01")), [{ id: 5, compteId: 70, date: "2026-10-02", montant: -19.99, libelle: "PRLV FREE", categorie: "abonnements" }]);
  const f = a.appels.find(x => x.table === "banque_operations");
  assert.match(f.cols, /^id, compte_id, date, montant, libelle, categorie$/);
  assert.deepEqual(J(await a.ctx.Store.banque.operations([], "2026-07-01")), [], "sans compte : aucune requête");
  assert.equal(a.appels.filter(x => x.table === "banque_operations").length, 1);
  const k = storeSup({ tables: Object.assign({}, tablesBq, { banque_operations: { data: null, error: { code: "500", message: "panne" } } }) });
  await pret(k.ctx);
  await assert.rejects(k.ctx.Store.banque.operations([70], "2026-07-01"), "échec : promesse rejetée (la vue réessaie)");
});
