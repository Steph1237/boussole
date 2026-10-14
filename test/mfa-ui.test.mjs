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
      return { data: { id, type: "totp", totp: { qr_code: erreurs.qr ?? QR, secret: "JBSWY3DPEHPK3PXP", uri: erreurs.uri ?? "otpauth://totp/Boussole:camille@example.org?secret=JBSWY3DPEHPK3PXP&issuer=Boussole" } }, error: null };
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
  const auth = {
    mfa,
    refreshSession: async () => { appels.push(["refreshSession"]); return { data: {}, error: null }; },
    signInWithPassword: async a => {
      appels.push(["signIn", a.email]);
      if (erreurs.signIn) return { data: null, error: erreurs.signIn };
      if (a.password !== MOT_DE_PASSE) return { data: null, error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 } };
      return { data: { session: {} }, error: null };
    },
  };
  return { appels, facteurs, abandonnes, erreurs, client: { auth } };
}
const MOT_DE_PASSE = "mot-de-passe-factice-1";
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
  assert.equal(deux.cont.querySelector("#mfaFacteur"), null, "plus de liste déroulante : une seule étape");
  assert.match(texte(deux.$("mfaAppareil")), /^Appareil 1 sur 2, ajouté le 1(er)? septembre 2026\.$/);
  assert.equal(texte(deux.$("mfaAutre")), "Utiliser un autre appareil");
  assert.equal(deux.$("mfaAutre").localName, "button"); assert.equal(deux.$("mfaAutre").getAttribute("type"), "button");
  deux.$("mfaAutre").click();
  assert.match(texte(deux.$("mfaAppareil")), /^Appareil 2 sur 2, ajouté le 15 septembre 2026\.$/);
  assert.equal(deux.doc.activeElement, deux.$("mfaCode"), "focus rendu au champ du code");
  await deux.saisir("123456");
  assert.deepEqual(deux.f.appels.find(a => a[0] === "challenge"), ["challenge", { factorId: "f-2" }]);
  const q = await monterEcran();
  q.$("mfaCodeQuitter").click();
  assert.equal(q.evts.quitte, 1);
  const sans = await monterEcran({ opts: { sansQuitter: true } });
  assert.equal(sans.cont.querySelector("#mfaCodeQuitter"), null);
  assert.equal(sans.cont.querySelector("#mfaAutre"), null, "un seul appareil : pas de bouton « autre appareil »");
});

