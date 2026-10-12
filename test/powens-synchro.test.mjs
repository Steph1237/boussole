// Synchronisation Powens (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md § 2 et § 6) :
// supabase/functions/powens/synchro.ts et categories.ts, exécutés dans un contexte vm (types retirés), avec une base
// en mémoire et un client Powens factice. Aucune donnée réelle, aucun identifiant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import vm from "node:vm";

const lire = rel => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
const strip = nodeModule.stripTypeScriptTypes;
const SANS_STRIP = typeof strip !== "function" && "module.stripTypeScriptTypes indisponible (Node trop ancien)";
const J = v => JSON.parse(JSON.stringify(v));

/* ---------- chargement des modules TypeScript ---------- */
const GLOBAUX = { RegExp, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, console, isFinite, Infinity, NaN,
  TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, Error, TypeError, Boolean, parseInt, parseFloat, encodeURIComponent };
function chargerModule(source, globaux = {}) {
  const noms = [...source.matchAll(/^export (?:const|function|async function|class) (\w+)/gm)].map(m => m[1]);
  const js = strip(source, { mode: "strip" }).replace(/^import .*$/gm, "").replace(/^export (const|function|async function|class)/gm, "$1");
  return vm.runInNewContext(js + `\n;({ ${noms.join(", ")} });`, { ...GLOBAUX, ...globaux });
}
const charger = () => {
  const C = chargerModule(lire("supabase/functions/powens/categories.ts"));
  const S = chargerModule(lire("supabase/functions/powens/synchro.ts"), { categorieBoussole: C.categorieBoussole });
  return { C, S };
};

