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
      : op === "is" ? (r[k] ?? null) === v : op === "neq" ? (r[k] ?? null) !== v : op === "not_is" ? (r[k] ?? null) !== v : true);
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
/** Rattachements posés par l'utilisateur (Agent › Connexion). */
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
    derniere_synchro: "2026-10-12T05:55:00Z", maj_le: MAINTENANT.toISOString(), connecteur: 59 });
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
