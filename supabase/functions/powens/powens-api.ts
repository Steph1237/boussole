// Boussole : client de l'API Powens (BQ1, docs/superpowers/specs/2026-10-12-bq1-powens-design.md).
//
// Sources (documentation consultée le 2026-10-12) :
// - Authentification : https://docs.powens.com/api-reference/overview/authentication
//     POST /auth/init { client_id, client_secret } → { auth_token, type: "permanent", id_user, expires_in? } (crée l'utilisateur) ;
//     GET /auth/token/code (jeton utilisateur) → { code, type: "temporary", access, expires_in }.
// - Connexions : https://docs.powens.com/api-reference/user-connections/connections
//     GET /users/me/connections/{id} (expand=connector → connector.name) ; champs state, error_message, last_update ;
//     PUT /users/me/connections/{id}?psu_requested=false&background=true : synchronisation demandée hors présence de
//     l'utilisateur (« you must set it to false for compliance reasons »), traitée en tâche de fond ;
//     DELETE /users/me/connections/{id} → 204 (suppression définitive).
// - Utilisateurs : https://docs.powens.com/api-reference/user-connections/users — DELETE /users/me → 204.
// - Comptes : https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts
//     GET /users/me/connections/{id}/accounts?all → { accounts: [...] } (`all` inclut les comptes désactivés).
// - Placements : https://docs.powens.com/api-reference/products/data-aggregation/investments et
//     https://docs.powens.com/documentation/integration-guides/wealth-and-loans — GET /users/me/accounts/{id}/investments
//     → { investments: [...] } (fonctionnalité « Wealth » activée par Powens sur le domaine).
// - Opérations : https://docs.powens.com/api-reference/products/data-aggregation/bank-transactions
//     GET /users/me/accounts/{id}/transactions?min_date=…&limit=1000&expand=categories → { transactions, _links: { next } }
//     (limit obligatoire, 1000 au plus ; pagination par liens opaques `_links`).
//
// Hôte : https://{nom}.biapi.pro/2.0/ (nom du domaine, suffixe `-sandbox` en bac à sable). Le jeton utilisateur ne sort jamais
// de ce module que vers cet hôte : un lien de pagination vers un autre hôte est ignoré. Les messages d'erreur ne contiennent
// jamais le jeton ni le secret client.

const NOM_VALIDE = /^[a-z0-9-]+$/;
const DELAI_MS = 20_000;
const PAGES_MAX = 20;

export class PowensErreur extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "PowensErreur";
    this.status = status;
    this.code = code;
  }
}

/** Normalise POWENS_DOMAIN : « boussole2-sandbox », « boussole2-sandbox.biapi.pro » et
    « https://boussole2-sandbox.biapi.pro/2.0/ » donnent { nom: "boussole2-sandbox", base: "https://boussole2-sandbox.biapi.pro/2.0/" }. */
export function domaine(env: string | Record<string, string | undefined> | undefined | null): { nom: string; base: string } {
  const brut = typeof env === "string" ? env : env?.POWENS_DOMAIN;
  let v = String(brut ?? "").trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/\/2\.0\/?$/, "").replace(/\/+$/, "");
  v = v.replace(/\.biapi\.pro$/, "");
  if (!NOM_VALIDE.test(v)) {
    throw new Error("Configuration Powens invalide : POWENS_DOMAIN doit être le nom du domaine (ex. boussole2-sandbox), éventuellement suivi de .biapi.pro.");
  }
  return { nom: v, base: `https://${v}.biapi.pro/2.0/` };
}

/** Message français pour un statut HTTP Powens (jamais le contenu de la requête). */
function messageErreur(status: number): string {
  if (status === 400) return "Powens a refusé la demande (paramètres invalides).";
  if (status === 401 || status === 403) return "Powens refuse l'accès : le jeton est invalide ou a expiré.";
  if (status === 404) return "Élément introuvable chez Powens.";
  if (status === 409) return "Powens signale un conflit : réessaie dans un moment.";
  if (status === 429) return "Powens limite les appels pour le moment : réessaie plus tard.";
  if (status >= 500) return "Powens est indisponible pour le moment : réessaie plus tard.";
  return `Erreur Powens (HTTP ${status}).`;
}

type Fetch = (input: string, init?: Record<string, unknown>) => Promise<Response>;

