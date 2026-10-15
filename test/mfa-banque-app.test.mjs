// SEC2 : double authentification obligatoire dès qu'une banque est connectée — côté app.
//   - carte bloquante « Active la double authentification pour voir ton détail bancaire » (Patrimoine › Comptes, Compte › Connexion) ;
//   - store Supabase exécuté : garde de démarrage (écran de code avant toute lecture), S.banque.mfaRequise sans aal2, rien de bancaire lu,
//     connecter / gerer refusés sans appel réseau, réponse 403 mfa_requise de la fonction powens affichée ;
//   - page de consentement des connecteurs exécutée (mini-DOM) : code exigé avant d'autoriser quand le compte a un facteur vérifié.
// Faux clients, aucune donnée réelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { miniDom } from "./helpers/mini-dom.mjs";

const require = createRequire(import.meta.url);
const BE = require("../web/src/banque-etat.js");
const G = require("../web/src/claude-guide.js");
const Mfa = require("../web/src/mfa.js");
const DEMO = require("../web/src/demo-data.js");
const src = f => readFileSync("web/src/" + f, "utf8");
const page = f => readFileSync("web/" + f, "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const sp = s => String(s).replace(/[  ]/g, " ");
const texte = h => sp(String(h).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim());
const VOUVOIEMENT = /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu;
const tick = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const AUJ = "2026-10-14";
const TITRE = "Active la double authentification pour voir ton détail bancaire";

/* =================================================================== carte bloquante =================================================================== */
test("BanqueEtat.carteMfa : titre exact, explication, bouton vers Mon compte › Sécurité ; mfaRequise seulement interrupteur actif ET drapeau posé", () => {
  const h = BE.carteMfa();
  assert.match(h, /<h3 id="bqMfaTitre">Active la double authentification pour voir ton détail bancaire<\/h3>/);
  assert.match(h, /<a class="bq-mfa-btn" href="compte\.html#securite" data-mfa-activer>Activer la double authentification<\/a>/);
  assert.match(h, /role="note" aria-labelledby="bqMfaTitre"/);
  assert.doesNotMatch(texte(h), VOUVOIEMENT);
  assert.equal(BE.LIEN_SECURITE, "compte.html#securite");
  assert.equal(BE.mfaRequise({ actif: true, mfaRequise: true }), true);
  for (const b of [null, undefined, {}, { actif: true }, { actif: false, mfaRequise: true }, { actif: true, mfaRequise: false }, { actif: true, mfaRequise: "oui" }])
    assert.equal(BE.mfaRequise(b), false, JSON.stringify(b));
});

test("BanqueEtat.carteMfa (I2) : dit que les comptes restent masqués sans double authentification ET que, une fois activée, toutes les données demandent le code", () => {
  const t = BE.carteMfa().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(t, /Sans double authentification, le détail bancaire \(opérations, budget réel, gestion des banques connectées\) reste masqué ; tes soldes, eux, restent visibles/);
  assert.match(t, /Une fois activée, tout Boussole \(comptes, placements, crédits, budget…\) te demande un code à 6 chiffres/);
  assert.doesNotMatch(t, VOUVOIEMENT);
});

test("Compte › Connexion : sans aal2, la section « Banques connectées » devient la carte bloquante (ni bouton « Connecter », ni liste de comptes)", () => {
  const S = { ready: true, banque: { actif: true, lu: true, mfaRequise: true, connexions: [], comptes: [], mois: [] }, positions: [], profil: { credits: [] }, people: [] };
  const h = G.banqueHtml(S, AUJ);
  assert.equal(h, BE.carteMfa());
  assert.doesNotMatch(h, /data-cg-banque-connecter|Connecter une banque|data-cg-banque-rattacher/);
  assert.match(texte(h), new RegExp(TITRE));
  // avec la double authentification, la section habituelle revient
  const ok = G.banqueHtml(Object.assign({}, S, { banque: { actif: true, lu: true, connexions: [], comptes: [], mois: [] } }), AUJ);
  assert.match(ok, /data-cg-banque-connecter/);
  assert.doesNotMatch(ok, /bq-mfa/);
  // interrupteur éteint : toujours rien, même si le drapeau traîne
  assert.equal(G.banqueHtml(Object.assign({}, S, { banque: { actif: false, mfaRequise: true } }), AUJ), "");
});

function monterComptes() {
  const { doc } = miniDom();
  const reg = {};
  const ctx = { console, Intl, Date, Math, JSON, URLSearchParams, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, scrollY: 0, scrollTo() {},
    App: { register: (n, api) => { reg[n] = api; }, parametres: () => ({}) }, Store: { cours: async () => ({}) } };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ["format.js", "calc.js", "ui.js", "claude-prompts.js", "banque-etat.js"]) vm.runInContext(src(f), ctx, { filename: f });
  vm.runInContext(src("comptes-view.js"), ctx, { filename: "comptes-view.js" });
  const root = doc.createElement("section");
  doc.body.appendChild(root);
  root.innerHTML = src("comptes-view.html");
  reg["comptes-view"].mount(root);
  return { api: reg["comptes-view"], root };
}
const demoS = o => Object.assign(J(DEMO), { ready: true, dbOk: true, scope: "foyer", people: [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }], error: null }, o);

