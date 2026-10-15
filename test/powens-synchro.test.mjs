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
function fausseBase(init = {}, { rpc = {}, echec = () => null, utilisateurs = {}, plafond = Infinity } = {}) {
  const tables = J(init);
  const journal = [];
  const lignes = t => (tables[t] ??= []);
  const cle = (t, r, champs) => (champs || CLES[t] || ["id"]).map(k => String(r[k])).join("|");
  function from(table) {
    const q = { table, op: "select", filtres: [], val: null, opts: {}, unique: null, limite: null };
    const correspond = r => q.filtres.every(([k, op, v]) => op === "eq" ? String(r[k]) === String(v)
      : op === "in" ? v.map(String).includes(String(r[k])) : op === "lt" ? r[k] < v : op === "gte" ? r[k] >= v
      : op === "is" ? (r[k] ?? null) === v : op === "neq" ? (r[k] ?? null) !== v : op === "not_is" ? (r[k] ?? null) !== v : true);
    const executer = () => {
      journal.push({ table, op: q.op, filtres: q.filtres, val: q.val, opts: q.opts });
      const err = echec(table, q.op, q);
      if (err) return { data: null, error: { message: err } };
      let data = null;
      if (q.op === "select") {
        data = lignes(table).filter(correspond).map(r => ({ ...r }));
        if (q.ordre) data.sort((x, y) => (x[q.ordre] > y[q.ordre] ? 1 : x[q.ordre] < y[q.ordre] ? -1 : 0));
        if (q.limite != null) data = data.slice(0, q.limite);
        data = data.slice(0, plafond); // plafond de lignes de l'API de données
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
      select: () => b, order: k => { q.ordre = k; return b; }, limit: n => { q.limite = n; return b; },
      eq: (k, v) => { q.filtres.push([k, "eq", v]); return b; }, in: (k, v) => { q.filtres.push([k, "in", v]); return b; },
      lt: (k, v) => { q.filtres.push([k, "lt", v]); return b; }, gte: (k, v) => { q.filtres.push([k, "gte", v]); return b; },
      is: (k, v) => { q.filtres.push([k, "is", v]); return b; }, neq: (k, v) => { q.filtres.push([k, "neq", v]); return b; },
      not: (k, op, v) => { q.filtres.push([k, "not_" + op, v]); return b; },
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
/** Compte de type « autre » (seul type qui reçoit encore une proposition « créer une ligne »). */
const COMPTE_AUTRE = { id: 105, id_connection: 7, name: "Compte à terme", balance: 500, currency: { id: "EUR" }, type: "unknown", disabled: null, deleted: null, last_update: "2026-10-12 07:55:00" };
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
/** Rattachements posés par l'utilisateur (Compte › Connecter Claude). */
const RATTACHES = [
  { user_id: U, id: 102, connexion_id: 7, position_id: "pos-livret", enveloppe: null, titulaire: null, credit_id: null },
  { user_id: U, id: 103, connexion_id: 7, position_id: null, enveloppe: "PEA", titulaire: "p2", credit_id: null },
  { user_id: U, id: 104, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: "cred-1" },
];
const AVEC_AUTRE = () => apiFactice({ comptes: [...COMPTES, COMPTE_AUTRE] });
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
  assert.deepEqual(J(C.CATEGORIES_BOUSSOLE), ["logement", "alimentation", "transport", "enfants", "sante", "loisirs", "abonnements", "impots", "divers", "revenus", "epargne", "virement_interne"]);
  assert.ok(!toutes.has("virement_interne"), "virement_interne n'est jamais une catégorie Powens : posée par le rapprochement des virements");
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
    derniere_synchro: "2026-10-12T05:55:00Z", maj_le: MAINTENANT.toISOString(), connecteur: 59 });
  assert.equal(plan.comptes.length, 1);
  const c = plan.comptes[0];
  const carte = S.planifier({ comptes: [], placements: [], lotsExistants: [] }, {
    userId: U, connexion: connexionPowens(), comptes: [{ compte: { ...COMPTES[0], type: "card" }, placements: null, operations: [] }], lectureComptesOk: true,
    maintenant: MAINTENANT.toISOString(), aujourdhui: AUJ, minDate: "2026-07-14", lots: {},
  });
  assert.deepEqual([carte.comptes[0].type, carte.comptes[0].debit_differe], ["courant", true], "carte à débit différé repérée");
  assert.deepEqual(Object.keys(c).sort(), ["actif", "connexion_id", "debit_differe", "devise", "id", "maj_le", "nom", "ouverture_le", "pret", "solde", "solde_le", "type", "user_id"]);
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
  const api = apiFactice({ comptes: [...COMPTES, COMPTE_AUTRE] });
  const r = await S.synchroniser(db, api, U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const T = db.tables;
  // Connexion et comptes.
  assert.equal(T.banque_connexions.length, 1);
  assert.equal(T.banque_connexions[0].user_id, U);
  assert.equal(T.banque_comptes.length, 5);
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
  // 4. Compte courant non rattaché, sans ligne correspondante : ligne « Compte courant <établissement> » créée et rattachée.
  const idCc = await S.uuidDeterministe(`powens-cc-${U}-101`);
  const cc = T.positions.find(x => x.id === idCc);
  assert.deepEqual({ name: cc.name, envelope: cc.envelope, bloc: cc.bloc, owner: cc.owner, mode: cc.mode, value: cc.value, value_date: cc.value_date, source_auto: cc.source_auto, status: cc.status, user_id: cc.user_id },
    { name: "Compte courant Banque Test", envelope: "Comptes courants", bloc: "Comptes courants", owner: "p1", mode: "manual", value: 1520.5, value_date: AUJ, source_auto: "powens", status: "actif", user_id: U });
  const c101 = T.banque_comptes.find(c => c.id === 101);
  assert.deepEqual([c101.position_id, c101.rattache_auto, c101.cree_auto, c101.suggestion, c101.propose_le ?? null], [idCc, MAINTENANT.toISOString(), true, null, null]);
  assert.equal(r.rattaches_auto, 1);
  assert.equal(r.crees_auto, 1);
  // 5. Compte « autre » non rattaché : proposition de création de ligne.
  assert.equal(T.propositions.length, 1);
  const p = T.propositions[0];
  assert.deepEqual({ user_id: p.user_id, cible: p.cible, operation: p.operation, source: p.source, lot: p.lot },
    { user_id: U, cible: "position", operation: "creer", source: "Powens — Banque Test", lot: await S.lotProposition(U, 105) });
  assert.deepEqual(J(p.apres), { name: "Compte à terme", envelope: "", mode: "manual", value: 500, value_date: AUJ, owner: "p1" });
  assert.equal(p.id, await S.uuidDeterministe(`powens-prop-${U}-105`), "identifiant de proposition déterministe (par compte)");
  assert.equal(T.banque_comptes.find(c => c.id === 105).propose_le, MAINTENANT.toISOString(), "trace de la proposition sur le compte");
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
  assert.deepEqual(J(ops[2]), { user_id: U, id: 9003, compte_id: 101, date: "2026-09-20", montant: -950, libelle: "PRLV LOYER REF ••••", categorie: "logement",
    categorie_powens: "logement", contrepartie_id: null, type_powens: null });
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
  assert.equal(db.tables.banque_comptes.find(c => c.id === 101).position_id, await S.uuidDeterministe(`powens-cc-${U}-101`), "rattachement automatique posé malgré l'échec du crédit");
});

test("synchroniser : compte disparu chez Powens → inactif ; enveloppe vide traitée comme absente", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const comptes = [...J(RATTACHES), { user_id: U, id: 199, connexion_id: 7, nom: "Ancien", actif: true, position_id: null, enveloppe: "", titulaire: null, credit_id: null }];
  comptes[1].enveloppe = "";
  const db = fausseBase(baseInitiale(comptes), { rpc: RPC });
  await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(db.tables.banque_comptes.find(c => c.id === 199).actif, false);
  assert.equal(db.tables.positions.filter(p => p.mode === "market").length, 0, "enveloppe vide : pas de ligne marché");
  assert.equal(db.tables.propositions.length, 0, "ni le PEA sans rattachement (il se rattache à une enveloppe) ni le courant (ligne créée) ne donnent lieu à une proposition");
  assert.equal(db.tables.banque_comptes.find(c => c.id === 103).enveloppe || null, null, "PEA sans enveloppe correspondante : pas de rattachement automatique");
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
  const comptes = [...J(RATTACHES), { user_id: U, id: 105, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: null, ignore: true }];
  const db = fausseBase(baseInitiale(comptes), { rpc: RPC });
  const r = await S.synchroniser(db, AVEC_AUTRE(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(db.tables.propositions.length, 0, "compte ignoré : aucune proposition");
  // Proposition supprimée (purge) mais déjà faite : jamais redéposée.
  const comptes2 = [...J(RATTACHES), { user_id: U, id: 105, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: null, propose_le: "2026-09-01T00:00:00Z" }];
  const db2 = fausseBase(baseInitiale(comptes2), { rpc: RPC });
  await S.synchroniser(db2, AVEC_AUTRE(), U, 7, OPTS());
  assert.equal(db2.tables.propositions.length, 0);
  // Proposition refusée : ne revient pas.
  const db3 = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db3, AVEC_AUTRE(), U, 7, OPTS());
  db3.tables.propositions[0].statut = "refusee";
  db3.tables.banque_comptes.find(c => c.id === 105).propose_le = null;
  await S.synchroniser(db3, AVEC_AUTRE(), U, 7, OPTS());
  assert.equal(db3.tables.propositions.length, 1);
  assert.equal(db3.tables.banque_comptes.find(c => c.id === 105).position_id ?? null, null);
});

test("synchroniser : proposition acceptée → compte rattaché à la ligne créée (une seule correspondance), sinon rien et noté", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC });
  await S.synchroniser(db, AVEC_AUTRE(), U, 7, OPTS());
  const prop = db.tables.propositions[0];
  Object.assign(prop, { statut: "acceptee", decide_le: "2026-10-12T08:10:00Z" });
  const ligne = { id: "pos-cree", user_id: U, name: prop.apres.name, envelope: prop.apres.envelope, mode: "manual", value: 500, status: "actif", created_at: "2026-10-12T08:09:30Z" };
  // Ambigu : deux lignes identiques → rien.
  db.tables.positions.push(ligne, { ...ligne, id: "pos-double", created_at: "2026-10-12T08:10:01Z" });
  let r = await S.synchroniser(db, AVEC_AUTRE(), U, 7, OPTS());
  assert.equal(db.tables.banque_comptes.find(c => c.id === 105).position_id ?? null, null, "ambigu : non rattaché");
  assert.ok(r.notes.some(n => /105/.test(n) && /ligne/.test(n)), JSON.stringify(r.notes));
  // Une seule correspondance (l'autre est trop ancienne ou d'un autre utilisateur) → rattachée, solde appliqué.
  db.tables.positions.find(p => p.id === "pos-double").created_at = "2026-10-11T00:00:00Z";
  db.tables.positions.push({ ...ligne, id: "pos-autre-user", user_id: AUTRE });
  r = await S.synchroniser(db, AVEC_AUTRE(), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(db.tables.banque_comptes.find(c => c.id === 105).position_id, "pos-cree");
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
  assert.equal(T.positions.length, nAvant + 1, "aucune nouvelle ligne de placement (seule la ligne « Compte courant » du compte 101)");
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
  assert.equal(db.tables.positions.length, nAvant + 1, "aucun doublon (seule la ligne « Compte courant » du compte 101 est créée)");
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

test("propositions : aucune pour un compte courant, livret, pea, compte_titres, assurance_vie ou per ; gardée pour un compte « autre »", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const types = { 201: "checking", 202: "livret_a", 203: "pea", 204: "market", 205: "lifeinsurance", 206: "per", 207: "unknown" };
  const comptes = Object.entries(types).map(([id, type]) => ({ id: Number(id), id_connection: 7, name: `Compte ${type}`, balance: 100, currency: { id: "EUR" }, type, disabled: null, deleted: null }));
  const db = fausseBase(baseInitiale([]), { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice({ comptes, placements: {}, operations: {} }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.deepEqual(db.tables.propositions.map(p => p.apres.name), ["Compte unknown"]);
  assert.deepEqual(db.tables.banque_comptes.filter(c => c.propose_le).map(c => c.id).sort(), [207]);
  // Courant et livret : lignes créées et rattachées ; compte-titres sans enveloppe : « Compte-titres <établissement> » (foyer d'une
  // personne) ; pea (sans PME), assurance-vie, PER : rien d'évident, « à rattacher » côté app tant que l'utilisateur n'a pas choisi.
  const k = id => db.tables.banque_comptes.find(c => c.id === id);
  assert.equal(k(201).position_id, await S.uuidDeterministe(`powens-cc-${U}-201`));
  assert.equal(k(202).position_id, "pos-livret", "Livret A : la ligne « Livret A » existante");
  assert.deepEqual([k(204).enveloppe, k(204).titulaire, k(204).cree_auto], ["Compte-titres Banque Test", "p1", true]);
  assert.deepEqual([203, 205, 206, 207].filter(id => !k(id).position_id && !k(id).enveloppe && !k(id).credit_id), [203, 205, 206, 207]);
});

/* ---------- rapprochement automatique et doublons (migration 0022) ---------- */
/** Client Powens factice à plusieurs connexions : { <id connexion>: { connexion, comptes, placements } }. */
function apiMulti(cxs) {
  return {
    connexion: async id => J(cxs[id].connexion),
    comptes: async id => J(cxs[id].comptes),
    placements: async id => { for (const c of Object.values(cxs)) if (c.placements?.[id]) return J(c.placements[id]); return []; },
    operations: async () => [],
  };
}
const cpt = (id, cx, name, type, balance, extra = {}) => ({ id, id_connection: cx, name, balance, currency: { id: "EUR" }, type, disabled: null, deleted: null, last_update: "2026-10-12 07:55:00", ...extra });
const ISINS_PEA = ["FR0010315770", "IE00B4L5Y983", "LU1681043599", "FR0011550185", "FR0013412285", "IE00BK5BQT80", "LU0392494562",
  "FR0010296061", "IE00B5BMR087", "FR0011871128", "LU1829221024", "IE00B3RBWM25", "FR0007052782"];
const liq = (id, compte, v) => ({ id, id_account: compte, code: null, code_type: null, label: "Liquidités", quantity: null, valuation: v, deleted: null });
/** Cas type (montants fictifs) : deux connexions LCL (la première ne contient que le courant), une BoursoBank. */
function casType() {
  const cxs = {
    11: { connexion: { id: 11, id_connector: 40, state: null, last_update: "2026-10-12 07:55:00", connector: { id: 40, name: "LCL" } },
      comptes: [cpt(1101, 11, "COMPTE COURANT", "checking", 41.2)] },
    12: { connexion: { id: 12, id_connector: 40, state: null, last_update: "2026-10-12 07:55:00", connector: { id: 40, name: "LCL" } },
      comptes: [cpt(1201, 12, "COMPTE COURANT", "checking", 41.2), cpt(1202, 12, "LIVRET A", "livret_a", 7412.5),
        cpt(1203, 12, "PRET ETUDIANT", "loan", -3264.18, { loan: { remaining_capital: 3264.18 } })] },
    13: { connexion: { id: 13, id_connector: 41, state: null, last_update: "2026-10-12 07:55:00", connector: { id: 41, name: "BoursoBank" } },
      comptes: [cpt(1301, 13, "BoursoBank Compte", "checking", 1.35), cpt(1302, 13, "LDDS", "ldds", 12), cpt(1303, 13, "Compte-titres", "market", 52.4),
        cpt(1304, 13, "PEA-PME", "pea", 1500), cpt(1305, 13, "PEA", "pea", 51230.5)],
      placements: { 1303: [liq(9301, 1303, 52.4)], 1304: [liq(9401, 1304, 1500)],
        1305: [...ISINS_PEA.map((isin, i) => ({ id: 9500 + i, id_account: 1305, code: isin, code_type: "ISIN", label: `Fonds ${i}`, quantity: i + 1, valuation: 5000, deleted: null })), liq(9599, 1305, 38.15)] } },
  };
  const positions = [
    { id: "l-livret-a", user_id: U, name: "Livret A", envelope: "Livrets", owner: "p1", bloc: "Livrets", mode: "manual", value: 15000, status: "actif" },
    { id: "l-indemnite", user_id: U, name: "Épargne en attente", envelope: "Livrets", owner: "p1", bloc: "Livrets", mode: "manual", value: 20000, status: "actif" },
    ...ISINS_PEA.map((isin, i) => ({ id: `l-pea-${i}`, user_id: U, name: `Ligne PEA ${i}`, envelope: "PEA", owner: "p1", bloc: "Monde", mode: "market", isin, qty: i + 1, status: "actif" })),
    { id: "l-pea-liq", user_id: U, name: "Liquidités PEA", envelope: "PEA", owner: "p1", bloc: "Liquidités", mode: "manual", value: 40, status: "actif" },
  ];
  const base = { banque_connexions: [11, 12, 13].map((id, i) => ({ user_id: U, id, cree_le: `2026-10-0${i + 1}T10:00:00Z` })), banque_comptes: [], banque_placements: [],
    banque_operations: [], positions, instruments: [], credits: [{ id: "k-etudiant", user_id: U, nom: "Prêt étudiant", crd: 3264.18 }], propositions: [] };
  return { cxs, base };
}

test("cas type : LCL A en double de LCL B, Livret A, prêt, PEA par ISIN, créations (courants, LDDS, PEA-PME, compte-titres), aucune proposition, aucun doublon", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const { cxs, base } = casType();
  const db = fausseBase(base, { rpc: rpcBanque() });
  const api = apiMulti(cxs);
  // Ordre défavorable : la connexion en double (A) est synchronisée d'abord, avant de connaître B ; puis tout, deux fois.
  for (const cx of [11, 12, 13, 11, 12, 13, 11]) {
    const r = await S.synchroniser(db, api, U, cx, OPTS());
    assert.equal(r.ok, true, `${cx} : ${JSON.stringify(r.erreurs)}`);
  }
  const T = db.tables, k = id => T.banque_comptes.find(c => c.id === id), ligne = id => T.positions.find(p => p.id === id);
  // Doublon de connexion : LCL A ne contient que le courant, déjà présent dans LCL B.
  assert.equal(T.banque_connexions.find(c => c.id === 11).doublon_de, 12, "LCL A en double de LCL B");
  assert.equal(T.banque_connexions.find(c => c.id === 12).doublon_de, null);
  assert.deepEqual(T.banque_connexions.map(c => c.connecteur), [40, 40, 41]);
  assert.equal(k(1101).doublon_de, 1201, "courant de LCL A : en double");
  assert.deepEqual([k(1101).position_id ?? null, k(1101).rattache_auto ?? null], [null, null], "le compte en double n'est pas rattaché (son rattachement automatique est passé au jumeau)");
  // LCL B : courant → ligne créée (reprise de celle créée pour LCL A au premier passage), livret A → ligne existante, prêt → crédit.
  const idCcLcl = await S.uuidDeterministe(`powens-cc-${U}-1101`);
  assert.equal(k(1201).position_id, idCcLcl, "le courant de LCL B reprend la ligne créée pour LCL A");
  assert.deepEqual([k(1201).cree_auto, !!k(1201).rattache_auto], [true, true]);
  assert.deepEqual({ name: ligne(idCcLcl).name, envelope: ligne(idCcLcl).envelope, bloc: ligne(idCcLcl).bloc, value: ligne(idCcLcl).value, status: ligne(idCcLcl).status },
    { name: "Compte courant LCL", envelope: "Comptes courants", bloc: "Comptes courants", value: 41.2, status: "actif" });
  assert.equal(k(1202).position_id, "l-livret-a");
  assert.equal(ligne("l-livret-a").value, 7412.5, "solde du livret appliqué");
  assert.equal(k(1203).credit_id, "k-etudiant");
  assert.equal(T.credits[0].crd, 3264.18);
  // BoursoBank.
  const idCcBourso = await S.uuidDeterministe(`powens-cc-${U}-1301`), idLdds = await S.uuidDeterministe(`powens-lv-${U}-1302`);
  assert.equal(k(1301).position_id, idCcBourso);
  assert.deepEqual([ligne(idCcBourso).name, ligne(idCcBourso).value], ["Compte courant BoursoBank", 1.35]);
  assert.equal(k(1302).position_id, idLdds);
  assert.deepEqual([ligne(idLdds).name, ligne(idLdds).envelope, ligne(idLdds).bloc, ligne(idLdds).value], ["LDDS", "Livrets", "Livrets", 12]);
  assert.deepEqual([k(1303).enveloppe, k(1303).titulaire, k(1303).cree_auto], ["Compte-titres BoursoBank", "p1", true]);
  assert.deepEqual([k(1304).enveloppe, k(1304).titulaire, k(1304).cree_auto], ["PEA-PME", "p1", true]);
  assert.deepEqual([k(1305).enveloppe, k(1305).titulaire, k(1305).cree_auto], ["PEA", "p1", false]);
  const liqDe = env => T.positions.filter(p => p.envelope === env && /^Liquidités/.test(p.name));
  assert.deepEqual(liqDe("PEA-PME").map(p => [p.name, p.value]), [["Liquidités PEA-PME", 1500]]);
  assert.deepEqual(liqDe("Compte-titres BoursoBank").map(p => [p.name, p.value]), [["Liquidités Compte-titres BoursoBank", 52.4]]);
  assert.deepEqual(liqDe("PEA").map(p => [p.id, p.value]), [["l-pea-liq", 38.15]], "liquidités du PEA : ligne existante reprise");
  assert.ok(ISINS_PEA.every((_, i) => ligne(`l-pea-${i}`).source_auto === "powens"), "13 lignes PEA reprises par ISIN");
  // Aucune proposition Powens, aucune ligne en double, aucune ligne ou crédit rattaché deux fois.
  assert.deepEqual(T.propositions, []);
  assert.equal(T.positions.filter(p => p.mode === "market").length, 13, "aucune ligne de marché créée");
  const noms = T.positions.filter(p => p.status !== "clôturé").map(p => `${p.envelope}|${p.name}`);
  assert.equal(new Set(noms).size, noms.length, "aucune ligne en double : " + noms.join(", "));
  const rattachees = T.banque_comptes.map(c => c.position_id).filter(Boolean);
  assert.equal(new Set(rattachees).size, rattachees.length);
  assert.equal(T.positions.length, base.positions.length + 5, "5 lignes créées : 2 courants, LDDS, 2 liquidités (PEA-PME, compte-titres) — et rien d'autre");
});

test("cas type, ordre favorable (LCL B avant LCL A) : le courant de LCL A n'est jamais rattaché ni proposé", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const { cxs, base } = casType();
  const db = fausseBase(base, { rpc: rpcBanque() });
  for (const cx of [12, 11]) assert.equal((await S.synchroniser(db, apiMulti(cxs), U, cx, OPTS())).ok, true);
  const k = id => db.tables.banque_comptes.find(c => c.id === id);
  assert.equal(k(1101).doublon_de, 1201);
  assert.equal(k(1101).position_id ?? null, null);
  assert.equal(k(1201).position_id, await S.uuidDeterministe(`powens-cc-${U}-1201`));
  assert.equal(db.tables.banque_connexions.find(c => c.id === 11).doublon_de, 12);
  assert.equal(db.tables.positions.filter(p => p.name === "Compte courant LCL").length, 1);
});

test("rapprochement : jamais d'écrasement — compte rattaché par l'utilisateur, ignoré, rattachement automatique retiré, ligne créée puis supprimée", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const { cxs, base } = casType();
  base.banque_comptes = [
    { user_id: U, id: 1202, connexion_id: 12, position_id: "l-indemnite", enveloppe: null, credit_id: null }, // choix de l'utilisateur
    { user_id: U, id: 1203, connexion_id: 12, ignore: true },
    { user_id: U, id: 1201, connexion_id: 12, auto_retire_le: "2026-10-11T00:00:00Z" },
  ];
  const db = fausseBase(base, { rpc: rpcBanque() });
  assert.equal((await S.synchroniser(db, apiMulti(cxs), U, 12, OPTS())).ok, true);
  const k = id => db.tables.banque_comptes.find(c => c.id === id);
  assert.equal(k(1202).position_id, "l-indemnite", "choix de l'utilisateur gardé");
  assert.equal(k(1203).credit_id ?? null, null, "compte ignoré : jamais rattaché");
  assert.equal(k(1201).position_id ?? null, null, "rattachement automatique retiré par l'utilisateur : jamais refait");
  assert.equal(db.tables.positions.filter(p => p.name === "Compte courant LCL").length, 0, "rien créé");
  assert.deepEqual(db.tables.propositions, [], "ni proposition");
  // Ligne créée automatiquement puis supprimée par l'utilisateur (la clé étrangère a vidé position_id, rattache_auto reste) : pas recréée.
  const db2 = fausseBase(casType().base, { rpc: rpcBanque() });
  await S.synchroniser(db2, apiMulti(cxs), U, 13, OPTS());
  const id = await S.uuidDeterministe(`powens-cc-${U}-1301`);
  db2.tables.positions = db2.tables.positions.filter(p => p.id !== id);
  db2.tables.banque_comptes.find(c => c.id === 1301).position_id = null;
  await S.synchroniser(db2, apiMulti(cxs), U, 13, OPTS());
  assert.ok(!db2.tables.positions.some(p => p.id === id), "ligne supprimée par l'utilisateur jamais recréée");
});