/* ---------- base en mémoire (sous-ensemble du client supabase-js) ---------- */
const CLES = {
  banque_connexions: ["user_id", "id"], banque_comptes: ["user_id", "id"], banque_placements: ["user_id", "id"],
  banque_operations: ["user_id", "id"], positions: ["id"], instruments: ["isin"], credits: ["id"], propositions: ["id"],
  fonctionnalites: ["user_id", "cle"],
};
function fausseBase(init = {}, { rpc = {}, echec = () => null, utilisateurs = {} } = {}) {
  const tables = J(init);
  const journal = [];
  const lignes = t => (tables[t] ??= []);
  const cle = (t, r, champs) => (champs || CLES[t] || ["id"]).map(k => String(r[k])).join("|");
  function from(table) {
    const q = { table, op: "select", filtres: [], val: null, opts: {}, unique: null, limite: null };
    const correspond = r => q.filtres.every(([k, op, v]) => op === "eq" ? String(r[k]) === String(v)
      : op === "in" ? v.map(String).includes(String(r[k])) : op === "lt" ? r[k] < v : op === "gte" ? r[k] >= v
      : op === "is" ? (r[k] ?? null) === v : true);
    const executer = () => {
      journal.push({ table, op: q.op, filtres: q.filtres, val: q.val, opts: q.opts });
      const err = echec(table, q.op, q);
      if (err) return { data: null, error: { message: err } };
      let data = null;
      if (q.op === "select") {
        data = lignes(table).filter(correspond).map(r => ({ ...r }));
        if (q.limite != null) data = data.slice(0, q.limite);
      } else if (q.op === "insert") {
        const rows = (Array.isArray(q.val) ? q.val : [q.val]).map(r => ({ id: r.id ?? crypto.randomUUID(), ...r }));
        lignes(table).push(...rows); data = rows;
      } else if (q.op === "upsert") {
        const champs = q.opts.onConflict ? q.opts.onConflict.split(",").map(s => s.trim()) : null;
        data = [];
        for (const r of Array.isArray(q.val) ? q.val : [q.val]) {
          const i = lignes(table).findIndex(x => cle(table, x, champs) === cle(table, r, champs));
          if (i < 0) lignes(table).push({ ...r });
          else if (!q.opts.ignoreDuplicates) lignes(table)[i] = { ...lignes(table)[i], ...r };
          data.push(r);
        }
      } else if (q.op === "update") {
        data = [];
        for (const r of lignes(table)) if (correspond(r)) { Object.assign(r, q.val); data.push({ ...r }); }
      } else if (q.op === "delete") {
        data = lignes(table).filter(correspond);
        tables[table] = lignes(table).filter(r => !correspond(r));
      }
      if (q.unique) {
        if (data.length > 1) return { data: null, error: { message: "plusieurs lignes" } };
        if (!data.length && q.unique === "single") return { data: null, error: { message: "aucune ligne" } };
        data = data[0] ?? null;
      }
      return { data, error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: n => { q.limite = n; return b; },
      eq: (k, v) => { q.filtres.push([k, "eq", v]); return b; }, in: (k, v) => { q.filtres.push([k, "in", v]); return b; },
      lt: (k, v) => { q.filtres.push([k, "lt", v]); return b; }, gte: (k, v) => { q.filtres.push([k, "gte", v]); return b; },
      is: (k, v) => { q.filtres.push([k, "is", v]); return b; },
      insert: v => { q.op = "insert"; q.val = v; return b; }, upsert: (v, o = {}) => { q.op = "upsert"; q.val = v; q.opts = o; return b; },
      update: v => { q.op = "update"; q.val = v; return b; }, delete: () => { q.op = "delete"; return b; },
      maybeSingle: () => { q.unique = "maybe"; return b; }, single: () => { q.unique = "single"; return b; },
      then: (ok, ko) => Promise.resolve().then(executer).then(ok, ko),
    };
    return b;
  }
  return {
    tables, journal, from,
    rpc: async (nom, args) => {
      journal.push({ rpc: nom, args });
      const f = rpc[nom];
      if (!f) return { data: null, error: { message: `rpc ${nom} inconnue` } };
      return f(args, tables);
    },
    auth: { getUser: async jwt => utilisateurs[jwt] ? { data: { user: utilisateurs[jwt] }, error: null } : { data: { user: null }, error: { message: "jeton invalide" } } },
  };
}

/* ---------- données Powens factices (formes de la référence API) ---------- */
const U = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";
const MAINTENANT = new Date("2026-10-12T08:00:00Z");
const AUJ = "2026-10-12";
const connexionPowens = (surcharge = {}) => ({ id: 7, id_user: 42, id_connector: 59, state: null, error_message: null,
  last_update: "2026-10-12 07:55:00", connector: { id: 59, name: "Banque Test" }, ...surcharge });
const COMPTES = [
  { id: 101, id_connection: 7, name: "Compte chèque 12345678901", original_name: "CPT", balance: 1520.5, currency: { id: "EUR" }, type: "checking", disabled: null, deleted: null, last_update: "2026-10-12 07:55:00" },
  { id: 102, id_connection: 7, name: "Livret A", balance: 8000, currency: { id: "EUR" }, type: "livret_a", disabled: null, deleted: null, last_update: "2026-10-12 07:55:00" },
  { id: 103, id_connection: 7, name: "PEA", balance: 25000, currency: { id: "EUR" }, type: "pea", disabled: null, deleted: null, last_update: "2026-10-12 07:55:00" },
  { id: 104, id_connection: 7, name: "Prêt immo", balance: -150000.25, currency: { id: "EUR" }, type: "loan", disabled: null, deleted: null, last_update: "2026-10-12 07:55:00" },
];
const PLACEMENTS = {
  103: [
    { id: 501, id_account: 103, code: "FR0010315770", code_type: "ISIN", label: "Amundi MSCI World", quantity: 120, unitprice: 20.1, unitvalue: 25, valuation: 3000, deleted: null },
    { id: 502, id_account: 103, code: "IE00B4L5Y983", code_type: "ISIN", label: "iShares Core World", quantity: 10, unitprice: 70, unitvalue: 90, valuation: 900, deleted: null },
    { id: 503, id_account: 103, code: "XX", code_type: "AMF", label: "Liquidités", quantity: 1, valuation: 50, deleted: null },
  ],
};
const OPERATIONS = {
  101: [
    { id: 9001, id_account: 101, date: "2026-10-01", value: 3200, simplified_wording: "VIR SALAIRE ACME", categories: [{ code: "salary", parent_code: "revenue" }], coming: false, deleted: null },
    { id: 9002, id_account: 101, date: "2026-10-03", value: -85.4, simplified_wording: "CB CARREFOUR 0412", categories: [{ code: "supermarket_and_groceries", parent_code: "food_and_restaurants" }], coming: false, deleted: null },
    { id: 9003, id_account: 101, date: "2026-09-20", value: -950, original_wording: "PRLV LOYER REF 123456789012", categories: [{ code: "rent", parent_code: "housing" }], coming: false, deleted: null },
    { id: 9004, id_account: 101, date: "2026-10-11", value: -20, simplified_wording: "A VENIR", coming: true, deleted: null },
    { id: 9005, id_account: 101, date: "2026-08-15", value: -12, simplified_wording: "NETFLIX", categories: [{ code: "media_subscriptions", parent_code: "media_and_telecommunications" }], coming: false, deleted: null },
  ],
  102: [],
};
function apiFactice({ connexion = connexionPowens(), comptes = COMPTES, placements = PLACEMENTS, operations = OPERATIONS, pannes = {} } = {}) {
  const appels = [];
  const panne = (quoi, id) => { const p = pannes[`${quoi}:${id ?? ""}`]; if (p) throw new Error(p); };
  return {
    appels,
    connexion: async id => { appels.push(["connexion", id]); panne("connexion", id); return J(connexion); },
    comptes: async id => { appels.push(["comptes", id]); panne("comptes", id); return J(comptes); },
    placements: async id => { appels.push(["placements", id]); panne("placements", id); return J(placements[id] ?? []); },
    operations: async (id, min) => { appels.push(["operations", id, min]); panne("operations", id); return J(operations[id] ?? []); },
  };
}
/** Bail de synchronisation simulé (banque_verrouiller / banque_deverrouiller de la migration 0021). */
function rpcBanque({ occupe = false } = {}) {
  const verrous = new Set();
  return {
    verrous,
    banque_recalculer_mois: async () => ({ data: null, error: null }),
    banque_verrouiller: async ({ p_user, p_connexion }) => {
      const k = `${p_user}|${p_connexion}`;
      if (occupe || verrous.has(k)) return { data: false, error: null };
      verrous.add(k);
      return { data: true, error: null };
    },
    banque_deverrouiller: async ({ p_user, p_connexion }) => { verrous.delete(`${p_user}|${p_connexion}`); return { data: null, error: null }; },
  };
}
const RPC = rpcBanque();
const baseInitiale = (comptes = []) => ({
  banque_connexions: [], banque_comptes: comptes, banque_placements: [], banque_operations: [], positions: [
    { id: "pos-livret", user_id: U, name: "Livret A", envelope: "Livret A", mode: "manual", value: 7000, status: "actif" },
    { id: "pos-autre", user_id: AUTRE, name: "Livret de B", mode: "manual", value: 1, status: "actif" },
  ], instruments: [], credits: [{ id: "cred-1", user_id: U, nom: "Prêt immo", crd: 160000 }], propositions: [],
});
/** Rattachements posés par l'utilisateur (Agent › Connexion). */
const RATTACHES = [
  { user_id: U, id: 102, connexion_id: 7, position_id: "pos-livret", enveloppe: null, titulaire: null, credit_id: null },
  { user_id: U, id: 103, connexion_id: 7, position_id: null, enveloppe: "PEA", titulaire: "p2", credit_id: null },
  { user_id: U, id: 104, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: "cred-1" },
];
let n = 0;
const OPTS = () => ({ maintenant: MAINTENANT, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });

/* ---------- catégories ---------- */
test("categorieBoussole : codes enfants et parents de la taxonomie française Powens, inconnu → divers", { skip: SANS_STRIP }, () => {
  const { C } = charger();
  const cas = {
    salary: "revenus", revenue: "revenus", rent: "logement", housing: "logement", energy: "logement",
    supermarket_and_groceries: "alimentation", food_and_restaurants: "alimentation", public_transportation: "transport",
    fuel_and_vehicle_charging: "transport", child_care_kindergarten: "enfants", pharmacy: "sante", healthcare: "sante",
    cinema_theater_culture: "loisirs", leisure: "loisirs", phone_internet_tv: "abonnements", media_subscriptions: "abonnements",
    taxes: "impots", administration_and_taxes: "impots", savings: "epargne", savings_investments_and_crypto_assets: "epargne",
    mortgage_payment: "logement", transfers: "divers", inconnu_total: "divers", constructor: "divers", ["__proto__"]: "divers",
    // virements entre comptes du foyer : épargne, jamais une dépense (pas de double compte avec le compte crédité)
    from_own_account: "epargne", to_own_account: "epargne",
  };
  for (const [code, attendu] of Object.entries(cas)) assert.equal(C.categorieBoussole(code), attendu, code);
  // Formes tolérées : tableau `categories` d'une opération, objet { code, parent_code }, valeur absente ou numérique.
  assert.equal(C.categorieBoussole([{ code: "pharmacy", parent_code: "healthcare" }]), "sante");
  assert.equal(C.categorieBoussole({ code: "code_inconnu", parent_code: "housing" }), "logement", "repli sur le parent");
  for (const v of [null, undefined, [], 12, {}, ""]) assert.equal(C.categorieBoussole(v), "divers");
  const toutes = new Set(Object.values(C.CORRESPONDANCE));
  for (const c of toutes) assert.ok(C.CATEGORIES_BOUSSOLE.includes(c), c);
  assert.deepEqual(J(C.CATEGORIES_BOUSSOLE), ["logement", "alimentation", "transport", "enfants", "sante", "loisirs", "abonnements", "impots", "divers", "revenus", "epargne"]);
  assert.match(C.VERSION_CATEGORIES, /^\d{4}-\d{2}-\d{2}$/);
});

/* ---------- fonctions pures ---------- */
test("normaliserType : types Powens vers les 8 types Boussole, inconnu → autre", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const cas = { checking: "courant", card: "courant", deposit: "courant", savings: "livret", livret_a: "livret", ldds: "livret", pel: "livret",
    cel: "livret", pea: "pea", market: "compte_titres", lifeinsurance: "assurance_vie", capitalisation: "assurance_vie", per: "per",
    perp: "per", perco: "per", madelin: "per", article83: "per", loan: "credit", consumercredit: "credit", revolvingcredit: "credit",
    real_estate: "autre", crowdlending: "autre", unknown: "autre", nimporte: "autre" };
  for (const [t, attendu] of Object.entries(cas)) assert.equal(S.normaliserType({ type: t }), attendu, t);
  assert.equal(S.normaliserType({}), "autre");
  assert.equal(S.normaliserType(null), "autre");
});

