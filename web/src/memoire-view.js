/* Profil et données › Mémoire de l'agent : ce que l'assistant (connecteur MCP) retient de l'utilisateur d'une conversation à l'autre.
   S.memoire = [{ id, categorie: contexte|preference|projet|decision|explique|a_suivre, contenu, echeance, epingle, source, creeLe, majLe }].
   Actions : Store.memoire.modifier(id, { contenu?, epingle?, echeance? }), .supprimer(ids), .toutEffacer() → { ok: true } ou { erreur }.
   Les fonctions de présentation (grouper, echu, meta) sont pures et exportées pour les tests. */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MAX = 200; // souvenirs au plus par utilisateur (limite de la base)

  /* Ordre d'affichage des catégories et titres de groupe. */
  const CATEGORIES = [
    ["a_suivre", "À reprendre"], ["projet", "Projets"], ["decision", "Décisions"],
    ["contexte", "Contexte"], ["preference", "Préférences"], ["explique", "Déjà expliqué"],
  ];

  const pad = n => String(n).padStart(2, "0");
  /** Date locale AAAA-MM-JJ (aujourd'hui par défaut). */
  function jour(d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const x = d == null ? new Date() : new Date(d);
    if (!isFinite(x)) return "";
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }
  /** « 10 oct. 2026 » ; une date seule (AAAA-MM-JJ) est lue à midi pour ne pas changer de jour. */
  function dateFr(s) {
    if (!s) return "";
    const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T12:00:00" : s);
    return isFinite(x) ? x.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
  }

  /** Échéance passée ou du jour (comparaison de dates locales). */
  function echu(m, today) {
    if (!m || !m.echeance) return false;
    const e = jour(String(m.echeance).slice(0, 10));
    return !!e && e <= jour(today);
  }

  /** Groupes non vides dans l'ordre des catégories ; épinglés d'abord, puis échéance la plus proche (à reprendre) ou le plus récent. */
  function grouper(memoire, today) {
    const liste = Array.isArray(memoire) ? memoire.filter(Boolean) : [];
    const connues = new Set(CATEGORIES.map(c => c[0]));
    const ordre = (a, b) => {
      if (!!b.epingle !== !!a.epingle) return a.epingle ? -1 : 1;
      if (a.categorie === "a_suivre") {
        const ea = a.echeance || "9999", eb = b.echeance || "9999";
        if (ea !== eb) return ea < eb ? -1 : 1;
      }
      const ca = a.creeLe || "", cb = b.creeLe || "";
      return ca === cb ? 0 : ca < cb ? 1 : -1;
    };
    const groupes = CATEGORIES.map(([cle, titre]) => ({ cle, titre, items: liste.filter(m => m.categorie === cle).sort(ordre) }));
    // catégorie inconnue (version future du connecteur) : rien n'est caché à l'utilisateur
    const autres = liste.filter(m => !connues.has(m.categorie)).sort(ordre);
    if (autres.length) groupes.push({ cle: "autre", titre: "Autres souvenirs", items: autres });
    return groupes.filter(g => g.items.length);
  }

  /** { texte: « retenu par Claude le 10 oct. 2026 », echeance: texte de l'échéance ou "", echu } */
  function meta(m, today) {
    const qui = m && m.source ? String(m.source) : "l'agent";
    let texte = "retenu par " + qui + (m && m.creeLe ? " le " + dateFr(m.creeLe) : "");
    if (m && m.majLe && m.creeLe && jour(m.majLe) !== jour(m.creeLe)) texte += ", modifié le " + dateFr(m.majLe);
    const e = !!(m && m.categorie === "a_suivre" && m.echeance);
    const est = echu(m, today);
    const echeance = !e ? "" : est ? "à reprendre (prévu le " + dateFr(String(m.echeance).slice(0, 10)) + ")" : "prévu le " + dateFr(String(m.echeance).slice(0, 10));
    return { texte, echeance, echu: e && est };
  }

  /** État à afficher quand la liste est vide : "chargement" (store pas prêt), "erreur" (lecture impossible) ou "vide" ; null si la liste n'est pas vide. */
  function etatVide(S, n) {
    if (n > 0) return null;
    if (!S || S.ready === false) return "chargement";
    return S.error ? "erreur" : "vide";
  }

  const H = { CATEGORIES, grouper, echu, meta, jour, dateFr, etatVide };
  if (typeof module === "object" && module.exports) module.exports = H;
  if (typeof document === "undefined") return;

  /* =================================================================== vue =================================================================== */
  const ICO_PIN = '<svg class="mv-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4zM12 15v6"/></svg>';
  const ICO_CAL = '<svg class="mv-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

  let S = null, root = null, dirty = true, sig = "", busy = false;
  const edition = new Map(); // id → { contenu, echeance } en cours de modification
  const $ = id => root.querySelector("#" + id);
  const API = () => (window.Store && window.Store.memoire) || null;
  const toutes = () => (S && Array.isArray(S.memoire) ? S.memoire : []);
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p || s + "s" : s);
  const extrait = t => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > 60 ? s.slice(0, 57) + "…" : s; };

  function itemHtml(m, today) {
    const x = meta(m, today), ed = edition.get(m.id), q = "« " + esc(extrait(m.contenu)) + " »";
    const corps = ed
      ? '<div class="mv-edit" role="group" aria-label="Modifier le souvenir">' +
          '<label class="mv-lab" for="mv-t-' + esc(m.id) + '">Texte du souvenir</label>' +
          '<textarea id="mv-t-' + esc(m.id) + '" class="mv-ta" data-field="contenu" data-for="' + esc(m.id) + '" maxlength="500" rows="3" aria-describedby="mv-c-' + esc(m.id) + '">' + esc(ed.contenu) + "</textarea>" +
          '<p class="mv-cpt small muted" id="mv-c-' + esc(m.id) + '">' + ed.contenu.length + " / 500 caractères</p>" +
          (m.categorie === "a_suivre"
            ? '<label class="mv-lab" for="mv-d-' + esc(m.id) + '">Échéance <span class="muted">(facultative)</span></label>' +
              '<input type="date" id="mv-d-' + esc(m.id) + '" class="mv-date" data-field="echeance" data-for="' + esc(m.id) + '" value="' + esc(ed.echeance) + '">'
            : "") +
          '<div class="mv-act"><button type="button" class="mv-btn sm" data-act="save" data-id="' + esc(m.id) + '">Enregistrer</button>' +
          '<button type="button" class="mv-btn sm ghost" data-act="cancel" data-id="' + esc(m.id) + '">Annuler</button></div>' +
        "</div>"
      : '<p class="mv-txt">' + esc(m.contenu) + "</p>";
    return '<li class="mv-item' + (m.epingle ? " is-pin" : "") + (x.echu ? " echu" : "") + '" data-item="' + esc(m.id) + '" tabindex="-1">' +
      corps +
      '<p class="mv-meta">' +
        (m.epingle ? '<span class="mv-tag pin">' + ICO_PIN + "épinglé</span>" : "") +
        (x.echeance ? '<span class="mv-tag ' + (x.echu ? "late" : "due") + '">' + ICO_CAL + esc(x.echeance) + "</span>" : "") +
        '<span class="mv-who">' + esc(x.texte) + "</span>" +
      "</p>" +
      (ed ? "" : '<div class="mv-act">' +
        '<button type="button" class="mv-lnk" data-act="pin" data-id="' + esc(m.id) + '" aria-label="' + (m.epingle ? "Désépingler" : "Épingler") + " le souvenir " + q + '">' + (m.epingle ? "Désépingler" : "Épingler") + "</button>" +
        '<button type="button" class="mv-lnk" data-act="edit" data-id="' + esc(m.id) + '" aria-label="Modifier le souvenir ' + q + '">Modifier</button>' +
        '<button type="button" class="mv-lnk danger" data-act="del" data-id="' + esc(m.id) + '" aria-label="Supprimer le souvenir ' + q + '">Supprimer</button>' +
      "</div>") +
      "</li>";
  }

  function render(force) {
    if (!root) return;
    const today = jour(), liste = toutes();
    const s = JSON.stringify([S && S.ready, S && S.error, today, liste, [...edition.keys()]]);
    if (force || s !== sig) {
      sig = s;
      const n = liste.length, nEchus = liste.filter(m => m.categorie === "a_suivre" && echu(m, today)).length;
      const ev = etatVide(S, n);
      $("mvEmpty").hidden = ev !== "vide"; // ni pendant le chargement, ni quand la lecture a échoué
      $("mvErr").hidden = ev !== "erreur";
      $("mvBar").hidden = !n;
      $("mvCount").innerHTML = '<b>' + pluriel(n, "souvenir") + "</b> sur " + MAX +
        (nEchus ? ' <span class="mv-late">· ' + pluriel(nEchus, "point", "points") + " à reprendre</span>" : "");
      $("mvGroups").innerHTML = grouper(liste, today).map(g =>
        '<section class="panel mv-grp" aria-labelledby="mv-g-' + g.cle + '"><h3 id="mv-g-' + g.cle + '">' + esc(g.titre) +
        ' <span class="mv-n muted">' + g.items.length + "</span></h3>" +
        '<ul class="mv-list">' + g.items.map(m => itemHtml(m, today)).join("") + "</ul></section>").join("");
    }
    etat();
  }
  function etat() {
    root.querySelectorAll("[data-act]").forEach(b => { b.disabled = busy; });
    $("mvClear").disabled = busy || !toutes().length;
  }
  function dire(m, ok) { const el = $("mvMsg"); el.textContent = m || ""; el.className = "mv-msg " + (ok ? "ok" : "err"); el.hidden = !m; }

  /* Appel au store : occupe la vue, remonte l'erreur telle quelle (ex. « Mémoire pleine… »). */
  async function appel(fn, succes) {
    const api = API();
    if (!api) { dire("La mémoire de l'agent n'est pas disponible dans cette vue."); return false; }
    busy = true; etat();
    let ok = false;
    try {
      const r = await fn(api);
      if (r && r.erreur) dire(String(r.erreur));
      else { dire(succes, true); ok = true; }
    } catch (e) {
      dire("Opération impossible : " + String((e && e.message) || "erreur").replace(/\.\s*$/, "") + ". Rien n'a été modifié.");
    } finally {
      busy = false;
      if (window.Store && Store.get) S = Store.get();
      render(true);
      if (window.App && App.refreshHeadlines) App.refreshHeadlines();
    }
    return ok;
  }
  /* Focus sur un bouton d'action d'un souvenir, sur le souvenir lui-même, ou sur un repère de la vue. */
  const focusEl = el => { if (el) el.focus(); return !!el; };
  const focusAct = (act, id) => focusEl(root.querySelector('[data-act="' + act + '"][data-id="' + CSS.escape(id) + '"]'));
  const focusItem = id => id != null && focusEl(root.querySelector('[data-item="' + CSS.escape(id) + '"]'));

  function ouvrir(id) {
    const m = toutes().find(x => x.id === id); if (!m) return;
    edition.set(id, { contenu: String(m.contenu || ""), echeance: m.echeance ? String(m.echeance).slice(0, 10) : "" });
    dire("");
    render(true);
    const t = root.querySelector('textarea[data-for="' + CSS.escape(id) + '"]');
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
  function fermer(id) { edition.delete(id); render(true); focusAct("edit", id); }

  async function enregistrer(id) {
    const m = toutes().find(x => x.id === id), ed = edition.get(id);
    if (!m || !ed) return fermer(id);
    const contenu = ed.contenu.trim();
    if (!contenu) { dire("Le souvenir ne peut pas être vide : utilisez « Supprimer » pour l'effacer."); return; }
    const patch = {};
    if (contenu !== String(m.contenu || "")) patch.contenu = contenu;
    const avant = m.echeance ? String(m.echeance).slice(0, 10) : "";
    if (m.categorie === "a_suivre" && ed.echeance !== avant) patch.echeance = ed.echeance || null;
    if (!Object.keys(patch).length) { dire(""); return fermer(id); }
    const ok = await appel(api => api.modifier(id, patch), "Souvenir modifié.");
    if (ok) fermer(id);
    else focusEl(root.querySelector('textarea[data-for="' + CSS.escape(id) + '"]')); // la saisie est conservée pour être corrigée
  }

  async function supprimer(id) {
    const items = [...root.querySelectorAll("[data-item]")].map(li => li.dataset.item);
    const i = items.indexOf(id), voisin = items[i + 1] || items[i - 1];
    const ok = await appel(api => api.supprimer([id]), "Souvenir supprimé : l'agent ne s'en servira plus.");
    if (ok) { edition.delete(id); if (!focusItem(voisin)) focusEl($(toutes().length ? "mvCount" : "mvEmptyTitle")); }
  }

  async function toutEffacer() {
    const n = toutes().length; if (!n) return;
    const q = n > 1 ? "Effacer les " + n + " souvenirs de l'agent ? Cette action est définitive." : "Effacer le souvenir de l'agent ? Cette action est définitive.";
    if (!confirm(q)) return;
    const ok = await appel(api => api.toutEffacer(), "Tous les souvenirs ont été effacés : l'agent repart de zéro.");
    if (ok) { edition.clear(); render(true); focusEl($("mvEmptyTitle")); }
  }

  function mount(r) {
    root = r;
    $("mvEmptyTitle").setAttribute("tabindex", "-1");
    $("mvCount").setAttribute("tabindex", "-1");
    /* Brouillon conservé à chaque frappe (et au « change » des sélecteurs de date natifs) : un rendu ne perd pas la saisie. */
    const saisir = e => {
      const f = e.target.closest("[data-field]"); if (!f) return;
      const ed = edition.get(f.dataset.for); if (!ed) return;
      ed[f.dataset.field] = f.value;
      if (f.dataset.field === "contenu") { const c = root.querySelector("#mv-c-" + CSS.escape(f.dataset.for)); if (c) c.textContent = f.value.length + " / 500 caractères"; }
    };
    root.addEventListener("input", saisir);
    root.addEventListener("change", saisir);
    root.addEventListener("keydown", e => {
      const f = e.target.closest("[data-field]"); if (!f) return;
      if (e.key === "Escape") { e.preventDefault(); dire(""); fermer(f.dataset.for); }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); enregistrer(f.dataset.for); }
    });
    root.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || b.disabled || busy) return;
      if (b.id === "mvClear") { toutEffacer(); return; }
      const id = b.dataset.id, act = b.dataset.act; if (!act) return;
      if (act === "edit") return ouvrir(id);
      if (act === "cancel") { dire(""); return fermer(id); }
      if (act === "save") return enregistrer(id);
      if (act === "del") return supprimer(id);
      if (act === "pin") {
        const m = toutes().find(x => x.id === id); if (!m) return;
        appel(api => api.modifier(id, { epingle: !m.epingle }), m.epingle ? "Souvenir désépinglé." : "Souvenir épinglé : il reste en tête de sa catégorie.")
          .then(() => focusAct("pin", id));
      }
    });
  }
  function update(snap, visible) { S = snap; dirty = true; if (visible) { render(); dirty = false; } }
  function show() { if (dirty) { render(); dirty = false; } }
  /* Chiffre clé : nombre de points « à reprendre » dont l'échéance est passée, "" sinon. */
  function headline() { const t = jour(); const n = toutes().filter(m => m.categorie === "a_suivre" && echu(m, t)).length; return n ? String(n) : ""; }

  const api = { mount, update, show, headline };
  const reg = () => App.register("memoire-view", api);
  if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
