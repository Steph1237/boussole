// Savoir commun (AG1, docs/superpowers/specs/2026-10-10-ag1-memoire-savoir.md) : fiches pédagogiques sourcées et datées
// (table savoir_fiches, recherche plein texte par la RPC chercher_savoir) et repères chiffrés (table reperes : taux,
// plafonds, barèmes). Tables communes en lecture seule pour tous ; contenu posé par migration (écriture éditeur en AG2).
// L'agent consulte avant d'expliquer une notion ou de citer un chiffre réglementaire, et cite la fiche ou le repère avec sa date.
// Ce module ne dépend pas d'index.ts : les utilitaires du serveur (wrap, must, UserError…) sont passés en paramètre.
import { z } from "zod";

export const THEMES = ["epargne", "enveloppes", "fiscalite", "immobilier", "retraite", "protection", "marches", "comportement", "credit"] as const;
/** Au-delà de ce nombre de jours depuis sa vérification, un repère est signalé « à vérifier » (même seuil que web/src/reperes.js). */
export const A_VERIFIER_JOURS = 180;

const jourUTC = () => new Date().toISOString().slice(0, 10);

/** Repères (tous, ou ceux de `cles`), valeur numérique et drapeau a_verifier calculé au jour `auj` (AAAA-MM-JJ). */
export async function lireReperes(db: any, must: any, cles?: string[], auj: string = jourUTC()) {
  let req = db.from("reperes").select("cle, libelle, valeur, unite, date_effet, source_titre, source_url, verifie_le").order("cle");
  if (cles?.length) req = req.in("cle", cles);
  const rows = (must("reperes", await req) as any[]) ?? [];
  return rows.map((r) => ({
    ...r,
    valeur: r.valeur == null ? null : Number(r.valeur),
    a_verifier: !r.verifie_le || (Date.parse(auj) - Date.parse(String(r.verifie_le).slice(0, 10))) / 864e5 > A_VERIFIER_JOURS,
  }));
}

/** Fiches mises à jour après le jour de `depuis` (horodatage ISO de la session précédente), 10 au plus ;
    rien si `depuis` est null (première session de ce client : tout serait « nouveau »).
    Granularité jour (mis_a_jour_le est une date) : une fiche publiée le jour même de la session précédente n'est pas
    signalée ; passera à un horodatage maj_le avec l'éditeur (AG2). */
export async function nouveautes(db: any, must: any, depuis: string | null) {
  if (!depuis) return [];
  const rows = must("savoir_fiches", await db.from("savoir_fiches").select("slug, theme, titre, resume, mis_a_jour_le")
    .gt("mis_a_jour_le", String(depuis).slice(0, 10)).order("mis_a_jour_le", { ascending: false }).limit(10)) as any[];
  return rows ?? [];
}

export function registerSavoir(server: any, h: { db: any; wrap: any; must: any; UserError: any; RO: any; today?: () => string }) {
  const { db, wrap, must, UserError, RO } = h;
  const auj = () => (h.today ? h.today() : jourUTC());

  server.registerTool("consulter_savoir", {
    title: "Consulter le savoir Boussole",
    description: "Fiches pédagogiques sourcées et datées de Boussole (épargne, enveloppes, fiscalité, immobilier, retraite, protection, marchés, comportement, crédit). Avec question et/ou theme : 5 fiches pertinentes au plus (slug, thème, titre, résumé, date de mise à jour, sources). Avec slug : la fiche complète. À consulter avant toute explication de fond ; citer la fiche (titre, date) ; si rien n'est trouvé, le dire sans inventer.",
    inputSchema: z.strictObject({
      question: z.string().trim().min(2, { error: "question : 2 caractères au moins." }).max(200, { error: "question : 200 caractères au plus." }).optional().describe("Mots-clés ou question en français (« plafond du PEA », « fonds euros »)."),
      theme: z.enum(THEMES, { error: "theme : " + THEMES.join(", ") + "." }).optional(),
      slug: z.string().regex(/^[a-z0-9-]{3,80}$/, { error: "slug : identifiant de fiche (minuscules, chiffres, tirets)." }).optional().describe("Identifiant d'une fiche renvoyé par une recherche : renvoie la fiche complète."),
    }),
    annotations: RO,
  }, wrap(async (a: any) => {
    if (a.slug) {
      const f = must("savoir_fiches", await db.from("savoir_fiches").select("slug, theme, titre, resume, contenu, sources, version, mis_a_jour_le").eq("slug", a.slug).maybeSingle());
      if (!f) throw new UserError(`Fiche introuvable : ${a.slug}. Cherchez avec question ou theme.`);
      return { fiche: f, consigne: "Citez la fiche (titre, date de mise à jour) ; ses sources sont dans sources." };
    }
    if (!a.question && !a.theme) throw new UserError("Fournissez question, theme ou slug.");
    const res = (must("chercher_savoir", await db.rpc("chercher_savoir", { p_question: a.question ?? null, p_theme: a.theme ?? null, p_limite: 5 })) as any[]) ?? [];
    return {
      nombre: res.length,
      fiches: res,
      consigne: res.length ? "Ouvrez la fiche utile avec slug, puis citez-la (titre, date)." : "Aucune fiche ne correspond : dites-le à l'utilisateur et n'inventez rien.",
    };
  }));

  server.registerTool("reperes", {
    title: "Repères chiffrés",
    description: "Chiffres de référence à jour (taux et plafonds des livrets, plafond du PEA, prélèvement forfaitaire unique, abattements de l'assurance-vie, normes HCSF, PASS…) avec libellé, unité, date d'effet, source et date de vérification ; a_verifier = vérifié il y a plus de 180 jours (le signaler à l'utilisateur). À appeler avant de citer tout chiffre réglementaire ; sans cles, renvoie tous les repères.",
    inputSchema: z.strictObject({
      cles: z.array(z.string().regex(/^[a-z0-9_]{2,60}$/, { error: "cles : identifiants de repères (minuscules, chiffres, _)." })).max(30).optional().describe("Identifiants de repères (cle) ; tous si absent."),
    }),
    annotations: RO,
  }, wrap(async ({ cles }: any) => ({ reperes: await lireReperes(db, must, cles, auj()) })));
}