test("normaliserEtat : null = à jour, états connus gardés, inconnu → bug", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  assert.equal(S.normaliserEtat(null), null);
  assert.equal(S.normaliserEtat(""), null);
  for (const e of ["SCARequired", "webauthRequired", "additionalInformationNeeded", "wrongpass", "decoupled", "validating", "actionNeeded",
    "passwordExpired", "rateLimiting", "websiteUnavailable", "bug"]) assert.equal(S.normaliserEtat(e), e);
  assert.equal(S.normaliserEtat("nouvelEtat"), "bug");
  assert.equal(S.ETATS_POWENS.length, 11);
});

test("nettoyerLibelle : 8 chiffres ou plus masqués, IBAN et carte masqués, mots interdits, espaces, 140 caractères", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  assert.equal(S.nettoyerLibelle("PRLV  LOYER   REF 123456789012"), "PRLV LOYER REF ••••");
  assert.equal(S.nettoyerLibelle("CB CARREFOUR 0412 1234567"), "CB CARREFOUR 0412 1234567", "7 chiffres conservés");
  assert.equal(S.nettoyerLibelle("VIR FR76 3000 6000 0112 3456 7890 189 DUPONT"), "VIR •••• DUPONT");
  assert.equal(S.nettoyerLibelle("CARTE 4970 1012 3456 7890 ACHAT"), "CARTE •••• ACHAT");
  assert.equal(S.nettoyerLibelle("Votre code secret est arrivé"), "Libellé masqué");
  assert.equal(S.nettoyerLibelle(null), "");
  assert.equal(S.nettoyerLibelle("x".repeat(300)).length, 140);
  // Aucun libellé nettoyé n'est refusé par la contrainte contenu_sensible (mêmes motifs que mcp/memoire.ts).
  const M = chargerModule(lire("supabase/functions/mcp/memoire.ts"), { z: new Proxy(function () {}, { get: () => () => ({}) }) });
  assert.deepEqual(J(S.SENSIBLE), J(M.SENSIBLE), "motifs identiques à public.contenu_sensible");
  for (const t of ["IBAN FR7630006000011234567890189", "4970101234567890", "mot de passe 1234", "RIB 30006 00001 12345678901 89"])
    assert.equal(M.estSensible(S.nettoyerLibelle(t)), false, t);
});

test("uuidDeterministe : même entrée → même uuid, forme uuid ; lotProposition dépend de l'utilisateur et du compte", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const a = await S.lotProposition(U, 101), b = await S.lotProposition(U, 101), c = await S.lotProposition(U, 102), d = await S.lotProposition(AUTRE, 101);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a, await S.uuidDeterministe(`powens-${U}-101`));
});

test("dateParis, premierDuMois, datePowens", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  assert.equal(S.dateParis(new Date("2026-10-11T22:30:00Z")), "2026-10-12", "minuit passé à Paris");
  assert.equal(S.premierDuMois("2026-09-20"), "2026-09-01");
  assert.equal(S.datePowens("2026-10-12 07:55:00"), "2026-10-12T05:55:00Z", "heure de Paris (été, +2 h)");
  assert.equal(S.datePowens("2026-12-12 07:55:00"), "2026-12-12T06:55:00Z", "heure de Paris (hiver, +1 h)");
  assert.equal(S.datePowens("2026-10-12 07:55:00Z"), "2026-10-12T07:55:00Z");
  assert.equal(S.datePowens("2026-10-12T07:55:00+02:00"), "2026-10-12T07:55:00+02:00");
  assert.equal(S.datePowens(null), null);
  assert.equal(S.datePowens("n'importe quoi"), null);
});

/* ---------- planifier (pur) ---------- */
test("planifier : connexion, comptes (sans colonnes de rattachement), états et message", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const plan = S.planifier({ comptes: [], placements: [], lotsExistants: [] }, {
    userId: U, connexion: connexionPowens({ state: "SCARequired", error_message: "Valide dans ton appli bancaire" }),
    comptes: [{ compte: COMPTES[0], placements: null, operations: [] }], lectureComptesOk: true,
    maintenant: MAINTENANT.toISOString(), aujourdhui: AUJ, minDate: "2026-07-14", lots: {}, uuid: OPTS().uuid,
  });
  assert.deepEqual(J(plan.connexion), { user_id: U, id: 7, etablissement: "Banque Test", etat: "SCARequired", message: "Valide dans ton appli bancaire",
    derniere_synchro: "2026-10-12T05:55:00Z", maj_le: MAINTENANT.toISOString() });
  assert.equal(plan.comptes.length, 1);
  const c = plan.comptes[0];
  const carte = S.planifier({ comptes: [], placements: [], lotsExistants: [] }, {
    userId: U, connexion: connexionPowens(), comptes: [{ compte: { ...COMPTES[0], type: "card" }, placements: null, operations: [] }], lectureComptesOk: true,
    maintenant: MAINTENANT.toISOString(), aujourdhui: AUJ, minDate: "2026-07-14", lots: {},
  });
  assert.deepEqual([carte.comptes[0].type, carte.comptes[0].debit_differe], ["courant", true], "carte à débit différé repérée");
  assert.deepEqual(Object.keys(c).sort(), ["actif", "connexion_id", "debit_differe", "devise", "id", "maj_le", "nom", "solde", "solde_le", "type", "user_id"]);
  assert.equal(c.debit_differe, false);
  assert.equal(c.nom, "Compte chèque ••••", "numéro masqué dans le nom");
  assert.equal(c.type, "courant");
  assert.equal(c.devise, "EUR");
  assert.equal(c.solde_le, "2026-10-12");
  assert.equal(c.actif, true);
  const inactif = S.planifier({ comptes: [], placements: [], lotsExistants: [] }, {
    userId: U, connexion: connexionPowens({ state: "étrange" }), comptes: [{ compte: { ...COMPTES[0], disabled: "2026-10-01 00:00:00" }, placements: null, operations: null }],
    lectureComptesOk: true, maintenant: MAINTENANT.toISOString(), aujourdhui: AUJ, minDate: "2026-07-14", lots: {}, uuid: OPTS().uuid,
  });
  assert.equal(inactif.connexion.etat, "bug");
  assert.equal(inactif.comptes[0].actif, false);
  assert.equal(inactif.propositions.length, 0, "aucune proposition pour un compte inactif");
});