/** Client Powens pour un utilisateur (jeton permanent) ou sans jeton (auth/init). `f` : fetch injectable pour les tests. */
export function api(base: string, jeton?: string | null, f: Fetch = fetch) {
  const origine = new URL(base).origin;

  async function appel(methode: string, chemin: string, opts: { query?: Record<string, string>; corps?: unknown; absentOk?: boolean } = {}) {
    const url = chemin.startsWith("http") ? new URL(chemin) : new URL(chemin, base);
    if (url.origin !== origine) throw new PowensErreur("Lien Powens inattendu ignoré.", 0);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
    if (opts.corps !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await f(url.toString(), {
        method: methode, headers, body: opts.corps === undefined ? undefined : JSON.stringify(opts.corps),
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch {
      throw new PowensErreur("Powens ne répond pas : réessaie dans un moment.", 0);
    }
    if (res.status === 404 && opts.absentOk) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      let code: string | null = null;
      try {
        const e = await res.json();
        // Corps d'erreur Powens : { code, description?, message? } ; seul le code (ex. « wrongpass ») est gardé.
        if (typeof e?.code === "string" && /^[A-Za-z_]{1,64}$/.test(e.code)) code = e.code;
      } catch { /* corps vide ou non JSON */ }
      throw new PowensErreur(messageErreur(res.status), res.status, code);
    }
    if (res.status === 204) return null;
    const t = await res.text();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      throw new PowensErreur("Réponse Powens illisible.", res.status);
    }
  }

  /** Liste paginée : suit `_links.next.href` (même hôte seulement), PAGES_MAX pages au plus. Une page suivante laissée de
      côté (plafond atteint) est signalée par `tronque = true` sur le tableau renvoyé (rapport de synchronisation). */
  async function liste(chemin: string, cle: string, query: Record<string, string>) {
    const tout: unknown[] & { tronque?: boolean } = [];
    let page: any = await appel("GET", chemin, { query });
    for (let n = 1; page; n++) {
      tout.push(...(Array.isArray(page[cle]) ? page[cle] : []));
      const href = page?._links?.next?.href;
      if (typeof href !== "string" || !href) break;
      let suivante: URL;
      try {
        suivante = new URL(href, base);
      } catch {
        break;
      }
      if (suivante.origin !== origine) break;
      if (n >= PAGES_MAX) {
        tout.tronque = true;
        break;
      }
      page = await appel("GET", suivante.toString());
    }
    return tout;
  }

  const id = (v: number | string) => encodeURIComponent(String(v));

  return {
    /** Crée l'utilisateur Powens permanent. Ne jamais journaliser le résultat. */
    async authInit(clientId: string, secret: string): Promise<{ auth_token: string; id_user: number }> {
      const r: any = await appel("POST", "auth/init", { corps: { client_id: clientId, client_secret: secret } });
      if (!r || typeof r.auth_token !== "string" || !r.auth_token || r.id_user == null) throw new PowensErreur("Réponse Powens inattendue à la création de l'utilisateur.", 200);
      return { auth_token: r.auth_token, id_user: Number(r.id_user) };
    },
    /** Code temporaire (quelques minutes) pour la page de connexion ou de reconnexion. */
    async code(): Promise<string> {
      const r: any = await appel("GET", "auth/token/code");
      if (!r || typeof r.code !== "string" || !r.code) throw new PowensErreur("Réponse Powens inattendue (code temporaire).", 200);
      return r.code;
    },
    connexion: (connexionId: number | string) => appel("GET", `users/me/connections/${id(connexionId)}`, { query: { expand: "connector" } }),
    async comptes(connexionId: number | string): Promise<any[]> {
      const r: any = await appel("GET", `users/me/connections/${id(connexionId)}/accounts`, { query: { all: "" } });
      return Array.isArray(r?.accounts) ? r.accounts : [];
    },
    async placements(compteId: number | string): Promise<any[]> {
      const r: any = await appel("GET", `users/me/accounts/${id(compteId)}/investments`);
      return Array.isArray(r?.investments) ? r.investments : [];
    },
    operations: (compteId: number | string, minDate: string) =>
      liste(`users/me/accounts/${id(compteId)}/transactions`, "transactions", { min_date: minDate, limit: "1000", expand: "categories" }),
    relancer: (connexionId: number | string) =>
      appel("PUT", `users/me/connections/${id(connexionId)}`, { query: { psu_requested: "false", background: "true" } }),
    supprimerConnexion: (connexionId: number | string) => appel("DELETE", `users/me/connections/${id(connexionId)}`, { absentOk: true }),
    supprimerUtilisateur: () => appel("DELETE", "users/me", { absentOk: true }),
  };
}
