// Boussole : fonction nocturne, photos reconstituées et rétention de l'historique importé (HIS2, spec § 4.5, § 4.8 et § 7.4).
//
// Trois travaux, appelés par index.ts (le client Supabase a la clé de service : toute lecture ou écriture de données personnelles filtre user_id) :
// 1. cours anciens : les ISIN dont les mouvements importés remontent plus loin que les cours stockés, à rattraper en priorité (plage « max » au-delà de
//    5 ans) ; la limite de 10 ISIN par nuit reste celle d'index.ts ;
// 2. photos reconstituées : pour chaque utilisateur dont status.historique_a_recalculer est posé (import validé ou retiré, cours anciens arrivés), le
//    passé du patrimoine en fins de mois, calculé avec le MÊME moteur que l'app (historique.gen.js, copie de web/src/historique.js), écrit dans
//    photos_reconstituees (service seulement). Jamais pour un mois dont la date est postérieure ou égale à la première photo observée (le déclencheur
//    photos_reconstituees_garde le refuse aussi), 240 mois au plus ; les mois qui ne sont plus calculés (import retiré) sont supprimés ;
// 3. rétention (D7) : 30 jours après leur décision, le contenu d'une proposition « historique » est réduit à { type, empreinte, resume } : les données
//    vivent dans les tables, on n'en garde pas une deuxième copie.
// Tout est idempotent : refaire le travail donne le même état.
import { Calc, Historique } from "./historique.gen.js";

export const PAGE = 1000;
export const PAGES_TRANSACTIONS_MAX = 60; // 60 000 transactions : au-delà des 50 000 importées plus les saisies
export const PHOTOS_MOIS_MAX = 240;
export const RETENTION_JOURS = 30;
export const RETENTION_PAR_NUIT = 20;
export const JOURS_5_ANS = 1827;
export const JOURS_20_ANS = 7305;
const UN_JOUR = 864e5;

type Admin = any;
export type Contexte = {
  /** Date du jour à Paris (AAAA-MM-JJ). */
  aujourdhui: string;
  maintenant: () => Date;
  /** Lève (« temps écoulé ») quand le budget de temps de la nuit est épuisé : appelé entre deux lectures. */
  verifier?: () => void;
};

const decaler = (date: string, jours: number) => new Date(Date.parse(date + "T00:00:00Z") + jours * UN_JOUR).toISOString().slice(0, 10);
const jour = (v: unknown) => (v == null ? "" : String(v).slice(0, 10));
const nombre = (v: unknown) => (v == null || v === "" || !isFinite(+(v as any)) ? null : +(v as any));
const lever = (nom: string, r: any) => { if (r?.error) throw new Error(`${nom} : ${r.error.message}`); return r?.data; };

/** Lit toutes les pages d'une requête (1 000 lignes l'une) ; `construire(de, a)` rend la requête de la page. */
async function toutLire(nom: string, construire: (de: number, a: number) => any, ctx: Contexte, pagesMax = 30): Promise<any[]> {
  const out: any[] = [];
  for (let p = 0; p < pagesMax; p++) {
    ctx.verifier?.();
    const lignes = (lever(nom, await construire(p * PAGE, p * PAGE + PAGE - 1)) as any[]) ?? [];
    out.push(...lignes);
    if (lignes.length < PAGE) break;
  }
  return out;
}

/* ---------- 1. cours anciens à rattraper en priorité ---------- */
export type CoursAncien = { isin: string; symbol: string | null; currency: string; plage: "5y" | "max"; depuis: string; jours: number; utilisateurs: string[] };

/** ISIN détenus dont le plus ancien mouvement importé précède le plus ancien cours stocké, du plus urgent (le plus ancien) au moins urgent.
    Règles : pas d'essai si le dernier rattrapage date de moins de 7 jours ; pas d'essai si les cours remontent déjà au-delà de 5 ans (la plage « max » a eu lieu :
    le fournisseur n'a pas plus) ; pas de nouvel essai d'un instrument récent (premier cours bien après la limite des 5 ans, déjà tenté) : son historique est complet.
    plage « max » quand le mouvement remonte à plus de 5 ans (ou presque), « 5y » sinon. */