/* ---------- synchroniser (base en mémoire) ---------- */
test("synchroniser : les 4 cas d'application aux lignes (ligne, enveloppe, crédit, non rattaché → proposition)", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  const api = apiFactice();
  const r = await S.synchroniser(db, api, U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const T = db.tables;
  // Connexion et comptes.
  assert.equal(T.banque_connexions.length, 1);
  assert.equal(T.banque_connexions[0].user_id, U);
  assert.equal(T.banque_comptes.length, 4);
  const c103 = T.banque_comptes.find(c => c.id === 103);
  assert.equal(c103.enveloppe, "PEA", "rattachement conservé par l'upsert");
  assert.equal(c103.titulaire, "p2");
  // 1. Compte rattaché à une ligne : value, value_date (Paris), source_auto.
  const livret = T.positions.find(p => p.id === "pos-livret");
  assert.equal(livret.value, 8000);
  assert.equal(livret.value_date, AUJ);
  assert.equal(livret.source_auto, "powens");
  assert.equal(livret.source_auto_le, MAINTENANT.toISOString());
  // 2. Enveloppe : une ligne marché par placement doté d'un ISIN, instrument demandé, lien gardé.
  const marche = T.positions.filter(p => p.mode === "market");
  assert.equal(marche.length, 2);
  const msci = marche.find(p => p.isin === "FR0010315770");
  assert.deepEqual({ name: msci.name, envelope: msci.envelope, owner: msci.owner, qty: msci.qty, user_id: msci.user_id, status: msci.status, source_auto: msci.source_auto },
    { name: "Amundi MSCI World", envelope: "PEA", owner: "p2", qty: 120, user_id: U, status: "actif", source_auto: "powens" });
  assert.deepEqual(T.instruments.map(i => i.isin).sort(), ["FR0010315770", "IE00B4L5Y983"]);
  assert.equal(T.banque_placements.length, 3, "le placement sans ISIN est gardé");
  assert.equal(T.banque_placements.find(p => p.id === 501).position_id, msci.id);
  assert.equal(T.banque_placements.find(p => p.id === 503).position_id, await S.uuidDeterministe(`powens-liq-${U}-103`), "liquidités : ligne manuelle");
  assert.equal(T.banque_placements.find(p => p.id === 501).prix_revient, 20.1);
  // 3. Crédit : capital restant dû = |solde|.
  assert.equal(T.credits.find(c => c.id === "cred-1").crd, 150000.25);
  // 4. Compte non rattaché : proposition de création de ligne.
  assert.equal(T.propositions.length, 1);
  const p = T.propositions[0];
  assert.deepEqual({ user_id: p.user_id, cible: p.cible, operation: p.operation, source: p.source, lot: p.lot },
    { user_id: U, cible: "position", operation: "creer", source: "Powens — Banque Test", lot: await S.lotProposition(U, 101) });
  assert.deepEqual(J(p.apres), { name: "Compte chèque ••••", envelope: "Compte courant", mode: "manual", value: 1520.5, value_date: AUJ, owner: "p1" });
  assert.equal(p.id, await S.uuidDeterministe(`powens-prop-${U}-101`), "identifiant de proposition déterministe (par compte)");
  assert.equal(T.banque_comptes.find(c => c.id === 101).propose_le, MAINTENANT.toISOString(), "trace de la proposition sur le compte");
  // Identifiants de lignes déterministes (deux synchronisations concurrentes ne créent pas deux lignes).
  assert.equal(msci.id, await S.uuidDeterministe(`powens-pos-${U}-501`));
  const upPos = db.journal.find(e => e.table === "positions" && e.op === "upsert");
  assert.deepEqual(J(upPos.opts), { onConflict: "id", ignoreDuplicates: true });
  const upProp = db.journal.find(e => e.table === "propositions" && e.op === "upsert");
  assert.deepEqual(J(upProp.opts), { onConflict: "id", ignoreDuplicates: true });
  // Bail pris puis libéré.
  assert.ok(db.journal.some(e => e.rpc === "banque_verrouiller" && e.args.p_user === U && e.args.p_connexion === 7));
  assert.equal(db.journal.filter(e => e.rpc).at(-1).rpc, "banque_deverrouiller", "bail libéré en dernier");
  assert.equal(RPC.verrous.size, 0);
  // La position d'un autre utilisateur n'est jamais touchée.
  assert.equal(T.positions.find(p => p.id === "pos-autre").value, 1);
  // Toutes les écritures sont filtrées par user_id (update / delete) ou portent user_id (insert / upsert).
  for (const e of db.journal.filter(e => e.op === "update" || e.op === "delete"))
    assert.ok(e.filtres.some(([k, op, v]) => k === "user_id" && op === "eq" && v === U), `${e.table} ${e.op} filtré par user_id`);
  for (const e of db.journal.filter(e => (e.op === "insert" || e.op === "upsert") && e.table !== "instruments"))
    for (const row of [].concat(e.val)) assert.equal(row.user_id, U, `${e.table} ${e.op} porte user_id`);
});

test("synchroniser : opérations (90 jours, nettoyées, catégorisées, à venir écartées) et recalcul des mois touchés", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  const api = apiFactice();
  await S.synchroniser(db, api, U, 7, OPTS());
  const ops = db.tables.banque_operations.sort((a, b) => a.id - b.id);
  assert.deepEqual(ops.map(o => o.id), [9001, 9002, 9003, 9005], "opération à venir écartée");
  assert.deepEqual(J(ops[2]), { user_id: U, id: 9003, compte_id: 101, date: "2026-09-20", montant: -950, libelle: "PRLV LOYER REF ••••", categorie: "logement" });
  assert.equal(ops[0].categorie, "revenus");
  assert.equal(ops[1].categorie, "alimentation");
  assert.equal(ops[3].categorie, "abonnements");
  const appelOps = api.appels.find(a => a[0] === "operations" && a[1] === 101);
  assert.equal(appelOps[2], "2026-07-14", "min_date = aujourd'hui - 90 jours");
  assert.ok(!api.appels.some(a => a[0] === "operations" && [103, 104].includes(a[1])), "pas d'opérations lues pour un PEA ou un crédit");
  assert.ok(!api.appels.some(a => a[0] === "placements" && a[1] !== 103), "placements lus seulement pour les comptes titres");
  const rec = db.journal.filter(e => e.rpc === "banque_recalculer_mois");
  assert.equal(rec.length, 1);
  assert.deepEqual(J(rec[0].args), { p_user: U, p_depuis: "2026-08-01" }, "1er du mois le plus ancien touché");
});