test("rapprochement : plusieurs candidats → aucune création ni rattachement, une suggestion (la plus proche) ; rattachement concurrent → suggestion, ligne retirée", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const { cxs, base } = casType();
  base.positions.push({ id: "l-livret-a-2", user_id: U, name: "Livret A Sam", envelope: "Livrets", owner: "p2", mode: "manual", value: 9000, status: "actif" });
  base.credits.push({ id: "k-etudiant-2", user_id: U, nom: "Prêt étudiant 2", crd: 3264 });
  base.positions.push({ id: "l-cc-1", user_id: U, name: "Compte courant LCL perso", envelope: "Comptes courants", mode: "manual", value: 1, status: "actif" },
    { id: "l-cc-2", user_id: U, name: "LCL compte courant joint", envelope: "Comptes courants", mode: "manual", value: 30, status: "actif" });
  const db = fausseBase(base, { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiMulti(cxs), U, 12, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const k = id => db.tables.banque_comptes.find(c => c.id === id);
  assert.deepEqual(J(k(1202).suggestion), { type: "ligne", id: "l-livret-a-2", libelle: "Livret A Sam · Livrets", raison: "2 lignes possibles pour ce Livret A : la plus proche du solde est proposée." });
  assert.equal(k(1202).position_id ?? null, null);
  assert.equal(k(1203).suggestion.type, "credit");
  assert.equal(k(1203).suggestion.id, "k-etudiant", "montant le plus proche");
  assert.equal(k(1201).suggestion.id, "l-cc-2", "solde le plus proche");
  assert.equal(db.tables.positions.filter(p => /^Compte courant LCL$/.test(p.name)).length, 0, "aucune création");
  assert.equal(r.suggestions, 3);
  // Rattachement posé par l'utilisateur pendant la synchronisation : la mise à jour conditionnelle ne trouve rien, la ligne créée est retirée.
  const { cxs: c2, base: b2 } = casType();
  const db2 = fausseBase(b2, { rpc: rpcBanque() });
  // L'utilisateur rattache le courant juste avant l'écriture du rattachement automatique.
  const from = db2.from;
  db2.from = t => {
    const b = from(t);
    if (t !== "banque_comptes") return b;
    const update = b.update;
    b.update = v => { if (v && v.rattache_auto && v.position_id) db2.tables.banque_comptes.find(c => c.id === 1301).position_id = "l-indemnite"; return update(v); };
    return b;
  };
  const r2 = await S.synchroniser(db2, apiMulti(c2), U, 13, OPTS());
  const idCc = await S.uuidDeterministe(`powens-cc-${U}-1301`);
  assert.ok(!db2.tables.positions.some(p => p.id === idCc), "ligne créée pour l'occasion retirée");
  assert.equal(db2.tables.banque_comptes.find(c => c.id === 1301).position_id, "l-indemnite", "choix concurrent gardé");
  assert.ok(r2.notes.some(n => /1301/.test(n)), JSON.stringify(r2.notes));
});

test("rapprochement : enveloppes — PEA-PME jamais dans « PEA » (et inversement), part d'ISIN ≥ 50 %, foyer de deux personnes → suggestion du titulaire", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const base = () => ({ comptes: [], lignes: [], credits: [], connexions: [], etatComptes: [], liees: [], idsCourant: {}, idsLivret: {} });
  const E = (comptes, lignes, extra = {}) => ({ ...base(), userId: U, aujourdhui: AUJ, maintenant: MAINTENANT.toISOString(), deuxPersonnes: false,
    connexion: { id: 7, etablissement: "Bourse Test", connecteur: 1 }, comptes, lignes, ...extra });
  const pea = (id, nom, isins) => ({ id, type: "pea", typePowens: "pea", nom, solde: 100, crd: null, actif: true, isins });
  const L = (id, envelope, isin, owner = "p1") => ({ id, user_id: U, name: id, envelope, owner, mode: "market", isin, status: "actif" });
  // PEA-PME avec les ISIN de l'enveloppe « PEA » : jamais dedans ; enveloppe « PEA PME » acceptée.
  let r = S.rapprocher(E([pea(1, "PEA-PME", ["FR0010315770"])], [L("a", "PEA", "FR0010315770")]));
  assert.deepEqual(J(r.comptes[1].auto.patch), { enveloppe: "PEA-PME", titulaire: "p1" }, "nouvelle enveloppe « PEA-PME »");
  assert.equal(r.comptes[1].auto.cree, true);
  r = S.rapprocher(E([pea(1, "PEA PME", ["FR0010315770"])], [L("a", "PEA", "FR0010315770"), L("b", "Pea Pme Sam", "FR0010315770")]));
  assert.deepEqual(J(r.comptes[1].auto.patch), { enveloppe: "Pea Pme Sam", titulaire: "p1" });
  r = S.rapprocher(E([pea(1, "PEA", ["FR0010315770"])], [L("b", "PEA-PME", "FR0010315770")]));
  assert.equal(r.comptes[1].auto, null, "PEA jamais dans « PEA-PME »");
  // Part d'ISIN : 1 sur 3 → non ; 2 sur 3 → oui ; deux enveloppes → suggestion de la meilleure.
  const isins = ["FR0010315770", "IE00B4L5Y983", "LU1681043599"];
  r = S.rapprocher(E([pea(1, "PEA", isins)], [L("a", "PEA", isins[0])]));
  assert.equal(r.comptes[1].auto, null, "1 ISIN sur 3 : moins de 50 %");
  r = S.rapprocher(E([pea(1, "PEA", isins)], [L("a", "PEA", isins[0]), L("b", "PEA", isins[1])]));
  assert.deepEqual(J(r.comptes[1].auto.patch), { enveloppe: "PEA", titulaire: "p1" });
  r = S.rapprocher(E([pea(1, "PEA", isins)], [L("a", "PEA", isins[0]), L("b", "PEA", isins[1]), L("c", "PEA", isins[0], "p2"), L("d", "PEA", isins[1], "p2"), L("e", "PEA", isins[2], "p2")]));
  assert.equal(r.comptes[1].auto, null);
  assert.deepEqual([r.comptes[1].suggestion.type, r.comptes[1].suggestion.enveloppe, r.comptes[1].suggestion.titulaire], ["enveloppe", "PEA", "p2"]);
  // Enveloppe déjà rattachée à un autre compte : exclue.
  r = S.rapprocher(E([pea(1, "PEA", isins)], [L("a", "PEA", isins[0]), L("b", "PEA", isins[1])], { etatComptes: [{ id: 9, connexion_id: 8, enveloppe: "pea", titulaire: "p1" }] }));
  assert.equal(r.comptes[1].auto, null, "enveloppe prise");
  // Foyer de deux personnes (ou inconnu) : pas de création, suggestion du titulaire.
  for (const deux of [true, null]) {
    r = S.rapprocher(E([{ ...pea(1, "Compte titres", []), type: "compte_titres", typePowens: "market" }], [], { deuxPersonnes: deux }));
    assert.equal(r.comptes[1].auto, null);
    assert.deepEqual([r.comptes[1].suggestion.enveloppe, r.comptes[1].suggestion.titulaire], ["Compte-titres Bourse Test", "p1"]);
  }
  // Placements non lus : rien.
  r = S.rapprocher(E([pea(1, "PEA-PME", null)], []));
  assert.equal(r.comptes[1].auto, null);
});

