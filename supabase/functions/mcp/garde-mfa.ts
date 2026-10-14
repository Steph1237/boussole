// SEC2 : garde globale de la double authentification dans le connecteur (docs/superpowers/specs/2026-10-14-sec2-mfa-design.md).
// La migration 0028 rend TOUTES les tables personnelles illisibles en aal1 pour un utilisateur qui a un facteur vérifié : sans cette
// garde, un jeton OAuth aal1 ferait répondre les outils par des listes vides, et le Copilote pourrait conclure « tu n'as rien ».
// handleMcp (index.ts) calcule le verdict une fois par requête, après auth.getUser, puis buildServer applique gardeOutils :
//   - "ok"       : jeton aal2, ou aucun facteur vérifié (rien à présenter) : le serveur est inchangé ;
//   - "requise"  : jeton aal1 et facteur vérifié : tout outil de données personnelles répond MSG_MFA_CONNECTEUR sans s'exécuter ;
//   - "incertain": jeton aal1 et lecture des facteurs impossible : même refus (échec fermé), avec MSG_MFA_INCERTAIN.
// Les outils de savoir commun (consulter_savoir, reperes, consulter_expertise) ne lisent aucune donnée personnelle : ils restent actifs.
// Le facteur est lu côté base par la fonction public.mfa_exigee() (migration 0028, security definer, exécutable par authenticated :
// vrai si auth.uid() a un facteur vérifié), appelée en RPC avec le client de l'utilisateur (clé anon + son jeton). Aucune clé de
// service dans le connecteur. L'aal du jeton vient de aalDuJeton (banque.ts), appelé sur un jeton déjà validé par getUser.

export type VerdictMfa = "ok" | "requise" | "incertain";

/** Réponse de tout outil de données personnelles quand le jeton du connecteur est aal1 et que le compte a une double authentification. */
export const MSG_MFA_CONNECTEUR = "Double authentification requise : ton compte Boussole est protégé par un code. Reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs) et saisis ton code à 6 chiffres sur la page d'autorisation.";
/** Réponse quand la double authentification du compte n'a pas pu être vérifiée (échec fermé : aucune donnée n'est lue). */
export const MSG_MFA_INCERTAIN = "Double authentification : vérification impossible pour le moment, donc aucune donnée n'est lue. Ce n'est pas un compte vide. Réessaie dans un instant ; si cela persiste, reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs).";

/** Outils de savoir commun, sans donnée personnelle : toujours disponibles. */
export const OUTILS_PUBLICS: ReadonlySet<string> = new Set(["consulter_savoir", "reperes", "consulter_expertise"]);

/** Verdict pour la requête. `db` est le client de l'utilisateur (clé anon + son jeton) ; appelé seulement hors aal2. Toute erreur
    (RPC en échec, réponse qui n'est pas un booléen) donne "incertain", jamais "ok". */
export async function verdictMfa(db: any, aal: string): Promise<VerdictMfa> {
  if (aal === "aal2") return "ok";
  try {
    const { data, error } = await db.rpc("mfa_exigee");
    if (error) throw new Error(error.message ?? "mfa_exigee");
    if (typeof data !== "boolean") throw new Error("réponse mfa_exigee inattendue");
    return data ? "requise" : "ok";
  } catch (e) {
    console.error("mcp: double authentification illisible", e instanceof Error ? e.message : e);
    return "incertain";
  }
}

/** Applique le verdict à un serveur MCP avant l'enregistrement des outils : les outils non publics répondent le message (isError) à la
    place de leur code, et leurs paramètres ne sont plus validés (le message passe même avec des paramètres invalides). */
export function gardeOutils(server: any, verdict: VerdictMfa): void {
  if (verdict === "ok") return;
  const message = verdict === "requise" ? MSG_MFA_CONNECTEUR : MSG_MFA_INCERTAIN;
  const refus = async () => ({ content: [{ type: "text" as const, text: message }], isError: true });
  const enregistrer = server.registerTool.bind(server);
  server.registerTool = (nom: string, def: unknown, handler: unknown) => enregistrer(nom, def, OUTILS_PUBLICS.has(nom) ? handler : refus);
  const valider = server.validateToolInput?.bind(server);
  server.validateToolInput = async (tool: any, args: unknown, nom: string) =>
    OUTILS_PUBLICS.has(nom) && valider ? valider(tool, args, nom) : {};
}