test("synchroniser : idempotente (deux fois le même CONNECTION_SYNCED → mêmes lignes, aucun doublon)", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  const avant = J(db.tables);
  const r2 = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r2.ok, true);
  for (const t of ["banque_connexions", "banque_comptes", "banque_placements", "banque_operations", "positions", "instruments", "credits", "propositions"])
    assert.equal(db.tables[t].length, avant[t].length, `${t} : même nombre de lignes`);
  assert.deepEqual(J(db.tables.positions), avant.positions, "lignes identiques");
  assert.equal(r2.positions_creees, 0);
  assert.equal(r2.propositions, 0, "proposition déjà déposée pour ce compte (repérée par son lot)");
});

test("synchroniser : placement disparu → ligne clôturée ; nouveau placement → nouvelle ligne", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  const iShares = db.tables.positions.find(p => p.isin === "IE00B4L5Y983");
  const nouveaux = { 103: [
    { ...PLACEMENTS[103][0], quantity: 130 },
    { ...PLACEMENTS[103][1], deleted: "2026-10-12 06:00:00" },
    { id: 504, id_account: 103, code: "LU1681043599", code_type: "ISIN", label: "Amundi MSCI World LU", quantity: 3, valuation: 1500, deleted: null },
  ] };
  const r = await S.synchroniser(db, apiFactice({ placements: nouveaux }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(db.tables.positions.find(p => p.id === iShares.id).status, "clôturé");
  assert.equal(db.tables.positions.find(p => p.isin === "FR0010315770").qty, 130, "quantité suivie");
  assert.ok(db.tables.positions.find(p => p.isin === "LU1681043599" && p.mode === "market"), "nouvelle ligne");
  assert.ok(!db.tables.banque_placements.some(p => p.id === 502), "placement disparu retiré");
  assert.equal(r.positions_creees, 1);
});

test("synchroniser : une erreur sur un compte n'arrête pas les autres ; rien n'est effacé ; message gardé", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  const avant = J(db.tables);
  const api = apiFactice({ placements: { 103: [] }, operations: { 101: [] }, pannes: { "placements:103": "Powens est indisponible pour le moment.", "operations:101": "délai dépassé" } });
  const r = await S.synchroniser(db, api, U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.equal(r.erreurs.length, 2);
  assert.deepEqual(J(db.tables.banque_placements), avant.banque_placements, "aucun placement effacé sur une erreur de lecture");
  assert.equal(db.tables.positions.filter(p => p.status === "clôturé").length, 0, "aucune ligne clôturée sur une erreur de lecture");
  assert.equal(db.tables.banque_operations.length, avant.banque_operations.length);
  assert.equal(db.tables.positions.find(p => p.id === "pos-livret").value, 8000, "les autres comptes sont appliqués");
  assert.match(db.tables.banque_connexions[0].message, /^Synchronisation partielle : 2 comptes non lus/);
  // Lecture des comptes impossible : la connexion est mise à jour, aucun compte n'est touché.
  const r2 = await S.synchroniser(db, apiFactice({ pannes: { "comptes:7": "Powens ne répond pas." } }), U, 7, OPTS());
  assert.equal(r2.ok, false);
  assert.equal(db.tables.banque_comptes.length, 4);
  assert.ok(db.tables.banque_comptes.every(c => c.actif === true));
  // Lecture de la connexion impossible : rien n'est écrit.
  const n0 = db.journal.length;
  const r3 = await S.synchroniser(db, apiFactice({ pannes: { "connexion:7": "Élément introuvable chez Powens." } }), U, 7, OPTS());
  assert.equal(r3.ok, false);
  assert.ok(!db.journal.slice(n0).some(e => e.op && e.op !== "select"), "aucune écriture");
});

test("synchroniser : erreur d'écriture sur une étape → les suivantes continuent", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC, echec: (t, op) => (t === "credits" && op === "update" ? "refusé" : null) });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.some(e => /crédit/.test(e.erreur)));
  assert.equal(db.tables.banque_operations.length, 4, "opérations écrites malgré l'échec du crédit");
  assert.equal(db.tables.propositions.length, 1);
});

test("synchroniser : compte disparu chez Powens → inactif ; enveloppe vide traitée comme absente", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const comptes = [...J(RATTACHES), { user_id: U, id: 199, connexion_id: 7, nom: "Ancien", actif: true, position_id: null, enveloppe: "", titulaire: null, credit_id: null }];
  comptes[1].enveloppe = "";
  const db = fausseBase(baseInitiale(comptes), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(db.tables.banque_comptes.find(c => c.id === 199).actif, false);
  assert.equal(db.tables.positions.filter(p => p.mode === "market").length, 0, "enveloppe vide : pas de ligne marché");
  assert.equal(db.tables.propositions.length, 1, "le PEA sans rattachement ne donne pas lieu à une proposition (il se rattache à une enveloppe)");
  assert.ok(!db.tables.propositions.some(p => p.apres.envelope === "PEA"));
});

test("oublierConnexion : lignes repassées en saisie manuelle, connexion supprimée (cascade), filtré par user_id", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  db.tables.banque_connexions.push({ user_id: AUTRE, id: 7, etablissement: "Autre" });
  await S.oublierConnexion(db, U, 7, OPTS());
  assert.deepEqual(db.tables.banque_connexions.map(c => c.user_id), [AUTRE], "seule la connexion de l'utilisateur est supprimée");
  const auto = db.tables.positions.filter(p => p.user_id === U && p.source_auto);
  assert.equal(auto.length, 0, "plus aucune ligne alimentée par Powens");
  assert.equal(db.tables.positions.find(p => p.id === "pos-livret").value, 8000, "ligne conservée");
  for (const e of db.journal.filter(e => e.op === "update" || e.op === "delete").slice(-3))
    assert.ok(e.filtres.some(([k, , v]) => k === "user_id" && v === U));
});

/* ---------- concurrence, propositions, écrasements (relecture sécurité) ---------- */
test("synchroniser : bail déjà pris → synchronisation sautée, notée, rien n'est écrit ; bail illisible → rien n'est écrit", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: rpcBanque({ occupe: true }) });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.equal(r.sautee, true);
  assert.match(r.erreurs[0].erreur, /déjà en cours/);
  assert.ok(!db.journal.some(e => e.op && e.op !== "select"), "aucune écriture");
  assert.ok(!db.journal.some(e => e.rpc === "banque_deverrouiller"), "le bail d'un autre n'est pas libéré");
  const db2 = fausseBase(baseInitiale(J(RATTACHES)), { rpc: { banque_verrouiller: async () => ({ data: null, error: { message: "panne" } }) } });
  const r2 = await S.synchroniser(db2, apiFactice(), U, 7, OPTS());
  assert.equal(r2.ok, false);
  assert.ok(!db2.journal.some(e => e.op && e.op !== "select"));
});

test("synchroniser : bail libéré même si une étape lève", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const rpc = rpcBanque();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: { ...rpc, banque_recalculer_mois: async () => { throw new Error("boum"); } } });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.equal(rpc.verrous.size, 0);
});