test("rapprochement : livrets (produit par type ou nom, générique), crédits (montant prioritaire, mots significatifs), courants", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const E = (comptes, lignes, extra = {}) => ({ userId: U, aujourdhui: AUJ, maintenant: MAINTENANT.toISOString(), deuxPersonnes: false, connexion: { id: 7, etablissement: "Crédit Mutuel", connecteur: 1 },
    comptes, lignes, credits: [], connexions: [], etatComptes: [], liees: [], idsCourant: { 1: "id-cc" }, idsLivret: { 1: "id-lv" }, ...extra });
  const C = (type, typePowens, nom, solde = 100, crd = null) => ({ id: 1, type, typePowens, nom, solde, crd, actif: true, isins: null });
  const M = (id, name, envelope = "Livrets", value = 1) => ({ id, user_id: U, name, envelope, mode: "manual", value, status: "actif" });
  assert.equal(S.produitLivret("savings", "Livret Développement Durable et Solidaire").nom, "LDDS");
  assert.equal(S.produitLivret("livret_a", "Mon épargne").nom, "Livret A");
  assert.equal(S.produitLivret("savings", "Livret Avenir"), null, "« Livret Avenir » n'est pas un Livret A");
  let r = S.rapprocher(E([C("livret", "savings", "LDD solidaire")], [M("a", "Livret A"), M("b", "LDDS Sam")]));
  assert.equal(r.comptes[1].auto.patch.position_id, "b");
  // Générique : seul candidat d'une enveloppe livret* (hors lignes d'un produit précis) → rattaché ; aucun → ligne créée au nom du compte.
  r = S.rapprocher(E([C("livret", "savings", "Livret Bourso+")], [M("a", "Livret A"), M("b", "Épargne de précaution")]));
  assert.equal(r.comptes[1].auto.patch.position_id, "b");
  r = S.rapprocher(E([C("livret", "savings", "Livret Bourso+")], [M("a", "Livret A")]));
  assert.deepEqual([r.comptes[1].auto.cree, r.comptes[1].auto.ligne.name, r.comptes[1].auto.ligne.envelope, r.comptes[1].auto.ligne.id], [true, "Livret Bourso+", "Livrets", "id-lv"]);
  r = S.rapprocher(E([C("livret", "lep", "LEP")], [M("a", "Livret A", "Épargne réglementée")]));
  assert.deepEqual([r.comptes[1].auto.ligne.name, r.comptes[1].auto.ligne.envelope], ["LEP", "Livrets"], "aucune enveloppe livret* : « Livrets »");
  r = S.rapprocher(E([C("livret", "lep", "LEP")], [M("a", "Livret A", "Livrets Camille")]));
  assert.equal(r.comptes[1].auto.ligne.envelope, "Livrets Camille", "enveloppe livret unique de l'utilisateur");
  // Ligne déjà rattachée à un autre compte ou liée à un placement : jamais visée.
  r = S.rapprocher(E([C("livret", "livret_a", "LIVRET A")], [M("a", "Livret A")], { etatComptes: [{ id: 2, connexion_id: 8, position_id: "a" }] }));
  assert.equal(r.comptes[1].auto.cree, true, "Livret A pris : nouvelle ligne");
  r = S.rapprocher(E([C("livret", "livret_a", "LIVRET A")], [M("a", "Livret A")], { liees: ["a"] }));
  assert.equal(r.comptes[1].auto.cree, true);
  // Crédits.
  const K = (id, nom, crd) => ({ id, nom, crd });
  r = S.rapprocher(E([C("credit", "loan", "PRET", -3264.18, 3264.18)], [], { credits: [K("x", "Prêt immo", 90000), K("y", "Prêt étudiant", 3270)] }));
  assert.equal(r.comptes[1].auto.patch.credit_id, "y", "montant à 1 % près");
  r = S.rapprocher(E([C("credit", "loan", "PRET AUTO", -5000)], [], { credits: [K("x", "Prêt immo", 90000), K("y", "Crédit voiture", 7000)] }));
  assert.equal(r.comptes[1].auto.patch.credit_id, "y", "mot significatif (auto ↔ voiture), « prêt » seul ne suffit pas");
  r = S.rapprocher(E([C("credit", "loan", "PRET", -5000)], [], { credits: [K("x", "Prêt immo", 90000), K("y", "Prêt auto", 7000)] }));
  assert.equal(r.comptes[1].auto, null, "« prêt » seul : deux candidats");
  assert.equal(r.comptes[1].suggestion.id, "y");
  r = S.rapprocher(E([C("credit", "loan", "PRET ETUDIANT", -3264.18)], [], { credits: [K("y", "Prêt étudiant", 3264.18)], etatComptes: [{ id: 2, connexion_id: 8, credit_id: "y" }] }));
  assert.equal(r.comptes[1].auto, null, "crédit déjà rattaché : jamais visé");
  // Courants : ligne existante (établissement + « courant »), sinon création ; jamais une ligne d'un autre établissement.
  r = S.rapprocher(E([C("courant", "checking", "CCP")], [M("a", "Compte courant Crédit Mutuel", "Comptes courants"), M("b", "Compte courant LCL", "Comptes courants")]));
  assert.equal(r.comptes[1].auto.patch.position_id, "a");
  r = S.rapprocher(E([C("courant", "checking", "CCP")], [M("b", "Compte courant LCL", "Comptes courants")]));
  assert.deepEqual([r.comptes[1].auto.ligne.name, r.comptes[1].auto.ligne.envelope, r.comptes[1].auto.ligne.bloc, r.comptes[1].auto.ligne.owner, r.comptes[1].auto.ligne.source_auto],
    ["Compte courant Crédit Mutuel", "Comptes courants", "Comptes courants", "p1", "powens"]);
  // Compte inactif, ignoré, déjà rattaché : rien.
  r = S.rapprocher(E([{ ...C("courant", "checking", "CCP"), actif: false }], []));
  assert.equal(r.comptes[1].auto, null);
  r = S.rapprocher(E([C("courant", "checking", "CCP")], [], { etatComptes: [{ id: 1, connexion_id: 7, ignore: true }] }));
  assert.equal(r.comptes[1].auto, null);
});

