// Mémoire de l'agent (AG1, docs/superpowers/specs/2026-10-10-ag1-memoire-savoir.md) : ce que l'agent retient de
// l'utilisateur d'une conversation à l'autre. Privée (table memoire_agent, RLS user_id = auth.uid()), visible et effaçable
// dans Boussole › Profil et données › Mémoire de l'agent. Écriture directe, sans proposition : elle ne touche pas au bilan.
// La base refuse aussi le contenu sensible (contrainte public.contenu_sensible) et plafonne à 200 souvenirs (déclencheur).
// Ce module ne dépend pas d'index.ts : les utilitaires du serveur (wrap, must, UserError…) sont passés en paramètre.
import { z } from "zod";

/* Mêmes motifs que public.contenu_sensible (supabase/migrations/0009_savoir_memoire.sql) et web/src/sensible.js :
   IBAN (refusé seulement si la correspondance contient au moins IBAN_CHIFFRES_MIN chiffres : un ISIN « IE00B4L5Y983 » suivi
   d'un libellé n'en a que 7), numéro de carte (groupes de 4 chiffres séparés d'espaces, bornés par des non-chiffres),
   mots interdits (insensible à la casse). */
export const SENSIBLE = [
  "[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}",
  "(?<![0-9])[0-9]{4} ?[0-9]{4} ?[0-9]{4} ?[0-9]{1,7}(?![0-9])",
  "mot de passe|password|code secret|code pin|identifiant de connexion",
];
export const IBAN_CHIFFRES_MIN = 12;
const RE_IBAN = new RegExp(SENSIBLE[0], "g"), RE_CARTE = new RegExp(SENSIBLE[1]), RE_MOTS = new RegExp(SENSIBLE[2], "i");
const chiffres = (s: string) => s.replace(/[^0-9]/g, "").length;
export function estSensible(t: string) {
  const s = String(t ?? "");
  for (const m of s.matchAll(RE_IBAN)) if (chiffres(m[0]) >= IBAN_CHIFFRES_MIN) return true;
  return RE_CARTE.test(s) || RE_MOTS.test(s);
}

export const CATEGORIES = ["contexte", "preference", "projet", "decision", "explique", "a_suivre"] as const;
const COLS = "id, categorie, contenu, echeance, epingle, source, cree_le, maj_le";
const MEMOIRE = "Boussole › Profil et données › Mémoire de l'agent";
/** Nombre de souvenirs non épinglés renvoyés en début de session. */
export const SESSION_RECENTS = 30;

/** Souvenirs de l'utilisateur : épinglés d'abord, puis les plus récents (200 au plus, la limite de la table). */
export async function lireMemoire(db: any, must: any, categorie?: string) {
  let req = db.from("memoire_agent").select(COLS).order("epingle", { ascending: false }).order("cree_le", { ascending: false }).limit(200);
  if (categorie) req = req.eq("categorie", categorie);
  return (must("memoire_agent", await req) as any[]) ?? [];
}

/** Mémoire de début de session : tous les épinglés, puis les `n` souvenirs non épinglés les plus récents (liste déjà triée). */
export function memoireDeSession(liste: any[], n = SESSION_RECENTS) {
  return [...liste.filter((m) => m.epingle), ...liste.filter((m) => !m.epingle).slice(0, n)];
}

/** Points « à suivre » dont l'échéance (AAAA-MM-JJ) est atteinte ou dépassée au jour `auj`. */
export function aSuivreEchus(liste: any[], auj: string) {
  return liste.filter((m) => m.categorie === "a_suivre" && m.echeance && String(m.echeance).slice(0, 10) <= auj);
}