test("synchroniser : ligne de placement non dupliquée par deux passages concurrents ; ligne supprimée par l'utilisateur jamais recréée", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.ok(db.tables.banque_placements.find(p => p.id === 501).ligne_creee_le, "trace de création");
  // Passage concurrent qui n'a pas vu les liens : mêmes identifiants, upsert sans doublon.
  const sansLiens = fausseBase({ ...J(db.tables), banque_placements: [] }, { rpc: rpcBanque() });
  await S.synchroniser(sansLiens, apiFactice(), U, 7, OPTS());
  assert.equal(sansLiens.tables.positions.filter(p => p.mode === "market").length, 2, "aucune ligne en double");
  // L'utilisateur supprime la ligne MSCI (clé étrangère on delete set null sur banque_placements.position_id).
  const msci = db.tables.positions.find(p => p.isin === "FR0010315770");
  db.tables.positions = db.tables.positions.filter(p => p.id !== msci.id);
  db.tables.banque_placements.find(p => p.id === 501).position_id = null;
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(r.positions_creees, 0);
  assert.ok(!db.tables.positions.some(p => p.isin === "FR0010315770"), "ligne supprimée non recréée");
  assert.ok(db.tables.banque_placements.find(p => p.id === 501).ligne_creee_le, "trace gardée");
});

test("synchroniser : quantité et clôture seulement sur les lignes encore alimentées par Powens (source_auto)", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  for (const p of db.tables.positions.filter(p => p.mode === "market")) { p.source_auto = null; p.qty = 999; }
  const nouveaux = { 103: [{ ...PLACEMENTS[103][0], quantity: 130 }, { ...PLACEMENTS[103][1], deleted: "2026-10-12 06:00:00" }] };
  await S.synchroniser(db, apiFactice({ placements: nouveaux }), U, 7, OPTS());
  const marche = db.tables.positions.filter(p => p.mode === "market");
  assert.ok(marche.every(p => p.qty === 999 && p.status === "actif"), "lignes reprises en main : intactes");
  for (const e of db.journal.filter(e => e.table === "positions" && e.op === "update" && ("qty" in e.val || "status" in e.val)))
    assert.ok(e.filtres.some(([k, , v]) => k === "source_auto" && v === "powens"), "filtre source_auto");
});

test("synchroniser : capital restant dû mis à jour seulement depuis un compte de type credit", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const comptes = J(RATTACHES).map(c => (c.id === 104 ? { ...c, credit_id: null } : c));
  comptes.push({ user_id: U, id: 101, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: "cred-1" });
  const db = fausseBase(baseInitiale(comptes), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(db.tables.credits.find(c => c.id === "cred-1").crd, 160000, "compte courant : crédit intact");
});

test("synchroniser : compte ignoré → ni proposition ni rattachement ; proposition déjà faite (propose_le) → pas de nouvelle", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const comptes = [...J(RATTACHES), { user_id: U, id: 101, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: true }];
  const db = fausseBase(baseInitiale(comptes), { rpc: RPC });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(db.tables.propositions.length, 0, "compte ignoré : aucune proposition");
  // Proposition supprimée (purge) mais déjà faite : jamais redéposée.
  const comptes2 = [...J(RATTACHES), { user_id: U, id: 101, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: null, propose_le: "2026-09-01T00:00:00Z" }];
  const db2 = fausseBase(baseInitiale(comptes2), { rpc: RPC });
  await S.synchroniser(db2, apiFactice(), U, 7, OPTS());
  assert.equal(db2.tables.propositions.length, 0);
  // Proposition refusée : ne revient pas.
  const db3 = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db3, apiFactice(), U, 7, OPTS());
  db3.tables.propositions[0].statut = "refusee";
  db3.tables.banque_comptes.find(c => c.id === 101).propose_le = null;
  await S.synchroniser(db3, apiFactice(), U, 7, OPTS());
  assert.equal(db3.tables.propositions.length, 1);
  assert.equal(db3.tables.banque_comptes.find(c => c.id === 101).position_id ?? null, null);
});

test("synchroniser : proposition acceptée → compte rattaché à la ligne créée (une seule correspondance), sinon rien et noté", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  const prop = db.tables.propositions[0];
  Object.assign(prop, { statut: "acceptee", decide_le: "2026-10-12T08:10:00Z" });
  const ligne = { id: "pos-cree", user_id: U, name: prop.apres.name, envelope: prop.apres.envelope, mode: "manual", value: 1520.5, status: "actif", created_at: "2026-10-12T08:09:30Z" };
  // Ambigu : deux lignes identiques → rien.
  db.tables.positions.push(ligne, { ...ligne, id: "pos-double", created_at: "2026-10-12T08:10:01Z" });
  let r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(db.tables.banque_comptes.find(c => c.id === 101).position_id ?? null, null, "ambigu : non rattaché");
  assert.ok(r.notes.some(n => /101/.test(n) && /ligne/.test(n)), JSON.stringify(r.notes));
  // Une seule correspondance (l'autre est trop ancienne ou d'un autre utilisateur) → rattachée, solde appliqué.
  db.tables.positions.find(p => p.id === "pos-double").created_at = "2026-10-11T00:00:00Z";
  db.tables.positions.push({ ...ligne, id: "pos-autre-user", user_id: AUTRE });
  r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(db.tables.banque_comptes.find(c => c.id === 101).position_id, "pos-cree");
  assert.equal(db.tables.positions.find(p => p.id === "pos-cree").source_auto, "powens", "ligne alimentée dès ce passage");
  assert.equal(db.tables.propositions.length, 1, "aucune nouvelle proposition");
});

test("synchroniser : lecture des opérations tronquée (pagination) → signalée dans le rapport", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  const api = apiFactice();
  const lire = api.operations;
  api.operations = async (id, min) => { const o = await lire(id, min); if (id === 101) o.tronque = true; return o; };
  const r = await S.synchroniser(db, api, U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.some(e => e.compte_id === 101 && /tronquée/.test(e.erreur)), JSON.stringify(r.erreurs));
  assert.equal(db.tables.banque_operations.length, 4, "opérations lues écrites quand même");
});

test("nettoyerLibelle : un ISIN valide n'est pas masqué ; une suite de 8 chiffres l'est", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  assert.equal(S.nettoyerLibelle("ACHAT FR0010315770 AMUNDI"), "ACHAT FR0010315770 AMUNDI");
  assert.equal(S.nettoyerLibelle("ACHAT US0378331005"), "ACHAT US0378331005");
  assert.equal(S.nettoyerLibelle("REF AB12345678"), "REF AB••••", "pas un ISIN : chiffres masqués");
  assert.equal(S.nettoyerLibelle("FR00103157701 X"), "FR•••• X", "13 caractères : pas un ISIN");
});