test("rapprochement : proposition « créer une ligne » encore en attente d'un compte rattaché automatiquement ou en double → retirée ; décidée → gardée", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const { cxs, base } = casType();
  const lot = async id => S.lotProposition(U, id);
  base.propositions = [
    { id: "prop-1201", user_id: U, lot: await lot(1201), cible: "position", operation: "creer", statut: "en_attente", apres: { name: "COMPTE COURANT" } },
    { id: "prop-1101", user_id: U, lot: await lot(1101), cible: "position", operation: "creer", statut: "en_attente", apres: { name: "COMPTE COURANT" } },
    { id: "prop-1202", user_id: U, lot: await lot(1202), cible: "position", operation: "creer", statut: "refusee", decide_le: "2026-10-01T00:00:00Z", apres: { name: "LIVRET A" } },
  ];
  const db = fausseBase(base, { rpc: rpcBanque() });
  for (const cx of [11, 12]) assert.equal((await S.synchroniser(db, apiMulti(cxs), U, cx, OPTS())).ok, true);
  assert.deepEqual(db.tables.propositions.map(p => p.id), ["prop-1202"], "en attente : retirées (courant rattaché automatiquement, courant en double) ; refusée : gardée");
  for (const e of db.journal.filter(e => e.table === "propositions" && e.op === "delete"))
    assert.ok(e.filtres.some(([k, op, v]) => k === "statut" && v === "en_attente") && e.filtres.some(([k, , v]) => k === "user_id" && v === U));
});

/* ---------- virements internes (CP1 § 5, correctifs I1 / I9) ---------- */
const KV = [
  { id: 1, connexion_id: 7, type: "courant" }, { id: 2, connexion_id: 7, type: "livret" }, { id: 3, connexion_id: 8, type: "courant" },
  { id: 4, connexion_id: 7, type: "courant", debit_differe: true }, { id: 5, connexion_id: 8, type: "courant", ignore: true },
  { id: 6, connexion_id: 9, type: "courant", doublon_de: 1 }, { id: 7, connexion_id: 8, type: "pea" }, { id: 8, connexion_id: 8, type: "autre" },
];
const opv = (id, compte_id, date, montant, categorie = "divers", libelle = "VIR", type_powens = null) => ({ id, compte_id, date, montant, categorie, libelle, type_powens });

test("rapprocherVirements : montant opposé à 0,01 €, comptes différents, ≤ 3 jours, un pour un (le plus proche), épargne côté courant (sorties et retours)", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const ops = [
    opv(10, 1, "2026-09-10", -500), opv(11, 2, "2026-09-11", 500, "epargne"),       // courant → livret : épargne / virement interne
    opv(12, 2, "2026-09-15", -200), opv(13, 1, "2026-09-15", 200),                  // livret → courant : virement interne / retour d'épargne (I9)
    opv(14, 1, "2026-09-01", -100), opv(15, 3, "2026-09-03", 100), opv(16, 3, "2026-09-04", 100), // un pour un : le plus proche
    opv(17, 1, "2026-08-01", -50), opv(18, 3, "2026-08-05", 50),                    // 4 jours : non
    opv(19, 1, "2026-08-10", -70), opv(20, 3, "2026-08-10", 70.02),                 // 0,02 € : non
    opv(21, 1, "2026-08-12", -80), opv(22, 3, "2026-08-12", 80.01),                 // 0,01 € : oui
    opv(23, 1, "2026-08-20", -300), opv(24, 1, "2026-08-20", 300),                  // même compte : non
    opv(25, 1, "2026-08-25", -1500), opv(26, 4, "2026-08-25", 1500),                // carte à débit différé : non
    opv(27, 1, "2026-07-20", -40), opv(28, 5, "2026-07-20", 40),                    // compte ignoré : non
    opv(29, 1, "2026-07-21", -60), opv(30, 6, "2026-07-21", 60),                    // compte en double : non
    opv(31, 1, "2026-07-25", -1000), opv(32, 7, "2026-07-26", 1000),                // courant → PEA : épargne
    opv(33, 8, "2026-07-27", -90), opv(34, 1, "2026-07-27", 90),                    // autre → courant : virement interne
  ];
  const r = S.rapprocherVirements(ops, KV);
  assert.deepEqual(J(r.categories), {
    10: "epargne", 11: "virement_interne", 12: "virement_interne", 13: "epargne", 14: "virement_interne", 15: "virement_interne",
    21: "virement_interne", 22: "virement_interne", 31: "epargne", 32: "virement_interne", 33: "virement_interne", 34: "virement_interne",
  });
  assert.deepEqual(J(r.paires).map(p => p.join("-")).sort(), ["10-11", "12-13", "14-15", "21-22", "31-32", "33-34"].sort());
  assert.deepEqual(J(r.contreparties), { 10: 11, 11: 10, 12: 13, 13: 12, 14: 15, 15: 14, 21: 22, 22: 21, 31: 32, 32: 31, 33: 34, 34: 33 }, "trace de l'appariement");
  // recalcul idempotent : relancé sur les mêmes catégories de départ → même résultat
  assert.deepEqual(J(S.rapprocherVirements(ops, KV)), J(r));
  // ordre des opérations sans effet ; montants en texte (numeric) tolérés
  const r2 = S.rapprocherVirements([...ops].reverse().map(o => ({ ...o, montant: String(o.montant) })), KV);
  assert.deepEqual(J(r2.categories), J(r.categories));
  // compte inconnu : écarté
  assert.deepEqual(J(S.rapprocherVirements([opv(1, 1, "2026-09-01", -5), opv(2, 99, "2026-09-01", 5)], KV).categories), {});
});

test("rapprocherVirements (I1) : indice de virement exigé d'un côté au moins ; cartes, prélèvements, revenus et dépenses catégorisées par Powens exclus", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const paire = (d, e) => J(S.rapprocherVirements([d, e], KV).paires).length === 1;
  // faux positifs de la relecture
  assert.equal(paire(opv(1, 1, "2026-09-28", 2500, "revenus", "VIR SALAIRE ACME"), opv(2, 3, "2026-09-28", -2500, "logement", "PRLV LOYER")), false, "salaire sur A / loyer sur B");
  assert.equal(paire(opv(1, 1, "2026-09-12", -40, "loisirs", "CB RESTO"), opv(2, 3, "2026-09-12", 40, "divers", "VIR LYDIA REMBOURSEMENT")), false, "carte / remboursement Lydia");
  // carte reconnue au libellé (CB, CARTE, PAIEMENT PAR CARTE) ou au type Powens, même sans catégorie
  for (const [lib, type] of [["CB RESTO", null], ["CARTE 12/09 RESTO", null], ["PAIEMENT PAR CARTE RESTO", null], ["RESTO", "card"], ["RESTO", "deferred_card"]])
    assert.equal(paire(opv(1, 1, "2026-09-12", -40, "divers", lib, type), opv(2, 3, "2026-09-12", 40, "divers", "VIR M DUPONT")), false, "carte : " + lib + " / " + type);
  // prélèvement (libellé ou type order) : jamais un virement entre ses comptes
  assert.equal(paire(opv(1, 1, "2026-09-05", -700, "divers", "PRLV SEPA ABC"), opv(2, 3, "2026-09-05", 700, "divers", "VIR RECU")), false, "prélèvement");
  assert.equal(paire(opv(1, 1, "2026-09-05", -700, "divers", "ABC", "order"), opv(2, 3, "2026-09-05", 700, "divers", "VIR RECU")), false, "prélèvement (type)");
  // aucun indice : non ; indice d'un seul côté (libellé ou type transfer) : oui
  assert.equal(paire(opv(1, 1, "2026-09-05", -300, "divers", "M DUPONT"), opv(2, 3, "2026-09-05", 300, "divers", "DEPOT")), false, "aucun indice");
  for (const lib of ["VIR SEPA M DUPONT", "VIREMENT M DUPONT", "TRANSFERT M DUPONT", "VIR INST M DUPONT", "VIR.PERMANENT DUPONT"])
    assert.equal(paire(opv(1, 1, "2026-09-05", -300, "divers", lib), opv(2, 3, "2026-09-05", 300, "divers", "DEPOT")), true, "indice : " + lib);
  assert.equal(paire(opv(1, 1, "2026-09-05", -300, "divers", "M DUPONT", "transfer"), opv(2, 3, "2026-09-05", 300, "divers", "DEPOT")), true, "type Powens transfer");
  // catégorie Powens : revenus ou dépense d'un côté → non ; divers et épargne → oui
  assert.equal(paire(opv(1, 1, "2026-09-05", -300, "divers"), opv(2, 3, "2026-09-05", 300, "revenus")), false);
  assert.equal(paire(opv(1, 1, "2026-09-05", -300, "alimentation"), opv(2, 3, "2026-09-05", 300, "divers")), false);
  assert.equal(paire(opv(1, 1, "2026-09-05", -300, "epargne"), opv(2, 2, "2026-09-05", 300, "epargne")), true);
});

test("preparerOperations : recalcul idempotent depuis la catégorie Powens — appariement tracé, défait quand la contrepartie disparaît ou n'est plus valide", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const pass = [{ ...opv(1, 1, "2026-09-05", -300, "divers", "VIR VERS JOINT"), categorie_powens: "divers" }];
  const enBase = [{ ...opv(2, 3, "2026-09-05", 300, "divers", "VIR DE M"), categorie_powens: "divers", contrepartie_id: null }];
  let p = S.preparerOperations(pass, [], enBase, KV, null);
  assert.deepEqual(J(p.operations.map(o => [o.id, o.categorie, o.categorie_powens, o.contrepartie_id])), [[1, "virement_interne", "divers", 2]]);
  assert.deepEqual(J(p.autres), [{ categorie: "virement_interne", contrepartie_id: 1, ids: [2] }], "contrepartie d'un autre compte : catégorie et trace");
  assert.equal(p.depuis, "2026-09-05"); assert.equal(p.virements, 1);
  // second passage, base à jour : rien ne change
  const enBase2 = [{ ...enBase[0], categorie: "virement_interne", contrepartie_id: 1 }, { ...p.operations[0] }];
  p = S.preparerOperations(pass, [], enBase2, KV, null);
  assert.deepEqual(J(p.autres), []); assert.equal(p.virements, 0); assert.equal(p.depuis, null);
  // contrepartie retirée chez Powens : l'opération restante retrouve sa catégorie Powens, sans trace
  p = S.preparerOperations([], [1], enBase2, KV, null);
  assert.deepEqual(J(p.autres), [{ categorie: "divers", contrepartie_id: null, ids: [2] }]);
  assert.equal(p.depuis, "2026-09-05", "mois de l'opération défaite recalculé");
  // appariement devenu invalide (Powens reclasse la sortie en loyer) : défait des deux côtés
  p = S.preparerOperations([{ ...pass[0], categorie: "logement", categorie_powens: "logement" }], [], enBase2, KV, null);
  assert.deepEqual(J(p.operations.map(o => [o.categorie, o.contrepartie_id])), [["logement", null]]);
  assert.deepEqual(J(p.autres), [{ categorie: "divers", contrepartie_id: null, ids: [2] }]);
  // opération écrite avant la migration 0025 (sans categorie_powens) : « virement_interne » sans contrepartie → « divers »
  p = S.preparerOperations([], [], [{ ...opv(5, 1, "2026-09-01", -12, "virement_interne", "VIR"), contrepartie_id: null }], KV, null);
  assert.deepEqual(J(p.autres), [{ categorie: "divers", contrepartie_id: null, ids: [5] }]);
  assert.equal(S.categorieDeBase({ categorie: "virement_interne" }), "divers");
  assert.equal(S.categorieDeBase({ categorie: "epargne" }), "epargne");
  assert.equal(S.categorieDeBase({ categorie: "virement_interne", categorie_powens: "revenus" }), "revenus");
  assert.equal(S.categorieDeBase({}), "divers");
});

