// Configuration publique du front. La clé publiable Supabase est publique par nature :
// l'isolation des données repose sur RLS côté base, jamais sur le secret de cette clé.
window.BOUSSOLE = {
  supabaseUrl: "https://oapcewpqsbbjdlcdeizi.supabase.co",
  supabaseKey: "sb_publishable_o5IJJ2Cf6xf6sPCEWHLZag_b9HefoZ_",
  base: "./",
  // Connecteur MCP et client OAuth déclaré pour Claude (public, PKCE, sans secret : l'identifiant n'est pas un secret).
  mcpUrl: "https://oapcewpqsbbjdlcdeizi.supabase.co/functions/v1/mcp",
  claude: { clientId: "30351516-1e76-4884-8fb2-ae856799a723" },
  // Envoi d'e-mails par Supabase (SMTP). false (décision du 2026-10-10) : pas de lien magique, pas de
  // réinitialisation de mot de passe, pas de confirmation d'adresse ; « Commencer sans e-mail » crée un
  // compte anonyme. Passer à true quand un SMTP sera configuré : liens de connexion et réinitialisation reviennent.
  emails: false,
};