export function registerMemoire(server: any, h: { db: any; wrap: any; must: any; UserError: any; RO: any; RW: any; source: string }) {
  const { db, wrap, must, UserError, RO, RW, source } = h;
  const Cat = z.enum(CATEGORIES, { error: "Catégorie invalide : " + CATEGORIES.join(", ") + "." });

  server.registerTool("memoriser", {
    title: "Retenir",
    description: "Retient une information durable sur l'utilisateur pour les prochaines conversations (écriture directe, sans validation : la mémoire ne touche pas au bilan). Catégories : contexte (situation de vie), preference (façon d'échanger, sujets sensibles), projet, decision (prise par l'utilisateur), explique (notion déjà expliquée), a_suivre (point à reprendre, avec echeance AAAA-MM-JJ). Une phrase courte et factuelle par souvenir. Ne pas retenir ce qui est déjà dans le bilan. Jamais d'identifiants, IBAN, numéros de compte ou de carte, mots de passe (refusés). Demander l'accord avant une information sensible (santé, famille, emploi). 200 souvenirs au plus. L'utilisateur voit et efface sa mémoire dans " + MEMOIRE + ".",
    inputSchema: z.strictObject({
      categorie: Cat,
      contenu: z.string().trim().min(1, { error: "contenu : une phrase courte." }).max(500, { error: "contenu : 500 caractères au plus." }),
      echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "echeance : date AAAA-MM-JJ." }).optional().describe("Seulement pour a_suivre : date à laquelle reprendre le point (AAAA-MM-JJ)."),
      epingle: z.boolean({ error: "epingle : true ou false." }).optional().describe("true pour un souvenir à toujours garder en tête (renvoyé en premier)."),
    }),
    annotations: RW,
  }, wrap(async (a: any) => {
    if (estSensible(a.contenu)) throw new UserError("Refusé : ce texte ressemble à un identifiant, un IBAN, un numéro de compte ou de carte, ou à un mot de passe. Boussole ne retient jamais ces informations.");
    if (a.echeance && a.categorie !== "a_suivre") throw new UserError("echeance : réservée à la catégorie a_suivre.");
    const ligne = { categorie: a.categorie, contenu: a.contenu, echeance: a.echeance ?? null, epingle: !!a.epingle, source };
    const res = await db.from("memoire_agent").insert(ligne).select(COLS).single();
    // Mémoire pleine (déclencheur memoire_limite, code 54000) : le message de la base est déjà rédigé pour l'utilisateur.
    if (res.error?.code === "54000") throw new UserError(res.error.message);
    const row = must("memoire_agent", res);
    return { retenu: row, rappel: "Visible et effaçable dans " + MEMOIRE + "." };
  }));

  server.registerTool("se_souvenir", {
    title: "Ce que je sais de l'utilisateur",
    description: "Souvenirs de l'agent sur l'utilisateur (identifiant, catégorie, contenu, échéance, épinglé, source, dates), épinglés d'abord puis les plus récents, éventuellement filtrés par catégorie (contexte, preference, projet, decision, explique, a_suivre).",
    inputSchema: z.strictObject({ categorie: Cat.optional().describe("Filtre facultatif.") }),
    annotations: RO,
  }, wrap(async ({ categorie }: any) => {
    const l = await lireMemoire(db, must, categorie);
    return { nombre: l.length, souvenirs: l };
  }));

  server.registerTool("oublier", {
    title: "Oublier",
    description: "Efface définitivement un ou plusieurs souvenirs (identifiants renvoyés par se_souvenir ou demarrer_session), à la demande de l'utilisateur ou quand une information est périmée. L'utilisateur peut aussi effacer sa mémoire dans " + MEMOIRE + ".",
    inputSchema: z.strictObject({
      id: z.uuid({ error: "id : identifiant de souvenir (UUID)." }).optional(),
      ids: z.array(z.uuid({ error: "ids : identifiants de souvenirs (UUID)." })).min(1).max(200).optional(),
    }),
    annotations: { ...RW, destructiveHint: true },
  }, wrap(async (a: any) => {
    const ids = [...new Set([...(a.ids ?? []), ...(a.id ? [a.id] : [])])];
    if (!ids.length) throw new UserError("Fournissez id ou ids (identifiants renvoyés par se_souvenir).");
    const del = must("memoire_agent", await db.from("memoire_agent").delete().in("id", ids).select("id")) as any[];
    const n = (del ?? []).length;
    return { oublies: n, ...(n < ids.length ? { avertissement: `${ids.length - n} identifiant(s) introuvable(s) : déjà effacé(s) ?` } : {}) };
  }));
}
