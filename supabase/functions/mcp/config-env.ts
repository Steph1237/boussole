// Configuration du connecteur lue dans l'environnement (SEC5). Sans variable, les valeurs sont celles de la production, octet pour
// octet ; BOUSSOLE_ENV=preprod et BOUSSOLE_PUBLIC_URL ne servent qu'à la préproduction locale (supabase functions serve --env-file).
// Pure et sans dépendance : testée par test/mcp-preprod.test.mjs.

export const URL_PRODUCTION = "https://oapcewpqsbbjdlcdeizi.supabase.co";
const CLE_PUBLIABLE_PRODUCTION = "sb_publishable_o5IJJ2Cf6xf6sPCEWHLZag_b9HefoZ_";

export type ConfigPublique = {
  /** URL du projet Supabase appelée par le connecteur (SUPABASE_URL ; dans la pile locale, l'URL interne de Kong). */
  supabaseUrl: string;
  /** Clé publiable : sert uniquement d'apikey, l'identité vient du JWT de l'utilisateur. */
  publishableKey: string;
  /** URL publique du projet, annoncée aux clients MCP (ressource protégée et serveur d'autorisation). */
  publicUrl: string;
  resource: string;
  resourceMetadataUrl: string;
  wwwAuthenticate: string;
  protectedResource: { resource: string; authorization_servers: string[]; bearer_methods_supported: string[]; resource_name: string };
  preprod: boolean;
  /** Préproduction mal configurée (une URL de projet distant) : le connecteur répond 500 à toute requête. */
  preprodInvalide: boolean;
};

export function configPublique(get: (nom: string) => string | undefined): ConfigPublique {
  const supabaseUrl = get("SUPABASE_URL") ?? URL_PRODUCTION;
  const publishableKey = get("BOUSSOLE_PUBLISHABLE_KEY") ?? CLE_PUBLIABLE_PRODUCTION;
  const publicUrl = (get("BOUSSOLE_PUBLIC_URL") ?? URL_PRODUCTION).replace(/\/+$/, "");
  const resource = `${publicUrl}/functions/v1/mcp`;
  const resourceMetadataUrl = `${resource}/.well-known/oauth-protected-resource`;
  const preprod = get("BOUSSOLE_ENV") === "preprod";
  return {
    supabaseUrl,
    publishableKey,
    publicUrl,
    resource,
    resourceMetadataUrl,
    wwwAuthenticate: `Bearer resource_metadata="${resourceMetadataUrl}"`,
    protectedResource: {
      resource,
      authorization_servers: [`${publicUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Boussole",
    },
    preprod,
    // Échec fermé : en préproduction, ni SUPABASE_URL (par défaut celle de la production si la variable manque) ni l'URL publique
    // ne doivent être un projet supabase.co.
    preprodInvalide: preprod && [supabaseUrl, publicUrl].some((u) => /supabase\.co/i.test(u)),
  };
}
