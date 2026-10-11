/* État de la revue mensuelle (routine de l'agent, RT1 : docs/superpowers/plans/2026-10-11-rt1-routines.md), seule source de la règle
   côté app : Aujourd'hui (aujourdhui.js), Agent › Connexion (claude-guide.js), accueil (accueil.js) et store démo (store-demo.js).
   Même règle que le connecteur (retardJours et jourParis de supabase/functions/mcp/routines.ts) et que la fonction SQL
   public.routine_date (0020_routines.sql) : test/routine-etat.test.mjs les compare. Pur, sans DOM, au tutoiement.
   RoutineEtat = {
     jourParis(dateOuIso) → AAAA-MM-JJ à Paris d'un instant (Date, horodatage ISO) ; une date seule est rendue telle quelle ; vide → null.
     aujParis() → date du jour à Paris ((now() at time zone 'Europe/Paris')::date).
     routineDate(jour, depuis, ecart) → premier jour `jour` (1-28) d'un mois qui tombe au plus tôt le depuis + ecart (null si invalide).
     etat(routines, auj, { lues, dbOk }) → { code, routine, retard, questions, prochain, dernier } :
       code = inconnu (pas de routine, table non lue ou base absente) | a_activer (aucune revue_mensuelle, table lue, base là) |
       pause | retard (active, prochain passage ≤ auj, aucun passage depuis ; retard = jours depuis le prochain passage, 0 = due
       aujourd'hui) | prete (questions en attente) | a_jour ; prochain = prochainPassage tronqué à 10 caractères ;
       dernier = dernierPassage en date de Paris ; questions = questions non vides de la routine.
     phraseRoutine(questions) → phrase « Répondre avec Claude » : seulement le nombre de questions (« 2 questions en attente ») ;
       le texte des questions, écrit par une exécution planifiée de l'agent, n'entre jamais dans l'URL préremplie
       (demarrer_routine les fournit à Claude).
     phraseRevue() → phrase « Lancer ma revue avec Claude » (ClaudePrompts.phrase("revue")).
   } */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RoutineEtat = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  const TYPE = "revue_mensuelle";
  const isoOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let PARIS = null;
  try { PARIS = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }); } catch (e) { PARIS = null; }

  /** Date de Paris (AAAA-MM-JJ) d'un instant ; une date seule est rendue telle quelle ; vide → null ; illisible → ses 10 premiers
      caractères (comme le connecteur). */
  function jourParis(v) {
    if (v == null || v === "") return null;
    if (isoOk(v)) return v;
    const d = v instanceof Date ? v : new Date(String(v));
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    if (PARIS) { try { return PARIS.format(d); } catch (e) { /* repli */ } }
    return d.toISOString().slice(0, 10);
  }
  const aujParis = () => jourParis(new Date());

  /** public.routine_date(p_jour, p_depuis, p_ecart) : cible = depuis + ecart ; le jour `jour` du mois de la cible, ou du mois
      suivant s'il tombe avant la cible. */
  function routineDate(jour, depuis, ecart) {
    const j = Number(jour), e = Number(ecart) || 0;
    if (!Number.isInteger(j) || j < 1 || j > 28 || !isoOk(depuis)) return null;
    const [y, m, d] = depuis.split("-").map(Number), cible = new Date(Date.UTC(y, m - 1, d + e));
    let t = Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), j);
    if (t < cible.getTime()) t = Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, j);
    return new Date(t).toISOString().slice(0, 10);
  }

  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const plat = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  /** État de la revue mensuelle au jour `auj` (date de Paris). o.lues : la table des routines a été lue (S.routinesLues === true) ;
      o.dbOk : la base répond (S.dbOk === true). Sans ces deux conditions, l'absence de routine est « inconnu », pas « a_activer ». */
  function etat(routines, auj, o) {
    const opt = o || {}, t = jourParis(auj == null ? new Date() : auj);
    const r = (Array.isArray(routines) ? routines : []).find(x => x && x.type === TYPE);
    if (!r) return { code: opt.lues === true && opt.dbOk === true ? "a_activer" : "inconnu", routine: null, retard: null, questions: [], prochain: null, dernier: null };
    const questions = (Array.isArray(r.questions) ? r.questions : []).filter(q => q && plat(q.question));
    const pp = r.prochainPassage == null ? "" : String(r.prochainPassage).slice(0, 10);
    const prochain = isoOk(pp) ? pp : null, dp = jourParis(r.dernierPassage), dernier = isoOk(dp) ? dp : null;
    const base = { routine: r, retard: null, questions, prochain, dernier };
    if (!r.active) return Object.assign({ code: "pause" }, base);
    if (prochain && isoOk(t) && prochain <= t && (!dernier || dernier < prochain))
      return Object.assign({}, base, { code: "retard", retard: Math.round((utc(t) - utc(prochain)) / 864e5) });
    return Object.assign({ code: questions.length ? "prete" : "a_jour" }, base);
  }

  const prompts = () => (root && root.ClaudePrompts) ||
    (typeof module === "object" && module.exports && typeof require === "function" ? require("./claude-prompts.js") : null);
  const PHRASE_ROUTINE = "Boussole : réponds avec moi aux questions de ma revue mensuelle (demarrer_routine, puis le formulaire, puis questions_routine).";
  const PHRASE_REVUE = "Boussole : faisons ma revue du mois (demarrer_routine, type revue_mensuelle). Commence par demarrer_session.";
  /** « Répondre avec Claude » : le nombre de questions seulement, jamais leur texte. */
  function phraseRoutine(questions) {
    const n = (Array.isArray(questions) ? questions : []).filter(q => q && plat(q.question)).length;
    const ctx = n ? n + " question" + (n > 1 ? "s" : "") + " en attente" : undefined, P = prompts();
    return P && P.SECTIONS && P.SECTIONS.routine && typeof P.phrase === "function" ? P.phrase("routine", ctx) : PHRASE_ROUTINE;
  }
  function phraseRevue() { const P = prompts(); return P && typeof P.phrase === "function" ? P.phrase("revue") : PHRASE_REVUE; }

  return { TYPE, jourParis, aujParis, routineDate, etat, phraseRoutine, phraseRevue };
});