/* ---------- comptes enveloppe : adoption des lignes existantes, liquidités, propositions ---------- */
/** Lignes saisies à la main par l'utilisateur dans son PEA (titulaire p2, comme le compte 103 de RATTACHES). */
const LIGNES_PEA = () => [
  { id: "m-msci", user_id: U, name: "MSCI World (saisi)", envelope: " pea ", owner: "p2", mode: "manual", isin: "fr0010315770", qty: 100, value: 2800, status: "actif" },
  { id: "m-ishares", user_id: U, name: "iShares World", envelope: "PEA", owner: "p2", mode: "market", isin: "IE00B4L5Y983", qty: 8, value: 700, status: "actif" },
  { id: "m-liq", user_id: U, name: "Espèces PEA", envelope: "P E A", owner: "p2", mode: "manual", isin: null, value: 40, status: "actif" },
];
const baseAvecLignes = (lignes, comptes = J(RATTACHES)) => { const b = baseInitiale(comptes); b.positions.push(...lignes); return b; };

test("adoption par ISIN : lignes existantes reprises (ISIN et enveloppe sans casse ni espaces), aucune ligne créée, nom, mode et valeur intacts", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseAvecLignes(LIGNES_PEA()), { rpc: rpcBanque() });
  const nAvant = db.tables.positions.length;
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const T = db.tables;
  assert.equal(T.positions.length, nAvant, "aucune nouvelle ligne");
  assert.equal(r.positions_creees, 0);
  const msci = T.positions.find(p => p.id === "m-msci");
  assert.deepEqual({ name: msci.name, mode: msci.mode, value: msci.value, envelope: msci.envelope, qty: msci.qty, isin: msci.isin, source_auto: msci.source_auto, source_auto_le: msci.source_auto_le },
    { name: "MSCI World (saisi)", mode: "manual", value: 2800, envelope: " pea ", qty: 120, isin: "FR0010315770", source_auto: "powens", source_auto_le: MAINTENANT.toISOString() });
  const ish = T.positions.find(p => p.id === "m-ishares");
  assert.deepEqual([ish.qty, ish.value, ish.mode, ish.source_auto], [10, 700, "market", "powens"]);
  assert.equal(T.banque_placements.find(p => p.id === 501).position_id, "m-msci");
  assert.equal(T.banque_placements.find(p => p.id === 502).position_id, "m-ishares");
  assert.ok(T.banque_placements.find(p => p.id === 501).ligne_creee_le, "lien posé : une suppression par l'utilisateur sera respectée");
  assert.ok(T.instruments.some(i => i.isin === "FR0010315770"), "instrument en majuscules (clé étrangère de positions.isin)");
  // Liquidités : ligne manuelle existante adoptée, valeur et date mises à jour.
  const liq = T.positions.find(p => p.id === "m-liq");
  assert.deepEqual([liq.value, liq.value_date, liq.source_auto, liq.name, liq.mode], [50, AUJ, "powens", "Espèces PEA", "manual"]);
  assert.equal(T.banque_placements.find(p => p.id === 503).position_id, "m-liq");
  assert.equal(r.lignes_adoptees, 3);
  // Deuxième synchronisation : rien de plus, quantités suivies par la voie ordinaire (filtre source_auto).
  const avant = J(T);
  const r2 = await S.synchroniser(db, apiFactice({ placements: { 103: [{ ...PLACEMENTS[103][0], quantity: 125 }, PLACEMENTS[103][1], { ...PLACEMENTS[103][2], valuation: 60 }] } }), U, 7, OPTS());
  assert.equal(r2.ok, true, JSON.stringify(r2.erreurs));
  assert.equal(db.tables.positions.length, avant.positions.length);
  assert.equal(r2.lignes_adoptees, 0);
  assert.equal(r2.positions_creees, 0);
  assert.equal(db.tables.positions.find(p => p.id === "m-msci").qty, 125);
  assert.equal(db.tables.positions.find(p => p.id === "m-liq").value, 60);
});

test("adoption par ISIN : cas type, 14 lignes PEA saisies (13 avec ISIN) → aucun doublon", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const isins = ["FR0010315770", "IE00B4L5Y983", "LU1681043599", "FR0011550185", "FR0013412285", "IE00BK5BQT80", "LU0392494562",
    "FR0010296061", "IE00B5BMR087", "FR0011871128", "LU1829221024", "IE00B3RBWM25", "FR0007052782"];
  const lignes = isins.map((isin, i) => ({ id: `pea-${i}`, user_id: U, name: `Ligne ${i}`, envelope: "PEA", owner: "p2", mode: i % 2 ? "market" : "manual", isin, qty: i + 1, value: 1000 + i, status: "actif" }));
  lignes.push({ id: "pea-liq", user_id: U, name: "Liquidités", envelope: "PEA", owner: "p2", mode: "manual", isin: null, value: 12, status: "actif" });
  const placements = { 103: [...isins.map((isin, i) => ({ id: 700 + i, id_account: 103, code: isin, code_type: "ISIN", label: `Fonds ${i}`, quantity: i + 2, valuation: 10, deleted: null })),
    { id: 799, id_account: 103, code: null, code_type: null, label: "Liquidités", quantity: null, valuation: 321.5, deleted: null }] };
  const db = fausseBase(baseAvecLignes(lignes), { rpc: rpcBanque() });
  const nAvant = db.tables.positions.length;
  for (let i = 0; i < 2; i++) {
    const r = await S.synchroniser(db, apiFactice({ placements }), U, 7, OPTS());
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    assert.equal(r.positions_creees, 0, `passage ${i + 1}`);
  }
  assert.equal(db.tables.positions.length, nAvant, "aucun doublon");
  assert.ok(lignes.every(l => db.tables.positions.find(p => p.id === l.id).source_auto === "powens"));
  assert.equal(db.tables.positions.find(p => p.id === "pea-3").qty, 5);
  assert.equal(db.tables.positions.find(p => p.id === "pea-liq").value, 321.5);
  assert.equal(new Set(db.tables.banque_placements.map(p => p.position_id)).size, 14, "un placement par ligne");
});