export async function coursAnciens(admin: Admin, ctx: Contexte, limite: number): Promise<CoursAncien[]> {
  const aujourdhui = ctx.aujourdhui, limite5 = decaler(aujourdhui, -JOURS_5_ANS), plancher = decaler(aujourdhui, -JOURS_20_ANS);
  const imports = (lever("historique_imports", await admin.from("historique_imports").select("user_id").limit(1000)) as any[]) ?? [];
  const users = [...new Set(imports.map((i) => String(i.user_id)))];
  const parIsin = new Map<string, { depuis: string; users: Set<string> }>();
  for (const uid of users) {
    ctx.verifier?.();
    const positions = (lever("positions", await admin.from("positions").select("id, isin").eq("user_id", uid).not("isin", "is", null)) as any[]) ?? [];
    for (const p of positions) {
      const isin = String(p.isin ?? "");
      if (!isin) continue;
      const t = (lever("transactions", await admin.from("transactions").select("date").eq("user_id", uid).eq("position_id", p.id)
        .not("import_id", "is", null).is("doublon_de", null).order("date", { ascending: true }).limit(1)) as any[]) ?? [];
      const d = jour(t[0]?.date);
      if (!d) continue;
      const x = parIsin.get(isin) ?? { depuis: d, users: new Set<string>() };
      if (d < x.depuis) x.depuis = d;
      x.users.add(uid);
      parIsin.set(isin, x);
    }
  }
  if (!parIsin.size) return [];
  const instruments = (lever("instruments", await admin.from("instruments").select("isin, symbol, currency, cours_rattrapage_le").in("isin", [...parIsin.keys()])) as any[]) ?? [];
  const sept = new Date(ctx.maintenant().getTime() - 7 * UN_JOUR).toISOString();
  const out: CoursAncien[] = [];
  for (const ins of instruments) {
    const isin = String(ins.isin), x = parIsin.get(isin);
    if (!x) continue;
    if (ins.cours_rattrapage_le && String(ins.cours_rattrapage_le) > sept) continue;
    ctx.verifier?.();
    const premier = (lever("cours", await admin.from("cours").select("date").eq("isin", isin).order("date", { ascending: true }).limit(1)) as any[]) ?? [];
    const plusAncien = jour(premier[0]?.date) || null, depuis = x.depuis < plancher ? plancher : x.depuis;
    if (plusAncien && depuis >= decaler(plusAncien, -7)) continue; // les cours couvrent déjà le premier mouvement
    if (plusAncien && plusAncien < decaler(limite5, -20)) continue; // la plage « max » a déjà eu lieu
    if (plusAncien && ins.cours_rattrapage_le && plusAncien > decaler(limite5, 45)) continue; // instrument récent : historique complet
    const max = depuis < decaler(limite5, 30);
    out.push({ isin, symbol: ins.symbol ? String(ins.symbol) : null, currency: String(ins.currency || "EUR"), plage: max ? "max" : "5y", depuis,
      jours: Math.min(JOURS_20_ANS, Math.round((Date.parse(aujourdhui) - Date.parse(depuis)) / UN_JOUR) + 60), utilisateurs: [...x.users] });
  }
  return out.sort((a, b) => (a.depuis < b.depuis ? -1 : a.depuis > b.depuis ? 1 : a.isin < b.isin ? -1 : 1)).slice(0, limite);
}

/** Pose la demande de recalcul des photos (status.historique_a_recalculer) pour ces utilisateurs : des cours anciens viennent d'arriver. */
export async function demanderRecalcul(admin: Admin, utilisateurs: string[], ctx: Contexte): Promise<void> {
  const le = ctx.maintenant().toISOString();
  for (const uid of utilisateurs) lever("status", await admin.from("status").upsert({ user_id: uid, historique_a_recalculer: le }, { onConflict: "user_id" }));
}

/* ---------- 2. photos reconstituées ---------- */
/** Utilisateurs à recalculer : demande posée, ou photos d'une version plus ancienne du moteur (une nouvelle version recalcule tout). */
export async function utilisateursARecalculer(admin: Admin): Promise<{ user_id: string; demande: string | null }[]> {
  const demandes = (lever("status", await admin.from("status").select("user_id, historique_a_recalculer").not("historique_a_recalculer", "is", null).limit(200)) as any[]) ?? [];
  const out = new Map<string, string | null>(demandes.map((d) => [String(d.user_id), d.historique_a_recalculer ? String(d.historique_a_recalculer) : null]));
  const vieux = (lever("photos_reconstituees", await admin.from("photos_reconstituees").select("user_id").neq("methode", Historique.METHODE).limit(200)) as any[]) ?? [];
  for (const v of vieux) if (!out.has(String(v.user_id))) out.set(String(v.user_id), null);
  return [...out.entries()].map(([user_id, demande]) => ({ user_id, demande }));
}

/** La demande est satisfaite : le champ repasse à nul, sauf si une nouvelle demande est arrivée pendant le calcul (valeur changée). */
export async function marquerCalcule(admin: Admin, uid: string, demande: string | null): Promise<void> {
  if (!demande) return;
  lever("status", await admin.from("status").update({ historique_a_recalculer: null }).eq("user_id", uid).eq("historique_a_recalculer", demande));
}

