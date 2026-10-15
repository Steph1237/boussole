/* IMMO1 : carte « Ta capacité d'emprunt aujourd'hui » de Patrimoine › Immobilier et crédits (spec PROJ § 8.1, moteur ProjectionImmo.capaciteEmprunt).
   Lecture seule : la carte affiche le résultat du moteur partagé, sans calcul de plus ; les réglages (type de bien, durée, usage, projet) ne
   changent que la façon dont le moteur est appelé, ils ne sont pas enregistrés. Tout ce qui manque (revenus, repères) est dit ; sans réponse
   fiable du moteur, jamais un chiffre : un état « indisponible » et « Compléter avec Claude » (ClaudePrompts).
   - Périmètre : celui de l'en-tête (S.scope : foyer, p1, p2), même appel du moteur.
   - Héros : budget d'achat total (ancien / neuf / primo), montant empruntable, mensualité maximale, apport mobilisable net (PER à part, seulement
     pour la résidence principale), durée (20 / 25 ans ; 27 ans avec différé seulement pour VEFA, CCMI ou ancien avec travaux), taux du jour avec
     sa source et sa date. Arrondis au millier : une estimation n'a pas la précision de l'euro (le détail exact est dans « Comment c'est calculé »).
   - Sensibilité : 20 et 25 ans × taux du jour −1 / 0 / +1 point, lue telle que le moteur la calcule (barres sur une base zéro commune).
   - « Comment c'est calculé » (UI.panneau) : revenus retenus, charges, taux d'effort, assurance, TAEG et taux d'usure, reste à vivre, frais, apport par
     enveloppe, sources datées, mention fixe « Estimation selon les règles du HCSF, chaque banque décide. Ce n'est pas une offre de prêt. »
   - « Ta capacité demain » (data-slot="capacite-demain") : le graphe maître en mode capacité (GrapheModele.brancher, preset « capacite » : budget d'achat P10–P90 par année,
     médiane, montant empruntable, ±1 point de taux, jalons). Il suit le périmètre de l'en-tête et, via liaison.definir, le type de bien et la durée (20 / 25 ans) de la carte ;
     il se recalcule quand l'état du store change (liaison.actualiser). Carte « aujourd'hui » indisponible → pas de graphe : un état honnête (ce qui manque, « Compléter avec
     Claude »). Moteur « vide » → la raison est affichée par le composant, jamais un chiffre inventé. Mention fixe du HCSF sous le graphe.
   Fonctions pures exportées pour les tests : donneesMoteur, optionsMoteur, calculer, manques, libelleTaux, carteHtml, indisponibleHtml, sensibiliteHtml,
   feuilleHtml, questionClaude, phraseCompleter, demainIndisponibleHtml, reglagesGraphe, libellePerimetre. Dépendances injectables (deps) : { ProjectionImmo, Calc, UI, ClaudePrompts, Fmt,
   GrapheModele, today } ; globales par défaut. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmoCapacite = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const glob = k => (typeof globalThis !== "undefined" && globalThis[k]) || null;
  const dep = (d, k) => (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] ? d[k] : glob(k));
  const noeud = typeof module === "object" && module.exports && typeof require === "function";
  const requis = (chemin) => { try { return require(chemin); } catch (e) { return null; } };
  const FmtDef = glob("Fmt") || (noeud ? requis("./format.js") : null);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NB = " ";
  const nbsp = s => String(s).replace(/[  ]/g, " ");
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const moisAnnee = iso => { const m = /^(\d{4})-(\d{2})/.exec(String(iso || "")); return m ? MOIS[+m[2] - 1] + " " + m[1] : ""; };
  const MENTION = "Estimation selon les règles du HCSF, chaque banque décide. Ce n'est pas une offre de prêt.";

  /* ---------- réglages de la carte (jamais enregistrés) ---------- */
  const TYPES = [{ id: "ancien", label: "Ancien" }, { id: "neuf", label: "Neuf" }, { id: "primo", label: "Primo", aria: "Primo-accédant dans l'ancien" }];
  const TYPE_NOM = { ancien: "ancien", neuf: "neuf", primo: "primo-accédant dans l'ancien" };
  const PROJETS = [{ id: "standard", label: "Classique", aria: "Achat classique" }, { id: "vefa", label: "VEFA", aria: "Vente en l'état futur d'achèvement" },
    { id: "ccmi", label: "CCMI", aria: "Construction de maison individuelle" }, { id: "ancien_travaux", label: "Ancien + travaux", aria: "Ancien avec au moins 10 % de travaux" }];
  const USAGES = [{ id: "rp", label: "Résidence principale" }, { id: "locatif", label: "Investissement locatif" }];
  const etatDefaut = () => ({ type: "ancien", duree: 25, projet: "standard", usage: "rp", metrique: "budget", reglages: false });

  /* ---------- données du moteur ---------- */
  /** Jour de Paris (AAAA-MM-JJ) : deps.today, sinon RoutineEtat.aujParis(), sinon la date locale. */
  function jourDe(deps) {
    if (deps && /^\d{4}-\d{2}-\d{2}$/.test(deps.today || "")) return deps.today;
    const R = dep(deps, "RoutineEtat");
    if (R && typeof R.aujParis === "function") { const j = R.aujParis(); if (j) return j; }
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  /** Entrée du moteur depuis l'état du store (S) : positions, config, profil, budget, classes, repères du savoir commun. */
  function donneesMoteur(S, today) {
    const s = S || {};
    return { today, positions: s.positions || [], instruments: [], config: s.config || {}, profil: s.profil || null, budget: s.budget || null,
      objectifs: s.objectifs || [], classes: s.classes || {}, reperes: (s.savoir && s.savoir.reperes) || [] };
  }
  const repere = (S, cle) => (((S || {}).savoir || {}).reperes || []).find(r => r && r.cle === cle) || null;
  /** Options du moteur pour un état de la carte. 27 ans n'est possible qu'avec un projet à différé ; sinon la durée retombe à 25 ans. */
  function optionsMoteur(S, etat) {
    const e = Object.assign(etatDefaut(), etat || {}), sc = S && (S.scope === "p1" || S.scope === "p2") ? S.scope : "foyer";
    const diff = e.projet !== "standard", duree = e.duree === 27 && !diff ? 25 : e.duree;
    const seuil = repere(S, "hcsf_travaux_seuil_pct");
    const o = { perimetre: sc, duree_ans: duree, neuf: e.type === "neuf", primo: e.type === "primo", usage: e.usage };
    if (diff) { o.type_projet = e.projet; if (e.projet === "ancien_travaux") o.travaux_pct = seuil ? +seuil.valeur : 10; }
    return o;
  }

  /* ---------- ce qui manque ---------- */
  /* Repères que le moteur signale sans qu'ils concernent la capacité d'emprunt (projection de patrimoine). */
  const HORS_SUJET = ["inflation_hypothese", "salaire_croissance_reelle"];
  const LIBELLES_REPERES = [
    [/^hcsf_taux_effort$/, "le plafond d'endettement du HCSF"], [/^hcsf_duree_max/, "la durée maximale fixée par le HCSF"], [/^hcsf_travaux/, "le seuil de travaux du HCSF"],
    [/^taux_credit_immo/, "le taux du jour des crédits immobiliers"], [/^taux_usure/, "le taux d'usure"], [/^assurance_emprunteur/, "le taux de l'assurance emprunteur"],
    [/^frais_acquisition/, "les frais d'acquisition (notaire)"], [/^garantie_pct$/, "le coût de la garantie du prêt"], [/^frais_dossier$/, "les frais de dossier"],
    [/^revenus_locatifs/, "la part des loyers retenue par les banques"],
  ];
  const libelleRepere = cle => { const t = LIBELLES_REPERES.find(([re]) => re.test(cle)); return t ? t[1] : "le repère « " + cle + " »"; };
  /** Clés de repères manquantes d'une sortie du moteur (champ manquants et message « repère manquant (…) »), sans celles qui sont hors sujet. */
  function clesManquantes(r) {
    const cles = new Set((r && r.manquants) || []);
    ((r && r.avertissements) || []).forEach(m => { const x = /repère manquant \(([^)]*)\)/.exec(m); if (x) x[1].split(",").forEach(k => cles.add(k.trim())); });
    return [...cles].filter(k => k && !HORS_SUJET.includes(k));
  }

  /** Nom du périmètre : « le foyer », « Camille ». */
  function nomPerimetre(S) {
    const sc = S && S.scope;
    if (sc !== "p1" && sc !== "p2") return { foyer: true, nom: "le foyer", court: "Foyer" };
    const p = ((S && S.people) || []).find(x => x && x.id === sc), pr = S && S.profil && S.profil.personnes && S.profil.personnes[sc];
    const nom = String((p && p.nom) || (pr && pr.nom) || "").trim() || (sc === "p1" ? "Personne 1" : "Personne 2");
    return { foyer: false, nom, court: nom };
  }

  /** Calcule la vue : { statut: "ok" | "indisponible", r, manques: [{ nature: "profil" | "repere", cle?, texte }], etat, perimetre }.
      « ok » seulement si le moteur répond sans repère manquant et avec des revenus retenus : sinon aucun chiffre n'est exposé. */
  function calculer(S, etat, deps) {
    const e = Object.assign(etatDefaut(), etat || {}), per = nomPerimetre(S), today = jourDe(deps);
    const Immo = dep(deps, "ProjectionImmo");
    const base = { etat: e, perimetre: per, today };
    if (!Immo || typeof Immo.capaciteEmprunt !== "function") return Object.assign(base, { statut: "indisponible", r: null, manques: [{ nature: "repere", texte: "le moteur de calcul de la capacité d'emprunt" }] });
    if (!S || !S.profil) return Object.assign(base, { statut: "indisponible", r: null, manques: [{ nature: "profil", texte: "tes revenus nets : ton profil n'est pas encore renseigné" }] });
    let r;
    try { r = Immo.capaciteEmprunt(donneesMoteur(S, today), optionsMoteur(S, e)); }
    catch (err) { return Object.assign(base, { statut: "indisponible", r: null, manques: [{ nature: "repere", texte: "un calcul qui n'a pas pu aboutir" }] }); }
    /* Le moteur n'impose le plafond de durée que s'il le connaît : sans lui, aucune durée n'est vérifiée, donc aucun chiffre. */
    const cles = clesManquantes(r);
    if (!repere(S, "hcsf_duree_max") && !cles.includes("hcsf_duree_max")) cles.push("hcsf_duree_max");
    const manques = cles.map(cle => ({ nature: "repere", cle, texte: libelleRepere(cle) }));
    const seen = new Set(), uniques = manques.filter(m => { if (seen.has(m.texte)) return false; seen.add(m.texte); return true; });
    if (r.indisponible || uniques.length) {
      if (r.indisponible && !uniques.length) uniques.push({ nature: "repere", texte: (r.avertissements && r.avertissements[0]) || "une donnée nécessaire au calcul" });
      return Object.assign(base, { statut: "indisponible", r, manques: uniques });
    }
    const total = r.revenus_retenus && r.revenus_retenus.total;
    if (!(total > 0)) return Object.assign(base, { statut: "indisponible", r, manques: [{ nature: "profil", texte: per.foyer ? "tes revenus nets (salaires) : aucun n'est enregistré" : "les revenus nets de " + per.nom + " : aucun n'est enregistré" }] });
    return Object.assign(base, { statut: "ok", r, manques: [] });
  }

  /* ---------- formats ---------- */
  const fm = deps => dep(deps, "Fmt") || FmtDef;
  const mille = (F, v) => F.fmtEUR(Math.round(v / 1000) * 1000);
  const pct2 = (F, v) => F.fmtPct(v, { decimales: 2 });
  /** Pourcentage sans « ,0 » inutile : 8 % et non 8,0 %. */
  const pctN = (F, v) => (Number.isInteger(+v) ? F.fmtPct(v, { decimales: 0 }) : F.fmtPct(v));
  /** Écart signé en k€ à une décimale : « +10,5 k€ », « −9,3 k€ » (une seule unité dans toute la table). */
  const kDelta = (F, d) => { const a = Math.abs(d); return (d < 0 ? "−" : "+") + F.fmtNombre(a / 1000, { decimales: 1 }) + NB + "k€"; };
  const parAn = n => n + NB + "ans";
  /** « taux moyen 25 ans, Observatoire Crédit Logement, août 2026 » : durée de référence, organisme de la source, mois du taux. */
  function libelleTaux(taux) {
    if (!taux) return "";
    let org = String(taux.source || "").replace(/^Valeur d'exemple \(démo\)\s*[—-]\s*/, "").split(/\s+[—-]\s+/)[0].replace(/\/CSA\b/, "").trim();
    const mois = moisAnnee(taux.date_effet);
    const morceaux = ["taux moyen " + (taux.duree_reference || "") + " ans"].concat(org ? [org] : [], mois ? [mois] : []);
    return morceaux.join(", ");
  }

  /* ---------- carte ---------- */
  const SVG_CHEVRON = '<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';
  const metrique = (id, label, valeur, sous) => '<div class="ic-m" data-ic-m="' + id + '"><dt class="ic-m-l">' + esc(label) + '</dt><dd class="ic-m-v">' + esc(valeur) + "</dd>" +
    (sous ? '<dd class="ic-m-s">' + esc(sous) + "</dd>" : "") + "</div>";

  /** Sensibilité : table 2 durées × 3 taux, barres sur une base zéro commune. Les valeurs affichées sont celles du moteur (data-valeur exact). */
  function sensibiliteHtml(v, deps) {
    const F = fm(deps), r = v.r, cle = v.etat.metrique === "pret" ? "montant_empruntable" : "budget_achat", nom = v.etat.metrique === "pret" ? "Montant emprunté" : "Budget d'achat";
    const S6 = r.sensibilite, max = Math.max.apply(null, S6.map(x => x[cle]));
    const cell = (x, centre) => {
      const val = x[cle], d = val - centre[cle], w = max > 0 ? Math.max(2, val / max * 100) : 0, actuel = x.duree_ans === r.duree_amortissement_ans && x.delta_pt === 0;
      const delta = x.delta_pt === 0 ? "référence" : kDelta(F, d);
      const lu = x.delta_pt === 0 ? "taux du jour" : kDelta(F, Math.abs(d)).slice(1) + (d >= 0 ? " de plus" : " de moins") + " qu'au taux du jour";
      return '<td class="ic-s-c' + (x.delta_pt === 0 ? " centre" : "") + (actuel ? " actuel" : "") + '" data-ic-sens="' + x.duree_ans + "|" + x.delta_pt + '" data-valeur="' + x[cle] + '">' +
        '<span class="ic-s-bar" aria-hidden="true"><i style="width:' + w.toFixed(1) + '%"></i></span>' +
        '<span class="ic-s-v">' + esc(F.fmtEUR(val, { compact: "graphe" })) + "</span>" +
        '<span class="ic-s-d" aria-hidden="true">' + esc(delta) + "</span>" +
        '<span class="ui-sr">' + esc(lu + (actuel ? " (ton réglage)" : "")) + "</span></td>";
    };
    const cols = S6.filter(x => x.duree_ans === 20), taux = cols.map(x => ({ delta: x.delta_pt, t: x.taux_pct }));
    const tete = taux.map(c => '<th scope="col" class="ic-s-h' + (c.delta === 0 ? " centre" : "") + '"><span class="ic-s-t">' + esc(pct2(F, c.t)) + '</span><span class="ic-s-tl">' +
      esc(c.delta === 0 ? "taux du jour" : (c.delta > 0 ? "+" : "−") + Math.abs(c.delta) + NB + "pt") + "</span></th>").join("");
    const ligne = ans => {
      const L = S6.filter(x => x.duree_ans === ans), centre = L.find(x => x.delta_pt === 0);
      return '<tr><th scope="row" class="ic-s-r">' + esc(parAn(ans)) + "</th>" + L.map(x => cell(x, centre)).join("") + "</tr>";
    };
    return '<table class="ic-s-table" data-ic-sensibilite><caption class="ui-sr">' + esc(nom + " selon la durée et le taux") + '</caption><thead><tr><td></td>' + tete + "</tr></thead><tbody>" + ligne(20) + ligne(25) + "</tbody></table>";
  }

  /** Corps de la carte quand le moteur répond : héros, sensibilité, réglages, pied. Les bascules sont posées après coup (UI.bascule dans les #ic…). */
  function carteHtml(v, deps) {
    const F = fm(deps), r = v.r, e = v.etat, per = v.perimetre;
    const taux = r.taux, perAchat = r.apport.per > 0;
    const diffActif = e.projet !== "standard";
    const alertes = [];
    if (taux.a_actualiser) alertes.push('<span class="ui-puce surveiller" data-ic-alerte="taux"><span class="ui-puce-point" aria-hidden="true"></span>Taux à actualiser</span>');
    if (r.usure && r.usure.depasse) alertes.push('<p class="ic-alerte" role="note" data-ic-alerte="usure">Le TAEG estimé (' + esc(pct2(F, r.taeg_estime)) + ") dépasse le taux d'usure (" + esc(pct2(F, r.usure.valeur)) +
      ") : une banque ne pourrait pas accorder ce prêt.</p>");
    const dureeTxt = r.differe_ans > 0 ? parAn(r.duree_ans) + " dont " + r.differe_ans + " an" + (r.differe_ans > 1 ? "s" : "") + " de différé : l'amortissement reste limité à " + parAn(r.duree_amortissement_ans) + "."
      : "";
    const reglages = '<details class="ui-acc ic-reglages"' + (e.reglages ? " open" : "") + '><summary class="ui-acc-titre"><span>Hypothèses du projet</span>' +
      '<span class="ic-reg-res">' + esc((e.usage === "rp" ? "Résidence principale" : "Investissement locatif") + " · " + (PROJETS.find(p => p.id === e.projet) || PROJETS[0]).label) + "</span>" +
      '<span class="ui-acc-chevron"><svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg></span></summary>' +
      '<div class="ui-acc-corps ic-reg-corps">' +
      '<div class="ic-reg"><span class="ic-lbl" id="icUsageL">Usage du bien</span><div id="icUsage"></div><p class="ic-note">Le PER ne compte dans l\'apport que pour une résidence principale (déblocage anticipé).</p></div>' +
      '<div class="ic-reg"><span class="ic-lbl" id="icProjetL">Type de projet</span><div id="icProjet"></div><p class="ic-note">Un différé permet une durée de 27 ans (l\'amortissement reste limité à 25 ans) pour une vente en l\'état futur d\'achèvement, une construction de maison individuelle ou de l\'ancien avec au moins 10 % de travaux.</p></div>' +
      "</div></details>";
    return '<div class="ic-grille">' +
      '<div class="ic-hero">' +
      '<div class="ic-hero-tete"><span class="ic-lbl" id="icBudgetL">Budget d\'achat total</span><div id="icType"></div></div>' +
      '<p class="ic-hero-v" aria-labelledby="icBudgetL" data-ic-budget="' + r.budget_achat + '"><span class="ic-hero-n">' + esc(mille(F, r.budget_achat)) + "</span></p>" +
      '<p class="ic-hero-s">Prix du bien visé, une fois payés les frais de notaire (' + esc(pctN(F, r.frais.acquisition_pct)) + "), de garantie et de dossier. Arrondi au millier.</p>" +
      alertes.join("") +
      '<div class="ic-duree"><span class="ic-lbl" id="icDureeL">Durée du prêt</span><div id="icDuree"></div>' + (dureeTxt ? '<p class="ic-note" data-ic-differe>' + esc(dureeTxt) + "</p>" : "") + "</div>" +
      '<dl class="ic-metrics">' +
      metrique("emprunt", "Montant empruntable", mille(F, r.montant_empruntable), "prêt, assurance comprise") +
      metrique("mensualite", "Mensualité maximale", F.fmtEUR(r.mensualite_max) + NB + "/ mois", pctN(F, r.taux_effort_pct) + " de tes revenus retenus, moins tes crédits") +
      metrique("apport", "Apport mobilisable", mille(F, r.apport.total), "net d'impôts, matelas exclu" + (perAchat ? ", dont PER " + mille(F, r.apport.per) : "")) +
      metrique("taux", "Taux du jour", pct2(F, taux.valeur), libelleTaux(taux)) +
      "</dl></div>" +
      '<div class="ic-sens"><div class="ic-sens-tete"><h3 class="ic-h3" id="icSensT">Si le taux ou la durée changent</h3><div id="icMetrique"></div></div>' +
      sensibiliteHtml(v, deps) +
      '<p class="ic-note">Même mensualité maximale (' + esc(F.fmtEUR(r.mensualite_max)) + "), taux du jour de ta durée " + esc(pct2(F, taux.valeur)) + " ± 1 point. Les barres partent de zéro.</p></div>" +
      "</div>" + reglages +
      '<div class="ic-pied"><button type="button" class="ui-btn secondaire ic-feuille-btn" data-ic-feuille aria-haspopup="dialog">Comment c\'est calculé' + SVG_CHEVRON + "</button>" +
      '<p class="ic-mention">' + esc(r.mention || MENTION) + "</p></div>";
  }

  /** Liste « ce qui manque » (puces <li>), partagée par la carte et l'emplacement « demain ». */
  const listeManques = v => v.manques.map(m => '<li data-ic-manque="' + esc(m.nature) + '">' + esc(m.texte.charAt(0).toUpperCase() + m.texte.slice(1)) + (m.nature === "repere" ? '<span class="ic-m-origine"> (repère de référence de Boussole)</span>' : "") + "</li>").join("");
  /** Manque de données : ce qui manque, ce que Boussole ne fait pas à la place, et un seul bouton Claude (rendu par l'appelant). */
  function indisponibleHtml(v, deps) {
    const U = dep(deps, "UI"), profil = v.manques.some(m => m.nature === "profil"), repere = v.manques.some(m => m.nature === "repere");
    const mention = (v.r && v.r.mention) || MENTION;
    return '<div class="ic-indispo" data-ic-indisponible role="status"><p class="ic-indispo-t">Je ne peux pas estimer ta capacité d\'emprunt pour l\'instant.</p>' +
      '<p class="ic-indispo-p">Il manque :</p><ul class="ic-indispo-l">' + listeManques(v) + "</ul>" +
      '<p class="ic-note">' + (profil ? "Boussole n'affiche aucun montant tant que ces éléments manquent : une réponse fausse serait pire que pas de réponse." : "Boussole n'affiche aucun montant sans ces repères de référence : une réponse fausse serait pire que pas de réponse.") +
      (repere && !profil ? " Rien à faire de ton côté ; Claude peut vérifier ce qui manque." : "") + "</p>" +
      '<div class="ic-indispo-act">' + (U && U.demanderAClaude ? U.demanderAClaude(phraseCompleter(v, deps), "Compléter avec Claude") : "") + "</div>" +
      '<p class="ic-mention">' + esc(mention) + "</p></div>";
  }
  /** « Ta capacité demain » sans capacité d'aujourd'hui : elle en part, donc aucun graphe ni chiffre ; ce qui manque et « Compléter avec Claude ». */
  function demainIndisponibleHtml(v, deps) {
    const U = dep(deps, "UI");
    return '<div class="ic-indispo ic-demain-indispo" data-ic-demain-indisponible role="status"><h3 class="ic-h3">Ta capacité demain</h3>' +
      '<p class="ic-indispo-p">Je ne peux pas tracer l\'évolution de ta capacité d\'achat : elle part de ta capacité d\'emprunt d\'aujourd\'hui, que je ne peux pas estimer pour l\'instant.</p>' +
      '<p class="ic-indispo-p">Il manque :</p><ul class="ic-indispo-l">' + listeManques(v) + "</ul>" +
      '<p class="ic-note">Aucun montant n\'est affiché tant que ces éléments manquent.</p>' +
      '<div class="ic-indispo-act">' + (U && U.demanderAClaude ? U.demanderAClaude(phraseCompleter(v, deps), "Compléter avec Claude") : "") + "</div></div>";
  }
  /** Phrase prête de « Compléter avec Claude » : revenus d'abord, sinon la capacité d'emprunt avec ce qui manque. */
  function phraseCompleter(v, deps) {
    const P = dep(deps, "ClaudePrompts");
    const profil = v && v.manques && v.manques.some(m => m.nature === "profil");
    const contexte = profil ? "mes revenus nets, pour calculer ma capacité d'emprunt" : "ma capacité d'emprunt (il manque : " + ((v && v.manques) || []).map(m => m.texte).join(" ; ") + ")";
    if (P && typeof P.phrase === "function") return P.phrase(profil ? "revenus" : "immobilier", contexte);
    return "Boussole : aide-moi à compléter " + contexte + ".";
  }

  /* ---------- feuille « Comment c'est calculé » ---------- */
  const eq = (libelle, montant, o) => '<div class="ic-f-l' + (o && o.total ? " total" : "") + '"><dt>' + esc(libelle) + "</dt><dd>" + esc(montant) + "</dd></div>";
  const sec = (titre, corps, id) => '<section class="ic-f-sec"' + (id ? ' data-ic-f="' + id + '"' : "") + '><h3 class="ic-f-h">' + esc(titre) + "</h3>" + corps + "</section>";
  const COURTS = { hcsf_taux_effort: "plafond d'endettement", hcsf_duree_max: "durée maximale", hcsf_duree_max_differe: "durée avec différé", hcsf_travaux_seuil_pct: "seuil de travaux",
    taux_usure_moins_10: "taux d'usure", taux_usure_10_20: "taux d'usure", taux_usure_20_plus: "taux d'usure", frais_acquisition_ancien_pct: "frais d'acquisition", frais_acquisition_primo_pct: "frais d'acquisition",
    frais_acquisition_neuf_pct: "frais d'acquisition", garantie_pct: "garantie du prêt", frais_dossier: "frais de dossier", assurance_emprunteur_defaut_pct: "assurance emprunteur", revenus_locatifs_ponderation: "pondération des loyers" };
  /** Sources par organisme : titre, lien, ce qu'elles fournissent (avec le mois pour les taux) et dernière vérification. */
  function sourcesGroupees(S, r, F) {
    const groupes = new Map();
    (r.sources || []).forEach(s => {
      const rep = repere(S, s.cle), k = (s.titre || "") + "|" + (s.url || "");
      const g = groupes.get(k) || { titre: s.titre || "Source non indiquée", url: s.url, objets: [], verifie: "" };
      let obj = COURTS[s.cle] || (/^taux_credit_immo_(\d+)/.exec(s.cle) ? "taux " + /^taux_credit_immo_(\d+)/.exec(s.cle)[1] + " ans" : "") || (rep && rep.libelle) || s.cle;
      if (/^taux_/.test(s.cle) && rep && rep.dateEffet) obj += " (" + moisAnnee(rep.dateEffet) + ")";
      if (!g.objets.includes(obj)) g.objets.push(obj);
      if ((s.verifie_le || "") > g.verifie) g.verifie = s.verifie_le || "";
      groupes.set(k, g);
    });
    return [...groupes.values()];
  }
  /** Contenu du panneau « Comment c'est calculé » (HTML échappé). */
  function feuilleHtml(v, S, deps) {
    const F = fm(deps), r = v.r, eur = x => F.fmtEUR(x), tx = x => pct2(F, x);
    const hors = r.depenses_hors_logement;
    const revenus = sec("Revenus retenus", '<dl class="ic-f-dl">' + r.revenus_retenus.detail.map(d => eq(d.libelle, eur(d.montant) + "/mois")).join("") + eq("Total retenu", eur(r.revenus_retenus.total) + "/mois", { total: true }) + "</dl>" +
      '<p class="ic-f-n">Revenus nets avant impôt sur le revenu, comme le prévoit la décision du HCSF. Les primes ne comptent que si ton profil les porte (moyenne sur 3 ans).</p>', "revenus");
    const charges = sec("Charges et mensualité maximale", '<dl class="ic-f-dl">' + eq("Crédits en cours (assurance comprise)", eur(r.charges) + "/mois") +
      eq("Taux d'effort maximal du HCSF", pctN(F, r.taux_effort_pct)) +
      eq(pctN(F, r.taux_effort_pct) + " × " + eur(r.revenus_retenus.total) + " − " + eur(r.charges), eur(r.mensualite_max) + "/mois", { total: true }) + "</dl>" +
      '<p class="ic-f-n">La mensualité maximale, assurance emprunteur comprise, est ce que le plafond d\'endettement laisse libre une fois tes crédits en cours payés.</p>', "charges");
    const assurance = sec("Assurance emprunteur", '<dl class="ic-f-dl">' + eq("Taux annuel sur le capital", tx(r.assurance_pct)) + eq("Assurance mensuelle", eur(r.assurance_mensuelle)) + eq("Échéance du prêt, hors assurance", eur(r.echeance)) + "</dl>" +
      ((S && S.config && S.config.projection && S.config.projection.assurance_pct != null) ? "" : '<p class="ic-f-n">Taux supposé (hypothèse de Boussole) : à confirmer avec ton assurance.</p>'), "assurance");
    const budget = r.budget_achat, fraisAcq = (r.montant_empruntable + r.apport.total - r.frais.garantie - r.frais.dossier) - budget;
    const pret = sec("Du prêt au budget d'achat", '<dl class="ic-f-dl">' + eq("Montant empruntable", eur(r.montant_empruntable)) + eq("+ Apport mobilisable", eur(r.apport.total)) +
      eq("− Garantie du prêt (" + pctN(F, Math.round(r.frais.garantie / Math.max(1, r.montant_empruntable) * 1000) / 10) + ")", eur(r.frais.garantie)) + eq("− Frais de dossier", eur(r.frais.dossier)) +
      eq("− Frais d'acquisition (" + pctN(F, r.frais.acquisition_pct) + ", " + TYPE_NOM[v.etat.type] + ")", eur(fraisAcq)) + eq("= Budget d'achat", eur(budget), { total: true }) + "</dl>" +
      '<p class="ic-f-n">Montant du prêt : ' + esc(tx(r.taux.valeur)) + " sur " + esc(parAn(r.duree_amortissement_ans)) + (r.differe_ans > 0 ? ", avec " + r.differe_ans + " an" + (r.differe_ans > 1 ? "s" : "") + " de différé" : "") +
      " (" + esc(libelleTaux(r.taux)) + (r.taux.a_actualiser ? " ; à actualiser" : "") + ").</p>", "pret");
    const u = r.usure || {};
    const usure = sec("TAEG estimé et taux d'usure", '<dl class="ic-f-dl">' + eq("TAEG estimé", tx(r.taeg_estime)) + eq("Taux d'usure" + (u.tranche ? " (" + ({ moins_10: "moins de 10 ans", "10_20": "10 à moins de 20 ans", "20_plus": "20 ans et plus" }[u.tranche] || "") + ")" : ""), u.valeur != null ? tx(u.valeur) : "indisponible") + "</dl>" +
      (u.depasse ? '<p class="ic-f-alerte" role="note" data-ic-f-usure="depasse">Le TAEG estimé dépasse le taux d\'usure : une banque ne pourrait pas accorder ce prêt. Réduis le montant ou allonge la durée.</p>'
        : u.valeur != null ? '<p class="ic-f-n" data-ic-f-usure="ok">Le TAEG estimé (assurance, garantie et frais de dossier compris) reste sous le taux d\'usure' + (u.date_effet ? " en vigueur depuis le " + esc(F.fmtDate(u.date_effet)) : "") + ".</p>"
          : '<p class="ic-f-n">Taux d\'usure indisponible : le TAEG n\'a pas pu être comparé.</p>'), "usure");
    const reste = sec("Reste à vivre", '<dl class="ic-f-dl">' + eq("Revenus retenus", eur(r.revenus_retenus.total)) + eq("− Crédits en cours", eur(r.charges)) + eq("− Nouvelle mensualité (assurance comprise)", eur(r.mensualite_nouvelle)) + eq("= Il te resterait", eur(r.reste_a_vivre) + "/mois", { total: true }) + "</dl>" +
      '<p class="ic-f-n">' + (hors != null ? "Tes dépenses courantes hors logement sont de " + esc(eur(hors)) + " par mois d'après ton budget. " : "") + "Aucun seuil n'est inventé : chaque banque a le sien.</p>", "reste");
    // apport : une ligne par enveloppe (les compartiments d'une même enveloppe sont regroupés)
    const parEnv = new Map();
    r.apport.detail.forEach(d => { const g = parEnv.get(d.enveloppe) || { brut: 0, net: 0, impots: 0, type: d.type }; g.brut += d.brut; g.net += d.net; g.impots += d.impots; parEnv.set(d.enveloppe, g); });
    const lignesApport = [...parEnv.entries()].map(([nom, g]) => "<tr><th scope=\"row\">" + esc(nom) + (g.type === "per" ? ' <span class="ic-f-tag">résidence principale</span>' : "") + '</th><td>' + esc(eur(g.brut)) + "</td><td>" + esc(g.impots > 0 ? "−" + NB + eur(g.impots) : eur(0)) + "</td><td>" + esc(eur(g.net)) + "</td></tr>").join("");
    const apport = sec("Apport mobilisable, par enveloppe", (parEnv.size ? '<div class="ic-f-scroll"><table class="ic-f-table" data-ic-apport><thead><tr><th scope="col">Enveloppe</th><th scope="col">Valeur</th><th scope="col">Impôts</th><th scope="col">Net</th></tr></thead><tbody>' + lignesApport +
      '</tbody><tfoot><tr><th scope="row">Total net</th><td></td><td>' + esc(r.apport.impots > 0 ? "−" + NB + eur(r.apport.impots) : eur(0)) + "</td><td>" + esc(eur(r.apport.total)) + "</td></tr></tfoot></table></div>" : '<p class="ic-f-n">Aucun placement mobilisable au-dessus du matelas.</p>') +
      '<p class="ic-f-n">Matelas de précaution exclu : ' + esc(eur(r.apport.matelas_exclu)) + ". Impôts calculés comme pour un retrait aujourd'hui" + (r.apport.per > 0 ? "; le PER (" + esc(eur(r.apport.per)) + ") compte pour l'achat d'une résidence principale seulement." : ".") + "</p>", "apport");
    const src = sourcesGroupees(S, r, F);
    const sources = sec("Sources", '<ul class="ic-f-src">' + src.map(s => "<li>" + (s.url && /^https:\/\//.test(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.titre) + '<span class="ui-sr"> (nouvel onglet)</span></a>' : esc(s.titre)) +
      '<span class="ic-f-src-d">' + esc(s.objets.join(" · ") + (s.verifie ? " · vérifié le " + F.fmtDate(s.verifie) : "")) + "</span></li>").join("") + "</ul>", "sources");
    const notes = (r.avertissements || []).length ? sec("À savoir", "<ul class=\"ic-f-av\">" + r.avertissements.map(a => "<li>" + esc(a) + "</li>").join("") + "</ul>", "avertissements") : "";
    return revenus + charges + assurance + pret + usure + reste + apport + sources + notes + '<p class="ic-mention" data-ic-mention>' + esc(r.mention || MENTION) + "</p>";
  }

  /** Question préremplie de « Demander à Claude » dans la feuille (espaces simples, aucun conseil prétendu). */
  function questionClaude(v, deps) {
    const F = fm(deps), r = v.r;
    return nbsp("Dans Boussole, ma capacité d'emprunt est estimée à un budget d'achat d'environ " + mille(F, r.budget_achat) + " (prêt de " + mille(F, r.montant_empruntable) + ", apport de " + mille(F, r.apport.total) +
      "), pour une mensualité maximale de " + F.fmtEUR(r.mensualite_max) + " sur " + r.duree_amortissement_ans + " ans à " + pct2(F, r.taux.valeur) + ". Explique-moi comment c'est calculé et ce qui pourrait la faire évoluer.");
  }

  /* ============================================================ vue ============================================================ */
  let racine = null, etat = etatDefaut(), dernier = null, derniereS = null, sigCarte = "", ouvertFeuille = false, retourFeuille = null, deps0 = null, liaison = null, sigDemain = "";
  const $ = id => racine && racine.querySelector("#" + id);

  function lier(v, focusId) {
    const U = dep(deps0, "UI");
    if (!U) return;
    const refaire = (cle, id) => nouvelId => { etat[cle] = cle === "duree" ? +nouvelId : nouvelId; if (cle === "projet" && nouvelId === "standard" && etat.duree === 27) etat.duree = 25; rendre(derniereS, { focus: id }); };
    const b = (idEl, cle, label, options) => { const el = $(idEl); if (el) U.bascule(el, { label, options, actif: String(etat[cle]), surChange: refaire(cle, idEl) }); };
    b("icType", "type", "Type de bien", TYPES);
    b("icDuree", "duree", "Durée du prêt", [{ id: "20", label: "20 ans" }, { id: "25", label: "25 ans" }].concat(etat.projet !== "standard" ? [{ id: "27", label: "27 ans", aria: "27 ans avec différé" }] : []));
    b("icMetrique", "metrique", "Grandeur comparée", [{ id: "budget", label: "Budget", aria: "Budget d'achat" }, { id: "pret", label: "Prêt", aria: "Montant emprunté" }]);
    b("icUsage", "usage", "Usage du bien", USAGES);
    b("icProjet", "projet", "Type de projet", PROJETS);
    if (focusId) { const g = $(focusId), f = g && g.querySelector('[aria-checked="true"]'); if (f && f.focus) f.focus(); }
  }

  /** (Re)dessine la carte : HTML inchangé → rien n'est réécrit (ni focus perdu, ni réglages repliés). `o.focus` = identifiant de la bascule à refocaliser. */
  function rendre(S, o) {
    if (!racine || !S) return;
    derniereS = S;
    const U = dep(deps0, "UI");
    const reg = racine.querySelector(".ic-reglages");
    if (reg) etat.reglages = reg.hasAttribute("open");
    const v = dernier = calculer(S, etat, deps0);
    if (etat.duree === 27 && etat.projet === "standard") etat.duree = 25;
    const per = v.perimetre;
    $("icPerimetre").textContent = "Calculée pour " + per.nom + ".";
    const corps = v.statut === "ok" ? carteHtml(v, deps0) : indisponibleHtml(v, deps0);
    const sig = v.statut + "|" + corps.replace(' ic-reglages" open', ' ic-reglages"') + "|" + JSON.stringify(Object.assign({}, etat, { reglages: false }));
    if (sig !== sigCarte || (o && o.focus)) {
      sigCarte = sig;
      $("icCorps").innerHTML = corps;
      if (v.statut === "ok") lier(v, o && o.focus);
    }
    rafraichirFeuille(S);
    demain(v, S);
    return v;
  }

  /* ---------- « Ta capacité demain » : le graphe maître en mode capacité ---------- */
  /** Réglages du graphe depuis la carte : le graphe n'a que 20 et 25 ans (27 ans avec différé → 25) et un type de bien (ancien, neuf, primo). */
  function reglagesGraphe(e) { const x = e || {}; return { duree: x.duree === 20 ? 20 : 25, neuf: x.type === "neuf", primo: x.type === "primo" }; }
  /** Périmètre du graphe, comme la carte « aujourd'hui » : « du foyer », « de Camille ». */
  function libellePerimetre(S, deps) {
    if (!S || (S.scope !== "p1" && S.scope !== "p2")) return "du foyer";
    const C = dep(deps, "Calc"), per = nomPerimetre(S);
    return C && typeof C.deNom === "function" ? C.deNom(per.nom, S.scope === "p2" ? 2 : 1) : "de " + per.nom;
  }
  function demain(v, S) {
    const host = $("icGraphe"), ind = $("icDemainIndispo"), men = $("icDemainMention");
    if (!host || !ind || !men) return;
    if (v.statut !== "ok") {
      /* Pas de capacité d'aujourd'hui : pas de graphe (il part d'elle), pas de chiffre. */
      if (liaison) { try { liaison.detruire(); } catch (e) { /* le composant est déjà parti */ } liaison = null; host.innerHTML = ""; }
      host.hidden = true; men.hidden = true; ind.hidden = false;
      const h = demainIndisponibleHtml(v, deps0);
      if (h !== sigDemain) { sigDemain = h; ind.innerHTML = h; }
      return;
    }
    if (sigDemain) { sigDemain = ""; ind.innerHTML = ""; }
    ind.hidden = true; host.hidden = false; men.hidden = false;
    const GM = dep(deps0, "GrapheModele"), r = reglagesGraphe(etat);
    if (!liaison && GM && typeof GM.brancher === "function") {
      liaison = GM.brancher(host, { preset: "capacite", deps: { UI: dep(deps0, "UI") }, today: () => jourDe(deps0), perimetre: () => libellePerimetre(derniereS, deps0), reglages: r });
    }
    if (!liaison) { host.innerHTML = '<p class="ic-note" role="status">Le graphique de ta capacité demain n\'a pas pu se charger.</p>'; return; }
    liaison.actualiser(S);
    const cur = typeof liaison.reglages === "function" ? liaison.reglages() : null;
    if (cur && (+cur.duree !== r.duree || !!cur.neuf !== r.neuf || !!cur.primo !== r.primo)) liaison.definir(r);
  }

  /* ---------- feuille ---------- */
  function optionsFeuille(S, U) {
    const v = dernier;
    if (!v || v.statut !== "ok") return null;
    return { titre: "Comment c'est calculé", contenu: feuilleHtml(v, S, deps0), pied: U.demanderAClaude(questionClaude(v, deps0)) };
  }
  function ouvrirFeuille(el) {
    const U = dep(deps0, "UI"); if (!U || !derniereS) return;
    const o = optionsFeuille(derniereS, U); if (!o) return;
    ouvertFeuille = true; retourFeuille = el || null;
    U.panneau.ouvrir(Object.assign(o, { retour: retourFeuille, surFermeture: apresFermeture }));
  }
  function apresFermeture(o) {
    ouvertFeuille = false;
    if ((o && o.focus === false) || !racine) return;
    if (retourFeuille && retourFeuille.isConnected !== false && racine.contains(retourFeuille)) return;
    const b = racine.querySelector("[data-ic-feuille]"); if (b && b.focus) b.focus();
  }
  function rafraichirFeuille(S) {
    const U = dep(deps0, "UI");
    if (!ouvertFeuille || !U || !U.panneau.ouvert()) return;
    const o = optionsFeuille(S, U);
    if (!o) { U.panneau.fermer({ focus: false }); return; }
    U.panneau.remplacer({ contenu: o.contenu, pied: o.pied });
  }

  /** Branche la carte sur sa racine (#blCapacite) : clic « Comment c'est calculé ». */
  function monter(el, deps) {
    racine = el; deps0 = deps || null; sigCarte = "";
    if (!el) return;
    el.addEventListener("click", ev => {
      const t = ev.target && ev.target.closest ? ev.target.closest("[data-ic-feuille]") : null;
      if (t) ouvrirFeuille(t);
    });
  }

  return { MENTION, etatDefaut, jourDe, donneesMoteur, optionsMoteur, clesManquantes, nomPerimetre, calculer, libelleTaux, sensibiliteHtml, carteHtml, indisponibleHtml, phraseCompleter, demainIndisponibleHtml, reglagesGraphe, libellePerimetre,
    feuilleHtml, questionClaude, sourcesGroupees, monter, rendre, ouvrirFeuille, _etat: () => etat };
});
