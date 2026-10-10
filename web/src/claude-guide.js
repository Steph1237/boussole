/* Profil et données › Avec Claude : faire son bilan en discutant avec Claude (connecteur MCP Boussole).
   Avancement par section (BilanEtat.etat), prochaines questions, ajout du connecteur (adresse + étapes par client),
   parcours lançables (claude.ai/new?q=… ou copie de la demande), retour vers Propositions pour valider.
   Compte anonyme (mode Supabase) : « Sécurisez d'abord votre compte » à la place de l'étape du connecteur. */
(function () {
  "use strict";
  /* Demandes pré-remplies : courtes, en langage naturel, elles invoquent le connecteur et ses outils. */
  const PARCOURS = [
    { id: "bilan_complet", titre: "Bilan complet", desc: "Tout le bilan, section par section, dans l'ordre d'un entretien.",
      prompt: "Utilise le connecteur Boussole pour faire mon bilan patrimonial complet : commence par etat_du_bilan, pose-moi une question à la fois, et dépose tes propositions dans Boussole." },
    { id: "profil_de_risque", titre: "Profil de risque", desc: "Les dix questions, expliquées une par une.",
      prompt: "Utilise le connecteur Boussole pour établir mon profil de risque : commence par etat_du_bilan, pose-moi les questions une à la fois en m'expliquant pourquoi, puis dépose mes réponses dans Boussole pour que je les valide." },
    { id: "budget", titre: "Budget", desc: "Dépenses et épargne du mois ; un relevé bancaire collé suffit.",
      prompt: "Utilise le connecteur Boussole pour compléter mon budget mensuel : commence par etat_du_bilan, demande-moi mes dépenses une catégorie à la fois (je peux coller un relevé bancaire), puis dépose tes propositions dans Boussole." },
    { id: "placements", titre: "Placements", desc: "Comptes, enveloppes et soldes à jour, depuis vos relevés.",
      prompt: "Utilise le connecteur Boussole pour mettre à jour mes placements : commence par etat_du_bilan, demande-moi les soldes à jour compte par compte (je peux coller mes relevés), puis dépose tes propositions dans Boussole." },
    { id: "revue_mensuelle", titre: "Revue du mois", desc: "Ce qui a changé ce mois-ci : soldes, budget, objectifs.",
      prompt: "Utilise le connecteur Boussole pour faire ma revue du mois : commence par etat_du_bilan, vérifie avec moi ce qui a changé (soldes, budget, objectifs), une question à la fois, et dépose tes propositions dans Boussole." },
  ];
  const lienClaude = prompt => "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  if (typeof module === "object" && module.exports) module.exports = { PARCOURS, lienClaude };
  if (typeof document === "undefined") return;

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICON = {
    complet: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
    partiel: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
    vide: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    copie: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  };
  const svg = (k, cls) => '<svg class="' + (cls || "cg-ico") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICON[k] + "</svg>";
  const STATUT_TXT = { complet: "complet", partiel: "en partie renseigné", vide: "à renseigner" };

  const B = window.BOUSSOLE || {};
  const MCP_URL = String(B.supabaseUrl || "https://oapcewpqsbbjdlcdeizi.supabase.co").replace(/\/+$/, "") + "/functions/v1/mcp";
  let S = null, root = null, dirty = true, anon = false, sigSec = "";
  const ouverts = new Set(); // sections dépliées (conservées d'un rendu à l'autre)
  const $ = id => root.querySelector("#" + id);
  const demo = () => !!(window.Store && window.Store.mode === "demo");
  const etat = () => (window.BilanEtat && S && S.ready !== false ? window.BilanEtat.etat(S) : null);
  const enAttente = () => ((S && S.propositions) || []).filter(p => p.statut === "en_attente").length;

  function ring(pct) {
    const r = 34, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, pct)) / 100;
    return '<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="' + r + '" class="cg-ring-bg"/>' +
      '<circle cx="40" cy="40" r="' + r + '" class="cg-ring-fg" stroke-dasharray="' + (c * f).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg>' +
      '<span class="cg-ring-v">' + pct + '<small>%</small></span>';
  }

  function render() {
    if (!root) return;
    const E = etat();
    if (E) {
      $("cgRing").innerHTML = ring(E.pourcentage);
      $("cgRing").setAttribute("aria-label", "Bilan complet à " + E.pourcentage + " %");
      const complets = E.sections.filter(s => s.statut === "complet").length;
      $("cgHeroSub").textContent = E.pourcentage >= 100 ? "Votre bilan est complet. Revenez chaque mois pour le garder à jour." :
        "Votre bilan est complet à " + E.pourcentage + " % : " + complets + " section" + (complets > 1 ? "s" : "") + " sur " + E.sections.length + " terminée" + (complets > 1 ? "s" : "") + ".";
      $("cgSecCount").textContent = complets + " sur " + E.sections.length;
      const sig = JSON.stringify(E.sections.map(s => [s.cle, s.statut, s.faits, s.total, s.manquants.map(m => m.champ)]));
      if (sig !== sigSec) {
        sigSec = sig;
        $("cgSections").innerHTML = E.sections.map(s => {
          const head = '<span class="cg-st ' + s.statut + '" title="' + STATUT_TXT[s.statut] + '">' + svg(s.statut) + '<span class="cg-sr">' + STATUT_TXT[s.statut] + "</span></span>" +
            '<span class="cg-sec-t">' + esc(s.titre) + '</span><span class="cg-sec-n">' + s.faits + " sur " + s.total + "</span>";
          if (!s.manquants.length) return '<li class="cg-sec"><div class="cg-sec-h">' + head + "</div></li>";
          return '<li class="cg-sec"><details data-sec="' + esc(s.cle) + '"' + (ouverts.has(s.cle) ? " open" : "") + '><summary class="cg-sec-h">' + head + "</summary>" +
            '<ul class="cg-miss">' + s.manquants.map(m => "<li><b>" + esc(m.question) + "</b><span>" + esc(m.pourquoi) + "</span></li>").join("") + "</ul></details></li>";
        }).join("");
      }
      $("cgNext").innerHTML = E.prochaines.map(q => {
        const sec = E.sections.find(s => s.cle === q.section);
        return '<li><span class="cg-next-s">' + esc(sec ? sec.titre : "") + "</span><b>" + esc(q.question) + '</b><span class="muted">' + esc(q.pourquoi) + "</span></li>";
      }).join("");
      $("cgNextDone").hidden = !!E.prochaines.length;
      $("cgNext").hidden = !E.prochaines.length;
    }
    const n = enAttente();
    $("cgPending").textContent = n ? n + " proposition" + (n > 1 ? "s" : "") + " en attente : examiner" : "Aucune proposition en attente pour le moment";
    $("cgPending").classList.toggle("has", n > 0);
    steps();
  }
  function steps() {
    const isDemo = demo();
    $("cgDemoNote").hidden = !isDemo;
    $("cgStep1").hidden = anon && !isDemo;
    $("cgStepAnon").hidden = !(anon && !isDemo);
  }

  /* Presse-papiers, avec repli : sélection du texte pour une copie manuelle. */
  async function copier(text, el) {
    try { if (!navigator.clipboard) throw new Error("indisponible"); await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      if (el && el.select) { el.hidden = false; el.focus(); el.select(); try { return document.execCommand("copy"); } catch (x) { return false; } }
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      return false;
    }
  }
  function dire(m, ok) { const el = $("cgMsg"); el.textContent = m; el.className = "cg-msg " + (ok ? "ok" : "err"); }
  /* Retour visible sur le bouton lui-même (le message détaillé reste annoncé dans #cgMsg). */
  function flash(b, ok) {
    if (!b.dataset.html) b.dataset.html = b.innerHTML;
    b.textContent = ok ? "Copié ✓" : "Sélectionné : ⌘C ou Ctrl+C";
    clearTimeout(b._t); b._t = setTimeout(() => { b.innerHTML = b.dataset.html; delete b.dataset.html; }, 2200);
  }

  function mount(r) {
    root = r;
    $("cgUrl").value = MCP_URL;
    $("cgCmd").textContent = "claude mcp add boussole -t http " + MCP_URL;
    $("cgParcours").innerHTML = PARCOURS.map(p =>
      '<div class="cg-pc"><div class="cg-pc-t"><b>' + esc(p.titre) + '</b><span class="small muted">' + esc(p.desc) + "</span></div>" +
      '<div class="cg-pc-a"><a class="cg-btn" href="' + esc(lienClaude(p.prompt)) + '" target="_blank" rel="noopener" data-parcours="' + p.id + '">' + svg("ext") + "Ouvrir dans Claude<span class=\"cg-sr\"> (nouvel onglet) : " + esc(p.titre) + "</span></a>" +
      '<button type="button" class="cg-btn ghost" data-copy-prompt="' + p.id + '">' + svg("copie") + "Copier la demande</button></div>" +
      '<textarea class="cg-prompt" id="cgPrompt-' + p.id + '" readonly rows="3" hidden aria-label="Demande à copier : ' + esc(p.titre) + '">' + esc(p.prompt) + "</textarea></div>").join("");
    root.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.copyEl) {
        const el = $(b.dataset.copyEl);
        const ok = await copier(el.value != null && el.tagName === "INPUT" ? el.value : el.textContent, el);
        dire(ok ? "Copié dans le presse-papiers." : "Copie impossible : le texte est sélectionné, copiez-le avec Ctrl+C ou ⌘C.", ok); flash(b, ok);
      } else if (b.dataset.copyPrompt) {
        const p = PARCOURS.find(x => x.id === b.dataset.copyPrompt), ta = $("cgPrompt-" + p.id);
        const ok = await copier(p.prompt, ta);
        dire(ok ? "Demande « " + p.titre + " » copiée : collez-la dans une nouvelle conversation avec Claude." : "Copie impossible : la demande est sélectionnée ci-dessus, copiez-la avec Ctrl+C ou ⌘C.", ok); flash(b, ok);
      }
    });
    root.addEventListener("toggle", e => { const d = e.target; if (d.dataset && d.dataset.sec) { if (d.open) ouverts.add(d.dataset.sec); else ouverts.delete(d.dataset.sec); } }, true);
    /* Compte anonyme : uniquement en mode Supabase (la démo montre tout). */
    if (!demo() && window.Auth && typeof Auth.session === "function") {
      const set = s => { anon = typeof Auth.isAnonymous === "function" ? Auth.isAnonymous(s) : !!(s && s.user && s.user.is_anonymous); steps(); };
      Auth.session().then(set, () => {});
      if (typeof Auth.onChange === "function") Auth.onChange((ev, s) => { if (s) set(s); });
    }
    steps();
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() { if (dirty) { render(); dirty = false; } }
  /* Chiffre clé : avancement du bilan (« 75 % »). */
  function headline() { const E = etat(); return E ? E.pourcentage + " %" : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("claude-guide", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