test("écran de code : liste des appareils illisible ou vide → message, jamais d'appel verify", async () => {
  const panne = await monterEcran({ erreurs: { listFactors: { code: "network", message: "Failed to fetch" } } });
  assert.match(texte(panne.$("mfaErreurMsg")), /Connexion au serveur impossible/);
  assert.equal(panne.$("mfaReessayer").localName, "button");
  assert.equal(panne.cont.querySelector("#mfaCodeForm"), null, "pas de formulaire à moitié fonctionnel");
  assert.ok(!panne.f.appels.some(a => a[0] === "verify"));
  // « Réessayer » relit les appareils ; une fois la panne levée, l'écran de code apparaît
  delete panne.f.erreurs.listFactors;
  panne.$("mfaReessayer").click(); await tick();
  assert.ok(panne.$("mfaCodeForm"), "écran de code après réessai");
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

test("exiger (échec fermé) : niveau illisible → la garde reste affichée avec le message et « Réessayer », l'app inerte ; true seulement après une lecture réussie", async () => {
  const { doc, app, dom } = domGarde();
  const f = fauxClient({ erreurs: { niveau: { code: "network", message: "Failed to fetch" } }, verifies: [F1] });
  let fini = null;
  const p = Mfa.exiger(Mfa.adapter(f.client), { doc, onQuitter: () => {} }).then(v => { fini = v; });
  await tick();
  const gate = doc.body.children.find(c => c.classList.contains("mfa-gate"));
  assert.ok(gate, "garde affichée malgré l'erreur");
  assert.equal(app.inert, true);
  assert.match(texte(gate.querySelector("#mfaErreurMsg")), /Connexion au serveur impossible/);
  assert.ok(gate.querySelector("#mfaErreurQuitter"), "« Se déconnecter » proposé");
  assert.equal(fini, null, "la garde ne résout pas");
  gate.querySelector("#mfaReessayer").click(); await tick();
  assert.equal(fini, null, "toujours illisible : toujours fermé");
  assert.match(texte(gate.querySelector("#mfaErreurMsg")), /Connexion au serveur impossible/);
  assert.ok(!gate.querySelector("#mfaReessayer").disabled, "bouton réutilisable");
  // la panne cesse : le niveau est lu (aal1 + facteur) → l'écran de code prend le relais
  delete f.erreurs.niveau;
  gate.querySelector("#mfaReessayer").click(); await tick();
  assert.equal(fini, null);
  assert.ok(gate.querySelector("#mfaCodeForm"), "écran de code");
  gate.querySelector("#mfaCode").value = "123456";
  gate.querySelector("#mfaCodeForm").dispatchEvent(new dom.Ev("submit")); await p; await tick();
  assert.equal(fini, true);
  assert.equal(app.inert, false);
});

test("exiger (échec fermé) : niveau illisible puis aal2 → la garde se lève sans demander de code ; sans document pour afficher → false (jamais true)", async () => {
  const { doc, app } = domGarde();
  const f = fauxClient({ current: "aal2", erreurs: { niveau: { code: "session_not_found", message: "x", status: 401 } }, verifies: [F1] });
  let fini = null;
  const p = Mfa.exiger(Mfa.adapter(f.client), { doc }).then(v => { fini = v; });
  await tick();
  assert.match(texte(doc.body.children.find(c => c.classList.contains("mfa-gate")).querySelector("#mfaErreurMsg")), /session a expiré/);
  delete f.erreurs.niveau;
  doc.body.querySelector("#mfaReessayer").click(); await p;
  assert.equal(fini, true);
  assert.equal(doc.body.children.some(c => c.classList.contains("mfa-gate")), false);
  assert.equal(app.inert, false);
  const g = fauxClient({ erreurs: { niveau: { code: "network", message: "x" } } });
  assert.equal(await Mfa.exiger(Mfa.adapter(g.client), { doc: null }), false);
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

test("apresConnexion (échec fermé) : niveau illisible → message et « Réessayer » dans le panneau, onPret jamais appelé tant que le niveau est illisible", async () => {
  const { doc, dom } = domGarde(false);
  const cont = doc.body.appendChild(doc.createElement("div"));
  const f = fauxClient({ erreurs: { niveau: { code: "network", message: "Failed to fetch" } }, verifies: [F1] });
  let pret = 0, codeAffiche = 0;
  const affiche = await Mfa.apresConnexion(Mfa.adapter(f.client), cont, { doc, onPret: () => { pret++; }, onCode: () => { codeAffiche++; }, onQuitter: () => {} });
  assert.equal(affiche, true); assert.equal(pret, 0); assert.equal(codeAffiche, 1, "panneau rendu visible");
  assert.match(texte(cont.querySelector("#mfaErreurMsg")), /Connexion au serveur impossible/);
  cont.querySelector("#mfaReessayer").click(); await tick();
  assert.equal(pret, 0, "toujours illisible");
  assert.ok(cont.querySelector("#mfaErreurMsg"));
  delete f.erreurs.niveau;
  cont.querySelector("#mfaReessayer").click(); await tick();
  assert.equal(pret, 0, "aal1 + facteur : le code est demandé");
  assert.ok(cont.querySelector("#mfaCodeForm"));
  cont.querySelector("#mfaCode").value = "123456";
  cont.querySelector("#mfaCodeForm").dispatchEvent(new dom.Ev("submit")); await tick();
  assert.equal(pret, 1);
});

test("etatConsentement (échec fermé) : niveau illisible → erreur relancée, jamais « ok »", async () => {
  const f = fauxClient({ erreurs: { niveau: { code: "network", message: "Failed to fetch" } } });
  await assert.rejects(Mfa.etatConsentement(Mfa.adapter(f.client)), e => e.code === "network");
  assert.equal(await Mfa.etatConsentement(Mfa.adapter(fauxClient({ verifies: [F1] }).client)), "code");
  assert.equal(await Mfa.etatConsentement(Mfa.adapter(fauxClient({ current: "aal1", next: "aal1" }).client)), "sans_facteur");
  assert.equal(await Mfa.etatConsentement(Mfa.adapter(fauxClient({ current: "aal2", verifies: [F1] }).client)), "ok");
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
function fauxStockage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _m: m };
}
async function monterSec({ verifies = [], anonyme = false, erreurs, qr, uri, email = "camille@example.org", clipboard, petitEcran = false } = {}) {
  const dom = miniDom(), { doc, Ev, touche } = dom;
  const f = fauxClient({ verifies, erreurs: Object.assign({}, erreurs, qr !== undefined ? { qr } : {}, uri !== undefined ? { uri } : {}) });
  const cont = doc.body.appendChild(doc.createElement("div"));
  const changes = [];
  const storage = fauxStockage();
  await Mfa.monterSecurite(cont, Mfa.adapter(f.client), { doc, anonyme, email, storage, clipboard, petitEcran, lienSecuriser: "#securiser", onChange: l => changes.push(l.length) });
  const $ = id => cont.querySelector("#" + id);
  const D = id => doc.body.querySelector("#" + id); // dans le dialogue d'activation (posé sur le body)
  const clic = async sel => { const b = doc.body.querySelector(sel); assert.ok(b, "bouton " + sel); b.click(); await tick(); };
  // étape 1 → 2 : le dialogue s'ouvre ; premier appareil = mot de passe redemandé avant d'appeler enroll
  const ajouter = async (mdp = MOT_DE_PASSE) => {
    await clic("#mfaAjouter");
    if (D("mfaAssPw")) { D("mfaAssPw").value = mdp; D("mfaAssForm1").dispatchEvent(new Ev("submit")); await tick(); }
  };
  const versCode = async () => { await ajouter(); D("mfaAssSuite").click(); await tick(); }; // étape 3
  const soumettre = async code => { D("mfaAssCode").value = code; D("mfaAssForm").dispatchEvent(new Ev("submit")); await tick(); };
  return { doc, Ev, touche, cont, f, $, D, clic, soumettre, changes, ajouter, versCode, storage };
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
  assert.match(texte(v.cont), /Sans lui, le détail bancaire \(opérations, budget réel\) reste masqué ; une fois activé, il est demandé pour accéder à toutes tes données/);
});

test("Sécurité, inscription : bouton → dialogue (plus de formulaire dans la page) ; QR code avec texte alternatif, clé révélée à la demande ; bon code → appareil listé et message", async () => {
  const v = await monterSec();
  await v.ajouter();
  assert.ok(v.D("mfaAss") && v.D("mfaAss").getAttribute("role") === "dialog", "l'inscription se fait dans un dialogue");
  assert.equal(v.cont.querySelector("#mfaInscrForm"), null);
  assert.deepEqual(v.f.appels.find(a => a[0] === "enroll")[1].factorType, "totp");
  const img = v.D("mfaQr");
  assert.ok(img && img.localName === "img");
  assert.match(img.getAttribute("src"), /^data:image\/svg\+xml;utf-8,<svg/);
  assert.match(img.getAttribute("alt"), /QR code à scanner avec ton application d'authentification/);
  assert.equal(v.D("mfaCle").hidden, true, "clé masquée tant qu'on ne demande pas");
  await v.clic("#mfaPasScanner");
  assert.equal(v.D("mfaCle").hidden, false);
  assert.equal(texte(v.D("mfaSecret")), "JBSWY3DPEHPK3PXP", "clé de secours en texte");
  v.D("mfaAssSuite").click(); await tick();
  assert.ok(v.doc.body.querySelector('label[for="mfaAssCode"]'));
  assert.equal(v.D("mfaAssCode").getAttribute("autocomplete"), "one-time-code");
  await v.soumettre("000000");
  assert.match(texte(v.D("mfaAssMsg")), /^Code incorrect\./);
  assert.equal(v.D("mfaAssMsg").getAttribute("role"), "alert");
  assert.ok(v.D("mfaAssForm"), "toujours à l'étape du code");
  await v.soumettre("123 456");
  assert.deepEqual(v.f.appels.filter(a => a[0] === "verify").at(-1), ["verify", { factorId: "f-nouveau", challengeId: "ch-f-nouveau", code: "123456" }]);
  assert.equal(texte(v.D("mfaEtape")), "Étape 4 sur 4");
  assert.deepEqual(v.changes, [1], "onChange dès l'activation");
  v.D("mfaAssFin").click(); await tick();
  assert.equal(v.D("mfaAss"), null, "dialogue fermé");
  assert.match(texte(v.cont), /Appareil 1/);
  assert.match(texte(v.$("mfaMsg")), /^Double authentification activée\./);
  assert.equal(v.$("mfaMsg").getAttribute("role"), "status");
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
  await ann.ajouter(); await ann.clic('[data-ass="fermer"]');
  assert.equal(ann.D("mfaAss"), null);
  assert.ok(ann.f.appels.some(a => a[0] === "unenroll" && a[1].factorId === "f-nouveau"), "inscription abandonnée retirée");
});

test("Sécurité : erreur à l'inscription expliquée ; QR d'origine inattendue jamais affiché (clé en texte seulement) ; tutoiement partout", async () => {
  const panne = await monterSec({ erreurs: { enroll: { code: "too_many_enrolled_mfa_factors", message: "x", status: 422 } } });
  await panne.ajouter();
  assert.match(texte(panne.D("mfaAssMsg")), /nombre maximal d'appareils/);
  assert.equal(texte(panne.D("mfaEtape")), "Étape 1 sur 4", "l'assistant reste à l'étape 1");
  const bizarre = await monterSec({ qr: "javascript:alert(1)" });
  await bizarre.ajouter();
  assert.equal(bizarre.D("mfaQr"), null);
  assert.equal(texte(bizarre.D("mfaSecret")), "JBSWY3DPEHPK3PXP");
  for (const v of [await monterSec(), await monterSec({ verifies: [F1] }), bizarre]) assert.doesNotMatch(texte(v.cont), VOUVOIEMENT);
  assert.doesNotMatch(texte(bizarre.doc.body), VOUVOIEMENT);
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

/* =================================================================== I1 : mot de passe redemandé avant la première inscription =================================================================== */
test("Sécurité (I1) : première inscription → le mot de passe est redemandé dans le dialogue, enroll n'est PAS appelé avant", async () => {
  const v = await monterSec();
  await v.clic("#mfaAjouter");
  assert.ok(v.D("mfaAssForm1"), "formulaire de mot de passe (étape 1)");
  const champ = v.D("mfaAssPw");
  assert.equal(champ.getAttribute("type"), "password");
  assert.equal(champ.getAttribute("autocomplete"), "current-password");
  assert.ok(v.doc.body.querySelector('label[for="mfaAssPw"]'));
  assert.equal(v.doc.body.querySelector("#mfaQr"), null);
  assert.ok(!v.f.appels.some(a => a[0] === "enroll" || a[0] === "signIn"), "ni connexion ni inscription avant la saisie");
  assert.doesNotMatch(texte(v.doc.body), VOUVOIEMENT);
});

test("Sécurité (I1) : mauvais mot de passe → message, champ vidé, enroll jamais appelé ; bon mot de passe → signInWithPassword sur l'e-mail courant PUIS enroll", async () => {
  const v = await monterSec({ email: "camille@example.org" });
  await v.clic("#mfaAjouter");
  v.D("mfaAssPw").value = "mauvais"; v.D("mfaAssForm1").dispatchEvent(new v.Ev("submit")); await tick();
  assert.match(texte(v.D("mfaAssMsg")), /^Mot de passe incorrect\./);
  assert.equal(v.D("mfaAssPw").value, "");
  assert.ok(!v.f.appels.some(a => a[0] === "enroll"), "aucune inscription sur un mauvais mot de passe");
  v.D("mfaAssPw").value = MOT_DE_PASSE; v.D("mfaAssForm1").dispatchEvent(new v.Ev("submit")); await tick();
  assert.ok(v.D("mfaQr") && texte(v.D("mfaEtape")) === "Étape 2 sur 4", "bon mot de passe : l'inscription démarre");
  assert.deepEqual(v.f.appels.map(a => a[0]).filter(n => n === "signIn" || n === "enroll"), ["signIn", "signIn", "enroll"]);
});

test("Sécurité (I1) : séquence exacte signIn → enroll ; champ vide refusé sans appel ; annuler ferme le dialogue ; e-mail inconnu → refus (échec fermé)", async () => {
  const v = await monterSec();
  await v.clic("#mfaAjouter");
  v.D("mfaAssPw").value = ""; v.D("mfaAssForm1").dispatchEvent(new v.Ev("submit")); await tick();
  assert.match(texte(v.D("mfaAssMsg")), /^Saisis ton mot de passe\./);
  assert.equal(v.f.appels.some(a => a[0] === "signIn"), false);
  await v.clic('[data-ass="annuler"]');
  assert.equal(v.D("mfaAss"), null, "dialogue fermé");
  assert.ok(v.$("mfaAjouter") && v.doc.activeElement === v.$("mfaAjouter"), "retour à la liste, focus sur le bouton");
  await v.ajouter();
  const seq = v.f.appels.map(a => a[0]).filter(n => n === "signIn" || n === "enroll");
  assert.deepEqual(seq, ["signIn", "enroll"]);
  assert.deepEqual(v.f.appels.find(a => a[0] === "signIn"), ["signIn", "camille@example.org"]);
  assert.ok(v.D("mfaQr"), "inscription affichée");
  const sansEmail = await monterSec({ email: "" });
  await sansEmail.ajouter();
  assert.match(texte(sansEmail.D("mfaAssMsg")), /Adresse e-mail introuvable/);
  assert.ok(!sansEmail.f.appels.some(a => a[0] === "enroll" || a[0] === "signIn"));
  const reseau = await monterSec({ erreurs: { signIn: { code: "network", message: "Failed to fetch" } } });
  await reseau.ajouter();
  assert.match(texte(reseau.D("mfaAssMsg")), /Connexion au serveur impossible/);
  assert.ok(!reseau.f.appels.some(a => a[0] === "enroll"), "réseau en panne : pas d'inscription");
});

test("Sécurité (I1) : second appareil (une session aal2 existe déjà) → pas de nouveau mot de passe, enroll direct", async () => {
  const v = await monterSec({ verifies: [F1] });
  await v.clic("#mfaAjouter");
  assert.equal(v.D("mfaAssPw"), null, "pas de champ mot de passe");
  assert.match(texte(v.D("mfaAss")), /second appareil de double authentification/);
  v.D("mfaAssForm1").dispatchEvent(new v.Ev("submit")); await tick();
  assert.ok(v.D("mfaQr"));
  assert.ok(!v.f.appels.some(a => a[0] === "signIn"));
});

/* =================================================================== I1 : bandeau « un appareil a été ajouté » =================================================================== */
async function monterBandeau({ verifies = [F1], vus, erreurs } = {}) {
  const dom = miniDom(), { doc } = dom;
  const f = fauxClient({ verifies, erreurs });
  const storage = fauxStockage(vus ? { "boussole.mfa.vus": JSON.stringify(vus) } : {});
  const pose = await Mfa.signalerNouvelAppareil(Mfa.adapter(f.client), { doc, storage });
  const bandeau = doc.body.querySelector("#mfaAlerte");
  return { doc, f, storage, pose, bandeau };
}

test("bandeau (I1) : appareil jamais vu sur ce navigateur → alerte avec la date et l'adresse d'assistance ; « C'est moi » l'acquitte et le retire", async () => {
  const v = await monterBandeau({ verifies: [F1, F2] });
  assert.equal(v.pose, true);
  assert.equal(v.bandeau.getAttribute("role"), "alert");
  const t = texte(v.bandeau);
  assert.match(t, /^Un appareil de double authentification a été ajouté le 15 septembre 2026 — ce n'est pas toi \? Écris à stephane@ceres\.agency\./, "le plus récent est signalé");
  assert.equal(v.bandeau.querySelector("a").getAttribute("href"), "mailto:stephane@ceres.agency");
  assert.doesNotMatch(t, VOUVOIEMENT);
  assert.equal(texte(v.bandeau.querySelector("#mfaAlerteOk")), "C'est moi");
  v.bandeau.querySelector("#mfaAlerteOk").click();
  assert.equal(v.doc.body.querySelector("#mfaAlerte"), null);
  assert.deepEqual(JSON.parse(v.storage.getItem("boussole.mfa.vus")).sort(), ["f-1", "f-2"], "tous les appareils actuels acquittés");
  // démarrage suivant : plus de bandeau
  const apres = await Mfa.signalerNouvelAppareil(Mfa.adapter(fauxClient({ verifies: [F1, F2] }).client), { doc: v.doc, storage: v.storage });
  assert.equal(apres, false);
});

test("bandeau (I1) : tous les appareils déjà acquittés → rien ; un appareil plus récent que ceux acquittés → seul lui est signalé", async () => {
  const rien = await monterBandeau({ verifies: [F1], vus: ["f-1"] });
  assert.equal(rien.pose, false); assert.equal(rien.bandeau, null);
  const nouveau = await monterBandeau({ verifies: [F1, F2], vus: ["f-1"] });
  assert.equal(nouveau.pose, true);
  assert.match(texte(nouveau.bandeau), /ajouté le 15 septembre 2026/);
  assert.doesNotMatch(texte(nouveau.bandeau), /1er septembre/);
  assert.deepEqual(JSON.parse(nouveau.storage.getItem("boussole.mfa.vus")), ["f-1"], "rien n'est acquitté sans clic");
});

test("bandeau (I1) : stockage absent, bloqué ou illisible → bandeau quand même (par prudence), jamais d'exception ; lecture des appareils en échec → rien", async () => {
  const dom = miniDom(), { doc } = dom;
  const api = Mfa.adapter(fauxClient({ verifies: [F1] }).client);
  const bloque = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceeded"); } };
  assert.equal(await Mfa.signalerNouvelAppareil(api, { doc, storage: bloque }), true);
  doc.body.querySelector("#mfaAlerteOk").click(); // setItem lève : sans conséquence
  assert.equal(doc.body.querySelector("#mfaAlerte"), null);
  const corrompu = fauxStockage({ "boussole.mfa.vus": "{pas du json" });
  assert.equal(await Mfa.signalerNouvelAppareil(api, { doc: miniDom().doc, storage: corrompu }), true);
  assert.equal((await monterBandeau({ erreurs: { listFactors: { code: "network", message: "x" } } })).pose, false);
  assert.equal(await Mfa.signalerNouvelAppareil(api, { doc: null }), false);
});

test("bandeau (I1) : un appareil enrôlé depuis cet appareil-ci (Sécurité) est acquitté d'office, pas de fausse alerte au démarrage suivant", async () => {
  const v = await monterSec();
  await v.versCode();
  await v.soumettre("123456");
  assert.deepEqual(JSON.parse(v.storage.getItem("boussole.mfa.vus")), ["f-nouveau"]);
});

test("store-supabase.js et mentions : le bandeau est lancé au démarrage de l'app, l'adresse d'assistance est celle des mentions légales", () => {
  const js = src("store-supabase.js");
  const boot = js.slice(js.indexOf("async function boot()"));
  assert.match(boot, /window\.Mfa\.signalerNouvelAppareil\(A\.mfa/);
  assert.ok(boot.indexOf("signalerNouvelAppareil") > boot.indexOf("Mfa.exiger") && boot.indexOf("signalerNouvelAppareil") < boot.indexOf("await loadAll()"));
  const mentions = readFileSync(new URL("../web/legal/mentions.html", import.meta.url), "utf8");
  assert.match(mentions, /mailto:stephane@ceres\.agency/);
  assert.match(src("mfa.js"), /const CONTACT = "stephane@ceres\.agency";/);
  assert.match(src("account.js"), /email: user\.email/);
});

/* =================================================================== assistant d'activation (dialogue en 4 étapes) =================================================================== */
const URI_TEST = "otpauth://totp/Boussole:camille@example.org?secret=JBSWY3DPEHPK3PXP&issuer=Boussole";
async function ouvrirAss({ verifies = [], email = "camille@example.org", petitEcran = false, clipboard, erreurs, qr, uri, passerPar } = {}) {
  const dom = miniDom(), { doc, Ev, touche } = dom;
  const app = doc.body.appendChild(doc.createElement("main"));
  const declencheur = app.appendChild(doc.createElement("button"));
  declencheur.id = "declencheur";
  declencheur.focus();
  const f = fauxClient({ verifies, erreurs: Object.assign({}, erreurs, qr !== undefined ? { qr } : {}, uri !== undefined ? { uri } : {}) });
  const api = Mfa.adapter(f.client);
  if (passerPar) passerPar(api);
  const changes = [], storage = fauxStockage();
  let resultat = null;
  const fini = Mfa.ouvrirActivation(api, { doc, email, storage, petitEcran, clipboard, onChange: l => changes.push(l.length) }).then(v => { resultat = v; return v; });
  await tick();
  const D = id => doc.body.querySelector("#" + id);
  const fond = () => doc.body.children.find(c => c.classList.contains("mfa-ass-fond"));
  const soumettre = async (id, valeur, champ) => { if (champ) D(champ).value = valeur; D(id).dispatchEvent(new Ev("submit")); await tick(); };
  const clic = async sel => { const b = doc.body.querySelector(sel); assert.ok(b, "bouton " + sel); b.click(); await tick(); };
  const etape = () => texte(D("mfaEtape"));
  const titre = () => texte(D("mfaAssTitre"));
  const barre = () => { const c = D("mfaAss").querySelector(".mfa-prog").children; return [c.length, c.filter(i => i.classList.contains("on")).length]; };
  // étape 1 → 2 (mot de passe si premier appareil)
  const versQr = async () => { if (D("mfaAssPw")) D("mfaAssPw").value = MOT_DE_PASSE; await soumettre("mfaAssForm1"); };
  const versCode = async () => { await versQr(); await clic("#mfaAssSuite"); };
  const saisirCode = async code => { const c = D("mfaAssCode"); c.value = code; c.dispatchEvent(new Ev("input")); await tick(); };
  return { doc, app, declencheur, f, api, changes, storage, fini, resultat: () => resultat, D, fond, soumettre, clic, etape, titre, barre, versQr, versCode, saisirCode, touche, Ev };
}

test("assistant : dialogue accessible (role, aria-modal, titre de l'étape), « Étape N sur 4 », focus dans la boîte, page derrière inerte", async () => {
  const v = await ouvrirAss();
  const boite = v.D("mfaAss");
  assert.equal(boite.getAttribute("role"), "dialog"); assert.equal(boite.getAttribute("aria-modal"), "true");
  const lie = boite.getAttribute("aria-labelledby");
  assert.equal(lie, "mfaAssTitre"); assert.equal(v.titre(), "Pourquoi un code ?");
  assert.equal(v.etape(), "Étape 1 sur 4");
  assert.equal(v.doc.activeElement, v.D("mfaAssPw"), "focus sur le mot de passe (premier appareil)");
  assert.equal(v.app.inert, true); assert.equal(v.app.getAttribute("aria-hidden"), "true");
  assert.ok(v.doc.documentElement.classList.contains("mfa-ass-ouvert"), "défilement de la page verrouillé");
  assert.deepEqual(v.barre(), [4, 1], "barre : 1 étape sur 4");
  const x = boite.querySelector('[data-ass="fermer"]');
  assert.equal(x.getAttribute("aria-label"), "Fermer"); assert.equal(x.localName, "button");
  assert.match(texte(v.D("mfaAss")), /Même si quelqu'un trouve ton mot de passe/);
  v.D("mfaAss").querySelector('[data-ass="annuler"]').click(); await v.fini;
});

test("assistant : les 4 étapes dans l'ordre (mot de passe → QR → code → activé), titres, progression et état final", async () => {
  const v = await ouvrirAss();
  assert.equal(v.D("mfaAssPw").getAttribute("type"), "password");
  assert.ok(!v.f.appels.some(a => a[0] === "enroll"), "rien n'est créé avant le mot de passe");
  await v.versQr();
  assert.equal(v.etape(), "Étape 2 sur 4"); assert.equal(v.titre(), "Ajoute Boussole à ton application");
  assert.equal(v.doc.activeElement, v.D("mfaAssTitre"), "focus sur le titre de l'étape (annoncé)");
  assert.deepEqual(v.barre(), [4, 2]);
  assert.ok(v.D("mfaQr"));
  await v.clic("#mfaAssSuite");
  assert.equal(v.etape(), "Étape 3 sur 4"); assert.equal(v.titre(), "Saisis le code");
  assert.equal(v.doc.activeElement, v.D("mfaAssCode"), "focus sur le champ du code");
  const champ = v.D("mfaAssCode");
  assert.equal(champ.getAttribute("inputmode"), "numeric");
  assert.equal(champ.getAttribute("autocomplete"), "one-time-code");
  assert.ok(v.doc.body.querySelector('label[for="mfaAssCode"]'));
  await v.soumettre("mfaAssForm", "123456", "mfaAssCode");
  assert.equal(v.etape(), "Étape 4 sur 4"); assert.equal(v.titre(), "C'est activé");
  assert.match(texte(v.D("mfaAssFait")), /La double authentification est activée/);
  assert.match(texte(v.D("mfaAss")), /ne propose pas de codes de secours/);
  assert.deepEqual(v.barre(), [4, 4]);
  assert.deepEqual(v.changes, [1]);
  assert.equal(texte(v.D("mfaAssSecond")), "Ajouter un second appareil");
  await v.clic("#mfaAssFin");
  assert.equal(v.fond(), undefined, "dialogue retiré");
  assert.equal(await v.fini, true, "résolu à true : un appareil a été activé");
  assert.equal(v.app.inert, false); assert.equal(v.app.getAttribute("aria-hidden"), null);
  assert.equal(v.doc.documentElement.classList.contains("mfa-ass-ouvert"), false);
  assert.equal(v.doc.activeElement, v.declencheur, "focus rendu à l'élément qui a ouvert le dialogue");
  assert.deepEqual(JSON.parse(v.storage.getItem("boussole.mfa.vus")), ["f-nouveau"], "pas de fausse alerte « appareil ajouté » pour l'appareil créé ici");
  assert.ok(!v.f.appels.some(a => a[0] === "unenroll" && a[1].factorId === "f-nouveau"), "l'appareil activé n'est pas retiré à la fermeture");
});

test("assistant : retour de l'étape 3 à l'étape 2 garde la même inscription ; retour de l'étape 2 à l'étape 1 la retire, une nouvelle est créée ensuite", async () => {
  const v = await ouvrirAss();
  await v.versCode();
  await v.clic('[data-ass="retour"]');
  assert.equal(v.etape(), "Étape 2 sur 4");
  assert.equal(v.f.appels.filter(a => a[0] === "enroll").length, 1, "même inscription");
  await v.clic('[data-ass="retour"]');
  assert.equal(v.etape(), "Étape 1 sur 4");
  assert.ok(v.f.appels.some(a => a[0] === "unenroll" && a[1].factorId === "f-nouveau"), "inscription non vérifiée retirée");
  assert.equal(v.D("mfaAssPw"), null, "mot de passe déjà confirmé : pas redemandé");
  await v.soumettre("mfaAssForm1");
  assert.equal(v.etape(), "Étape 2 sur 4");
  assert.equal(v.f.appels.filter(a => a[0] === "enroll").length, 2);
  v.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await v.fini;
});

test("assistant : « Je ne peux pas scanner » révèle la clé (aria-expanded) ; Copier utilise le presse-papiers ; repli : clé sélectionnée et message", async () => {
  const copies = [];
  const v = await ouvrirAss({ clipboard: { writeText: async t => { copies.push(t); } } });
  await v.versQr();
  const b = v.D("mfaPasScanner");
  assert.equal(b.localName, "button"); assert.equal(b.getAttribute("aria-expanded"), "false"); assert.equal(b.getAttribute("aria-controls"), "mfaCle");
  assert.equal(v.D("mfaCle").hidden, true);
  await v.clic("#mfaPasScanner");
  assert.equal(b.getAttribute("aria-expanded"), "true"); assert.equal(v.D("mfaCle").hidden, false);
  assert.equal(texte(v.D("mfaSecret")), "JBSWY3DPEHPK3PXP");
  assert.equal(v.D("mfaSecret").getAttribute("tabindex"), "0", "clé focalisable : copiable au clavier");
  assert.equal(texte(v.D("mfaCopier")), "Copier");
  await v.clic("#mfaCopier");
  assert.deepEqual(copies, ["JBSWY3DPEHPK3PXP"]);
  assert.equal(texte(v.D("mfaCopieMsg")), "Clé copiée."); assert.equal(v.D("mfaCopieMsg").getAttribute("role"), "status");
  v.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await v.fini;
  // presse-papiers refusé (contexte non sécurisé, permission) ou absent : jamais d'exception, la clé est sélectionnée et le message le dit
  for (const clipboard of [{ writeText: async () => { throw new Error("NotAllowedError"); } }, null, undefined]) {
    const w = await ouvrirAss({ clipboard });
    await w.versQr(); await w.clic("#mfaPasScanner"); await w.clic("#mfaCopier");
    assert.match(texte(w.D("mfaCopieMsg")), /Copie automatique impossible : la clé est sélectionnée/);
    assert.equal(w.doc.activeElement, w.D("mfaSecret"), "clé focalisée pour Ctrl+C");
    w.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await w.fini;
  }
});

test("assistant : petit écran → bouton « Ouvrir dans mon application d'authentification » (lien otpauth://) AVANT le QR code ; grand écran → QR seul", async () => {
  const p = await ouvrirAss({ petitEcran: true });
  await p.versQr();
  const ouvrir = p.D("mfaOuvrir");
  assert.ok(ouvrir, "bouton présent");
  assert.equal(ouvrir.localName, "a"); assert.equal(ouvrir.getAttribute("href"), URI_TEST);
  assert.equal(texte(ouvrir), "Ouvrir dans mon application d'authentification");
  assert.ok(ouvrir.classList.contains("mfa-btn"));
  const ordre = p.D("mfaAss").descendants();
  assert.ok(ordre.indexOf(ouvrir) < ordre.indexOf(p.D("mfaQr")), "le bouton précède le QR code");
  assert.ok(p.D("mfaQr"), "le QR reste disponible (autre appareil)");
  assert.match(texte(p.D("mfaAss")), /Sur ce téléphone, un QR code ne peut pas être scanné/);
  await p.clic("#mfaPasScanner"); assert.equal(texte(p.D("mfaSecret")), "JBSWY3DPEHPK3PXP", "la clé reste le dernier recours");
  p.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await p.fini;
  const g = await ouvrirAss({ petitEcran: false });
  await g.versQr();
  assert.equal(g.D("mfaOuvrir"), null); assert.ok(g.D("mfaQr"));
  g.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await g.fini;
  // lien d'un autre schéma (réponse inattendue) : jamais proposé
  for (const uri of ["javascript:alert(1)", "https://exemple.org/x", "otpauth://hotp/x?secret=A"]) {
    const x = await ouvrirAss({ petitEcran: true, uri });
    await x.versQr();
    assert.equal(x.D("mfaOuvrir"), null, uri);
    x.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await x.fini;
  }
});

test("assistant : étape 3 — code faux : message clair, champ vidé et focalisé, nouvel essai possible ; Retour et Annuler présents", async () => {
  const v = await ouvrirAss();
  await v.versCode();
  await v.soumettre("mfaAssForm", "000000", "mfaAssCode");
  assert.match(texte(v.D("mfaAssMsg")), /^Code incorrect\./);
  assert.equal(v.D("mfaAssMsg").getAttribute("role"), "alert");
  assert.equal(v.D("mfaAssCode").value, ""); assert.equal(v.doc.activeElement, v.D("mfaAssCode"));
  assert.equal(v.etape(), "Étape 3 sur 4");
  assert.ok(!v.D("mfaAssOk").disabled, "bouton réutilisable");
  await v.soumettre("mfaAssForm", "12 34", "mfaAssCode");
  assert.match(texte(v.D("mfaAssMsg")), /^Saisis les 6 chiffres/);
  assert.equal(v.f.appels.filter(a => a[0] === "verify").length, 1, "moins de 6 chiffres : aucun appel");
  await v.soumettre("mfaAssForm", "123456", "mfaAssCode");
  assert.equal(v.etape(), "Étape 4 sur 4");
  assert.deepEqual(v.f.appels.filter(a => a[0] === "verify").map(a => a[1].code), ["000000", "123456"]);
  await v.clic("#mfaAssFin"); await v.fini;
  const r = await ouvrirAss({ erreurs: { verify: { code: "over_request_rate_limit", message: "rate", status: 429 } } });
  await r.versCode(); await r.saisirCode("123456");
  assert.match(texte(r.D("mfaAssMsg")), /Trop de tentatives/);
  r.D("mfaAss").querySelector('[data-ass="annuler"]').click(); await r.fini;
});

test("assistant : envoi automatique dès le 6e chiffre (frappe ou saisie automatique), pas avant ; collage tolérant (espaces, texte autour)", async () => {
  const v = await ouvrirAss();
  await v.versCode();
  await v.saisirCode("12345");
  assert.equal(v.f.appels.filter(a => a[0] === "verify").length, 0, "5 chiffres : rien n'est envoyé");
  await v.saisirCode("123456");
  assert.equal(v.f.appels.filter(a => a[0] === "verify").length, 1, "6 chiffres : envoyé tout seul");
  assert.equal(v.etape(), "Étape 4 sur 4");
  await v.clic("#mfaAssFin"); await v.fini;
  for (const [colle, attendu] of [["123 456", "123456"], ["Code : 123-456", "123456"], ["123456", "123456"]]) {
    const w = await ouvrirAss();
    await w.versCode();
    const champ = w.D("mfaAssCode");
    const ev = new w.Ev("paste", { clipboardData: { getData: () => colle } });
    champ.dispatchEvent(ev); await tick();
    assert.equal(ev.defaultPrevented, true, "collage pris en charge");
    assert.equal(w.f.appels.filter(a => a[0] === "verify").map(a => a[1].code)[0], attendu, colle);
    assert.equal(w.etape(), "Étape 4 sur 4");
    await w.clic("#mfaAssFin"); await w.fini;
  }
  // collage incomplet : rempli mais pas envoyé
  const c = await ouvrirAss();
  await c.versCode();
  c.D("mfaAssCode").dispatchEvent(new c.Ev("paste", { clipboardData: { getData: () => "12 34" } })); await tick();
  assert.equal(c.D("mfaAssCode").value, "1234"); assert.equal(c.f.appels.filter(a => a[0] === "verify").length, 0);
  // double déclenchement (frappe puis Entrée) : un seul envoi tant que le premier n'est pas revenu
  const d = await ouvrirAss();
  await d.versCode();
  d.D("mfaAssCode").value = "123456";
  d.D("mfaAssCode").dispatchEvent(new d.Ev("input")); d.D("mfaAssForm").dispatchEvent(new d.Ev("submit")); await tick();
  assert.equal(d.f.appels.filter(a => a[0] === "verify").length, 1);
});

test("assistant : Échap ferme et retire l'inscription non vérifiée (étapes 2 et 3), focus rendu, page de nouveau active ; résolu à false", async () => {
  for (const etapeVoulue of [2, 3]) {
    const v = await ouvrirAss();
    await (etapeVoulue === 2 ? v.versQr() : v.versCode());
    assert.equal(v.f.abandonnes.length, 1, "inscription non vérifiée en cours côté serveur");
    const e = v.touche(v.D("mfaAss"), "Escape"); await tick();
    assert.equal(e.defaultPrevented, true);
    assert.equal(v.fond(), undefined, "dialogue fermé");
    assert.equal(await v.fini, false);
    assert.deepEqual(v.f.appels.filter(a => a[0] === "unenroll").map(a => a[1].factorId), ["f-nouveau"]);
    assert.ok(v.f.appels.some(a => a[0] === "listFactors"), "nettoyage = listFactors puis unenroll des non vérifiés");
    assert.equal(v.f.abandonnes.length, 0, "rien ne reste côté serveur : une nouvelle tentative repart proprement");
    assert.equal(v.app.inert, false); assert.equal(v.doc.activeElement, v.declencheur);
    assert.equal(v.doc.documentElement.classList.contains("mfa-ass-ouvert"), false);
  }
  // un appareil vérifié n'est jamais touché par le nettoyage (second appareil abandonné)
  const s = await ouvrirAss({ verifies: [F1] });
  await s.soumettre("mfaAssForm1");
  s.touche(s.D("mfaAss"), "Escape"); await s.fini;
  assert.ok(s.f.facteurs.some(f => f.id === "f-1"), "appareil existant intact");
  assert.deepEqual(s.f.appels.filter(a => a[0] === "unenroll").map(a => a[1].factorId), ["f-nouveau"]);
  // fermer sans avoir rien créé (étape 1) : aucun appel de nettoyage
  const u = await ouvrirAss();
  u.touche(u.D("mfaAss"), "Escape"); await u.fini;
  assert.ok(!u.f.appels.some(a => a[0] === "unenroll" || a[0] === "enroll"));
});

test("assistant : ×, Annuler et Terminer ferment ; fermer pendant la création → l'inscription qui arrive ensuite est retirée aussitôt", async () => {
  for (const sel of ['[data-ass="fermer"]', '[data-ass="annuler"]']) {
    const v = await ouvrirAss();
    await v.versCode();
    await v.clic(sel);
    assert.equal(v.fond(), undefined, sel);
    assert.equal(await v.fini, false);
    assert.equal(v.f.abandonnes.length, 0, sel);
  }
  let relacher;
  const attente = new Promise(r => { relacher = r; });
  const v = await ouvrirAss({ passerPar: api => { const orig = api.inscrire; api.inscrire = async () => { await attente; return orig(); }; } });
  v.D("mfaAssPw").value = MOT_DE_PASSE; v.D("mfaAssForm1").dispatchEvent(new v.Ev("submit")); await tick();
  assert.equal(v.D("mfaAssSuite").getAttribute("aria-busy"), "true", "création en cours");
  v.touche(v.D("mfaAss"), "Escape"); await tick();
  assert.equal(v.fond(), undefined);
  relacher(); await v.fini; await tick();
  assert.equal(v.f.abandonnes.length, 0, "l'inscription tardive est retirée");
  assert.ok(v.f.appels.some(a => a[0] === "unenroll" && a[1].factorId === "f-nouveau"));
});

test("assistant : piège à focus — Tab et Maj+Tab bouclent dans la boîte, la page derrière reste inerte, le focus extérieur est ramené", async () => {
  const v = await ouvrirAss();
  const boite = v.D("mfaAss");
  const focalisables = [...boite.querySelectorAll("button, a[href], input, select, textarea, [tabindex]")].filter(e => e.getAttribute("tabindex") !== "-1");
  assert.deepEqual(focalisables.map(e => e.id || e.getAttribute("data-ass") || e.getAttribute("type")), ["fermer", "mfaAssPw", "mfaAssSuite", "annuler"]);
  const dernier = focalisables.at(-1), premier = focalisables[0];
  dernier.focus();
  let e = v.touche(dernier, "Tab");
  assert.equal(e.defaultPrevented, true); assert.equal(v.doc.activeElement, premier, "Tab sur le dernier → premier");
  e = v.touche(premier, "Tab", { shiftKey: true });
  assert.equal(e.defaultPrevented, true); assert.equal(v.doc.activeElement, dernier, "Maj+Tab sur le premier → dernier");
  v.D("mfaAssPw").focus();
  e = v.touche(v.D("mfaAssPw"), "Tab");
  assert.equal(e.defaultPrevented, false, "au milieu : le navigateur avance seul");
  // focus qui s'échappe (clic en dehors, outil d'accessibilité) : ramené dans la boîte
  v.app.inert = false; v.declencheur.focus();
  assert.ok(boite.contains(v.doc.activeElement), "focus ramené dans le dialogue");
  v.touche(boite, "Escape"); await v.fini;
  // après fermeture, plus d'écoute : Échap ou Tab sans effet
  const apres = v.touche(v.doc.body, "Tab");
  assert.equal(apres.defaultPrevented, false);
});

test("assistant : second appareil depuis l'étape 4 — nouvelle inscription à l'étape 2 (sans mot de passe) ; appareil existant : texte adapté", async () => {
  const v = await ouvrirAss();
  await v.versCode(); await v.saisirCode("123456");
  assert.equal(v.etape(), "Étape 4 sur 4");
  await v.clic("#mfaAssSecond");
  assert.equal(v.etape(), "Étape 2 sur 4");
  assert.equal(v.f.appels.filter(a => a[0] === "enroll").length, 2, "nouvelle inscription");
  assert.equal(v.f.appels.filter(a => a[0] === "signIn").length, 1, "mot de passe non redemandé");
  assert.ok(v.D("mfaQr"));
  await v.clic("#mfaAssSuite");
  await v.saisirCode("123456");
  assert.equal(v.etape(), "Étape 4 sur 4");
  assert.deepEqual(v.changes, [1, 2]);
  await v.clic("#mfaAssFin");
  assert.equal(await v.fini, true);
  const w = await ouvrirAss({ verifies: [F1] });
  assert.match(texte(w.D("mfaAss")), /Tu ajoutes un second appareil de double authentification\. Si tu perds le premier/);
  assert.equal(w.D("mfaAssPw"), null);
  w.touche(w.D("mfaAss"), "Escape"); await w.fini;
});

test("assistant : appareils illisibles → mot de passe demandé par prudence ; erreur à la création → étape 1 conservée avec le message", async () => {
  const v = await ouvrirAss({ erreurs: { listFactors: { code: "network", message: "Failed to fetch" } } });
  assert.ok(v.D("mfaAssPw"), "échec fermé : mot de passe redemandé");
  v.touche(v.D("mfaAss"), "Escape"); await v.fini;
  const e = await ouvrirAss({ erreurs: { enroll: { code: "too_many_enrolled_mfa_factors", message: "x", status: 422 } } });
  await e.versQr();
  assert.equal(e.etape(), "Étape 1 sur 4");
  assert.match(texte(e.D("mfaAssMsg")), /nombre maximal d'appareils/);
  assert.ok(!e.D("mfaAssSuite").disabled, "on peut réessayer");
  e.touche(e.D("mfaAss"), "Escape"); await e.fini;
  assert.equal(await Mfa.ouvrirActivation(Mfa.adapter(fauxClient().client), { doc: null }), false, "sans document : rien, false");
});

test("assistant : tous les textes tutoient ; aucun message anglais brut", async () => {
  const v = await ouvrirAss({ petitEcran: true });
  const textes = [texte(v.D("mfaAss"))];
  await v.versQr(); await v.clic("#mfaPasScanner"); textes.push(texte(v.D("mfaAss")));
  await v.clic("#mfaAssSuite"); await v.soumettre("mfaAssForm", "000000", "mfaAssCode"); textes.push(texte(v.D("mfaAss")));
  await v.soumettre("mfaAssForm", "123456", "mfaAssCode"); textes.push(texte(v.D("mfaAss")));
  for (const t of textes) { assert.doesNotMatch(t, VOUVOIEMENT); assert.doesNotMatch(t, /Invalid|enroll|factor/i); }
  await v.clic("#mfaAssFin"); await v.fini;
});

test("assistant : style — feuille plein écran sur téléphone, mouvement réduit respecté, clair/sombre via les variables de la page", () => {
  const css = Mfa.CSS;
  assert.match(css, /@media \(max-width:640px\)\{\.mfa-ass-fond\{padding:0;align-items:stretch\}\.mfa-ass-box\{max-width:none;max-height:none;min-height:100%;border:0;border-radius:0/);
  assert.match(css, /env\(safe-area-inset-bottom,0px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\.mfa-ass-box\{animation:/, "animation seulement si le mouvement n'est pas réduit");
  assert.doesNotMatch(css.replace(/@media \(prefers-reduced-motion:no-preference\)\{[^}]*\{[^}]*\}[^}]*\{[^}]*\}[^}]*\}/, ""), /animation|transition/, "aucun mouvement hors de la requête média");
  const boite = css.match(/\.mfa-ass-box\{[^}]*\}/)[0];
  assert.match(boite, /color:var\(--ink,/); assert.match(boite, /background:var\(--surface,/); assert.match(boite, /border:1px solid var\(--line,/);
  assert.match(css, /\.mfa-btn:focus-visible[^{]*\{outline:2px solid/);
  assert.match(css, /\.mfa-ass-x\{[^}]*min-width:44px;min-height:44px/);
});

/* =================================================================== écran de code : saisie (auto-envoi, collage) =================================================================== */
test("écran de code : envoi automatique au 6e chiffre, collage tolérant, une seule étape sans liste d'appareils", async () => {
  const a = await monterEcran();
  a.$("mfaCode").value = "12345"; a.$("mfaCode").dispatchEvent(new (miniDom().Ev)("input")); await tick();
  assert.equal(a.f.appels.filter(x => x[0] === "verify").length, 0);
  a.$("mfaCode").value = "123456"; a.$("mfaCode").dispatchEvent(new (miniDom().Ev)("input")); await tick();
  assert.equal(a.evts.verifie, 1, "6 chiffres : validé sans clic");
  const b = await monterEcran();
  const ev = new (miniDom().Ev)("paste", { clipboardData: { getData: () => "123 456" } });
  b.$("mfaCode").dispatchEvent(ev); await tick();
  assert.equal(ev.defaultPrevented, true);
  assert.equal(b.evts.verifie, 1);
  assert.deepEqual(b.f.appels.find(x => x[0] === "verify")[1].code, "123456");
  // mauvais code envoyé tout seul : champ vidé, message, prêt pour un nouvel essai
  const c = await monterEcran();
  c.$("mfaCode").value = "000000"; c.$("mfaCode").dispatchEvent(new (miniDom().Ev)("input")); await tick();
  assert.match(texte(c.$("mfaCodeMsg")), /^Code incorrect\./);
  assert.equal(c.$("mfaCode").value, ""); assert.equal(c.doc.activeElement, c.$("mfaCode"));
  assert.equal(c.evts.verifie, 0);
  assert.equal(c.$("mfaCode").getAttribute("autocomplete"), "one-time-code"); assert.equal(c.$("mfaCode").getAttribute("inputmode"), "numeric");
});

/* =================================================================== ouverture depuis la carte « Active la double authentification » =================================================================== */
test("carte bloquante : le bouton (data-mfa-activer) ouvre l'assistant sur place ; compte anonyme ou sans client → lien normal vers Compte › Sécurité", async () => {
  const montage = async ({ auth, apres, aller }) => {
    const dom = miniDom(), { doc, Ev } = dom;
    const app = doc.body.appendChild(doc.createElement("main"));
    app.innerHTML = '<a class="bq-mfa-btn" id="carte" href="compte.html#securite" data-mfa-activer>Activer la double authentification</a>';
    Mfa.installerOuverture(doc, { auth, apres, aller, petitEcran: false });
    const lien = doc.body.querySelector("#carte");
    const clic = new Ev("click"); lien.dispatchEvent(clic); await tick();
    return { doc, Ev, lien, clic, D: id => doc.body.querySelector("#" + id) };
  };
  const f = fauxClient();
  const auth = { mfa: Mfa.adapter(f.client), session: async () => ({ user: { email: "camille@example.org" } }), isAnonymous: () => false };
  const appels = { apres: 0, aller: [] };
  const v = await montage({ auth, apres: () => { appels.apres++; }, aller: u => appels.aller.push(u) });
  assert.equal(v.clic.defaultPrevented, true, "pas de navigation : on reste dans la page");
  assert.ok(v.D("mfaAss"), "assistant ouvert");
  assert.equal(v.D("mfaAssTitre").textContent, "Pourquoi un code ?");
  v.D("mfaAssPw").value = MOT_DE_PASSE; v.D("mfaAssForm1").dispatchEvent(new v.Ev("submit")); await tick();
  assert.deepEqual(f.appels.find(a => a[0] === "signIn"), ["signIn", "camille@example.org"], "e-mail de la session");
  v.D("mfaAssSuite").click(); await tick();
  v.D("mfaAssCode").value = "123456"; v.D("mfaAssCode").dispatchEvent(new v.Ev("input")); await tick();
  assert.equal(appels.apres, 0, "pas de rechargement tant que le dialogue est ouvert");
  v.D("mfaAssFin").click(); await tick();
  assert.equal(appels.apres, 1, "données rechargées une fois activé (la carte disparaît)");
  assert.deepEqual(appels.aller, []);
  assert.equal(v.doc.activeElement, v.lien, "focus rendu au bouton de la carte");
  // annulé : rien n'est rechargé
  const g = fauxClient(), appels2 = { apres: 0 };
  const w = await montage({ auth: { mfa: Mfa.adapter(g.client), session: async () => ({ user: { email: "c@example.org" } }), isAnonymous: () => false }, apres: () => { appels2.apres++; }, aller: () => {} });
  w.D("mfaAss").querySelector('[data-ass="fermer"]').click(); await tick();
  assert.equal(appels2.apres, 0);
  // anonyme : navigation vers Compte
  const h = { apres: 0, aller: [] };
  const x = await montage({ auth: { mfa: Mfa.adapter(fauxClient().client), session: async () => ({ user: { is_anonymous: true } }), isAnonymous: s => !!s.user.is_anonymous }, apres: () => { h.apres++; }, aller: u => h.aller.push(u) });
  assert.equal(x.D("mfaAss"), null); assert.deepEqual(h.aller, ["compte.html#securite"]);
  // session illisible : même repli
  const y = { aller: [] };
  const z = await montage({ auth: { mfa: Mfa.adapter(fauxClient().client), session: async () => { throw new Error("x"); } }, aller: u => y.aller.push(u) });
  assert.equal(z.D("mfaAss"), null); assert.deepEqual(y.aller, ["compte.html#securite"]);
  // sans client (démo, page sans Auth) : on ne détourne pas le clic
  const n = await montage({ auth: { mfa: null, session: async () => null } });
  assert.equal(n.clic.defaultPrevented, false);
  // un clic ailleurs n'ouvre rien
  const dom = miniDom(); Mfa.installerOuverture(dom.doc, { auth });
  const autre = dom.doc.body.appendChild(dom.doc.createElement("a")); autre.dispatchEvent(new dom.Ev("click")); await tick();
  assert.equal(dom.doc.body.querySelector("#mfaAss"), null);
});

test("carte bloquante : la carte porte data-mfa-activer ; mfa.js s'installe tout seul dans le navigateur (document), pas sous Node", () => {
  assert.match(src("banque-etat.js"), /<a class="bq-mfa-btn" href="' \+ LIEN_SECURITE \+ '" data-mfa-activer>/);
  assert.match(src("mfa.js"), /if \(typeof document !== "undefined"\) installerOuverture\(document\);/);
  assert.equal(typeof Mfa.ouvrirActivation, "function"); assert.equal(typeof Mfa.installerOuverture, "function");
});
