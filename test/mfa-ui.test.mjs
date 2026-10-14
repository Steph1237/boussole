// SEC2 : double authentification côté app (web/src/mfa.js) — adaptateur supabase-js, écran de code (connexion, reprise de session),
// section Compte › Sécurité (inscription par QR code, second appareil, retrait). Faux client Supabase et mini-DOM : aucun réseau.
// Valeurs fictives uniquement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const Mfa = require("../web/src/mfa.js");
const src = f => readFileSync(new URL("../web/src/" + f, import.meta.url), "utf8");
const page = f => readFileSync(new URL("../web/" + f, import.meta.url), "utf8");
const VOUVOIEMENT = /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu;
const tick = async (n = 25) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const texte = el => el.textContent.replace(/\s+/g, " ").trim();

/* ---------- faux client supabase-js (auth.mfa) ---------- */
const QR = "data:image/svg+xml;utf-8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><rect width=\"10\" height=\"10\"/></svg>";
function fauxClient({ current = "aal1", next = "aal2", verifies = [], nonVerifies = [], erreurs = {}, codeJuste = "123456" } = {}) {
  const appels = [];
  let niveau = { currentLevel: current, nextLevel: next };
  const facteurs = verifies.map(f => ({ factor_type: "totp", status: "verified", ...f }));
  const abandonnes = nonVerifies.map(f => ({ factor_type: "totp", status: "unverified", ...f }));
  const err = (nom, defaut) => (erreurs[nom] ? { data: null, error: erreurs[nom] } : defaut);
  const mfa = {
    getAuthenticatorAssuranceLevel: async () => { appels.push(["niveau"]); return err("niveau", { data: niveau, error: null }); },
    listFactors: async () => { appels.push(["listFactors"]); return err("listFactors", { data: { all: [...facteurs, ...abandonnes], totp: facteurs.slice(), phone: [] }, error: null }); },
    enroll: async a => {
      appels.push(["enroll", a]);
      const e = erreurs.enroll; if (e) return { data: null, error: e };
      const id = "f-nouveau";
      abandonnes.push({ id, factor_type: "totp", status: "unverified", created_at: "2026-10-14T09:00:00Z" });
      return { data: { id, type: "totp", totp: { qr_code: erreurs.qr ?? QR, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Boussole:camille@example.org?secret=JBSWY3DPEHPK3PXP" } }, error: null };
    },
    challenge: async a => { appels.push(["challenge", a]); return err("challenge", { data: { id: "ch-" + a.factorId }, error: null }); },
    verify: async a => {
      appels.push(["verify", a]);
      if (erreurs.verify) return { data: null, error: erreurs.verify };
      if (a.code !== codeJuste) return { data: null, error: { code: "mfa_verification_failed", message: "Invalid TOTP code entered", status: 400 } };
      const i = abandonnes.findIndex(f => f.id === a.factorId);
      if (i >= 0) { const [f] = abandonnes.splice(i, 1); facteurs.push({ ...f, status: "verified" }); }
      niveau = { currentLevel: "aal2", nextLevel: "aal2" };
      return { data: { access_token: "jeton-factice" }, error: null };
    },
    unenroll: async a => {
      appels.push(["unenroll", a]);
      if (erreurs.unenroll) return { data: null, error: erreurs.unenroll };
      for (const l of [facteurs, abandonnes]) { const i = l.findIndex(f => f.id === a.factorId); if (i >= 0) l.splice(i, 1); }
      return { data: { id: a.factorId }, error: null };
    },
  };
  return { appels, facteurs, abandonnes, client: { auth: { mfa, refreshSession: async () => { appels.push(["refreshSession"]); return { data: {}, error: null }; } } } };
}
const F1 = { id: "f-1", friendly_name: "Appareil 2026-09-01 10:00", created_at: "2026-09-01T10:00:00Z" };
const F2 = { id: "f-2", friendly_name: "Appareil 2026-09-15 18:30", created_at: "2026-09-15T18:30:00Z" };

/* =================================================================== adaptateur et erreurs =================================================================== */
test("Mfa.adapter : niveau, appareils vérifiés seulement (du plus ancien au plus récent)", async () => {
  const f = fauxClient({ verifies: [F2, F1], nonVerifies: [{ id: "f-x", created_at: "2026-10-01T00:00:00Z" }] });
  const api = Mfa.adapter(f.client);
  assert.deepEqual(await api.niveau(), { current: "aal1", next: "aal2" });
  const l = await api.facteurs();
  assert.deepEqual(l.map(x => x.id), ["f-1", "f-2"], "non vérifié écarté, ordre de création");
  assert.deepEqual(Object.keys(l[0]).sort(), ["cree", "id", "nom", "statut"]);
});

test("Mfa.adapter.inscrire : inscriptions abandonnées retirées, puis enroll TOTP → QR (SVG), clé en texte, URI", async () => {
  const f = fauxClient({ verifies: [F1], nonVerifies: [{ id: "f-vieux", created_at: "2026-10-01T00:00:00Z" }] });
  const r = await Mfa.adapter(f.client).inscrire();
  assert.deepEqual(f.appels.filter(a => a[0] === "unenroll"), [["unenroll", { factorId: "f-vieux" }]], "seule l'inscription abandonnée est retirée");
  const en = f.appels.find(a => a[0] === "enroll");
  assert.equal(en[1].factorType, "totp");
  assert.match(en[1].friendlyName, /^Appareil \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual({ facteurId: r.facteurId, secret: r.secret, qrSvg: r.qr.startsWith("data:image/svg+xml") }, { facteurId: "f-nouveau", secret: "JBSWY3DPEHPK3PXP", qrSvg: true });
  assert.match(r.uri, /^otpauth:\/\/totp\//);
  assert.ok(f.facteurs.some(x => x.id === "f-1"), "l'appareil vérifié n'est pas touché");
});

test("Mfa.adapter.verifier : challenge puis verify (identifiant du défi, code normalisé) ; erreurs relancées avec leur code", async () => {
  const f = fauxClient({ verifies: [F1] });
  const api = Mfa.adapter(f.client);
  assert.equal(await api.verifier("f-1", "123 456"), true);
  assert.deepEqual(f.appels.filter(a => a[0] === "challenge" || a[0] === "verify"),
    [["challenge", { factorId: "f-1" }], ["verify", { factorId: "f-1", challengeId: "ch-f-1", code: "123456" }]]);
  await assert.rejects(api.verifier("f-1", "000000"), e => e.code === "mfa_verification_failed");
  const g = fauxClient({ erreurs: { challenge: { code: "mfa_factor_not_found", message: "x", status: 404 } } });
  await assert.rejects(Mfa.adapter(g.client).verifier("f-9", "123456"), e => e.code === "mfa_factor_not_found");
  assert.ok(!g.appels.some(a => a[0] === "verify"), "pas de verify si le défi échoue");
});

test("Mfa.adapter.supprimer : unenroll puis session renouvelée ; refus insufficient_aal relancé ; annuler ne lève jamais", async () => {
  const f = fauxClient({ verifies: [F1, F2] });
  const api = Mfa.adapter(f.client);
  await api.supprimer("f-1");
  assert.deepEqual(f.appels.slice(-2), [["unenroll", { factorId: "f-1" }], ["refreshSession"]]);
  const g = fauxClient({ verifies: [F1], erreurs: { unenroll: { code: "insufficient_aal", message: "AAL2 required", status: 401 } } });
  await assert.rejects(Mfa.adapter(g.client).supprimer("f-1"), e => e.code === "insufficient_aal");
  await Mfa.adapter(g.client).annuler("f-x");
  await assert.rejects(Mfa.adapter({ auth: {} }).niveau(), e => e.code === "network");
});

test("Mfa.texteErreur : français, tutoiement, jamais le message anglais brut", () => {
  const cas = [
    [{ code: "mfa_verification_failed", message: "Invalid TOTP code entered" }, /^Code incorrect\./],
    [{ code: "mfa_challenge_expired" }, /expiré/],
    [{ code: "insufficient_aal" }, /valide d'abord ton code/],
    [{ code: "too_many_enrolled_mfa_factors" }, /nombre maximal d'appareils/],
    [{ code: "over_request_rate_limit" }, /Trop de tentatives/],
    [{ code: "session_not_found" }, /session a expiré/],
    [{ code: "network", message: "Failed to fetch" }, /Connexion au serveur impossible/],
    [{ code: "autre", message: "boom" }, /^Une erreur est survenue \(boom\)\. Réessaie\.$/],
  ];
  for (const [e, re] of cas) { const t = Mfa.texteErreur(e); assert.match(t, re); assert.doesNotMatch(t, VOUVOIEMENT); }
  assert.doesNotMatch(Mfa.texteErreur({ code: "mfa_verification_failed", message: "Invalid TOTP code entered" }), /Invalid/);
});

test("Mfa.normaliserCode / codeValide / besoinCode", () => {
  assert.equal(Mfa.normaliserCode(" 123 456 "), "123456");
  assert.equal(Mfa.normaliserCode("123-456"), "123456");
  assert.equal(Mfa.codeValide("123 456"), true);
  for (const m of ["12345", "1234567", "12345a", "", null]) assert.equal(Mfa.codeValide(m), false, String(m));
  assert.equal(Mfa.besoinCode({ current: "aal1", next: "aal2" }), true);
  for (const n of [{ current: "aal2", next: "aal2" }, { current: "aal1", next: "aal1" }, { current: "aal2", next: "aal1" }, null]) assert.equal(Mfa.besoinCode(n), false, JSON.stringify(n));
});

/* =================================================================== écran de code (connexion) =================================================================== */
async function monterEcran({ verifies = [F1], erreurs, codeJuste, opts = {} } = {}) {
  const dom = miniDom(), { doc, Ev } = dom;
  const f = fauxClient({ verifies, erreurs, codeJuste });
  const cont = doc.body.appendChild(doc.createElement("div"));
  const evts = { verifie: 0, quitte: 0 };
  await Mfa.monterCode(cont, Mfa.adapter(f.client), { doc, onVerifie: () => { evts.verifie++; }, onQuitter: opts.sansQuitter ? undefined : () => { evts.quitte++; } });
  const $ = id => cont.querySelector("#" + id);
  const saisir = async code => { $("mfaCode").value = code; $("mfaCodeForm").dispatchEvent(new Ev("submit")); await tick(); };
  return { doc, cont, f, evts, $, saisir };
}

test("écran de code : champ étiqueté, saisie numérique à usage unique, message d'erreur annoncé, boutons réels", async () => {
  const { cont, $ } = await monterEcran();
  assert.equal($("mfaCodeForm").getAttribute("aria-labelledby"), "mfaCodeTitre");
  assert.equal(texte($("mfaCodeTitre")), "Double authentification");
  const label = cont.querySelector('label[for="mfaCode"]');
  assert.ok(label && /Code à 6 chiffres/.test(texte(label)), "label relié au champ");
  const champ = $("mfaCode");
  assert.equal(champ.getAttribute("autocomplete"), "one-time-code");
  assert.equal(champ.getAttribute("inputmode"), "numeric");
  assert.equal($("mfaCodeMsg").getAttribute("role"), "alert");
  assert.equal($("mfaCodeOk").localName, "button"); assert.equal($("mfaCodeOk").getAttribute("type"), "submit");
  assert.equal($("mfaCodeQuitter").localName, "button"); assert.equal($("mfaCodeQuitter").getAttribute("type"), "button");
  assert.equal(cont.querySelector("#mfaFacteur"), null, "un seul appareil : pas de choix");
  assert.doesNotMatch(texte(cont), VOUVOIEMENT);
});

test("écran de code : mauvais code → message en français, champ vidé, bouton rendu, rien n'est validé", async () => {
  const { f, evts, $, saisir } = await monterEcran();
  await saisir("000000");
  assert.match(texte($("mfaCodeMsg")), /^Code incorrect\./);
  assert.equal($("mfaCode").value, "");
  assert.equal(evts.verifie, 0);
  assert.ok(!$("mfaCodeOk").disabled, "bouton réutilisable");
  assert.equal($("mfaCodeOk").getAttribute("aria-busy"), null);
  assert.equal(f.appels.filter(a => a[0] === "verify").length, 1);
  // Supabase décide du blocage éventuel : aucune logique de verrouillage côté app (un nouvel essai part toujours)
  await saisir("111111"); await saisir("222222");
  assert.equal(f.appels.filter(a => a[0] === "verify").length, 3);
});

test("écran de code : moins de 6 chiffres → message, aucun appel à Supabase", async () => {
  const { f, evts, $, saisir } = await monterEcran();
  const avant = f.appels.length;
  await saisir("12 34");
  assert.match(texte($("mfaCodeMsg")), /^Saisis les 6 chiffres/);
  assert.equal(f.appels.length, avant);
  assert.equal(evts.verifie, 0);
});

test("écran de code : bon code (espaces tolérés) → challenge + verify, onVerifie appelé une fois", async () => {
  const { f, evts, $, saisir } = await monterEcran();
  await saisir("123 456");
  assert.deepEqual(f.appels.filter(a => a[0] === "challenge" || a[0] === "verify"),
    [["challenge", { factorId: "f-1" }], ["verify", { factorId: "f-1", challengeId: "ch-f-1", code: "123456" }]]);
  assert.equal(evts.verifie, 1);
  assert.equal(texte($("mfaCodeMsg")), "");
});

test("écran de code : erreur réseau ou limite de débit expliquée ; deux appareils → liste de choix ; « Se déconnecter » appelle onQuitter", async () => {
  const net = await monterEcran({ erreurs: { verify: { code: "over_request_rate_limit", message: "rate", status: 429 } } });
  await net.saisir("123456");
  assert.match(texte(net.$("mfaCodeMsg")), /Trop de tentatives/);
  const deux = await monterEcran({ verifies: [F1, F2] });
  assert.ok(deux.$("mfaFacteur"), "choix de l'appareil");
  assert.ok(deux.cont.querySelector('label[for="mfaFacteur"]'));
  deux.$("mfaFacteur").value = "f-2";
  await deux.saisir("123456");
  assert.deepEqual(deux.f.appels.find(a => a[0] === "challenge"), ["challenge", { factorId: "f-2" }]);
  const q = await monterEcran();
  q.$("mfaCodeQuitter").click();
  assert.equal(q.evts.quitte, 1);
  const sans = await monterEcran({ opts: { sansQuitter: true } });
  assert.equal(sans.cont.querySelector("#mfaCodeQuitter"), null);
});

test("écran de code : liste des appareils illisible ou vide → message, jamais d'appel verify", async () => {
  const panne = await monterEcran({ erreurs: { listFactors: { code: "network", message: "Failed to fetch" } } });
  assert.match(texte(panne.$("mfaCodeMsg")), /Connexion au serveur impossible/);
  await panne.saisir("123456");
  assert.ok(!panne.f.appels.some(a => a[0] === "verify"));
  const vide = await monterEcran({ verifies: [] });
  assert.match(texte(vide.$("mfaCodeMsg")), /Aucun appareil/);
});

/* =================================================================== garde (reprise de session) et après-connexion =================================================================== */
function domGarde(avecApp = true) {
  const dom = miniDom(), { doc } = dom;
  doc.querySelectorAll = sel => doc.body.querySelectorAll(sel);
  const app = avecApp ? doc.body.appendChild(doc.createElement("div")) : null;
  if (app) app.className = "app";
  return { dom, doc, app };
}

test("exiger : session déjà aal2, ou sans facteur → rien à afficher", async () => {
  for (const [current, next] of [["aal2", "aal2"], ["aal1", "aal1"]]) {
    const { doc } = domGarde();
    const f = fauxClient({ current, next, verifies: next === "aal2" ? [F1] : [] });
    assert.equal(await Mfa.exiger(Mfa.adapter(f.client), { doc }), true);
    assert.equal(doc.body.children.filter(c => c.classList.contains("mfa-gate")).length, 0, current + "/" + next);
  }
});

test("exiger : aal1 avec un facteur vérifié → dialogue modal plein écran, l'app est inerte, levé après le bon code", async () => {
  const { doc, app, dom } = domGarde();
  const f = fauxClient({ verifies: [F1] });
  let fini = false;
  const p = Mfa.exiger(Mfa.adapter(f.client), { doc, onQuitter: () => {} }).then(v => { fini = v; });
  await tick();
  const gate = doc.body.children.find(c => c.classList.contains("mfa-gate"));
  assert.ok(gate, "écran de code affiché");
  assert.equal(gate.getAttribute("role"), "dialog"); assert.equal(gate.getAttribute("aria-modal"), "true");
  assert.equal(app.inert, true); assert.equal(app.getAttribute("aria-hidden"), "true");
  assert.equal(fini, false, "la garde attend le code");
  gate.querySelector("#mfaCode").value = "000000";
  gate.querySelector("#mfaCodeForm").dispatchEvent(new dom.Ev("submit")); await tick();
  assert.equal(fini, false, "mauvais code : la garde reste");
  assert.match(texte(gate.querySelector("#mfaCodeMsg")), /Code incorrect/);
  gate.querySelector("#mfaCode").value = "123456";
  gate.querySelector("#mfaCodeForm").dispatchEvent(new dom.Ev("submit")); await p; await tick();
  assert.equal(fini, true);
  assert.equal(doc.body.children.some(c => c.classList.contains("mfa-gate")), false, "écran retiré");
  assert.equal(app.inert, false); assert.equal(app.getAttribute("aria-hidden"), null);
});

test("exiger : niveau illisible → false (la RLS protège de toute façon les données bancaires), aucun écran", async () => {
  const { doc } = domGarde();
  const f = fauxClient({ erreurs: { niveau: { code: "session_not_found", message: "x", status: 401 } } });
  assert.equal(await Mfa.exiger(Mfa.adapter(f.client), { doc }), false);
  assert.equal(doc.body.children.some(c => c.classList.contains("mfa-gate")), false);
});

test("apresConnexion : code à valider → écran dans le panneau, onPret seulement après le bon code ; sinon onPret tout de suite", async () => {
  const { doc, dom } = domGarde(false);
  const cont = doc.body.appendChild(doc.createElement("div"));
  const f = fauxClient({ verifies: [F1] });
  let pret = 0;
  const affiche = await Mfa.apresConnexion(Mfa.adapter(f.client), cont, { doc, onPret: () => { pret++; }, onQuitter: () => {} });
  assert.equal(affiche, true); assert.equal(pret, 0);
  assert.ok(cont.querySelector("#mfaCodeForm"));
  cont.querySelector("#mfaCode").value = "123456";
  cont.querySelector("#mfaCodeForm").dispatchEvent(new dom.Ev("submit")); await tick();
  assert.equal(pret, 1);
  const g = fauxClient({ current: "aal1", next: "aal1" });
  const cont2 = doc.body.appendChild(doc.createElement("div"));
  assert.equal(await Mfa.apresConnexion(Mfa.adapter(g.client), cont2, { doc, onPret: () => { pret++; } }), false);
  assert.equal(pret, 2); assert.equal(cont2.querySelector("#mfaCodeForm"), null);
});

test("accueil : après le mot de passe, goApp passe par apresConnexion ; panneau de code prévu ; mfa.js chargé avant auth.js", () => {
  const js = src("landing.js"), html = page("index.html");
  assert.match(js, /await A\.signInPassword\(em, p\);\s*await ouvrirApresConnexion\(\);\s*return;/);
  assert.match(js, /window\.Mfa\.apresConnexion\(A\.mfa, panneauCode\(\), \{[^}]*onPret: goApp/);
  assert.match(js, /onQuitter/);
  assert.match(html, /<div id="authMfa"[^>]*hidden><\/div>/);
  assert.ok(html.indexOf('src="app/mfa.js"') > 0 && html.indexOf('src="app/mfa.js"') < html.indexOf('src="app/auth.js"'));
  // compte.html et consent.html : même ordre
  assert.ok(page("compte.html").indexOf('src="app/mfa.js"') < page("compte.html").indexOf('src="app/auth.js"'));
  assert.ok(page("oauth/consent.html").indexOf('src="../app/mfa.js"') > 0);
});

/* =================================================================== Compte › Sécurité =================================================================== */
async function monterSec({ verifies = [], anonyme = false, erreurs, qr } = {}) {
  const dom = miniDom(), { doc, Ev } = dom;
  const f = fauxClient({ verifies, erreurs: Object.assign({}, erreurs, qr !== undefined ? { qr } : {}) });
  const cont = doc.body.appendChild(doc.createElement("div"));
  const changes = [];
  await Mfa.monterSecurite(cont, Mfa.adapter(f.client), { doc, anonyme, lienSecuriser: "#securiser", onChange: l => changes.push(l.length) });
  const $ = id => cont.querySelector("#" + id);
  const clic = async sel => { const b = cont.querySelector(sel); assert.ok(b, "bouton " + sel); b.click(); await tick(); };
  const soumettre = async code => { $("mfaInscrCode").value = code; $("mfaInscrForm").dispatchEvent(new Ev("submit")); await tick(); };
  return { doc, cont, f, $, clic, soumettre, changes };
}

test("Sécurité, compte anonyme : phrase d'explication et lien pour sécuriser le compte d'abord, aucune inscription possible", async () => {
  const v = await monterSec({ anonyme: true });
  assert.match(texte(v.cont), /sécurise d'abord ton compte avec un e-mail et un mot de passe/);
  assert.equal(v.cont.querySelector("a").getAttribute("href"), "#securiser");
  assert.equal(v.cont.querySelector("#mfaAjouter"), null);
  assert.equal(v.f.appels.length, 0, "aucun appel à Supabase");
});

test("Sécurité, sans appareil : état clair, bouton « Activer la double authentification », pas de phrase sur le second appareil", async () => {
  const v = await monterSec();
  assert.match(texte(v.$("mfaVide")), /La double authentification n'est pas activée\./);
  assert.equal(texte(v.$("mfaAjouter")), "Activer la double authentification");
  assert.equal(v.$("mfaAjouter").localName, "button");
  assert.equal(v.cont.querySelector("#mfaSecours"), null);
  assert.match(texte(v.cont), /obligatoire pour voir tes comptes bancaires/);
});

test("Sécurité, inscription : QR code (SVG) avec texte alternatif, clé en texte, code à 6 chiffres ; bon code → appareil listé et message", async () => {
  const v = await monterSec();
  await v.clic("#mfaAjouter");
  assert.deepEqual(v.f.appels.find(a => a[0] === "enroll")[1].factorType, "totp");
  const img = v.$("mfaQr");
  assert.ok(img && img.localName === "img");
  assert.match(img.getAttribute("src"), /^data:image\/svg\+xml;utf-8,<svg/);
  assert.match(img.getAttribute("alt"), /QR code à scanner avec ton application d'authentification/);
  assert.equal(texte(v.$("mfaSecret")), "JBSWY3DPEHPK3PXP", "clé de secours en texte");
  assert.ok(v.cont.querySelector('label[for="mfaInscrCode"]'));
  assert.equal(v.$("mfaInscrCode").getAttribute("autocomplete"), "one-time-code");
  await v.soumettre("000000");
  assert.match(texte(v.$("mfaMsg")), /^Code incorrect\./);
  assert.equal(v.$("mfaMsg").getAttribute("role"), "alert");
  assert.ok(v.$("mfaInscrForm"), "toujours en inscription");
  await v.soumettre("123 456");
  assert.deepEqual(v.f.appels.filter(a => a[0] === "verify").at(-1), ["verify", { factorId: "f-nouveau", challengeId: "ch-f-nouveau", code: "123456" }]);
  assert.equal(v.cont.querySelector("#mfaInscrForm"), null);
  assert.match(texte(v.cont), /Appareil 1/);
  assert.match(texte(v.$("mfaMsg")), /^Double authentification activée\./);
  assert.equal(v.$("mfaMsg").getAttribute("role"), "status");
  assert.deepEqual(v.changes, [1]);
  assert.equal(texte(v.$("mfaAjouter")), "Ajouter un second appareil");
});

test("Sécurité, avec un appareil : phrase de secours (pas de codes de récupération), second appareil, retrait avec confirmation dans la page", async () => {
  const v = await monterSec({ verifies: [F1] });
  assert.match(texte(v.$("mfaSecours")), /ne propose pas de codes de secours/);
  assert.match(texte(v.$("mfaSecours")), /second appareil/);
  assert.equal((texte(v.$("mfaSecours")).match(/\./g) || []).length, 1, "une seule phrase");
  assert.equal(texte(v.$("mfaAjouter")), "Ajouter un second appareil");
  assert.match(texte(v.cont.querySelector("ul")), /Appareil 1\s*Ajouté le 1(er)? septembre 2026/);
  await v.clic('[data-mfa="retirer"]');
  const conf = v.cont.querySelector('[role="group"]');
  assert.ok(conf && /Retirer Appareil 1 \?/.test(texte(conf)));
  assert.match(texte(conf), /tes comptes bancaires ne s'afficheront plus/, "dernier appareil : conséquence dite");
  assert.ok(!v.f.appels.some(a => a[0] === "unenroll"), "rien n'est retiré avant la confirmation");
  await v.clic('[data-mfa="annuler-retrait"]');
  assert.equal(v.cont.querySelector('[role="group"]'), null);
  await v.clic('[data-mfa="retirer"]');
  await v.clic('[data-mfa="confirmer-retrait"]');
  assert.deepEqual(v.f.appels.filter(a => a[0] === "unenroll" || a[0] === "refreshSession"), [["unenroll", { factorId: "f-1" }], ["refreshSession"]]);
  assert.match(texte(v.$("mfaVide")), /pas activée/);
  assert.match(texte(v.$("mfaMsg")), /^Appareil retiré\./);
  assert.deepEqual(v.changes, [0]);
});

test("Sécurité : retrait refusé sans aal2 → message ; deux appareils → conséquence moins lourde ; annuler une inscription la retire côté serveur", async () => {
  const refus = await monterSec({ verifies: [F1], erreurs: { unenroll: { code: "insufficient_aal", message: "AAL2 required", status: 401 } } });
  await refus.clic('[data-mfa="retirer"]'); await refus.clic('[data-mfa="confirmer-retrait"]');
  assert.match(texte(refus.$("mfaMsg")), /valide d'abord ton code/);
  assert.match(texte(refus.cont.querySelector("ul")), /Appareil 1/, "l'appareil est toujours là");
  const deux = await monterSec({ verifies: [F1, F2] });
  await deux.clic('[data-mfa="retirer"]');
  assert.match(texte(deux.cont.querySelector('[role="group"]')), /Tes autres appareils restent valables/);
  const ann = await monterSec();
  await ann.clic("#mfaAjouter"); await ann.clic('[data-mfa="annuler-inscription"]');
  assert.equal(ann.cont.querySelector("#mfaInscrForm"), null);
  assert.ok(ann.f.appels.some(a => a[0] === "unenroll" && a[1].factorId === "f-nouveau"), "inscription abandonnée retirée");
});

test("Sécurité : erreur à l'inscription expliquée ; QR d'origine inattendue jamais affiché (clé en texte seulement) ; tutoiement partout", async () => {
  const panne = await monterSec({ erreurs: { enroll: { code: "too_many_enrolled_mfa_factors", message: "x", status: 422 } } });
  await panne.clic("#mfaAjouter");
  assert.match(texte(panne.$("mfaMsg")), /nombre maximal d'appareils/);
  const bizarre = await monterSec({ qr: "javascript:alert(1)" });
  await bizarre.clic("#mfaAjouter");
  assert.equal(bizarre.cont.querySelector("#mfaQr"), null);
  assert.equal(texte(bizarre.$("mfaSecret")), "JBSWY3DPEHPK3PXP");
  for (const v of [await monterSec(), await monterSec({ verifies: [F1] }), bizarre]) assert.doesNotMatch(texte(v.cont), VOUVOIEMENT);
});

test("compte.html : section Double authentification (ancre #securite), conteneur, mfa.js avant auth.js ; account.js la monte et exige le code avant tout", () => {
  const html = page("compte.html"), js = src("account.js");
  assert.match(html, /<section class="card" id="securite" aria-labelledby="h-mfa">/);
  assert.match(html, /<h2 id="h-mfa">Double authentification<\/h2>/);
  assert.match(html, /<div id="mfaBox"><\/div>/);
  assert.ok(html.indexOf('src="app/mfa.js"') < html.indexOf('src="app/auth.js"'));
  assert.match(js, /window\.Mfa\.monterSecurite\(\$\("mfaBox"\), A\.mfa, \{[^}]*anonyme: anon/);
  assert.match(js, /await window\.Mfa\.exiger\(A\.mfa/);
  assert.ok(js.indexOf("Mfa.exiger") < js.indexOf('$("main").hidden = false'), "garde avant l'affichage de la page");
  assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ""), VOUVOIEMENT);
});

test("auth.js : Auth.mfa = adaptateur de Mfa sur le client de la page (une seule instance de client)", () => {
  const js = src("auth.js");
  assert.match(js, /mfa: \(window\.Mfa && client\) \? window\.Mfa\.adapter\(client\) : null/);
});

test("build : mfa.js assemblé dans app.html (avant auth.js) et copié pour les pages autonomes", () => {
  const b = readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
  const scripts = b.match(/const SCRIPTS = \[([^\]]*)\]/)[1];
  assert.ok(scripts.indexOf('"mfa"') > 0 && scripts.indexOf('"mfa"') < scripts.indexOf('"auth"'));
});