test("Patrimoine › Comptes (vm) : carte bloquante en tête quand la banque est fermée par la double authentification ; absente sinon", () => {
  const m = monterComptes();
  const mfa = $ => m.root.querySelector("#cvMfa");
  const S = demoS();
  m.api.update(Object.assign({}, S, { banque: { actif: true, lu: true, mfaRequise: true, connexions: [], comptes: [], mois: [] } }), true);
  m.api.show();
  assert.equal(mfa().hidden, false);
  assert.match(texte(mfa().innerHTML), new RegExp(TITRE));
  assert.equal(mfa().querySelector("a").getAttribute("href"), "compte.html#securite");
  m.api.update(S, true);
  assert.equal(mfa().hidden, true, "session aal2 : la carte disparaît");
  assert.ok(src("comptes-view.html").indexOf('id="cvMfa"') < src("comptes-view.html").indexOf('id="cvChargement"'), "en tête de la vue");
});

test("mfa.css : la carte a ses styles (bouton à 44 px, couleurs du thème), assemblés dans app.html par build.mjs", () => {
  const css = src("mfa.css");
  assert.match(readFileSync("build.mjs", "utf8"), /read\(join\(SRC, "mfa\.css"\)\)/);
  assert.match(css, /\.bq-mfa\{[^}]*background:var\(--warn-soft\)/);
  assert.match(css, /\.bq-mfa-btn\{[^}]*min-height:44px/);
});

/* =================================================================== store Supabase exécuté =================================================================== */
function storeSup({ niveau = { current: "aal2", next: "aal2" }, niveauErreur = false, banqueActive = true, fetchRep, sansMfa = false, exigerRetour = true, sansSignal = false } = {}) {
  const ordre = [], tables = [], fetchs = [];
  const session = { access_token: "jeton-utilisateur-factice", user: { id: "u1", email: "a@b.c" } };
  const lignes = {
    banque_connexions: [{ id: 7, etablissement: "Banque test", etat: null, message: null, derniere_synchro: "2026-10-12T05:00:00Z" }],
    banque_comptes: [{ id: 70, connexion_id: 7, nom: "Compte joint", type: "courant", solde: "1234.56", devise: "EUR", solde_le: "2026-10-12", actif: true, ignore: false }],
    banque_mois: [{ mois: "2026-09-01", categorie: "alimentation", entrees: "0", sorties: "812.30", nombre: 14 }],
  };
  const requete = table => {
    const f = { table, unique: false };
    const b = {};
    for (const m of ["eq", "gte", "in", "order", "limit", "range", "select", "update"]) b[m] = () => b;
    b.maybeSingle = () => { f.unique = true; return b; };
    b.then = (ok, ko) => {
      tables.push(table); ordre.push("lire:" + table);
      let r = { data: f.unique ? null : [], error: null, count: 0 };
      if (table === "fonctionnalites") r = { data: { cle: "banque", active: banqueActive }, error: null };
      else if (lignes[table]) r = { data: lignes[table], error: null };
      return Promise.resolve(r).then(ok, ko);
    };
    return b;
  };
  const client = { from: requete, rpc: () => Promise.resolve({ data: null, error: null }), auth: { getSession: async () => ({ data: { session } }) } };
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout,
    location: { href: "https://x/app.html", search: "", hash: "", pathname: "/app.html", replace: u => ordre.push("replace:" + u) },
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    BOUSSOLE: { supabaseUrl: "https://projet.supabase.co/", supabaseKey: "cle-publique-factice" },
    supabase: { createClient: () => client },
    Auth: { client, session: async () => session, onChange() {}, requireSession() {}, signOut: async () => { ordre.push("signOut"); }, urls: { connexion: () => "https://x/index.html#connexion" },
      ...(sansMfa ? {} : { mfa: { niveau: async () => { ordre.push("niveau"); if (niveauErreur) throw new Error("illisible"); return niveau; } } }) },
    Mfa: { exiger: async (api, o) => { ordre.push("exiger"); ctx.__exiger = { api, o }; return exigerRetour; },
      ...(sansSignal ? {} : { signalerNouvelAppareil: async (api, o) => { ordre.push("signaler"); return true; } }) },
    fetch: async (url, init) => {
      fetchs.push({ url, init });
      const x = typeof fetchRep === "function" ? fetchRep(url, init) : fetchRep || { status: 200, body: { ok: true } };
      return { ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => x.body };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["sensible.js", "routine-etat.js", "banque-etat.js", "store-supabase.js"]) vm.runInContext(src(f), ctx, { filename: f });
  return { ctx, ordre, tables, fetchs };
}
const pret = ctx => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("jamais prêt")), 2000);
  const ok = S => { if (S.ready) { clearTimeout(t); res(S); } };
  ctx.Store.on(ok); ok(ctx.Store.get());
});