test("synchroniser : virements internes rapprochés sur toutes les connexions, trace et catégorie Powens écrites, autres comptes mis à jour, mois recalculés", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const base = baseInitiale(J(RATTACHES));
  base.banque_connexions = [{ user_id: U, id: 8, etablissement: "Autre Banque", connecteur: 99 }];
  base.banque_comptes.push({ user_id: U, id: 201, connexion_id: 8, nom: "Compte joint", type: "courant", actif: true });
  base.banque_operations = [
    { user_id: U, id: 7001, compte_id: 201, date: "2026-09-29", montant: 250, libelle: "VIR DE M", categorie: "divers", categorie_powens: "divers" },
    { user_id: U, id: 7002, compte_id: 201, date: "2026-06-01", montant: -10, libelle: "ANCIENNE", categorie: "divers" },
  ];
  const operations = {
    101: [
      { id: 9101, date: "2026-10-01", value: -250, simplified_wording: "VIR VERS JOINT", categories: [{ code: "transfers" }], type: "transfer", coming: false, deleted: null },
      { id: 9102, date: "2026-10-05", value: -400, simplified_wording: "VIR LIVRET A", categories: [{ code: "transfers" }], coming: false, deleted: null },
      { id: 9103, date: "2026-10-08", value: 150, simplified_wording: "VIR DU LIVRET", categories: [{ code: "transfers" }], coming: false, deleted: null },
    ],
    102: [
      { id: 9201, date: "2026-10-06", value: 400, simplified_wording: "VIR DU COMPTE", categories: [{ code: "savings" }], coming: false, deleted: null },
      { id: 9202, date: "2026-10-08", value: -150, simplified_wording: "RETRAIT LIVRET", categories: [{ code: "savings_disposal" }], coming: false, deleted: null },
    ],
  };
  const db = fausseBase(base, { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const op = id => db.tables.banque_operations.find(o => o.id === id);
  const cat = id => op(id).categorie;
  assert.equal(cat(9101), "virement_interne"); assert.equal(cat(7001), "virement_interne", "autre connexion : mise à jour");
  assert.deepEqual([op(9101).contrepartie_id, op(7001).contrepartie_id, op(9101).type_powens, op(9101).categorie_powens], [7001, 9101, "transfer", "divers"]);
  assert.equal(cat(9102), "epargne", "courant → livret : épargne côté courant"); assert.equal(cat(9201), "virement_interne");
  assert.equal(op(9201).categorie_powens, "epargne", "catégorie Powens gardée pour être restaurée");
  assert.equal(cat(9103), "epargne", "livret → courant : retour d'épargne côté courant (épargne nette)"); assert.equal(cat(9202), "virement_interne");
  assert.equal(cat(7002), "divers", "hors 90 jours : jamais lue");
  assert.equal(r.virements_internes, 3);
  const lecture = db.journal.find(e => e.table === "banque_operations" && e.op === "select");
  assert.ok(lecture.filtres.some(([k, , v]) => k === "user_id" && v === U) && lecture.filtres.some(([k, op, v]) => k === "date" && op === "gte" && v === "2026-07-14"));
  for (const e of db.journal.filter(e => e.table === "banque_operations" && e.op === "update")) assert.ok(e.filtres.some(([k, , v]) => k === "user_id" && v === U));
  const rec = db.journal.filter(e => e.rpc === "banque_recalculer_mois");
  assert.deepEqual(J(rec.map(e => e.args)), [{ p_user: U, p_depuis: "2026-09-01" }], "mois de l'opération de l'autre compte compris, un seul recalcul");
  // idempotent
  const avant = J(db.tables.banque_operations);
  const r2 = await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(r2.ok, true);
  assert.deepEqual(J(db.tables.banque_operations).sort((a, b) => a.id - b.id), avant.sort((a, b) => a.id - b.id));
  assert.equal(r2.virements_internes, 0, "rien à changer au second passage");
  // contrepartie disparue (purgée) : retour à la catégorie Powens, trace effacée, mois recalculé
  db.tables.banque_operations = db.tables.banque_operations.filter(o => o.id !== 7001);
  db.journal.length = 0;
  await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.deepEqual([cat(9101), op(9101).contrepartie_id], ["divers", null], "contrepartie disparue : appariement défait");
  assert.deepEqual(J(db.journal.filter(e => e.rpc === "banque_recalculer_mois").map(e => e.args.p_depuis)), ["2026-10-01"], "mois de l'opération défaite recalculé");
});

test("synchroniser : lecture des opérations existantes en échec → opérations non écrites (catégories préservées), noté", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const db = fausseBase(baseInitiale(J(RATTACHES)), { rpc: RPC, echec: (t, op) => (t === "banque_operations" && op === "select" ? "panne" : null) });
  const r = await S.synchroniser(db, apiFactice(), U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.some(e => /opérations/.test(e.erreur) && /panne/.test(e.erreur)), JSON.stringify(r.erreurs));
  assert.equal(db.tables.banque_operations.length, 0);
  assert.equal(db.tables.banque_comptes.find(c => c.id === 102).position_id, "pos-livret", "le reste est appliqué");
});

test("synchroniser : opérations existantes lues par pages (identifiant croissant) jusqu'à une page vide, même si l'API plafonne sous 1000", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const base = baseInitiale(J(RATTACHES));
  base.banque_operations = Array.from({ length: 2300 }, (_, i) => ({ user_id: U, id: 100000 + i, compte_id: 101, date: "2026-09-02", montant: -1, libelle: "X", categorie: "divers" }));
  base.banque_operations.push({ user_id: U, id: 200000, compte_id: 101, date: "2026-09-30", montant: -77, libelle: "VIR", categorie: "divers" });
  const operations = { 101: [], 102: [{ id: 9201, date: "2026-10-01", value: 77, simplified_wording: "VIR", coming: false, deleted: null }] };
  let db = fausseBase(base, { rpc: rpcBanque() });
  await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(db.tables.banque_operations.find(o => o.id === 200000).categorie, "epargne", "opération de la 3e page rapprochée");
  let pages = db.journal.filter(e => e.table === "banque_operations" && e.op === "select");
  assert.deepEqual(J(pages.map(p => p.filtres.find(([k]) => k === "id")?.[2] ?? null)), [null, 101000, 102000, 200001], "jusqu'à une page vide");
  // API plafonnée à 500 lignes par requête : une page de 500 (< 1000 demandées) n'arrête pas la lecture
  db = fausseBase(base, { rpc: rpcBanque(), plafond: 500 });
  await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(db.tables.banque_operations.find(o => o.id === 200000).categorie, "epargne", "dernière opération lue malgré le plafond");
  pages = db.journal.filter(e => e.table === "banque_operations" && e.op === "select");
  assert.equal(pages.length, 6);
});

/* ---------- revenus détectés (CP1 § 5) ---------- */
const sal = (id, date, montant, compte_id = 1, libelle = "VIR SALAIRE ACME " + date.slice(5, 7), categorie = "revenus") => ({ id, compte_id, date, montant, libelle, categorie });

test("revenusDetectes : entrée récurrente du courant, 2 mois sur 3 au moins, ±15 % ; salaireNetMensuel comme l'app", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const AUJ_R = "2026-10-12";
  let d = S.revenusDetectes([sal(1, "2026-07-28", 3000), sal(2, "2026-08-28", 3100), sal(3, "2026-09-28", 2950), sal(4, "2026-10-01", 9999)], KV, AUJ_R);
  assert.deepEqual(J(d), { cle: "vir salaire acme", moyenne: 3016.67, mois: [{ mois: "2026-07-01", montant: 3000 }, { mois: "2026-08-01", montant: 3100 }, { mois: "2026-09-01", montant: 2950 }] },
    "mois en cours écarté");
  d = S.revenusDetectes([sal(1, "2026-08-28", 3000), sal(3, "2026-09-28", 3300)], KV, AUJ_R);
  assert.equal(d.moyenne, 3150, "2 mois sur 3 suffisent");
  assert.equal(S.revenusDetectes([sal(1, "2026-08-28", 3000), sal(3, "2026-09-28", 2000)], KV, AUJ_R), null, "montant instable");
  assert.equal(S.revenusDetectes([sal(1, "2026-09-28", 3000)], KV, AUJ_R), null, "un seul mois");
  assert.equal(S.revenusDetectes([sal(1, "2026-08-28", 3000, 2), sal(3, "2026-09-28", 3000, 2)], KV, AUJ_R), null, "livret : pas un compte courant");
  assert.equal(S.revenusDetectes([sal(1, "2026-08-28", 3000, 6), sal(3, "2026-09-28", 3000, 6)], KV, AUJ_R), null, "compte en double");
  assert.equal(S.revenusDetectes([sal(1, "2026-08-28", 3000, 1, "VIR", "virement_interne"), sal(3, "2026-09-28", 3000, 1, "VIR", "virement_interne")], KV, AUJ_R), null, "virement interne");
  assert.equal(S.revenusDetectes([sal(1, "2026-08-28", -3000), sal(3, "2026-09-28", -3000)], KV, AUJ_R), null, "sorties");
  // plusieurs entrées récurrentes : la plus grande ; libellés identiques une fois nettoyés (chiffres, casse, accents)
  d = S.revenusDetectes([sal(1, "2026-08-05", 120, 1, "CAF 08"), sal(2, "2026-09-05", 120, 1, "Caf 09"), sal(3, "2026-08-28", 2500, 1, "VIR Salaire Nova 0826"), sal(4, "2026-09-28", 2500, 1, "vir salaire nova 0926")], KV, AUJ_R);
  assert.equal(d.cle, "vir salaire nova");
  assert.equal(S.cleLibelle("VIR Salaire Nová 0826"), "vir salaire nova");
  assert.equal(S.salaireNetMensuel({ salaire: 2500 }), 2500);
  assert.equal(S.salaireNetMensuel({ salaire: 36000, salaireUnite: "na" }), 3000);
  assert.equal(S.salaireNetMensuel({ salaire: 4000, salaireUnite: "bm", statut: "cadre" }), 3000);
  assert.equal(S.salaireNetMensuel({ salaire: 48000, salaireUnite: "ba" }), 3120);
  assert.equal(S.salaireNetMensuel(null), 0);
});

