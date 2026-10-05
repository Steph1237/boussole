/* Premiers pas : fenêtre en 3 étapes (foyer, revenus, patrimoine) ouverte par l'app tant que l'onboarding n'est
   pas terminé. Aucun accès à la base ici : l'appelant reçoit les données et les écrit.

   window.Onboarding = { open({ profil, onSave, onSkip, onClose }), buildPatch(state) }
   - profil : le profil courant (forme canonique p1 / p2 ; la forme héritée steph / compagne est aussi lue).
   - onSave(profilPatch, positionsRows) à la fin, éventuellement async (la fenêtre attend et affiche l'erreur) :
       profilPatch = { foyer: {…foyer existant, adultes, enfants, union, age, tmi},
                       personnes: { p1: { nom, salaire, salaireUnite, statut, …champs existants }, p2?: {…} } }
       (p2 absent si un seul adulte : écrire `personnes` en entier le supprime)
       positionsRows = lignes normalisées par Assistant.parse / Import.parseCSV (peut être vide).
   - onSkip() sur « Passer » ; onClose() à toute fermeture (y compris Échap, qui ne vaut pas « Passer »).
   Dépendances navigateur : assistant.js (prompt + lecture de la réponse), import.js (fichier CSV). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Onboarding = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  function dep(name, file) {
    if (root && root[name]) return root[name];
    if (typeof require === "function") { try { return require(file); } catch (e) { /* navigateur */ } }
    return null;
  }
  const A = () => dep("Assistant", "./assistant.js");
  const num = v => { const a = A(); if (a) return a.num(v); const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; };

  const TITLES = ["Votre foyer", "Vos revenus", "Votre patrimoine"];
  const AGES = [["u30", "moins de 30"], ["a30", "30-39"], ["a40", "40-49"], ["a50", "50-59"], ["a60", "60-69"], ["a70", "70 et +"]];
  const TMIS = [[0, "0 %"], [11, "11 %"], [30, "30 %"], [41, "41 %"], [45, "45 %"], ["", "je ne sais pas"]];
  const UNITS = [["nm", "net / mois"], ["na", "net / an"], ["bm", "brut / mois"], ["ba", "brut / an"]];
  const clone = o => JSON.parse(JSON.stringify(o || {}));

  /* ---------- profil existant → forme canonique ---------- */
  function canon(profil) {
    const p = clone(profil);
    const P = p.personnes || {};
    return {
      foyer: p.foyer || {},
      personnes: { p1: P.p1 || P.steph || null, p2: P.p2 || P.compagne || null },
    };
  }

  /* ---------- état initial depuis le profil ---------- */
  function initialState(profil) {
    const b = canon(profil), f = b.foyer, P = b.personnes;
    const person = (p, nom) => ({ nom: (p && p.nom) || nom, salaire: p && p.salaire != null ? String(p.salaire) : "", salaireUnite: (p && p.salaireUnite) || "nm", statut: (p && p.statut) || "" });
    return {
      step: 0,
      base: profil || null,
      foyer: {
        adultes: f.adultes != null ? Math.min(3, Math.max(1, +f.adultes || 1)) : P.p2 ? 2 : 1,
        enfants: f.enfants != null ? +f.enfants || 0 : 0,
        union: f.union || "joint",
        age: f.age || "",
        tmi: f.tmi == null ? "" : String(f.tmi),
      },
      personnes: { p1: person(P.p1, "Moi"), p2: person(P.p2, "") },
      choix: null,        // "csv" | "assistant" | "plus-tard"
      positions: [],
      reponse: "",        // réponse collée de l'assistant
    };
  }

  /* ---------- état → patch du profil (pur, testé) ---------- */
  function buildPatch(state) {
    const st = state || {}, b = canon(st.base), f = st.foyer || {};
    const int = (v, d) => { const n = num(v); return n == null ? d : Math.round(n); };
    const adultes = Math.min(3, Math.max(1, int(f.adultes, b.foyer.adultes || 1)));
    const enfants = Math.max(0, int(f.enfants, b.foyer.enfants || 0));
    const foyer = Object.assign({}, b.foyer, { adultes, enfants });
    if (foyer.enfants14 != null) foyer.enfants14 = Math.max(0, Math.min(enfants, +foyer.enfants14 || 0));
    if (adultes >= 2 && (f.union === "joint" || f.union === "sep")) foyer.union = f.union;
    if (f.age !== undefined) foyer.age = AGES.some(([k]) => k === f.age) ? f.age : null;
    if (f.tmi !== undefined) { const t = num(f.tmi); foyer.tmi = [0, 11, 30, 41, 45].includes(t) ? t : null; }

    const personnes = {};
    (adultes >= 2 ? ["p1", "p2"] : ["p1"]).forEach(k => {
      const src = (st.personnes || {})[k] || {}, prev = b.personnes[k] || {};
      const s = num(src.salaire);
      const nom = String(src.nom ?? prev.nom ?? "").trim().slice(0, 40) || (k === "p1" ? "Moi" : "Conjoint");
      personnes[k] = Object.assign({}, prev, {
        nom,
        salaire: s != null && s >= 0 ? s : null,
        salaireUnite: UNITS.some(([u]) => u === src.salaireUnite) ? src.salaireUnite : prev.salaireUnite || "nm",
        statut: src.statut === "cadre" || src.statut === "nc" ? src.statut : null,
      });
    });
    return { foyer, personnes };
  }

  /* ---------- fenêtre ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const plural = (n, one, many) => n + " " + (n > 1 ? many : one);
  let seq = 0;

  async function copyText(text, ta) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { if (ta) { ta.focus(); ta.select(); try { return document.execCommand("copy"); } catch (x) { return false; } } return false; }
  }

  function open(opts) {
    const o = opts || {};
    const id = "ob" + (++seq);
    const st = initialState(o.profil);
    let busy = false, parseTmr = null, parsed = null;

    const dlg = document.createElement("dialog");
    dlg.className = "ob-dialog";
    dlg.setAttribute("aria-labelledby", id + "-h");
    document.body.appendChild(dlg);
    const $ = s => dlg.querySelector(s);

    const seg = (path, opts2, label, cur) =>
      '<div class="ob-field"><span class="ob-lbl" id="' + id + "-" + path.replace(/\./g, "-") + '">' + label + '</span><div class="ob-seg" role="group" aria-labelledby="' + id + "-" + path.replace(/\./g, "-") + '">' +
      opts2.map(([v, t]) => '<button type="button" data-seg="' + path + '" data-v="' + esc(v) + '" aria-pressed="' + String(String(cur) === String(v)) + '">' + t + "</button>").join("") + "</div></div>";
    const people = () => (+st.foyer.adultes >= 2 ? ["p1", "p2"] : ["p1"]);
    const nameOf = k => (st.personnes[k].nom || "").trim() || (k === "p1" ? "Moi" : "Personne 2");

    function stepFoyer() {
      const f = st.foyer;
      return seg("foyer.adultes", [[1, "1"], [2, "2"], [3, "3 et +"]], "Adultes dans le foyer", f.adultes) +
        seg("foyer.enfants", [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4 et +"]], "Enfants à charge", f.enfants) +
        '<div class="ob-names">' + people().map(k =>
          '<div class="ob-field"><label class="ob-lbl" for="' + id + "-n-" + k + '">' + (k === "p1" ? "Votre prénom" : "Prénom de la deuxième personne") + "</label>" +
          '<input class="ob-input" id="' + id + "-n-" + k + '" data-f="personnes.' + k + '.nom" type="text" maxlength="40" autocomplete="' + (k === "p1" ? "given-name" : "off") + '" value="' + esc(st.personnes[k].nom) + '" placeholder="' + (k === "p1" ? "Moi" : "ex. Sam") + '"></div>').join("") + "</div>" +
        (+f.adultes >= 2 ? seg("foyer.union", [["joint", "mariés ou pacsés"], ["sep", "union libre"]], "Vous êtes", f.union) : "") +
        seg("foyer.age", AGES, "Âge de la personne qui gagne le plus", f.age) +
        seg("foyer.tmi", TMIS, "Tranche marginale d'imposition", f.tmi) +
        '<p class="ob-hint">La tranche figure sur votre avis d\'impôt. Elle sert à comparer les placements après impôt.</p>';
    }

    function stepRevenus() {
      return people().map(k => {
        const p = st.personnes[k], fid = id + "-s-" + k;
        return '<fieldset class="ob-person"><legend>' + esc(nameOf(k)) + "</legend>" +
          '<div class="ob-field"><label class="ob-lbl" for="' + fid + '">Salaire, primes comprises</label><div class="ob-money">' +
          '<input class="ob-input" id="' + fid + '" data-f="personnes.' + k + '.salaire" type="text" inputmode="decimal" autocomplete="off" value="' + esc(p.salaire) + '" placeholder="ex. 2 800">' +
          '<select class="ob-input" data-f="personnes.' + k + '.salaireUnite" aria-label="Unité du salaire de ' + esc(nameOf(k)) + '">' +
          UNITS.map(([v, t]) => '<option value="' + v + '"' + (v === p.salaireUnite ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
          '<p class="ob-err" data-err="personnes.' + k + '.salaire" hidden>Montant illisible : écrivez par exemple 2 800 ou 2800,50.</p></div>' +
          seg("personnes." + k + ".statut", [["cadre", "cadre"], ["nc", "non-cadre"], ["", "autre ou sans emploi"]], "Statut", p.statut) +
          "</fieldset>";
      }).join("") + '<p class="ob-hint">Laissez vide si vous préférez : vous pourrez compléter plus tard dans l\'onglet Profil.</p>';
    }

    function summary() {
      const n = st.positions.length;
      if (st.choix === "plus-tard") return "Vous pourrez ajouter vos placements depuis le Pilotage.";
      if (!n) return "";
      return plural(n, "placement prêt", "placements prêts") + " à être enregistré" + (n > 1 ? "s" : "") + " : " +
        st.positions.slice(0, 4).map(p => esc(p.name)).join(", ") + (n > 4 ? "…" : "") + ".";
    }

    function assistantPanel() {
      const a = A();
      const prompt = a ? a.prompt("positions") : "";
      return '<div class="ob-assist">' +
        '<p class="ob-step-txt"><b>1.</b> Copiez ce message dans Claude ou ChatGPT, puis collez-y vos relevés (PEA, assurance-vie, livrets…).</p>' +
        '<textarea class="ob-input ob-prompt" id="' + id + '-prompt" rows="5" readonly aria-label="Message à copier">' + esc(prompt) + "</textarea>" +
        '<div><button type="button" class="ob-btn ghost" data-act="copy">Copier le message</button> <span class="ob-copied" role="status"></span></div>' +
        '<label class="ob-step-txt" for="' + id + '-rep"><b>2.</b> Collez ici la réponse de l\'assistant.</label>' +
        '<textarea class="ob-input ob-reply" id="' + id + '-rep" rows="5" spellcheck="false" placeholder="```json { &quot;positions&quot;: [ … ] } ```">' + esc(st.reponse) + "</textarea>" +
        '<div class="ob-parse" aria-live="polite"></div></div>';
    }

    function stepPatrimoine() {
      const c = st.choix;
      const card = (k, t, d) => '<button type="button" class="ob-choice" data-choix="' + k + '" aria-pressed="' + String(c === k) + '"><b>' + t + "</b><span>" + d + "</span></button>";
      return '<p class="ob-lead">Ajoutez vos placements : comptes-titres, PEA, assurance-vie, livrets.</p>' +
        '<div class="ob-choices">' +
        card("csv", "Importer un fichier CSV", "Un export de votre banque ou un tableur.") +
        card("assistant", "Remplir avec mon assistant", "Claude ou ChatGPT lit vos relevés et prépare la liste.") +
        card("plus-tard", "Plus tard", "Vous commencerez avec un patrimoine vide.") +
        "</div>" +
        (c === "assistant" ? assistantPanel() : "") +
        '<p class="ob-summary" aria-live="polite">' + summary() + "</p>";
    }

    function renderParse() {
      const box = $(".ob-parse"); if (!box) return;
      if (!parsed) { box.innerHTML = ""; return; }
      const ok = parsed.data || [];
      box.innerHTML = parsed.erreurs.length
        ? '<ul class="ob-errs">' + parsed.erreurs.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul><p class=\"ob-hint\">Rien ne sera enregistré tant que la réponse contient une erreur. Demandez à l'assistant de la corriger, puis recollez-la.</p>"
        : '<p class="ob-good">' + plural(ok.length, "placement reconnu", "placements reconnus") + ".</p>" +
          (parsed.avertissements.length ? '<ul class="ob-warns">' + parsed.avertissements.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul>" : "");
    }

    function render(focus) {
      const s = st.step, last = s === TITLES.length - 1;
      dlg.innerHTML =
        '<form method="dialog" class="ob-box" novalidate>' +
        '<header class="ob-head"><div><p class="ob-kicker">Bienvenue sur Boussole</p>' +
        '<p class="ob-progress" aria-live="polite">Étape ' + (s + 1) + " sur " + TITLES.length + "</p></div>" +
        '<div class="ob-bar" aria-hidden="true">' + TITLES.map((t, i) => '<i class="' + (i <= s ? "on" : "") + '"></i>').join("") + "</div></header>" +
        '<div class="ob-body"><h2 id="' + id + '-h" tabindex="-1">' + TITLES[s] + "</h2>" +
        (s === 0 ? stepFoyer() : s === 1 ? stepRevenus() : stepPatrimoine()) + "</div>" +
        '<footer class="ob-foot"><button type="button" class="ob-link" data-act="skip">Passer</button><span class="ob-msg" role="status"></span>' +
        (s > 0 ? '<button type="button" class="ob-btn ghost" data-act="back">Retour</button>' : "") +
        '<button type="button" class="ob-btn" data-act="' + (last ? "save" : "next") + '">' + (last ? "Terminer" : "Continuer") + "</button></footer></form>";
      renderParse();
      if (focus) { const h = $("#" + id + "-h"); if (h) h.focus(); }
    }

    function setPath(path, v) {
      const ks = path.split("."); let a = st;
      ks.slice(0, -1).forEach(k => { a = a[k]; });
      a[ks[ks.length - 1]] = v;
    }

    function validSalaires() {
      let ok = true;
      people().forEach(k => {
        const v = st.personnes[k].salaire, bad = String(v).trim() !== "" && (num(v) == null || num(v) < 0);
        const e = $('[data-err="personnes.' + k + '.salaire"]'); if (e) e.hidden = !bad;
        if (bad) ok = false;
      });
      return ok;
    }

    function setBusy(b, text) {
      busy = b;
      dlg.querySelectorAll(".ob-foot button").forEach(x => { x.disabled = b; });
      const m = $(".ob-msg"); if (m) m.textContent = text || "";
    }

    function finish(cb) { dlg.close(); if (typeof cb === "function") cb(); }

    dlg.addEventListener("input", e => {
      const t = e.target;
      if (t.dataset.f) { setPath(t.dataset.f, t.value); if (/\.nom$/.test(t.dataset.f)) return; }
      if (t.classList.contains("ob-reply")) {
        st.reponse = t.value;
        clearTimeout(parseTmr);
        parseTmr = setTimeout(() => {
          const a = A();
          parsed = st.reponse.trim() && a ? a.parse(st.reponse, "positions") : null;
          st.positions = parsed && !parsed.erreurs.length ? parsed.data : [];
          renderParse();
          const sm = $(".ob-summary"); if (sm) sm.innerHTML = summary();
        }, 250);
      }
    });
    dlg.addEventListener("change", e => { const t = e.target; if (t.dataset.f && t.tagName === "SELECT") setPath(t.dataset.f, t.value); });

    dlg.addEventListener("click", async e => {
      const sg = e.target.closest("[data-seg]");
      if (sg) {
        const path = sg.dataset.seg, raw = sg.dataset.v;
        setPath(path, path === "foyer.adultes" || path === "foyer.enfants" ? +raw : raw);
        if (path === "foyer.adultes") { render(); const b = dlg.querySelector('[data-seg="foyer.adultes"][aria-pressed="true"]'); if (b) b.focus(); }
        else sg.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === sg)));
        return;
      }
      const ch = e.target.closest("[data-choix]");
      if (ch) {
        const k = ch.dataset.choix;
        if (k === "csv") {
          const I = root.Import;
          if (!I) { $(".ob-msg").textContent = "Import indisponible : rechargez la page."; return; }
          I.open({
            people: people().map(p => ({ id: p, nom: nameOf(p) })),
            onApply: rows => { st.choix = "csv"; st.positions = rows; parsed = null; render(); },
          });
          return;
        }
        st.choix = k;
        if (k === "plus-tard") { st.positions = []; parsed = null; }
        if (k === "assistant") { st.positions = parsed && !parsed.erreurs.length ? parsed.data : []; }
        render();
        const again = dlg.querySelector('[data-choix="' + k + '"]'); if (again) again.focus();
        return;
      }
      const b = e.target.closest("[data-act]");
      if (!b) { if (e.target === dlg && !busy) { /* clic sur le fond : ne ferme pas, pour ne rien perdre */ } return; }
      e.preventDefault();
      const act = b.dataset.act;
      if (act === "copy") {
        const ta = $("#" + id + "-prompt");
        const ok = await copyText(ta.value, ta);
        $(".ob-copied").textContent = ok ? "Copié. Collez-le dans votre assistant." : "Sélectionnez le texte et copiez-le (Ctrl+C ou ⌘C).";
      } else if (act === "next") {
        if (st.step === 1 && !validSalaires()) return;
        st.step = Math.min(TITLES.length - 1, st.step + 1); render(true);
      } else if (act === "back") {
        st.step = Math.max(0, st.step - 1); render(true);
      } else if (act === "skip") {
        if (busy) return;
        finish(o.onSkip);
      } else if (act === "save") {
        if (busy) return;
        setBusy(true, "Enregistrement…");
        try {
          if (typeof o.onSave === "function") await o.onSave(buildPatch(st), st.positions.slice());
          setBusy(false); finish();
        } catch (err) {
          setBusy(false, "Enregistrement impossible : " + ((err && err.message) || err) + ". Réessayez.");
        }
      }
    });

    dlg.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
    dlg.addEventListener("close", () => { dlg.remove(); if (typeof o.onClose === "function") o.onClose(); });

    render();
    dlg.showModal();
    const first = dlg.querySelector('[data-seg="foyer.adultes"][aria-pressed="true"]') || dlg.querySelector("button");
    if (first) first.focus();
    return { close: () => { if (!busy) dlg.close(); }, dialog: dlg, state: st };
  }

  return { open, buildPatch, TITLES };
});