test("store (exécuté) : la garde Mfa.exiger passe AVANT toute lecture de données ; « Se déconnecter » ferme la session et renvoie à la connexion", async () => {
  const s = storeSup();
  await pret(s.ctx);
  assert.equal(s.ordre[0], "exiger", "écran de code avant la première lecture");
  assert.ok(s.ordre.findIndex(x => x.startsWith("lire:")) > 0);
  assert.equal(s.ctx.__exiger.api, s.ctx.Auth.mfa, "l'adaptateur de la page est celui d'Auth");
  await s.ctx.__exiger.o.onQuitter();
  assert.deepEqual(s.ordre.slice(-2), ["signOut", "replace:https://x/index.html#connexion"]);
});

test("store (exécuté) : session aal2 → banque lue normalement, aucun drapeau mfaRequise ; contrat de S.banque inchangé", async () => {
  const s = storeSup({ niveau: { current: "aal2", next: "aal2" } });
  const S = await pret(s.ctx);
  assert.deepEqual(Object.keys(J(S.banque)).sort(), ["actif", "comptes", "connexions", "lu", "mois"], "pas de clé mfaRequise");
  assert.equal(S.banque.comptes.length, 1); assert.equal(S.banque.connexions.length, 1);
  assert.ok(s.tables.includes("banque_comptes"));
});

test("store (exécuté) : interrupteur actif mais session aal1 → AUCUNE table banque_* lue, S.banque.mfaRequise, connecter / gerer refusés sans réseau", async () => {
  for (const niveau of [{ current: "aal1", next: "aal1" }, { current: "aal1", next: "aal2" }]) {
    const s = storeSup({ niveau });
    const S = await pret(s.ctx);
    assert.deepEqual(J(S.banque), { actif: true, lu: true, mfaRequise: true, connexions: [], comptes: [], mois: [] }, JSON.stringify(niveau));
    assert.deepEqual(s.tables.filter(t => t.startsWith("banque_")), [], "rien de bancaire n'est lu");
    for (const r of [await s.ctx.Store.banque.connecter(), await s.ctx.Store.banque.connecter(7), await s.ctx.Store.banque.gerer(7)]) {
      assert.match(r.erreur, /^Active la double authentification \(Mon compte › Sécurité\) et valide ton code pour connecter ta banque\.$/);
      assert.doesNotMatch(r.erreur, VOUVOIEMENT);
    }
    assert.deepEqual(s.fetchs, [], "aucun appel à la fonction powens");
  }
});

test("store (exécuté) : niveau illisible → traité comme aal1 (données bancaires fermées) ; interrupteur éteint → pas de carte ; Auth.mfa absent (démo) → lecture normale", async () => {
  const ill = await pret(storeSup({ niveauErreur: true }).ctx);
  assert.equal(ill.banque.mfaRequise, true);
  const off = await pret(storeSup({ niveau: { current: "aal1", next: "aal1" }, banqueActive: false }).ctx);
  assert.deepEqual(J(off.banque), { actif: false, lu: true, connexions: [], comptes: [], mois: [] });
  const sans = await pret(storeSup({ sansMfa: true }).ctx);
  assert.equal(sans.banque.comptes.length, 1);
});