test("propositionRevenus : écart > 10 % → proposition profil (salaire net mensuel arrondi), sinon rien ; jamais appliquée", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const det = { cle: "vir salaire acme", moyenne: 3016.67, mois: [{ mois: "2026-08-01", montant: 3100 }, { mois: "2026-09-01", montant: 2933.33 }] };
  const ids = { userId: U, id: "id-r", lot: "lot-r" };
  const p = S.propositionRevenus(det, { personnes: { p1: { nom: "Moi", salaire: 2500, salaireUnite: "nm" } } }, ids);
  assert.deepEqual(J({ ...p, justification: undefined }), {
    id: "id-r", user_id: U, lot: "lot-r", cible: "profil", operation: "modifier",
    avant: { personnes: { p1: { salaire: 2500 } } }, apres: { personnes: { p1: { salaire: 3017 } } }, source: "Powens — revenus détectés",
  });
  assert.equal(S.SOURCE_REVENUS, "Powens — revenus détectés");
  assert.match(p.justification, /août 2026 : 3 100,00 €/); assert.match(p.justification, /septembre 2026 : 2 933,33 €/);
  assert.match(p.justification, /3 017 €/); assert.match(p.justification, /2 500 €/); assert.match(p.justification, /\+21 %/);
  assert.doesNotMatch(p.justification, /acme/i, "jamais le libellé bancaire");
  assert.doesNotMatch(p.justification, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu);
  assert.ok(p.justification.length <= 1000);
  // unité convertie : salaire brut annuel → net mensuel déclaré
  const q = S.propositionRevenus(det, { personnes: { p1: { salaire: 30000, salaireUnite: "ba", statut: "cadre" } } }, ids);
  assert.deepEqual(J(q.avant), { personnes: { p1: { salaire: 30000, salaireUnite: "ba" } } });
  assert.deepEqual(J(q.apres), { personnes: { p1: { salaire: 3017, salaireUnite: "nm" } } });
  // profil vide : proposé ; écart ≤ 10 % : rien
  assert.deepEqual(J(S.propositionRevenus(det, null, ids).apres), { personnes: { p1: { salaire: 3017, salaireUnite: "nm" } } });
  assert.equal(S.propositionRevenus(det, { personnes: { p1: { salaire: 2800 } } }, ids), null, "écart de 7,7 %");
  assert.equal(S.propositionRevenus(det, { personnes: { p1: { salaire: 36000, salaireUnite: "na" } } }, ids), null);
  assert.equal(S.propositionRevenus(null, { personnes: {} }, ids), null);
});

test("revenusDetectes (I6) : noms de mois retirés du libellé ; « VIR » d'une personne du foyer et compte commun exclus", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const AUJ_R = "2026-10-12";
  for (const [a, b] of [["VIR SALAIRE ACME SEPTEMBRE 2026", "vir salaire acme"], ["Salaire Acme Août", "salaire acme"], ["SALAIRE ACME AOUT", "salaire acme"],
    ["PRLV EDF JANV FEVR MARS AVR MAI JUIN JUIL SEPT OCT NOV DEC", "prlv edf"], ["Loyer Décembre", "loyer"], ["LOYER FÉV", "loyer"], ["VIR JULIE", "vir julie"]])
    assert.equal(S.cleLibelle(a), b, a);
  let d = S.revenusDetectes([sal(1, "2026-07-28", 3000, 1, "SALAIRE ACME JUILLET"), sal(2, "2026-08-28", 3100, 1, "SALAIRE ACME AOÛT"), sal(3, "2026-09-28", 2950, 1, "SALAIRE ACME SEPT")], KV, AUJ_R);
  assert.equal(d.cle, "salaire acme"); assert.equal(d.mois.length, 3, "un seul groupe malgré le mois dans le libellé");
  // virement reçu d'une personne du foyer : jamais un salaire
  const vir = [sal(1, "2026-08-28", 2000, 1, "VIR CAMILLE DUPONT", "divers"), sal(2, "2026-09-28", 2000, 1, "VIR CAMILLE DUPONT", "divers")];
  assert.equal(S.revenusDetectes(vir, KV, AUJ_R, { noms: [["camille"]] }), null);
  assert.equal(S.revenusDetectes(vir, KV, AUJ_R).cle, "vir camille dupont", "sans nom du foyer connu : gardé");
  // compte de titulaire commun (titulaire « commun », nom « joint » ou « commun », ligne rattachée commune) : écarté
  const ops = [sal(1, "2026-08-28", 3000, 9), sal(2, "2026-09-28", 3000, 9)];
  for (const k of [{ titulaire: "commun" }, { nom: "Compte joint" }, { nom: "CPT COMMUN M ET MME" }, { commun: true }])
    assert.equal(S.revenusDetectes(ops, [...KV, { id: 9, connexion_id: 7, type: "courant", ...k }], AUJ_R), null, JSON.stringify(k));
  assert.ok(S.revenusDetectes(ops, [...KV, { id: 9, connexion_id: 7, type: "courant", nom: "Compte perso" }], AUJ_R));
});

test("propositionRevenus (I6) : comparée à p1 et p2, proposée pour la personne la plus proche, abstention si ambigu", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const ids = { userId: U, id: "id-r", lot: "lot-r" };
  const det = m => ({ cle: "vir salaire", moyenne: m, mois: [{ mois: "2026-08-01", montant: m }, { mois: "2026-09-01", montant: m }] });
  const couple = { foyer: { adultes: 2 }, personnes: { p1: { nom: "Hélène", salaire: 2500 }, p2: { nom: "Camille", salaire: 3200 } } };
  assert.equal(S.propositionRevenus(det(3016.67), couple, ids), null, "à 10 % du salaire de p2 : rien à proposer");
  assert.equal(S.propositionRevenus(det(2600), couple, ids), null, "à 10 % du salaire de p1");
  let p = S.propositionRevenus(det(2000), couple, ids);
  assert.deepEqual(J([p.avant, p.apres]), [{ personnes: { p1: { salaire: 2500 } } }, { personnes: { p1: { salaire: 2000 } } }], "p1 nettement plus proche");
  p = S.propositionRevenus(det(4000), couple, ids);
  assert.deepEqual(J(p.apres), { personnes: { p2: { salaire: 4000 } } }, "p2 nettement plus proche");
  assert.match(p.justification, /Camille/); assert.doesNotMatch(p.justification, /ton salaire/);
  assert.equal(S.propositionRevenus(det(2850), couple, ids), null, "14 % de p1, 11 % de p2 : ambigu, abstention");
  assert.equal(S.propositionRevenus(det(3017), { foyer: { adultes: 2 }, personnes: { p1: { salaire: 2500 }, p2: {} } }, ids), null, "p2 sans salaire : ambigu");
  assert.equal(S.propositionRevenus(det(3017), { foyer: { adultes: 2 }, personnes: {} }, ids), null, "aucun salaire dans un couple : ambigu");
  assert.deepEqual(J(S.propositionRevenus(det(3017), { foyer: { adultes: 1 }, personnes: { p1: { salaire: 2500 }, p2: { salaire: 3000 } } }, ids).apres),
    { personnes: { p1: { salaire: 3017 } } }, "foyer d'une personne : p1");
});

test("synchroniser : revenus détectés → une proposition profil, lot déterministe, jamais deux en attente, jamais appliquée", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const base = baseInitiale(J(RATTACHES));
  base.profiles = [{ user_id: U, foyer: { adultes: 1 }, personnes: { p1: { nom: "Moi", salaire: 2500, salaireUnite: "nm" } } }];
  base.banque_operations = [
    { user_id: U, id: 8001, compte_id: 101, date: "2026-07-28", montant: 3000, libelle: "VIR SALAIRE ACME 07", categorie: "revenus" },
    { user_id: U, id: 8002, compte_id: 101, date: "2026-08-28", montant: 3100, libelle: "VIR SALAIRE ACME 08", categorie: "revenus" },
  ];
  const operations = { 101: [{ id: 9301, date: "2026-09-28", value: 2950, simplified_wording: "VIR SALAIRE ACME 09", categories: [{ code: "salary" }], coming: false, deleted: null }] };
  const lot = await S.lotRevenus(U, "vir salaire acme", "2026-09-01");
  base.propositions = [
    { id: "ancienne", user_id: U, lot: "lot-ancien", cible: "profil", operation: "modifier", statut: "en_attente", source: "Powens — revenus détectés", apres: { personnes: { p1: { salaire: 2900 } } } },
    { id: "autre-source", user_id: U, lot: "lot-x", cible: "profil", operation: "modifier", statut: "en_attente", source: "Claude", apres: { foyer: { adultes: 1 } } },
  ];
  const db = fausseBase(base, { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const props = db.tables.propositions.filter(p => p.source === "Powens — revenus détectés");
  assert.equal(props.length, 1, "l'ancienne détection en attente est remplacée");
  assert.equal(props[0].lot, lot); assert.equal(props[0].id, await S.idRevenus(lot));
  assert.deepEqual(J(props[0].apres), { personnes: { p1: { salaire: 3017 } } });
  assert.equal(props[0].statut ?? "en_attente", "en_attente");
  assert.ok(db.tables.propositions.some(p => p.id === "autre-source"), "autre source intacte");
  assert.equal(db.tables.profiles[0].personnes.p1.salaire, 2500, "jamais appliquée automatiquement");
  assert.equal(r.revenus_proposes, 1);
  for (const e of db.journal.filter(e => e.table === "propositions" && e.op === "delete"))
    assert.ok(e.filtres.some(([k, , v]) => k === "statut" && v === "en_attente") && e.filtres.some(([k, , v]) => k === "user_id" && v === U));
  // second passage : rien de nouveau
  const r2 = await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(db.tables.propositions.filter(p => p.source === "Powens — revenus détectés").length, 1);
  assert.equal(r2.revenus_proposes, 0);
  // refusée : pas reproposée (même lot), ni le mois suivant pour un montant à 10 % près de celui refusé
  props[0].statut = "refusee"; props[0].decide_le = "2026-10-12T09:00:00Z";
  await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(db.tables.propositions.filter(p => p.source === "Powens — revenus détectés").length, 1);
  const novembre = { 101: [...operations[101], { id: 9302, date: "2026-10-28", value: 3000, simplified_wording: "VIR SALAIRE ACME 10", coming: false, deleted: null }] };
  await S.synchroniser(db, apiFactice({ operations: novembre }), U, 7, { maintenant: new Date("2026-11-03T08:00:00Z") });
  assert.equal(db.tables.propositions.filter(p => p.source === "Powens — revenus détectés").length, 1, "refus respecté");
});

/* ---------- versements vers les placements sans contrepartie synchronisée (cas type : LCL → PEA Bourso, PER, assurance-vie) ---------- */
const RECURRING = [
  { id: "r1", label: "ETF Monde", positionId: "pos-etf", amount: 400, day: 5 },
  { id: "r2", label: "PER", positionId: "pos-per", amount: 150, day: 10 },
  { id: "r3", label: "Assurance-vie", positionId: "pos-av", amount: 150, day: 20, start: "2026-09-01" },
];
const LIGNES_INV = [
  { id: "pos-etf", name: "ETF Monde", envelope: "PEA Bourso", mode: "market", status: "actif" },
  { id: "pos-av", name: "Fonds euros", envelope: "Assurance-vie Linxea", mode: "manual", status: "actif" },
  { id: "pos-cc", name: "Compte courant LCL", envelope: "Comptes courants", mode: "manual", status: "actif" },
];

test("contexteEpargne / epargneSansContrepartie : libellé de placement, versement programmé, virement vers soi ; jamais un virement interne", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const comptes = [...KV, { id: 40, connexion_id: 40, type: "pea" }, { id: 41, connexion_id: 41, type: "pea" }, { id: 42, connexion_id: 41, type: "courant" }];
  const ctx = S.contexteEpargne({ lignes: LIGNES_INV, comptes, recurring: RECURRING, personnes: { p1: { nom: "Moi" }, p2: { nom: "Camille" } },
    connexions: [{ id: 40, etablissement: "Fortuneo Placements" }, { id: 41, etablissement: "Boursorama Banque" }] });
  const t = ctx.termes.map(x => x.join(" "));
  for (const k of ["pea", "per", "assurance vie", "linxea", "spirica", "versement programme", "pea bourso", "assurance vie linxea", "fortuneo placements", "fortuneo"]) assert.ok(t.includes(k), k);
  assert.ok(!t.includes("boursorama banque") && !t.includes("boursorama"), "établissement où l'utilisateur a aussi un compte courant : pas un indice");
  assert.ok(!t.includes("comptes courants"), "enveloppe de compte courant : pas un placement");
  assert.deepEqual(J(ctx.noms), [["camille"]], "« Moi » n'est pas un nom");
  assert.deepEqual(J(ctx.versements), [{ montant: 400, jour: 5, debut: null }, { montant: 150, jour: 10, debut: null }, { montant: 150, jour: 20, debut: "2026-09-01" }]);
  const o = (id, date, montant, libelle, categorie = "divers", compte_id = 1) => ({ id, compte_id, date, montant, libelle, categorie });
  const ops = [
    o(1, "2026-09-05", -400, "VIR.PERMANENT DUPONT"),              // virement vers soi + versement programmé
    o(2, "2026-09-12", -150, "PRLV SPIRICA 0912", "abonnements"),  // libellé de placement, quelle que soit la catégorie
    o(3, "2026-09-07", -400.8, "VIR SEPA 123"),                   // versement programmé : montant ±1 €, jour ±5
    o(4, "2026-09-11", -150, "CB FNAC"),                          // paiement par carte : jamais un versement programmé
    o(5, "2026-09-11", -150, "PRLV EDF", "logement"),             // dépense catégorisée : pas un versement programmé
    o(6, "2026-09-25", -400, "VIR SEPA 123"),                     // jour trop loin (20 jours)
    o(7, "2026-09-25", -400, "VIR PERMANENT DUPONT"),              // virement vers soi, montant d'un versement : quel que soit le jour
    o(8, "2026-09-25", -42, "VIR PERMANENT DUPONT"),               // virement vers soi sans versement de ce montant : gardé
    o(9, "2026-09-02", -150, "VIR CAMILLE"),                      // vir + nom d'une personne du foyer + montant d'un versement
    o(10, "2026-09-05", 400, "VIR.PERMANENT DUPONT"),              // entrée : jamais
    o(11, "2026-09-05", -400, "VIR.PERMANENT DUPONT", "divers", 2), // livret : seulement les comptes courants
    o(12, "2026-09-12", -150, "VERSEMENT PEA BOURSO"),
    o(13, "2026-08-18", -150, "VIR SEPA ABC"),                    // versement r3 pas encore commencé ; r2 (jour 10) à 8 jours
    o(14, "2026-09-05", -400, "VIR.PERMANENT DUPONT", "virement_interne"), // déjà virement interne : jamais requalifié
    o(15, "2026-09-30", -400, "VIR SEPA X"),                      // jour 30 contre 5 : 5 jours en passant le mois
  ];
  assert.deepEqual(Object.keys(S.epargneSansContrepartie(ops, comptes, ctx)).map(Number).sort((a, b) => a - b), [1, 2, 3, 7, 9, 12, 15]);
  assert.deepEqual(J(S.epargneSansContrepartie(ops, comptes, ctx, new Set(["1"]))).hasOwnProperty("1"), false, "opération rapprochée : exclue");
  assert.deepEqual(J(S.epargneSansContrepartie(ops, comptes, null)), {});
  // dans preparerOperations : la sortie appariée à une contrepartie reste virement interne
  const prep = S.preparerOperations([o(20, "2026-10-05", -400, "VIR.PERMANENT DUPONT")], [], [o(21, "2026-10-05", 400, "VIR DE DUPONT", "divers", 3)], comptes, ctx);
  assert.equal(prep.operations[0].categorie, "virement_interne");
  assert.equal(prep.epargne, 0);
});