test("adoption par ISIN : plusieurs correspondances → la plus grande quantité, noté dans le rapport", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const lignes = [
    { id: "a-petite", user_id: U, name: "MSCI 1", envelope: "PEA", owner: "p2", mode: "manual", isin: "FR0010315770", qty: 10, value: 1, status: "actif" },
    { id: "a-grande", user_id: U, name: "MSCI 2", envelope: "pea", owner: "p2", mode: "manual", isin: "FR0010315770", qty: 90, value: 2, status: "actif" },
    { id: "a-sans-qte", user_id: U, name: "MSCI 3", envelope: "PEA", owner: "p2", mode: "manual", isin: "FR0010315770", qty: null, value: 3, status: "actif" },
  ];
  const db = fausseBase(baseAvecLignes(lignes), { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(db.tables.banque_placements.find(p => p.id === 501).position_id, "a-grande");
  assert.equal(db.tables.positions.find(p => p.id === "a-grande").qty, 120);
  assert.equal(db.tables.positions.find(p => p.id === "a-petite").qty, 10, "les autres sont intactes");
  assert.equal(db.tables.positions.find(p => p.id === "a-petite").source_auto ?? null, null);
  assert.ok(r.notes.some(n => /FR0010315770/.test(n) && /3 lignes/.test(n)), JSON.stringify(r.notes));
});

test("adoption par ISIN : titulaire, ligne clôturée, autre enveloppe, autre utilisateur ou ligne déjà liée → pas adoptées, ligne créée", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const lignes = [
    { id: "x-p1", user_id: U, name: "MSCI p1", envelope: "PEA", owner: "p1", mode: "manual", isin: "FR0010315770", qty: 1, status: "actif" },
    { id: "x-cloture", user_id: U, name: "MSCI clos", envelope: "PEA", owner: "p2", mode: "manual", isin: "FR0010315770", qty: 1, status: "clôturé" },
    { id: "x-cto", user_id: U, name: "MSCI CTO", envelope: "Compte-titres", owner: "p2", mode: "manual", isin: "FR0010315770", qty: 1, status: "actif" },
    { id: "x-autre", user_id: AUTRE, name: "MSCI autre", envelope: "PEA", owner: "p2", mode: "manual", isin: "FR0010315770", qty: 1, status: "actif" },
  ];
  const db = fausseBase(baseAvecLignes(lignes), { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const id501 = await S.idLigne(U, 501);
  assert.equal(db.tables.banque_placements.find(p => p.id === 501).position_id, id501, "aucune correspondance : ligne créée");
  for (const l of lignes) assert.equal(db.tables.positions.find(p => p.id === l.id).qty, 1, l.id);
  // Compte sans titulaire : la ligne de p1 est adoptée.
  const sansTitulaire = J(RATTACHES).map(c => (c.id === 103 ? { ...c, titulaire: null } : c));
  const db2 = fausseBase(baseAvecLignes(lignes, sansTitulaire), { rpc: rpcBanque() });
  await S.synchroniser(db2, apiFactice(), U, 7, OPTS());
  assert.equal(db2.tables.banque_placements.find(p => p.id === 501).position_id, "x-p1");
  // Deux placements du même ISIN, une seule ligne : la ligne est liée au premier, le second a sa propre ligne.
  const doubles = { 103: [PLACEMENTS[103][0], { ...PLACEMENTS[103][0], id: 505, quantity: 7 }] };
  const db3 = fausseBase(baseAvecLignes([{ ...LIGNES_PEA()[0] }]), { rpc: rpcBanque() });
  await S.synchroniser(db3, apiFactice({ placements: doubles }), U, 7, OPTS());
  assert.equal(db3.tables.banque_placements.find(p => p.id === 501).position_id, "m-msci");
  assert.equal(db3.tables.banque_placements.find(p => p.id === 505).position_id, await S.idLigne(U, 505));
  assert.equal(db3.tables.positions.find(p => p.id === "m-msci").qty, 120);
});

test("liquidités : sans ligne existante → ligne manuelle « Liquidités <enveloppe> » créée une fois ; autres placements sans ISIN ignorés et listés", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const lignes = [
    { id: "liq-cto", user_id: U, name: "Liquidités CTO", envelope: "CTO", owner: "p2", mode: "manual", isin: null, value: 5, status: "actif" },
    { id: "liq-isin", user_id: U, name: "Liquidités monétaire", envelope: "PEA", owner: "p2", mode: "manual", isin: "FR0010296061", value: 5, status: "actif" },
    { id: "liq-marche", user_id: U, name: "Liquidités", envelope: "PEA", owner: "p2", mode: "market", isin: null, value: 5, status: "actif" },
  ];
  const placements = { 103: [...PLACEMENTS[103], { id: 506, id_account: 103, code: "QS0002005324", code_type: "AMF", label: "Fonds euros", quantity: null, valuation: 400, deleted: null }] };
  const db = fausseBase(baseAvecLignes(lignes), { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice({ placements }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const idLiq = await S.uuidDeterministe(`powens-liq-${U}-103`);
  const liq = db.tables.positions.find(p => p.id === idLiq);
  assert.deepEqual({ name: liq.name, envelope: liq.envelope, owner: liq.owner, mode: liq.mode, isin: liq.isin ?? null, value: liq.value, value_date: liq.value_date, source_auto: liq.source_auto, status: liq.status, user_id: liq.user_id },
    { name: "Liquidités PEA", envelope: "PEA", owner: "p2", mode: "manual", isin: null, value: 50, value_date: AUJ, source_auto: "powens", status: "actif", user_id: U });
  assert.equal(db.tables.banque_placements.find(p => p.id === 503).position_id, idLiq);
  assert.equal(db.tables.banque_placements.find(p => p.id === 506).position_id, null, "fonds euros sans ISIN : ignoré");
  assert.ok(r.notes.some(n => /506/.test(n) && /sans ISIN/.test(n)), JSON.stringify(r.notes));
  for (const l of lignes) assert.equal(db.tables.positions.find(p => p.id === l.id).value, 5, l.id);
  const n1 = db.tables.positions.length;
  const r2 = await S.synchroniser(db, apiFactice({ placements: { 103: [PLACEMENTS[103][0], PLACEMENTS[103][1], { ...PLACEMENTS[103][2], valuation: 75 }] } }), U, 7, OPTS());
  assert.equal(r2.ok, true, JSON.stringify(r2.erreurs));
  assert.equal(db.tables.positions.length, n1, "pas de seconde ligne de liquidités");
  assert.equal(db.tables.positions.find(p => p.id === idLiq).value, 75);
  // Libellé « Liquidités » sans code_type : reconnu aussi.
  const db2 = fausseBase(baseInitiale(J(RATTACHES)), { rpc: rpcBanque() });
  await S.synchroniser(db2, apiFactice({ placements: { 103: [{ id: 510, id_account: 103, label: "LIQUIDITES", valuation: 9, deleted: null }] } }), U, 7, OPTS());
  assert.equal(db2.tables.positions.find(p => p.id === idLiq).value, 9);
});

test("propositions : aucune pour un compte pea, compte_titres, assurance_vie ou per ; gardées pour courant et livret", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const types = { 201: "checking", 202: "livret_a", 203: "pea", 204: "market", 205: "lifeinsurance", 206: "per" };
  const comptes = Object.entries(types).map(([id, type]) => ({ id: Number(id), id_connection: 7, name: `Compte ${type}`, balance: 100, currency: { id: "EUR" }, type, disabled: null, deleted: null }));
  const db = fausseBase(baseInitiale([]), { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice({ comptes, placements: {}, operations: {} }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.deepEqual(db.tables.propositions.map(p => p.apres.envelope).sort(), ["Compte courant", "Livret"]);
  assert.deepEqual(db.tables.banque_comptes.filter(c => c.propose_le).map(c => c.id).sort(), [201, 202]);
  // Toujours « à rattacher » côté app (sans ligne, enveloppe ni crédit) tant que l'utilisateur n'a pas choisi.
  assert.equal(db.tables.banque_comptes.filter(c => !c.position_id && !c.enveloppe && !c.credit_id && !c.ignore).length, 6);
});
