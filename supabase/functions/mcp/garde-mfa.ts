// SEC2 : garde globale de la double authentification dans le connecteur (docs/superpowers/specs/2026-10-14-sec2-mfa-design.md).
// La migration 0028 rend TOUTES les tables personnelles illisibles en aal1 pour un utilisateur qui a un facteur vérifié : sans cette
// garde, un jeton OAuth aal1 ferait répondre les outils par des listes vides, et le Copilote pourrait conclure « tu n'as rien ».
// Or un jeton OAuth est TOUJOURS aal1 (constat de la préproduction, SEC5 § 3.12). La migration 0033 ajoute donc une autorisation du
// connecteur créée seulement par une session aal2 (page de consentement, après le code) et liée à une seule session OAuth ; la RLS
// l'accepte (connecteur_autorise()). handleMcp (index.ts) calcule le verdict une fois par requête, après auth.getUser, puis buildServer
// applique gardeOutils :
//   - "ok"        : jeton aal2, ou aucun facteur vérifié (rien à présenter) : le serveur est inchangé ;
//   - "autorise"  : jeton aal1 d'un compte à facteur, autorisation valide liée à la session de ce jeton (RPC lier_connecteur, 0033) :
//                   le serveur est inchangé et lit comme en aal2 (banque en lecture seulement : la RLS refuse toute écriture bancaire) ;
//   - "requise"   : jeton aal1 et facteur vérifié, sans autorisation valide : tout outil de données personnelles répond MSG_MFA_CONNECTEUR ;
//   - "expiree"   : même refus, avec MSG_MFA_EXPIREE (autorisation de 90 jours arrivée à terme) ;
//   - "incertain" : jeton aal1 et lecture impossible (facteurs ou autorisation) : même refus (échec fermé), avec MSG_MFA_INCERTAIN.
// Les outils de savoir commun (consulter_savoir, reperes, consulter_expertise) ne lisent aucune donnée personnelle : ils restent actifs.
// Le facteur est lu côté base par public.mfa_exigee() (0028), l'autorisation par public.lier_connecteur() (0033), qui lit client_id et
// session_id dans le jeton signé (jamais en paramètre) ; toutes deux appelées en RPC avec le client de l'utilisateur (clé anon + son jeton).
// Aucune clé de service dans le connecteur. L'aal du jeton vient de aalDuJeton (banque.ts), appelé sur un jeton déjà validé par getUser.
// Le verdict ne fait qu'éviter des réponses vides trompeuses : la barrière reste la RLS (un faux « autorise » ne lirait rien).

export type VerdictMfa = "ok" | "autorise" | "requise" | "expiree" | "incertain";

/** Réponse de tout outil de données personnelles quand le jeton du connecteur est aal1, que le compte a une double authentification et
    qu'aucune autorisation valide n'est liée à ce jeton. */
export const MSG_MFA_CONNECTEUR = "Double authentification requise : ton compte Boussole est protégé par un code. Reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs) et saisis ton code à 6 chiffres sur la page d'autorisation.";
/** Réponse quand l'autorisation du connecteur, accordée avec le code, est arrivée à terme. */
export const MSG_MFA_EXPIREE = "Double authentification requise : l'autorisation du connecteur Boussole, accordée avec ton code, a expiré (elle vaut 90 jours). Reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs) et saisis ton code à 6 chiffres sur la page d'autorisation.";
/** Réponse quand la double authentification du compte n'a pas pu être vérifiée (échec fermé : aucune donnée n'est lue). */
export const MSG_MFA_INCERTAIN = "Double authentification : vérification impossible pour le moment, donc aucune donnée n'est lue. Ce n'est pas un compte vide. Réessaie dans un instant ; si cela persiste, reconnecte le connecteur Boussole dans Claude (Réglages › Connecteurs).";

/** Outils de savoir commun, sans donnée personnelle : toujours disponibles. */
export const OUTILS_PUBLICS: ReadonlySet<string> = new Set(["consulter_savoir", "reperes", "consulter_expertise"]);

/** Réponses de lier_connecteur (0033) qui refusent l'accès : l'utilisateur doit reconnecter le connecteur avec son code. */
const REFUS_CONNECTEUR: ReadonlySet<string> = new Set(["sans_client", "absente", "revoquee", "autre_session", "hors_delai", "en_attente", "ambigu", "non_liee"]);
/** Refus qui signalent une session OAuth qui n'est pas celle que le second facteur a autorisée (mot de passe volé ?) : journalisés. */
const REFUS_SIGNALES: ReadonlySet<string> = new Set(["autre_session", "ambigu"]);

/** Verdict pour la requête. `db` est le client de l'utilisateur (clé anon + son jeton) ; appelé seulement hors aal2. Toute erreur
    (RPC en échec, réponse inattendue) donne "incertain", jamais "ok" ni "autorise". Seule exception : lier_connecteur absente
    (PGRST202, migration 0033 pas encore appliquée) donne "requise", le comportement d'avant 0033. */
export async function verdictMfa(db: any, aal: string): Promise<VerdictMfa> {
  if (aal === "aal2") return "ok";
  try {
    const { data, error } = await db.rpc("mfa_exigee");
    if (error) throw new Error(error.message ?? "mfa_exigee");
    if (typeof data !== "boolean") throw new Error("réponse mfa_exigee inattendue");
    if (!data) return "ok";
  } catch (e) {
    console.error("mcp: double authentification illisible", e instanceof Error ? e.message : e);
    return "incertain";
  }
  try {
    const { data, error } = await db.rpc("lier_connecteur");
    if (error) {
      if (error.code === "PGRST202") return "requise";
      throw new Error(error.message ?? "lier_connecteur");
    }
    if (data === "autorise") return "autorise";
    if (data === "expiree") return "expiree";
    if (typeof data === "string" && REFUS_CONNECTEUR.has(data)) {
      if (REFUS_SIGNALES.has(data)) console.error("mcp: autorisation du connecteur refusée :", data);
      return "requise";
    }
    throw new Error("réponse lier_connecteur inattendue");
  } catch (e) {
    console.error("mcp: autorisation du connecteur illisible", e instanceof Error ? e.message : e);
    return "incertain";
  }
}

/** Applique le verdict à un serveur MCP avant l'enregistrement des outils : les outils non publics répondent le message (isError) à la
    place de leur code, et leurs paramètres ne sont plus validés (le message passe même avec des paramètres invalides). */
export function gardeOutils(server: any, verdict: VerdictMfa): void {
  if (verdict === "ok" || verdict === "autorise") return;
  const message = verdict === "requise" ? MSG_MFA_CONNECTEUR : verdict === "expiree" ? MSG_MFA_EXPIREE : MSG_MFA_INCERTAIN;
  const refus = async () => ({ content: [{ type: "text" as const, text: message }], isError: true });
  const enregistrer = server.registerTool.bind(server);
  server.registerTool = (nom: string, def: unknown, handler: unknown) => enregistrer(nom, def, OUTILS_PUBLICS.has(nom) ? handler : refus);
  const valider = server.validateToolInput?.bind(server);
  server.validateToolInput = async (tool: any, args: unknown, nom: string) =>
    OUTILS_PUBLICS.has(nom) && valider ? valider(tool, args, nom) : {};
}