test("epargneSansContrepartie (I5) : prénoms et noms du foyer retirés des termes ; nom entier de l'enveloppe exigé ; jamais une opération carte", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  const lignes = [
    { id: "a", name: "ETF", envelope: "PEA Camille", mode: "market", status: "actif" },
    { id: "b", name: "Fonds", envelope: "Mon Épargne Yomoni", mode: "market", status: "actif" },
    { id: "c", name: "ETF", envelope: "Dupont", mode: "market", status: "actif" },
  ];
  const personnes = { p1: { prenom: "Hélène", nom: "Dupont" }, p2: { prenom: "Camille", nom: "Dupont" } };
  const ctx = S.contexteEpargne({ lignes, comptes: KV, recurring: [], personnes, connexions: [] });
  const t = ctx.termes.map(x => x.join(" "));
  assert.ok(t.includes("pea camille") && t.includes("mon epargne yomoni"), "nom entier de l'enveloppe");
  for (const k of ["camille", "yomoni", "dupont", "helene"]) assert.ok(!t.includes(k), "pas un terme seul : " + k);
  assert.deepEqual(J(ctx.noms).map(n => n.join(" ")).sort(), ["camille", "dupont", "helene"]);
  const o = (id, montant, libelle, type_powens = null) => ({ id, compte_id: 1, date: "2026-09-12", montant, libelle, categorie: "divers", type_powens });
  const ops = [
    o(1, -300, "VIR CAMILLE"),            // virement à la conjointe : pas de l'épargne
    o(2, -300, "VIR SEPA DUPONT"),         // nom de famille seul : non
    o(3, -300, "VIR PEA CAMILLE"),        // nom entier de l'enveloppe : oui
    o(4, -300, "PRLV YOMONI"),            // un mot de l'enveloppe seulement : non
    o(5, -300, "VIR MON EPARGNE YOMONI"), // nom entier : oui
    o(6, -300, "CB LINXEA"),              // carte : jamais
    o(7, -300, "PAIEMENT PAR CARTE PEA"), // carte : jamais
    o(8, -300, "LINXEA", "card"),         // carte (type Powens) : jamais
    o(9, -300, "PRLV LINXEA"),            // mot de placement : oui
  ];
  assert.deepEqual(Object.keys(S.epargneSansContrepartie(ops, KV, ctx)).map(Number).sort((a, b) => a - b), [3, 5, 9]);
  // établissement d'investissement : nom entier et mots significatifs, sauf un nom du foyer
  const ctx2 = S.contexteEpargne({ lignes: [], comptes: [{ id: 40, connexion_id: 40, type: "pea" }], recurring: [], personnes,
    connexions: [{ id: 40, etablissement: "Dupont Gestion Privée" }] });
  const t2 = ctx2.termes.map(x => x.join(" "));
  assert.ok(t2.includes("dupont gestion privee") && t2.includes("gestion") && t2.includes("privee") && !t2.includes("dupont"));
});

test("synchroniser : cas type — 400 € « VIR.PERMANENT DUPONT » le 5 vers le PEA, « PRLV SPIRICA » 150 € → épargne, pas dépense", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const base = baseInitiale(J(RATTACHES));
  base.positions.push(...LIGNES_INV.map(p => ({ ...p, user_id: U })));
  base.config = [{ user_id: U, recurring: RECURRING }];
  base.profiles = [{ user_id: U, foyer: { adultes: 1 }, personnes: { p1: { nom: "Moi" } } }];
  const operations = {
    101: [
      { id: 9401, date: "2026-10-05", value: -400, simplified_wording: "VIR.PERMANENT DUPONT", categories: [{ code: "transfers" }], coming: false, deleted: null },
      { id: 9402, date: "2026-09-12", value: -150, simplified_wording: "PRLV SPIRICA", coming: false, deleted: null },
      { id: 9403, date: "2026-10-03", value: -85.4, simplified_wording: "CB CARREFOUR", categories: [{ code: "supermarket_and_groceries" }], coming: false, deleted: null },
    ],
  };
  const db = fausseBase(base, { rpc: rpcBanque() });
  const r = await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  const cat = id => db.tables.banque_operations.find(o => o.id === id).categorie;
  assert.deepEqual([cat(9401), cat(9402), cat(9403)], ["epargne", "epargne", "alimentation"]);
  assert.equal(r.versements_epargne, 2);
  assert.ok(db.journal.some(e => e.table === "config" && e.op === "select" && e.filtres.some(([k, , v]) => k === "user_id" && v === U)));
  // idempotent ; config illisible → règles de libellé seulement, noté, sans échec
  await S.synchroniser(db, apiFactice({ operations }), U, 7, OPTS());
  assert.deepEqual([cat(9401), cat(9402)], ["epargne", "epargne"]);
  const db2 = fausseBase({ ...base, banque_operations: [] }, { rpc: rpcBanque(), echec: (t) => (t === "config" ? "panne" : null) });
  const r2 = await S.synchroniser(db2, apiFactice({ operations }), U, 7, OPTS());
  assert.equal(r2.ok, true);
  assert.ok(r2.notes.some(n => /versements programmés illisibles/.test(n)));
  const cat2 = id => db2.tables.banque_operations.find(o => o.id === id).categorie;
  assert.deepEqual([cat2(9401), cat2(9402)], ["divers", "epargne"], "sans versements programmés : « DUPONT » seul n'est pas un indice");
});

/* ---------- DAT1 : données du prêt (spec dat1-calendrier § 2.6 et § 7) ---------- */
const PRET_BANQUE = { subscription_date: "2021-03-15", maturity_date: "2041-03-15", start_repayment_date: "2021-04-15", rate: 1.45,
  duration: 240, total_amount: 200000, insurance_rate: 0.0035, next_payment_date: "2026-11-15", type: "mortgage" };
const avecPret = (loan, base = COMPTES) => base.map(c => (c.id === 104 ? { ...c, loan } : c));
const apiPret = (comptes, surcharge = {}) => apiFactice({ comptes, connexion: connexionPowens({ connector: { id: 59, name: "Banque Exemple" } }), ...surcharge });
const propsConfig = db => db.tables.propositions.filter(p => p.cible === "config");

test("pretDe : champs documentés présents et valides seulement, dates réelles tronquées au jour, rien d'inventé", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  assert.deepEqual(J(S.pretDe({ loan: PRET_BANQUE })), PRET_BANQUE);
  // Chaîne ISO complète valide : tronquée au jour. Date impossible, texte, nombre non fini : écartés.
  const bruit = S.pretDe({ loan: { subscription_date: "2021-03-15T00:00:00Z", maturity_date: "2041-02-30", start_repayment_date: "bientôt",
    next_payment_date: "2026-11-15 00:00:00", rate: "abc", duration: Infinity, total_amount: NaN, insurance_rate: null, type: "autre_type" } });
  assert.deepEqual(J(bruit), { subscription_date: "2021-03-15", next_payment_date: "2026-11-15" });
  // Nombres sous forme de chaîne numérique stricte acceptés ; booléens, tableaux, objets refusés.
  assert.deepEqual(J(S.pretDe({ loan: { rate: "1.45", duration: "240", total_amount: true, insurance_rate: [0.003], type: "LOAN" } })),
    { rate: 1.45, duration: 240, type: "loan" });
  // Seuls les champs documentés sont copiés : ni capital restant dû, ni montant d'assurance, ni champ inconnu.
  const copie = S.pretDe({ loan: { ...PRET_BANQUE, remaining_capital: 160000, insurance_amount: 30, nb_payments_left: 12, inconnu: "x", iban: "FR76" } });
  assert.deepEqual(Object.keys(copie).sort(), Object.keys(PRET_BANQUE).sort());
  // Jamais de date inventée : une durée seule ne produit aucune date.
  assert.deepEqual(J(S.pretDe({ loan: { duration: 240 } })), { duration: 240 });
  // Absent, vide, nul, mal formé, sans champ exploitable : null.
  for (const compte of [null, undefined, {}, { loan: null }, { loan: {} }, { loan: [] }, { loan: "x" }, { loan: 12 },
    { loan: { subscription_date: null, maturity_date: null, rate: null, duration: null, type: null } }, { loan: { type: "inconnu", remaining_capital: 5 } }])
    assert.equal(S.pretDe(compte), null, JSON.stringify(compte));
});

test("infosPret : bornes de la base (date_fin > date_signature, durée 1 à 480, assurance 0 à 5 %), taux_pct jamais proposé", { skip: SANS_STRIP }, () => {
  const { S } = charger();
  assert.deepEqual(J(S.infosPret(PRET_BANQUE, AUJ)), { date_signature: "2021-03-15", date_fin: "2041-03-15", duree_mois: 240, assurance_taux_pct: 0.35 });
  assert.equal("assurance_taux_pct" in S.infosPret({ ...PRET_BANQUE, insurance_rate: 0.07 }, AUJ), false, "7 % : hors borne, omis");
  assert.equal(S.infosPret({ ...PRET_BANQUE, insurance_rate: 0.05 }, AUJ).assurance_taux_pct, 5);
  assert.equal(S.infosPret({ ...PRET_BANQUE, insurance_rate: 0 }, AUJ).assurance_taux_pct, 0);
  assert.equal("assurance_taux_pct" in S.infosPret({ ...PRET_BANQUE, insurance_rate: 3.5 }, AUJ), false, "hors du ratio documenté : omis");
  assert.equal("assurance_taux_pct" in S.infosPret({ ...PRET_BANQUE, insurance_rate: -0.01 }, AUJ), false);
  assert.equal("duree_mois" in S.infosPret({ ...PRET_BANQUE, duration: 481 }, AUJ), false);
  assert.equal("duree_mois" in S.infosPret({ ...PRET_BANQUE, duration: 0 }, AUJ), false);
  assert.equal("duree_mois" in S.infosPret({ ...PRET_BANQUE, duration: 12.5 }, AUJ), false);
  assert.equal(S.infosPret({ ...PRET_BANQUE, duration: 480 }, AUJ).duree_mois, 480);
  assert.equal("date_fin" in S.infosPret({ ...PRET_BANQUE, maturity_date: "2021-03-15" }, AUJ), false, "fin = signature : omise");
  assert.equal("date_fin" in S.infosPret({ ...PRET_BANQUE, maturity_date: "2020-01-01" }, AUJ), false);
  assert.equal("date_signature" in S.infosPret({ ...PRET_BANQUE, subscription_date: "2027-01-01" }, AUJ), false, "signature dans le futur : omise");
  assert.equal("date_signature" in S.infosPret({ ...PRET_BANQUE, subscription_date: "1900-01-01" }, AUJ), false);
  // Taux nominal : échelle de `rate` non documentée → jamais proposé ; un prêt qui n'a que ce champ ne donne rien.
  assert.equal("taux_pct" in S.infosPret(PRET_BANQUE, AUJ), false);
  assert.equal(S.infosPret({ rate: 1.45, total_amount: 1000, next_payment_date: "2026-11-15", type: "loan" }, AUJ), null);
  assert.equal(S.infosPret(null, AUJ), null);
});

