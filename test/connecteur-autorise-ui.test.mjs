// SEC2 bis (migration 0033) : Mon compte › Connexion de Claude liste les accès de connecteur protégés par le code (table
// connecteurs_autorises, lecture par son propriétaire) et permet de les retirer (RPC revoquer_connecteur). account.js exécuté dans un
// contexte vm avec un faux document et un faux client Supabase. Valeurs fictives uniquement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = f => readFileSync("web/src/" + f, "utf8");
const page = f => readFileSync("web/" + f, "utf8");
const VOUVOIEMENT = /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu;
const texte = h => String(h).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const J = v => JSON.parse(JSON.stringify(v));
const JOUR = 864e5, maintenant = Date.now();
const iso = decalage => new Date(maintenant + decalage).toISOString();

/** account.js exécuté. `accords` : lignes de connecteurs_autorises (ou une Error pour une table absente). */
async function compteVm({ accords = [], grants = null, revoquer } = {}) {
  const els = {}, appels = [];
  const el = id => (els[id] ||= { id, value: "", textContent: "", className: "", hidden: false, disabled: false, type: "", innerHTML: "", ls: {}, dataset: {},
    addEventListener(t, f) { (this.ls[t] ||= []).push(f); }, querySelector() { return null; }, focus() {}, scrollIntoView() {} });
  const user = { id: "u1", email: "camille@example.org" };
  let lignes = accords;
  const requete = table => {
    const b = { table, filtres: [] };
    for (const m of ["select", "eq", "order"]) b[m] = (...a) => { b.filtres.push([m, ...a]); return b; };
    b.maybeSingle = () => b;
    b.then = (ok, ko) => {
      appels.push(["from", table, b.filtres]);
      const r = table === "connecteurs_autorises" ? (lignes instanceof Error ? { data: null, error: lignes } : { data: lignes, error: null }) : { data: null, error: null };
      return Promise.resolve(r).then(ok, ko);
    };
    return b;
  };
  const client = {
    from: requete,
    rpc: async (n, a) => {
      appels.push(["rpc", n, a]);
      if (n === "revoquer_connecteur") {
        if (revoquer) return revoquer(a);
        if (Array.isArray(lignes)) lignes = lignes.map(l => l.client_id === a.p_client_id ? { ...l, revoque_le: new Date().toISOString() } : l);
        return { data: 1, error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      signOut: async () => ({}),
      oauth: grants ? {
        listGrants: async () => ({ data: grants, error: null }),
        revokeGrant: async o => { appels.push(["revokeGrant", o.clientId]); return { data: {}, error: null }; },
      } : undefined,
    },
  };
  const Auth = { client, session: async () => ({ access_token: "jeton", user }), requireSession: async () => ({ access_token: "jeton", user }), isAnonymous: () => false,
    onChange() {}, signOut: async () => {}, urls: { home: () => "https://ex.org/index.html", connexion: () => "https://ex.org/index.html#connexion" }, passwordProblem: () => null };
  const ctx = { console, setTimeout, clearTimeout, URL, Blob: class {}, Date, Intl,
    document: { getElementById: el, addEventListener() {}, createElement: () => el("tmp"), body: { appendChild() {} } },
    location: { href: "https://ex.org/compte.html", pathname: "/compte.html", search: "", hash: "", replace() {} },
    navigator: {}, BOUSSOLE: { supabaseUrl: "https://projet.supabase.co/" }, Auth, fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src("account.js"), ctx, { filename: "account.js" });
  await tick();
  /** Clic délégué sur un bouton [data-…] du conteneur `id`. */
  const cliquer = async (id, dataset) => {
    const bouton = { dataset, disabled: false, closest: () => bouton };
    for (const f of el(id).ls.click || []) f({ target: bouton });
    await tick();
  };
  return { appels, el, cliquer };
}

const ACTIF = { id: 1, user_id: "u1", client_id: "c-claude", client_nom: "Claude", accorde_le: iso(-10 * JOUR), expire_le: iso(80 * JOUR), lie_le: iso(-10 * JOUR), dernier_usage: iso(-1 * JOUR), revoque_le: null };
const EXPIRE = { id: 2, user_id: "u1", client_id: "c-code", client_nom: null, accorde_le: iso(-100 * JOUR), expire_le: iso(-10 * JOUR), lie_le: iso(-100 * JOUR), dernier_usage: iso(-20 * JOUR), revoque_le: null };
const RETIRE = { id: 3, user_id: "u1", client_id: "c-vieux", client_nom: "Ancien", accorde_le: iso(-50 * JOUR), expire_le: iso(40 * JOUR), lie_le: null, dernier_usage: null, revoque_le: iso(-5 * JOUR) };

test("Compte › Connexion : accès protégés par le code listés (actif, expiré), retirés masqués, sans colonne cachée lue", async () => {
  const v = await compteVm({ accords: [ACTIF, EXPIRE, RETIRE] });
  const lecture = v.appels.find(a => a[0] === "from" && a[1] === "connecteurs_autorises");
  assert.ok(lecture, "table lue");
  const select = lecture[2].find(f => f[0] === "select")[1];
  assert.doesNotMatch(select, /session_id|autorisation_id|\*/, "seulement les colonnes accordées à authenticated");
  const box = v.el("accords");
  assert.equal(box.hidden, false);
  const t = texte(box.innerHTML);
  assert.match(t, /Accès protégés par ton code/);
  assert.match(t, /Claude/);
  assert.match(t, /valable jusqu'au/);
  assert.match(t, /dernier usage le/);
  assert.match(t, /expiré le .* reconnecte le connecteur et saisis ton code/);
  assert.match(t, /Application/, "nom absent : libellé générique");
  assert.doesNotMatch(t, /Ancien/, "un accès retiré n'est plus listé");
  assert.match(box.innerHTML, /data-retirer="c-claude"/);
  assert.doesNotMatch(t, VOUVOIEMENT);
});

test("Compte › Connexion : « Retirer » appelle revoquer_connecteur avec le client, confirme et relit la liste", async () => {
  const v = await compteVm({ accords: [ACTIF] });
  await v.cliquer("accords", { retirer: "c-claude", name: "Claude" });
  assert.deepEqual(J(v.appels.find(a => a[0] === "rpc" && a[1] === "revoquer_connecteur")), ["rpc", "revoquer_connecteur", { p_client_id: "c-claude" }]);
  assert.match(v.el("accordMsg").textContent, /Accès retiré à Claude/);
  assert.equal(v.appels.filter(a => a[0] === "from" && a[1] === "connecteurs_autorises").length, 2, "liste relue");
  assert.equal(v.el("accords").hidden, true, "plus rien d'actif ni d'expiré : section masquée");
  // échec : message, rien d'autre
  const e = await compteVm({ accords: [ACTIF], revoquer: () => ({ data: null, error: { message: "Failed to fetch", code: "network" } }) });
  await e.cliquer("accords", { retirer: "c-claude", name: "Claude" });
  assert.match(e.el("accordMsg").textContent, /Connexion au serveur impossible/);
});

test("Compte › Connexion : retirer une application chez Supabase (revokeGrant) retire aussi son accès protégé par le code", async () => {
  const v = await compteVm({ accords: [ACTIF], grants: [{ client: { id: "c-claude", name: "Claude" }, scopes: ["email"], granted_at: iso(-10 * JOUR) }] });
  await v.cliquer("grants", { revoke: "c-claude", name: "Claude" });
  const i = v.appels.findIndex(a => a[0] === "revokeGrant"), j = v.appels.findIndex(a => a[0] === "rpc" && a[1] === "revoquer_connecteur");
  assert.ok(i >= 0 && j > i, "revokeGrant puis revoquer_connecteur");
  assert.deepEqual(J(v.appels[j][2]), { p_client_id: "c-claude" });
});

test("Compte › Connexion : accès pas encore lié → « en attente de première connexion », pas « autorisé » ni de dernier usage", async () => {
  const v = await compteVm({ accords: [{ ...ACTIF, lie_le: null, dernier_usage: null }] });
  const t = texte(v.el("accords").innerHTML);
  assert.match(t, /en attente de première connexion/);
  assert.doesNotMatch(t, /autorisé le/);
  assert.match(v.el("accords").innerHTML, /data-retirer="c-claude"/, "retirable quand même");
});

test("Compte › Connexion : après revokeGrant, seul PGRST202 (0033 absente) est ignoré ; toute autre erreur de revoquer_connecteur est affichée, sans « Accès retiré »", async () => {
  const g = [{ client: { id: "c-claude", name: "Claude" }, scopes: ["email"], granted_at: iso(-10 * JOUR) }];
  const absente = await compteVm({ accords: [ACTIF], grants: g, revoquer: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) });
  await absente.cliquer("grants", { revoke: "c-claude", name: "Claude" });
  assert.match(absente.el("grantMsg").textContent, /Accès retiré à Claude/);
  const panne = await compteVm({ accords: [ACTIF], grants: g, revoquer: () => ({ data: null, error: { code: "network", message: "Failed to fetch" } }) });
  await panne.cliquer("grants", { revoke: "c-claude", name: "Claude" });
  assert.doesNotMatch(panne.el("grantMsg").textContent, /Accès retiré/);
  assert.match(panne.el("grantMsg").textContent, /Connexion au serveur impossible/);
});

test("Compte › Connexion : sans accès (compte sans code) ou table absente (0033 non appliquée) → section masquée, sans message d'erreur", async () => {
  for (const accords of [[], [RETIRE], Object.assign(new Error("relation absente"), { code: "PGRST205" })]) {
    const v = await compteVm({ accords });
    assert.equal(v.el("accords").hidden, true, JSON.stringify(accords));
    assert.equal(v.el("accordMsg").textContent, "");
  }
});

test("compte.html : conteneur des accès protégés par le code sous « Applications autorisées », et texte sur la durée de 90 jours", () => {
  const html = page("compte.html");
  assert.ok(html.indexOf('id="grants"') < html.indexOf('id="accords"'), "après la liste des applications");
  assert.match(html, /<div id="accords" hidden><\/div>/);
  assert.match(html, /<p class="msg" id="accordMsg" role="status"><\/p>/);
  const sec = html.slice(html.indexOf('id="h-mcp"'), html.indexOf('id="h-data"'));
  assert.match(texte(sec), /valide ton code quand tu autorises l'accès : cet accès vaut alors 90 jours/);
  assert.doesNotMatch(texte(sec), VOUVOIEMENT);
});