test("store (exécuté) : la fonction powens répond 403 mfa_requise → son message est affiché tel quel", async () => {
  const MSG = "Active la double authentification et valide ton code pour connecter ta banque. Tu la règles dans Mon compte › Sécurité.";
  const s = storeSup({ fetchRep: { status: 403, body: { erreur: MSG, code: "mfa_requise" } } });
  await pret(s.ctx);
  const r = await s.ctx.Store.banque.connecter();
  assert.deepEqual(J(r), { erreur: MSG });
});

test("store (exécuté, M1) : la garde ne peut pas afficher son écran (false) → aucune lecture, erreur « mfa » ; sinon bandeau d'appareil lancé après la garde, avant la lecture", async () => {
  const ferme = storeSup({ exigerRetour: false });
  const S = await pret(ferme.ctx);
  assert.equal(S.error, "mfa"); assert.equal(S.dbOk, false);
  assert.deepEqual(ferme.ordre.filter(x => x.startsWith("lire:") || x === "signaler"), [], "rien n'est lu, pas de bandeau");
  const ok = storeSup();
  await pret(ok.ctx);
  const i = ok.ordre.indexOf("exiger"), j = ok.ordre.indexOf("signaler"), k = ok.ordre.findIndex(x => x.startsWith("lire:"));
  assert.ok(i === 0 && j > i && k > j, "garde, puis bandeau, puis lecture : " + ok.ordre.join(","));
  // Mfa sans signalerNouvelAppareil (page ancienne en cache) : le démarrage continue
  const ancien = await pret(storeSup({ sansSignal: true }).ctx);
  assert.equal(ancien.banque.comptes.length, 1);
});