export type BilanPhotos = { mois: number; supprimees: number; etat: "calculees" | "sans_import" | "rien_a_reconstituer" };

/** Recalcule les photos reconstituées d'un utilisateur et remplace celles de la base. Lève en cas d'erreur de lecture ou d'écriture (la demande reste alors posée). */
export async function recalculerPhotos(admin: Admin, uid: string, ctx: Contexte): Promise<BilanPhotos> {
  const aujourdhui = ctx.aujourdhui;
  const existantes = ((lever("photos_reconstituees", await admin.from("photos_reconstituees").select("mois").eq("user_id", uid)) as any[]) ?? []).map((r) => jour(r.mois));
  const imports = (lever("historique_imports", await admin.from("historique_imports").select("id, type, enveloppe, resume").eq("user_id", uid).limit(1000)) as any[]) ?? [];
  const remplacer = async (lignes: any[]): Promise<number> => {
    const nouveaux = new Set(lignes.map((l) => l.mois)), obsoletes = existantes.filter((m) => !nouveaux.has(m));
    const ajoutes = lignes.filter((l) => !existantes.includes(l.mois)).length;
    const supprimer = async () => { for (let i = 0; i < obsoletes.length; i += 100) lever("photos_reconstituees", await admin.from("photos_reconstituees").delete().eq("user_id", uid).in("mois", obsoletes.slice(i, i + 100))); };
    // le déclencheur de la base refuse la 241e photo : on libère la place d'abord quand il le faudrait
    if (existantes.length + ajoutes > PHOTOS_MOIS_MAX) await supprimer();
    for (let i = 0; i < lignes.length; i += 60) lever("photos_reconstituees", await admin.from("photos_reconstituees").upsert(lignes.slice(i, i + 60), { onConflict: "user_id,mois" }));
    if (existantes.length + ajoutes <= PHOTOS_MOIS_MAX) await supprimer();
    return obsoletes.length;
  };
  if (!imports.length) return { mois: 0, supprimees: await remplacer([]), etat: "sans_import" };

  /* première photo observée : aucune photo reconstituée à cette date ni après */
  const premiere = jour(((lever("snapshots", await admin.from("snapshots").select("date").eq("user_id", uid).order("date", { ascending: true }).limit(1)) as any[]) ?? [])[0]?.date) || null;
  /* lignes du bilan, avec le cours d'aujourd'hui comme take_snapshots (price_override, sinon cours de l'instrument) */
  const lignesBrutes = (lever("positions", await admin.from("positions").select("id, name, envelope, owner, bloc, mode, isin, qty, value, price_override, status").eq("user_id", uid)) as any[]) ?? [];
  const isins = [...new Set(lignesBrutes.filter((p) => p.mode === "market" && p.isin).map((p) => String(p.isin)))];
  const prix = new Map<string, number | null>();
  if (isins.length) for (const i of (lever("instruments", await admin.from("instruments").select("isin, price").in("isin", isins)) as any[]) ?? []) prix.set(String(i.isin), nombre(i.price));
  const positions = lignesBrutes.map((p) => ({ id: p.id, name: p.name, envelope: p.envelope, owner: p.owner, bloc: p.bloc, mode: p.mode, isin: p.isin, qty: nombre(p.qty), value: nombre(p.value),
    price: nombre(p.price_override) ?? prix.get(String(p.isin)) ?? null, status: p.status }));
  /* mouvements, relevés et comptes importés */
  const tx = (await toutLire("transactions", (de, a) => admin.from("transactions").select("id, position_id, date, type, qty, price, amount, frais, enveloppe, import_id, doublon_de, source")
    .eq("user_id", uid).order("date", { ascending: true }).order("id", { ascending: true }).range(de, a), ctx, PAGES_TRANSACTIONS_MAX))
    .map((t) => ({ positionId: t.position_id, date: jour(t.date), type: t.type, qty: nombre(t.qty), price: nombre(t.price), amount: nombre(t.amount), frais: nombre(t.frais),
      enveloppe: t.enveloppe, importId: t.import_id, doublonDe: t.doublon_de, source: t.source }));
  const comptes = (lever("historique_comptes", await admin.from("historique_comptes").select("id, position_id, banque_compte_id").eq("user_id", uid)) as any[]) ?? [];
  const releves = await toutLire("historique_releves", (de, a) => admin.from("historique_releves").select("compte_id, mois, solde_debut, solde_fin, import_id").eq("user_id", uid)
    .order("compte_id", { ascending: true }).order("mois", { ascending: true }).range(de, a), ctx, 10);
  const banqueComptes = comptes.some((c) => c.banque_compte_id != null) ? ((lever("banque_comptes", await admin.from("banque_comptes").select("id, position_id").eq("user_id", uid)) as any[]) ?? []) : [];
  /* cours : de 45 jours avant le plus ancien mouvement, 20 ans au plus */
  const premierMvt = tx.map((t) => t.date).filter(Boolean).sort()[0] ?? aujourdhui;
  const depuisCours = decaler(premierMvt < decaler(aujourdhui, -JOURS_20_ANS) ? decaler(aujourdhui, -JOURS_20_ANS) : premierMvt, -45);
  const cours: Record<string, { date: string; cloture: number }[]> = {};
  for (const isin of isins) {
    cours[isin] = (await toutLire("cours", (de, a) => admin.from("cours").select("date, cloture").eq("isin", isin).gte("date", depuisCours).order("date", { ascending: true }).range(de, a), ctx, 30))
      .map((c) => ({ date: jour(c.date), cloture: +c.cloture }));
  }
  /* biens hors placements d'aujourd'hui (immobilier, biens d'usage, parts d'entreprise, dettes) : net = financier + hors financier, convention de HIS1 */
  const profil = (lever("profiles", await admin.from("profiles").select("autres").eq("user_id", uid).maybeSingle()) as any) ?? {};
  const biens = (lever("biens", await admin.from("biens").select("valeur, part_p1, crd").eq("user_id", uid)) as any[]) ?? [];
  const credits = (lever("credits", await admin.from("credits").select("owner, crd").eq("user_id", uid)) as any[]) ?? [];
  const pat = Calc.patrimoine(positions, { autres: profil.autres ?? {}, biens, credits }, "foyer");
  const horsFin = pat.net - pat.financier;

  const veille = decaler(aujourdhui, -1), jusqua = premiere && decaler(premiere, -1) < veille ? decaler(premiere, -1) : veille;
  /* le passé commence au premier mouvement importé ou, pour un compte, à la veille de son premier mois relevé (solde de début) : pas de mois vides avant */
  const debuts = [...tx.map((t) => t.date), ...releves.map((r) => decaler(jour(r.mois).slice(0, 7) + "-01", -1))].filter(Boolean).sort();
  const res = Historique.reconstituer({ today: aujourdhui, positions, scope: "foyer", cours, tx, pas: "mois", jusqua, horsFin, qualites: true, detailLignes: true, ...(debuts.length ? { depuis: debuts[0] } : {}),
    soldesMois: Historique.soldesMois(comptes, releves, banqueComptes), depuisOuverture: Historique.depuisOuverture(imports, tx, positions) });
  const lignes = (Historique.photos(res, positions, { avant: premiere ?? undefined, horsFin, max: PHOTOS_MOIS_MAX }) as any[])
    .map((p) => ({ user_id: uid, ...p, calcule_le: ctx.maintenant().toISOString() }));
  const supprimees = await remplacer(lignes);
  return { mois: lignes.length, supprimees, etat: lignes.length ? "calculees" : "rien_a_reconstituer" };
}