test("synchroniser (DAT1) : compte de crédit avec prêt → pret et ouverture_le, une seule proposition prets_infos, tracée ensuite", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const autre = { user_id: AUTRE, id: 104, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: "cred-b" };
  const db = fausseBase({ ...baseInitiale([...J(RATTACHES), autre]), config: [{ user_id: U, prets_infos: {} }, { user_id: AUTRE, prets_infos: {} }] }, { rpc: RPC });
  const api = apiPret(avecPret(PRET_BANQUE));
  const r = await S.synchroniser(db, api, U, 7, OPTS());
  assert.equal(r.ok, true, JSON.stringify(r.erreurs));
  assert.equal(r.prets_proposes, 1);
  const T = db.tables;
  const c104 = T.banque_comptes.find(c => c.user_id === U && c.id === 104);
  assert.deepEqual(J(c104.pret), PRET_BANQUE);
  assert.equal(c104.ouverture_le, "2021-03-15");
  assert.equal(c104.infos_proposees_le, MAINTENANT.toISOString());
  // Un compte non crédit : aucune date d'ouverture, aucun prêt.
  for (const id of [101, 102, 103]) {
    const c = T.banque_comptes.find(x => x.user_id === U && x.id === id);
    assert.equal(c.ouverture_le, null, `compte ${id}`);
    assert.equal(c.pret, null, `compte ${id}`);
    assert.equal(c.infos_proposees_le ?? null, null, `compte ${id}`);
  }
  // La proposition : cible config, modifier, clé du crédit, champs documentés et valides, source Powens, jour de la synchronisation.
  const ps = propsConfig(db);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].user_id, U);
  assert.equal(ps[0].statut ?? "en_attente", "en_attente");
  assert.equal(ps[0].operation, "modifier");
  assert.deepEqual(J(ps[0].apres), { prets_infos: { "credit:cred-1": { date_signature: "2021-03-15", date_fin: "2041-03-15", duree_mois: 240,
    assurance_taux_pct: 0.35, source: "Powens — Banque Exemple : données du prêt transmises par la banque", le: AUJ } } });
  assert.equal(ps[0].id, await S.idPret(U, 104));
  assert.equal(ps[0].lot, await S.lotPret(U, 104));
  assert.ok(!JSON.stringify(ps[0]).includes("enveloppes_infos"));
  assert.equal(T.propositions.filter(p => JSON.stringify(p.apres ?? {}).includes("enveloppes_infos")).length, 0, "jamais de proposition d'enveloppe");
  // L'autre utilisateur n'est pas touché.
  assert.deepEqual(J(T.banque_comptes.find(c => c.user_id === AUTRE)), J(autre));
  assert.deepEqual(J(T.config.find(c => c.user_id === AUTRE).prets_infos), {});
  // Deuxième passage, même refusée entre-temps : aucune nouvelle proposition, trace inchangée.
  T.propositions.forEach(p => { p.statut = "refusee"; p.decide_le = MAINTENANT.toISOString(); });
  const r2 = await S.synchroniser(db, apiPret(avecPret(PRET_BANQUE)), U, 7, { ...OPTS(), maintenant: new Date("2026-10-13T08:00:00Z") });
  assert.equal(r2.prets_proposes, 0);
  assert.equal(propsConfig(db).length, 1);
  assert.equal(T.banque_comptes.find(c => c.user_id === U && c.id === 104).infos_proposees_le, MAINTENANT.toISOString());
});

test("synchroniser (DAT1) : clé déjà dans prets_infos, déjà proposé, non rattaché, ignoré ou prêt sans champ proposable → aucune proposition", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const sync = async (comptes, { config = [{ user_id: U, prets_infos: {} }], credits, loan = PRET_BANQUE } = {}) => {
    const base = baseInitiale(comptes);
    if (credits) base.credits = credits;
    const db = fausseBase({ ...base, config }, { rpc: RPC });
    const r = await S.synchroniser(db, apiPret(avecPret(loan)), U, 7, OPTS());
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    return db;
  };
  // Clé déjà présente (saisie par l'utilisateur) : rien, et pas de trace non plus.
  let db = await sync(J(RATTACHES), { config: [{ user_id: U, prets_infos: { "credit:cred-1": { date_fin: "2040-01-01", source: "relevé", le: "2026-01-01" } } }] });
  assert.equal(propsConfig(db).length, 0);
  assert.equal(db.tables.banque_comptes.find(c => c.id === 104).infos_proposees_le ?? null, null);
  assert.equal(db.tables.banque_comptes.find(c => c.id === 104).ouverture_le, "2021-03-15", "le prêt reste gardé sur le compte");
  // Clé d'un autre crédit présente : la proposition a lieu.
  db = await sync(J(RATTACHES), { config: [{ user_id: U, prets_infos: { "credit:autre": { date_fin: "2040-01-01", source: "x", le: "2026-01-01" } } }] });
  assert.equal(propsConfig(db).length, 1);
  // Déjà proposé une fois (infos_proposees_le), même refusée depuis : rien.
  db = await sync(J(RATTACHES).map(c => (c.id === 104 ? { ...c, infos_proposees_le: "2026-09-01T00:00:00Z" } : c)));
  assert.equal(propsConfig(db).length, 0);
  // Compte de crédit non rattaché (aucun crédit dans le profil) : le prêt est gardé, rien n'est proposé.
  db = await sync(J(RATTACHES).filter(c => c.id !== 104), { credits: [] });
  assert.equal(propsConfig(db).length, 0);
  assert.deepEqual(J(db.tables.banque_comptes.find(c => c.id === 104).pret), PRET_BANQUE);
  // Compte ignoré : rien.
  db = await sync(J(RATTACHES).map(c => (c.id === 104 ? { ...c, ignore: true } : c)));
  assert.equal(propsConfig(db).length, 0);
  // Prêt dont aucun champ n'est proposable (taux et montant seulement) : pret gardé, pas de proposition ni de trace.
  db = await sync(J(RATTACHES), { loan: { rate: 1.45, total_amount: 200000, type: "mortgage" } });
  assert.equal(propsConfig(db).length, 0);
  assert.equal(db.tables.banque_comptes.find(c => c.id === 104).infos_proposees_le ?? null, null);
  assert.deepEqual(J(db.tables.banque_comptes.find(c => c.id === 104).pret), { rate: 1.45, total_amount: 200000, type: "mortgage" });
  // config illisible : aucune proposition (échec fermé), noté, le reste de la synchronisation continue.
  const base = baseInitiale(J(RATTACHES));
  const dbPanne = fausseBase({ ...base, config: [{ user_id: U, prets_infos: {} }] }, { rpc: RPC, echec: (t, op) => (t === "config" ? "panne config" : null) });
  const rp = await S.synchroniser(dbPanne, apiPret(avecPret(PRET_BANQUE)), U, 7, OPTS());
  assert.equal(propsConfig(dbPanne).length, 0);
  assert.ok(rp.notes.some(x => x.includes("panne config")));
  assert.equal(dbPanne.tables.banque_comptes.find(c => c.id === 104).ouverture_le, "2021-03-15");
});

test("synchroniser (DAT1) : loan absent ou sans champ → pret et ouverture_le null, aucune date inventée, aucune proposition", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  for (const loan of [undefined, null, {}, { subscription_date: null, maturity_date: null, rate: null, duration: null, insurance_rate: null }]) {
    const db = fausseBase({ ...baseInitiale(J(RATTACHES)), config: [{ user_id: U, prets_infos: {} }] }, { rpc: RPC });
    const r = await S.synchroniser(db, apiPret(avecPret(loan)), U, 7, OPTS());
    assert.equal(r.ok, true, JSON.stringify(r.erreurs));
    const c = db.tables.banque_comptes.find(x => x.id === 104);
    assert.equal(c.pret, null);
    assert.equal(c.ouverture_le, null);
    assert.equal(propsConfig(db).length, 0);
  }
  // Un `loan` posé sur un compte qui n'est pas un crédit n'est pas lu : ouverture_le reste null.
  const db = fausseBase({ ...baseInitiale(J(RATTACHES)), config: [{ user_id: U, prets_infos: {} }] }, { rpc: RPC });
  const comptes = COMPTES.map(c => (c.id === 103 || c.id === 101 ? { ...c, loan: PRET_BANQUE } : c));
  await S.synchroniser(db, apiPret(comptes), U, 7, OPTS());
  for (const id of [101, 103]) {
    const c = db.tables.banque_comptes.find(x => x.id === id);
    assert.equal(c.ouverture_le, null);
    assert.equal(c.pret, null);
  }
  assert.equal(propsConfig(db).length, 0);
});

test("synchroniser (DAT1) : une erreur sur un compte n'arrête pas les autres (proposition de prêt et trace compte par compte)", { skip: SANS_STRIP }, async () => {
  const { S } = charger();
  const credit2 = { id: 108, id_connection: 7, name: "Prêt travaux", balance: -20000, currency: { id: "EUR" }, type: "consumercredit", disabled: null, deleted: null,
    last_update: "2026-10-12 07:55:00", loan: { subscription_date: "2023-06-01", maturity_date: "2028-06-01", duration: 60, type: "consumercredit" } };
  const comptes = [...avecPret(PRET_BANQUE), credit2];
  const rattaches = [...J(RATTACHES), { user_id: U, id: 108, connexion_id: 7, position_id: null, enveloppe: null, titulaire: null, credit_id: "cred-2" }];
  const base = baseInitiale(rattaches);
  base.credits.push({ id: "cred-2", user_id: U, nom: "Travaux", crd: 20000 });
  const idEchec = await S.idPret(U, 104);
  const db = fausseBase({ ...base, config: [{ user_id: U, prets_infos: {} }] }, { rpc: RPC,
    echec: (t, op, q) => (t === "propositions" && op === "upsert" && q.val?.id === idEchec ? "refus de la base" : null) });
  const r = await S.synchroniser(db, apiPret(comptes), U, 7, OPTS());
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.some(e => e.erreur.includes("proposition de prêt") && e.erreur.includes("refus de la base")));
  assert.equal(r.prets_proposes, 1);
  const ps = propsConfig(db);
  assert.equal(ps.length, 1);
  assert.deepEqual(Object.keys(ps[0].apres.prets_infos), ["credit:cred-2"]);
  assert.deepEqual(J(ps[0].apres.prets_infos["credit:cred-2"]), { date_signature: "2023-06-01", date_fin: "2028-06-01", duree_mois: 60,
    source: "Powens — Banque Exemple : données du prêt transmises par la banque", le: AUJ });
  // Le compte en échec n'est pas tracé : nouvel essai au prochain passage ; l'autre l'est.
  assert.equal(db.tables.banque_comptes.find(c => c.id === 104).infos_proposees_le ?? null, null);
  assert.equal(db.tables.banque_comptes.find(c => c.id === 108).infos_proposees_le, MAINTENANT.toISOString());
  assert.equal(db.tables.banque_comptes.find(c => c.id === 108).ouverture_le, "2023-06-01");
  assert.equal(db.tables.banque_comptes.find(c => c.id === 104).ouverture_le, "2021-03-15", "les deux comptes sont enregistrés");
});