test("store-supabase.js : la garde est avant loadAll au démarrage, et le drapeau est documenté dans le contrat", () => {
  const js = src("store-supabase.js");
  const boot = js.slice(js.indexOf("async function boot()"));
  assert.ok(boot.indexOf("window.Mfa.exiger(A.mfa") > 0 && boot.indexOf("window.Mfa.exiger(A.mfa") < boot.indexOf("await loadAll()"));
  assert.match(js, /S\.banque = \{ actif: true, lu: true, mfaRequise: true/);
});

/* =================================================================== page de consentement (exécutée) =================================================================== */
const RETOUR = "https://client.example.org/cb?code=abc";
const ACCORD = { id: 7, client_id: "c-1", client_nom: "Claude", accorde_le: "2026-10-15T10:00:00Z", expire_le: "2027-01-13T10:00:00Z", duree_jours: 90 };
function consentVm({ session = { user: { email: "camille@example.org", is_anonymous: false } }, current = "aal1", next = "aal2", codeJuste = "123456", approbation, niveauErreur = false,
  autorisation, details, codeIlYa = 60 } = {}) {
  const dom = miniDom(), { doc, Ev } = dom;
  doc.querySelectorAll = sel => doc.body.querySelectorAll(sel);
  doc.getElementById = id => doc.body.querySelector("#" + id);
  const html = page("oauth/consent.html");
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
  doc.body.innerHTML = main;
  const appels = [];
  let niveau = { currentLevel: current, nextLevel: next };
  let erreurNiveau = niveauErreur;
  // jeton de la session : revendication amr avec l'instant du dernier code validé (0033 : code frais exigé pour autoriser un connecteur)
  let codeLe = current === "aal2" ? Date.now() / 1000 - codeIlYa : null;
  const jeton = () => ["e30", Buffer.from(JSON.stringify({ amr: codeLe === null ? [{ method: "password", timestamp: 1 }] : [{ method: "totp", timestamp: Math.floor(codeLe) }] })).toString("base64url"), "sig"].join(".");
  const laSession = () => session && Object.assign({}, session, { access_token: jeton() });
  const sb = {
    // 0033 : autorisation du connecteur liée au second facteur (RPC autoriser_connecteur, session aal2 exigée côté base)
    rpc: async (nom, args) => { appels.push(["rpc", nom, J(args), niveau.currentLevel]); return autorisation ? autorisation(nom, args) : { data: ACCORD, error: null }; },
    auth: {
      getSession: async () => ({ data: { session: laSession() } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { appels.push(["signOut"]); return {}; },
      signInWithPassword: async () => ({ data: {}, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => (erreurNiveau ? { data: null, error: { code: "network", message: "Failed to fetch" } } : { data: niveau, error: null }),
        listFactors: async () => ({ data: { all: [], totp: next === "aal2" || niveau.nextLevel === "aal2" ? [{ id: "f-1", status: "verified", created_at: "2026-09-01T10:00:00Z" }] : [] }, error: null }),
        challenge: async a => { appels.push(["challenge", a.factorId]); return { data: { id: "ch-1" }, error: null }; },
        verify: async a => {
          appels.push(["verify", a.code]);
          if (a.code !== codeJuste) return { data: null, error: { code: "mfa_verification_failed", message: "Invalid TOTP code entered", status: 400 } };
          niveau = { currentLevel: "aal2", nextLevel: "aal2" };
          codeLe = Date.now() / 1000;
          return { data: {}, error: null };
        },
      },
      oauth: {
        getAuthorizationDetails: async id => { appels.push(["details", id]); if (details) return details(id); return { data: { authorization_id: id, client: { name: "Claude", uri: "https://claude.ai" }, redirect_uri: RETOUR, scope: "openid email", user: { email: "camille@example.org" } }, error: null }; },
        approveAuthorization: async (id, o) => { appels.push(["approve", id, niveau.currentLevel]); return approbation ? approbation() : { data: { redirect_url: RETOUR }, error: null }; },
        denyAuthorization: async id => { appels.push(["deny", id]); return { data: { redirect_url: RETOUR }, error: null }; },
      },
    },
  };
  const loc = { search: "?authorization_id=auth-123", href: "https://x/oauth/consent.html?authorization_id=auth-123", assign: u => appels.push(["assign", u]), reload() {} };
  const ctx = { console, setTimeout, clearTimeout, URL, URLSearchParams, atob, document: doc, location: loc, BOUSSOLE: { supabaseUrl: "https://projet.supabase.co", supabaseKey: "cle-publique-factice", emails: false },
    supabase: { createClient: () => sb } };
  ctx.window = ctx;
  doc.readyState = "complete";
  vm.createContext(ctx);
  vm.runInContext(src("mfa.js"), ctx, { filename: "mfa.js" });
  vm.runInContext(src("consent.js"), ctx, { filename: "consent.js" });
  const $ = id => doc.body.querySelector("#" + id);
  const visible = () => doc.body.querySelectorAll("[data-state]").filter(s => !s.hidden).map(s => s.getAttribute("data-state"));
  const saisir = async code => { $("mfaCode").value = code; $("mfaCodeForm").dispatchEvent(new Ev("submit")); await tick(); };
  return { appels, $, visible, saisir, doc, sb, setNiveau: n => { niveau = n; }, setErreurNiveau: b => { erreurNiveau = b; }, vieillir: sec => { codeLe = Date.now() / 1000 - sec; } };
}

test("consentement (exécuté) : compte avec facteur vérifié et session aal1 → écran de code AVANT toute demande ; bon code → demande affichée ; Autoriser avec aal2", async () => {
  const v = consentVm();
  await tick();
  assert.deepEqual(v.visible(), ["mfa"], "code demandé d'abord");
  assert.ok(!v.appels.some(a => a[0] === "details"), "la demande d'autorisation n'est même pas lue");
  assert.ok(v.doc.body.querySelector('label[for="mfaCode"]'), "champ étiqueté");
  await v.saisir("000000");
  assert.deepEqual(v.visible(), ["mfa"]);
  assert.match(v.$("mfaCodeMsg").textContent, /^Code incorrect\./);
  await v.saisir("123 456");
  assert.deepEqual(v.visible(), ["consent"]);
  assert.equal(v.$("mfaNote").hidden, true, "facteur actif : pas d'avertissement");
  assert.ok(v.appels.some(a => a[0] === "details" && a[1] === "auth-123"));
  v.$("approveBtn").click();
  await tick();
  assert.deepEqual(v.appels.find(a => a[0] === "approve"), ["approve", "auth-123", "aal2"], "approuvé par une session aal2");
  assert.deepEqual(v.appels.at(-1), ["assign", RETOUR]);
});

/* ---------- 0033 : autorisation du connecteur liée au second facteur ---------- */
test("consentement (0033) : après le code, « Autoriser » crée l'autorisation du connecteur (RPC, session aal2) AVANT d'approuver ; durée affichée", async () => {
  const v = consentVm();
  await tick();
  await v.saisir("123456");
  assert.deepEqual(v.visible(), ["consent"]);
  assert.equal(v.$("grantNote").hidden, false, "durée de l'accès annoncée avant d'autoriser");
  assert.match(sp(v.$("grantNote").textContent), /cet accès vaut 90 jours/);
  assert.match(sp(v.$("grantNote").textContent), /pourra aussi lire tes comptes bancaires, sans jamais pouvoir les modifier/);
  assert.match(sp(v.$("grantNote").textContent), /Mon compte › Connexion de Claude/);
  assert.doesNotMatch(v.$("grantNote").textContent, VOUVOIEMENT);
  assert.ok(!v.appels.some(a => a[0] === "rpc"), "rien n'est créé avant le clic");
  v.$("approveBtn").click(); await tick();
  const iRpc = v.appels.findIndex(a => a[0] === "rpc"), iApp = v.appels.findIndex(a => a[0] === "approve");
  assert.ok(iRpc >= 0 && iRpc < iApp, "autorisation créée avant l'approbation (le code n'est pas encore échangé)");
  assert.deepEqual(v.appels[iRpc], ["rpc", "autoriser_connecteur", { p_autorisation_id: "auth-123" }, "aal2"], "identifiant de la demande, jamais un client_id fourni par la page");
  assert.match(sp(v.$("doneText").textContent), /Accès valable 90 jours, jusqu'au 13 janvier 2027/);
  assert.deepEqual(v.appels.at(-1), ["assign", RETOUR]);
});

test("consentement (0033) : autorisation refusée par le serveur → rien n'est approuvé ; réseau : message et nouvel essai ; demande expirée : écran d'erreur", async () => {
  let reponse = { data: null, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } };
  const v = consentVm({ current: "aal2", next: "aal2", autorisation: () => reponse });
  await tick();
  v.$("approveBtn").click(); await tick();
  assert.ok(!v.appels.some(a => a[0] === "approve"), "aucune approbation sans autorisation enregistrée");
  assert.deepEqual(v.visible(), ["consent"]);
  assert.match(v.$("consentMsg").textContent, /Serveur injoignable/);
  assert.equal(v.$("approveBtn").disabled, false, "nouvel essai possible");
  reponse = { data: ACCORD, error: null };
  v.$("approveBtn").click(); await tick();
  assert.ok(v.appels.some(a => a[0] === "approve"), "approuvé au second essai");
  const e = consentVm({ current: "aal2", next: "aal2", autorisation: () => ({ data: null, error: { code: "P0002", message: "Demande d'autorisation introuvable ou expirée" } }) });
  await tick();
  e.$("approveBtn").click(); await tick();
  assert.deepEqual(e.visible(), ["error"]);
  assert.match(e.$("errTitle").textContent, /expirée ou introuvable/);
  assert.ok(!e.appels.some(a => a[0] === "approve"));
  const d = consentVm({ current: "aal2", next: "aal2", autorisation: () => ({ data: null, error: { code: "42501", message: "Double authentification requise" } }) });
  await tick();
  d.$("approveBtn").click(); await tick();
  assert.ok(!d.appels.some(a => a[0] === "approve"));
  assert.match(d.$("consentMsg").textContent, /code/);
});

test("consentement (0033) : sans double authentification ni pour un refus, aucune autorisation n'est créée ; pas d'annonce de durée", async () => {
  const v = consentVm({ current: "aal1", next: "aal1" });
  await tick();
  assert.equal(v.$("grantNote").hidden, true);
  v.$("approveBtn").click(); await tick();
  assert.ok(v.appels.some(a => a[0] === "approve"));
  assert.ok(!v.appels.some(a => a[0] === "rpc"), "compte sans facteur : rien à lier (la base le refuserait)");
  const d = consentVm({ current: "aal2", next: "aal2" });
  await tick();
  d.$("denyBtn").click(); await tick();
  assert.ok(d.appels.some(a => a[0] === "deny") && !d.appels.some(a => a[0] === "rpc"));
});

test("consentement (0033) : consentement déjà donné (Supabase renvoie directement le retour) → code, puis autorisation créée avant la redirection ; échec → pas de redirection", async () => {
  const deja = () => ({ data: { redirect_url: RETOUR }, error: null });
  const v = consentVm({ details: deja });
  await tick();
  assert.deepEqual(v.visible(), ["mfa"], "code d'abord, même si le consentement est mémorisé");
  await v.saisir("123456");
  const iRpc = v.appels.findIndex(a => a[0] === "rpc"), iAssign = v.appels.findIndex(a => a[0] === "assign");
  assert.ok(iRpc >= 0 && iRpc < iAssign, "autorisation créée avant de rendre le code à Claude");
  assert.equal(v.appels[iRpc][3], "aal2");
  const e = consentVm({ current: "aal2", next: "aal2", details: deja, autorisation: () => ({ data: null, error: { code: "P0002", message: "introuvable" } }) });
  await tick();
  assert.deepEqual(e.visible(), ["error"]);
  assert.ok(!e.appels.some(a => a[0] === "assign"), "pas de redirection sans autorisation");
});

test("consentement (0033, code frais) : session aal2 dont le code a 20 minutes → code redemandé AVANT la demande ; puis autorisation et approbation", async () => {
  const v = consentVm({ current: "aal2", next: "aal2", codeIlYa: 20 * 60 });
  await tick();
  assert.deepEqual(v.visible(), ["mfa"], "code redemandé même en aal2");
  assert.ok(!v.appels.some(a => a[0] === "details"));
  await v.saisir("123456");
  assert.deepEqual(v.visible(), ["consent"]);
  v.$("approveBtn").click(); await tick();
  const iRpc = v.appels.findIndex(a => a[0] === "rpc"), iApp = v.appels.findIndex(a => a[0] === "approve");
  assert.ok(iRpc >= 0 && iRpc < iApp);
});

test("consentement (0033, code frais) : le code vieillit pendant la lecture (plus de 8 minutes) → redemandé au clic, rien d'enregistré avant", async () => {
  const v = consentVm({ current: "aal2", next: "aal2" });
  await tick();
  assert.deepEqual(v.visible(), ["consent"]);
  v.vieillir(9 * 60);
  v.$("approveBtn").click(); await tick();
  assert.deepEqual(v.visible(), ["mfa"]);
  assert.ok(!v.appels.some(a => a[0] === "rpc" || a[0] === "approve"), "ni autorisation ni approbation");
  await v.saisir("123456");
  v.$("approveBtn").click(); await tick();
  assert.ok(v.appels.some(a => a[0] === "rpc") && v.appels.some(a => a[0] === "approve"));
});

test("consentement (0033) : la base juge le code trop ancien (BOU02) → écran de code, puis « Autoriser » aboutit ; client non déclaré (BOU01) → refus net", async () => {
  let n = 0;
  const v = consentVm({ current: "aal2", next: "aal2", autorisation: () => (++n === 1 ? { data: null, error: { code: "BOU02", message: "Valide de nouveau ton code" } } : { data: ACCORD, error: null }) });
  await tick();
  v.$("approveBtn").click(); await tick();
  assert.deepEqual(v.visible(), ["mfa"], "code redemandé");
  assert.ok(!v.appels.some(a => a[0] === "approve"));
  await v.saisir("123456");
  assert.deepEqual(v.visible(), ["consent"]);
  v.$("approveBtn").click(); await tick();
  assert.ok(v.appels.some(a => a[0] === "approve"), "approuvé avec un code frais");
  const d = consentVm({ current: "aal2", next: "aal2", autorisation: () => ({ data: null, error: { code: "BOU01", message: "Cette application n'est pas autorisée…" } }) });
  await tick();
  d.$("approveBtn").click(); await tick();
  assert.deepEqual(d.visible(), ["error"]);
  assert.match(d.$("errTitle").textContent, /Application non reconnue/);
  assert.doesNotMatch(d.$("errText").textContent, VOUVOIEMENT);
  assert.ok(!d.appels.some(a => a[0] === "approve"));
});

test("consentement (0033) : la durée affichée (90 jours) est celle de autoriser_connecteur dans la migration", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0033_connecteurs_autorises.sql", import.meta.url), "utf8");
  assert.match(sql, /v_duree\s+constant interval := interval '90 days'/);
  assert.match(src("consent.js"), /const DUREE_AUTORISATION_JOURS = 90;/);
});

test("consentement (exécuté) : session déjà aal2 → demande directe ; la session retombe à aal1 avant « Autoriser » → code redemandé, rien d'approuvé", async () => {
  const v = consentVm({ current: "aal2", next: "aal2" });
  await tick();
  assert.deepEqual(v.visible(), ["consent"]);
  v.setNiveau({ currentLevel: "aal1", nextLevel: "aal2" });
  v.$("approveBtn").click();
  await tick();
  assert.deepEqual(v.visible(), ["mfa"]);
  assert.ok(!v.appels.some(a => a[0] === "approve"), "aucune approbation sans aal2");
  await v.saisir("123456");
  assert.deepEqual(v.visible(), ["consent"]);
  v.$("approveBtn").click(); await tick();
  assert.equal(v.appels.find(a => a[0] === "approve")[2], "aal2");
});

test("consentement (exécuté) : refuser ne demande pas de code ; « Se déconnecter » de l'écran de code ramène à la connexion", async () => {
  const d = consentVm({ current: "aal2", next: "aal2" });
  await tick();
  d.setNiveau({ currentLevel: "aal1", nextLevel: "aal2" });
  d.$("denyBtn").click(); await tick();
  assert.ok(d.appels.some(a => a[0] === "deny"), "refus possible sans code");
  const q = consentVm();
  await tick();
  assert.deepEqual(q.visible(), ["mfa"]);
  q.$("mfaCodeQuitter").click(); await tick();
  assert.ok(q.appels.some(a => a[0] === "signOut"));
  assert.deepEqual(q.visible(), ["signin"]);
});

test("consentement (exécuté) : sans double authentification → demande possible, avec l'avertissement « ne pourra pas lire tes comptes bancaires » et le lien vers Sécurité", async () => {
  const v = consentVm({ current: "aal1", next: "aal1" });
  await tick();
  assert.deepEqual(v.visible(), ["consent"]);
  assert.equal(v.$("mfaNote").hidden, false);
  assert.match(v.$("mfaNote").textContent, /ne pourra pas lire tes comptes bancaires/);
  assert.equal(v.$("mfaNote").querySelector("a").getAttribute("href"), "../compte.html#securite");
  assert.doesNotMatch(v.$("mfaNote").textContent, VOUVOIEMENT);
  v.$("approveBtn").click(); await tick();
  assert.ok(v.appels.some(a => a[0] === "approve"), "la connexion reste possible : les outils bancaires répondent « Double authentification requise »");
});

test("consentement (échec fermé, M1) : niveau illisible → message + « Réessayer », demande jamais lue ni approuvée ; réessai réussi → code puis demande", async () => {
  const v = consentVm({ niveauErreur: true });
  await tick();
  assert.deepEqual(v.visible(), ["mfa"], "ni la demande ni un « ok » par défaut");
  assert.match(v.$("mfaErreurMsg").textContent, /Connexion au serveur impossible/);
  assert.ok(!v.appels.some(a => a[0] === "details"), "la demande d'autorisation n'est pas lue");
  v.$("mfaReessayer").click(); await tick();
  assert.deepEqual(v.visible(), ["mfa"], "toujours illisible : toujours fermé");
  assert.ok(v.$("mfaErreurMsg"));
  v.setErreurNiveau(false);
  v.$("mfaReessayer").click(); await tick();
  assert.ok(v.$("mfaCodeForm"), "niveau lu : écran de code (aal1 + facteur)");
  await v.saisir("123456");
  assert.deepEqual(v.visible(), ["consent"]);
  // l'approbation re-vérifie le niveau : illisible au clic sur « Autoriser » → rien n'est approuvé
  v.setErreurNiveau(true);
  v.$("approveBtn").click(); await tick();
  assert.ok(!v.appels.some(a => a[0] === "approve"), "aucune approbation si le niveau est illisible");
  assert.deepEqual(v.visible(), ["mfa"]);
  assert.ok(v.$("mfaReessayer"));
  // « Se déconnecter » reste possible depuis l'écran d'erreur
  v.$("mfaErreurQuitter").click(); await tick();
  assert.ok(v.appels.some(a => a[0] === "signOut"));
  assert.deepEqual(v.visible(), ["signin"]);
});

test("consentement : compte anonyme → toujours l'écran « à sécuriser » (pas de code) ; consent.html charge mfa.js avant consent.js", async () => {
  const v = consentVm({ session: { user: { is_anonymous: true } } });
  await tick();
  assert.deepEqual(v.visible(), ["anon"]);
  const html = page("oauth/consent.html");
  assert.ok(html.indexOf('src="../app/mfa.js"') > 0 && html.indexOf('src="../app/mfa.js"') < html.indexOf('src="../app/consent.js"'));
  assert.match(html, /<section data-state="mfa" hidden>/);
  assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ""), VOUVOIEMENT);
});