/* ---------- 3. rétention des propositions d'historique (D7) ---------- */
/** Réduit à { type, empreinte, resume } le contenu des propositions « historique » décidées depuis plus de 30 jours (au plus 20 par nuit : le reste suit). Rend le nombre
    de propositions réduites. Seules les propositions encore chargées de données (apres.donnees) sont lues : une proposition déjà réduite n'est plus relue. */
export async function reduirePropositions(admin: Admin, ctx: Contexte, limite = RETENTION_PAR_NUIT): Promise<number> {
  const coupure = new Date(ctx.maintenant().getTime() - RETENTION_JOURS * UN_JOUR).toISOString();
  const lignes = (lever("propositions", await admin.from("propositions").select("id, type:apres->>type, empreinte:apres->>empreinte, resume:apres->resume")
    .eq("cible", "historique").in("statut", ["acceptee", "refusee"]).lt("decide_le", coupure).not("apres->>donnees", "is", null).limit(limite)) as any[]) ?? [];
  let n = 0;
  for (const l of lignes) {
    const apres: Record<string, unknown> = {};
    if (l.type != null) apres.type = l.type;
    if (l.empreinte != null) apres.empreinte = l.empreinte;
    apres.resume = l.resume ?? {};
    lever("propositions", await admin.from("propositions").update({ apres }).eq("id", l.id).eq("cible", "historique").in("statut", ["acceptee", "refusee"]));
    n++;
  }
  return n;
}
