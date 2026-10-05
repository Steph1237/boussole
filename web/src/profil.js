/* Onglet Profil : la seule partie de l'outil qui écrit les infos hors Pilotage (revenus, foyer, immobilier, crédits).
   On édite un brouillon ; « Enregistrer » l'écrit dans profil/main. */
(function () {
  "use strict";
  let root = null, S = null, draft = null, base = null, dirty = false, saving = false, remoteChanged = false;
  const $ = id => root.querySelector("#" + id);
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => nf.format(Math.round(v || 0)) + " €";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 9);

  const EMPTY = {
    foyer: { adultes: 2, enfants: 0, enfants14: 0, union: "joint", age: null, tmi: null },
    personnes: {
      steph: { salaire: null, salaireUnite: "nm", statut: null, csp: "", essai: false, autresRevenus: 0 },
      compagne: { salaire: null, salaireUnite: "nm", statut: null, csp: "", essai: false, autresRevenus: 0 },
    },
    biens: [], credits: [],
    autres: { steph: { usage: 0, entreprise: 0 }, compagne: { usage: 0, entreprise: 0 } },
  };
  function normalize(p) {
    const d = clone(EMPTY);
    if (!p) return d;
    Object.assign(d.foyer, p.foyer || {});
    ["steph", "compagne"].forEach(k => { Object.assign(d.personnes[k], (p.personnes || {})[k] || {}); Object.assign(d.autres[k], (p.autres || {})[k] || {}); });
    d.biens = clone(p.biens || []); d.credits = clone(p.credits || []);
    if (p.updatedAt) d.updatedAt = p.updatedAt;
    d.__saved = true;
    return d;
  }

  /* ---------- chemins « a.b.0.c » ---------- */
  const getP = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  function setP(o, path, v) { const ks = path.split("."); let a = o; ks.slice(0, -1).forEach(k => { if (a[k] == null) a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }

  /* ---------- briques de formulaire ---------- */
  const seg = (path, opts, label) => {
    const cur = getP(draft, path);
    return '<div class="pf-field"><span class="lbl">' + label + '</span><div class="seg" role="group" aria-label="' + esc(label) + '">' +
      opts.map(([v, t]) => '<button type="button" data-seg="' + path + '" data-v="' + esc(v) + '" aria-pressed="' + String(String(cur) === String(v)) + '">' + t + "</button>").join("") + "</div></div>";
  };
  const money = (path, label, unit, extra) => {
    const v = getP(draft, path); const id = "pf-" + path.replace(/\./g, "-");
    return '<div class="pf-field' + (extra || "") + '"><label class="lbl" for="' + id + '">' + label + '</label><div class="money"><input id="' + id + '" data-f="' + path + '" data-t="num" type="number" inputmode="decimal" min="0" step="any" value="' + (v == null || v === "" ? "" : esc(v)) + '"><span class="u">' + unit + "</span></div></div>";
  };
  const text = (path, label, ph, extra) => {
    const id = "pf-" + path.replace(/\./g, "-");
    return '<div class="pf-field' + (extra || "") + '"><label class="lbl" for="' + id + '">' + label + '</label><input class="plain" id="' + id + '" data-f="' + path + '" type="text" value="' + esc(getP(draft, path) || "") + '" placeholder="' + esc(ph || "") + '"></div>';
  };
  const select = (path, label, opts, extra) => {
    const id = "pf-" + path.replace(/\./g, "-"), cur = getP(draft, path) ?? "";
    return '<div class="pf-field' + (extra || "") + '"><label class="lbl" for="' + id + '">' + label + '</label><select class="plain" id="' + id + '" data-f="' + path + '">' +
      opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>";
  };

  const CSP = [["", "Non précisée"], ["cadre", "Cadre"], ["inter", "Profession intermédiaire"], ["empl", "Employé"], ["ouv", "Ouvrier"], ["indep", "Artisan, commerçant, chef d'entreprise"], ["liber", "Profession libérale"], ["agri", "Agriculteur"], ["inact", "Autre inactif"]];
  const UNITS = [["nm", "net / mois"], ["na", "net / an"], ["bm", "brut / mois"], ["ba", "brut / an"]];

  function renderForm() {
    const f = draft.foyer, kids = +f.enfants || 0;
    $("pfFoyer").innerHTML =
      seg("foyer.adultes", [[1, "1"], [2, "2"], [3, "3 +"]], "Adultes") +
      seg("foyer.enfants", [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4 +"]], "Enfants") +
      (kids > 0 ? seg("foyer.enfants14", Array.from({ length: kids + 1 }, (_, i) => [i, String(i)]), "Dont 14 ans ou plus") : "") +
      (+f.adultes >= 2 ? seg("foyer.union", [["joint", "marié ou pacsé"], ["sep", "union libre"]], "Le couple est") : "") +
      seg("foyer.age", [["u30", "&lt; 30"], ["a30", "30-39"], ["a40", "40-49"], ["a50", "50-59"], ["a60", "60-69"], ["a70", "70 +"]], "Âge de la personne qui gagne le plus") +
      seg("foyer.tmi", [[0, "0 %"], [11, "11 %"], [30, "30 %"], [41, "41 %"], [45, "45 %"]], "Tranche marginale d'imposition");

    const people = +f.adultes >= 2 ? ["steph", "compagne"] : ["steph"];
    $("pfPeople").innerHTML = people.map(k => {
      const p = "personnes." + k, a = "autres." + k, u = getP(draft, p + ".salaireUnite") || "nm";
      return '<div class="pf-person"><h3>' + (k === "steph" ? "Stéph" : "Compagne") + "</h3>" +
        '<div class="pf-field"><label class="lbl" for="pf-' + k + '-sal">Salaire</label><div class="money"><input id="pf-' + k + '-sal" data-f="' + p + '.salaire" data-t="num" type="number" inputmode="decimal" min="0" step="any" value="' + esc(getP(draft, p + ".salaire") ?? "") + '">' +
        '<select data-f="' + p + '.salaireUnite" aria-label="Unité du salaire">' + UNITS.map(([v, t]) => '<option value="' + v + '"' + (v === u ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div></div>" +
        seg(p + ".statut", [["cadre", "cadre"], ["nc", "non-cadre"]], "Statut") +
        select(p + ".csp", "Catégorie professionnelle", CSP) +
        '<label class="chk"><input type="checkbox" data-f="' + p + '.essai"' + (getP(draft, p + ".essai") ? " checked" : "") + "> En période d'essai</label>" +
        money(p + ".autresRevenus", "Autres revenus imposables", "€ / mois") +
        '<div class="pf-2">' + money(a + ".usage", "Voiture, meubles…", "€") + money(a + ".entreprise", "Parts d'entreprise", "€") + "</div></div>";
    }).join("");

    const BI = draft.biens;
    $("pfBiens").innerHTML = BI.length ? BI.map((b, i) => {
      const p = "biens." + i, warn = +b.crd > +b.valeur && +b.valeur > 0;
      return '<div class="pf-row" data-row="biens" data-i="' + i + '">' + text(p + ".nom", "Nom", "ex. Studio Lyon 7e", " pf-wide") +
        select(p + ".usage", "Usage", [["rp", "Résidence principale"], ["locatif", "Locatif"], ["secondaire", "Secondaire"]]) +
        money(p + ".valeur", "Valeur", "€") + money(p + ".partSteph", "Part de Stéph", "%") + money(p + ".crd", "Reste à rembourser", "€") +
        money(p + ".mensualite", "Mensualité", "€/mois") + money(p + ".loyer", "Loyer perçu", "€/mois") +
        '<button type="button" class="del" data-pf-del="biens" data-i="' + i + '">Retirer</button>' +
        (warn ? '<div class="pf-note">Le reste à rembourser dépasse la valeur du bien.</div>' : "") + "</div>";
    }).join("") : '<div class="pf-empty">Aucun bien. Si vous êtes locataires, laissez vide : le profil est quand même considéré comme renseigné une fois enregistré.</div>';

    const CR = draft.credits;
    $("pfCredits").innerHTML = CR.length ? CR.map((c, i) => {
      const p = "credits." + i;
      return '<div class="pf-row" data-row="credits" data-i="' + i + '">' + text(p + ".nom", "Nom", "ex. Prêt auto", " pf-wide") +
        select(p + ".owner", "Titulaire", [["steph", "Stéph"], ["compagne", "Compagne"], ["commun", "Commun"]]) +
        money(p + ".crd", "Reste à rembourser", "€") + money(p + ".mensualite", "Mensualité", "€/mois") +
        '<button type="button" class="del" data-pf-del="credits" data-i="' + i + '">Retirer</button></div>';
    }).join("") : '<div class="pf-empty">Aucun autre crédit.</div>';
  }

  /* ---------- état et récapitulatif ---------- */
  function renderStatus() {
    const C = window.Calc, pr = forCalc();
    const pct = draft.__saved || dirty ? C.completude(pr) : 0;
    $("pfPct").textContent = pct + " %";
    $("pfBar").style.width = pct + "%";
    const miss = C.manquants(pr);
    $("pfMissing").textContent = miss.length ? "À compléter : " + miss.join(", ").toLowerCase() + "." : "Tout est renseigné. Ma position et Acheter ou placer utilisent ces chiffres.";
    const pos = S ? S.positions : [];
    const pat = C.patrimoine(pos, pr, "couple"), rev = C.revenusFoyer(pr, "couple"), mens = C.mensualites(pr, "couple");
    $("pfRecap").innerHTML = [
      ["Patrimoine net du couple", eur(pat.net), "dont " + eur(pat.financier) + " suivis dans le Pilotage"],
      ["Revenus du foyer", eur(rev) + "/mois", "nets avant impôt, loyers compris"],
      ["Mensualités de crédit", eur(mens) + "/mois", rev > 0 ? Math.round(mens / rev * 100) + " % des revenus" : "—"],
    ].map(([l, v, s]) => '<div class="pf-kpi"><span>' + l + "</span><b>" + v + "</b><em>" + s + "</em></div>").join("");
    renderMsgs();
  }
  function forCalc() { const p = clone(draft); delete p.__saved; return p; }

  function renderMsgs(extra) {
    const v = window.Calc.valider(forCalc()), out = [];
    v.erreurs.forEach(e => out.push(["err", e]));
    v.avertissements.forEach(w => out.push(["warn", w]));
    if (remoteChanged && dirty) out.push(["warn", "Le profil a été modifié ailleurs pendant votre saisie. Enregistrer remplacera cette version."]);
    if (extra) out.push(extra);
    if (!out.length) out.push(dirty ? ["", "Modifications non enregistrées."] : [draft.updatedAt ? "ok" : "", draft.updatedAt ? "Enregistré le " + new Date(draft.updatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + "." : "Rien n'est encore enregistré."]);
    $("pfMsgs").innerHTML = out.map(([c, t]) => '<span class="' + c + '">' + esc(t) + "</span>").join("");
    $("pfSubmit").disabled = saving || !!v.erreurs.length || !(S && S.dbOk);
    $("pfCancel").hidden = !dirty;
  }

  function touch() { dirty = true; renderStatus(); }

  /* ---------- interactions ---------- */
  function mount(r) {
    root = r;
    draft = normalize(null); base = null;
    root.addEventListener("input", e => {
      const el = e.target.closest("[data-f]"); if (!el) return;
      const path = el.dataset.f;
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.t === "num") v = v === "" ? null : Math.max(0, +v);
      setP(draft, path, v);
      if (/^biens\.\d+\.(crd|valeur)$/.test(path)) { const row = el.closest(".pf-row"); const b = getP(draft, path.replace(/\.(crd|valeur)$/, "")); let n = row.querySelector(".pf-note"); const warn = +b.crd > +b.valeur && +b.valeur > 0; if (warn && !n) { n = document.createElement("div"); n.className = "pf-note"; n.textContent = "Le reste à rembourser dépasse la valeur du bien."; row.appendChild(n); } else if (!warn && n) n.remove(); }
      touch();
    });
    root.addEventListener("click", e => {
      const s = e.target.closest("[data-seg]");
      if (s) { const raw = s.dataset.v; setP(draft, s.dataset.seg, /^-?\d+(\.\d+)?$/.test(raw) ? +raw : raw); if (s.dataset.seg === "foyer.enfants" && +draft.foyer.enfants14 > +draft.foyer.enfants) draft.foyer.enfants14 = +draft.foyer.enfants; renderForm(); touch(); return; }
      const add = e.target.closest("[data-pf-add]");
      if (add) { const k = add.dataset.pfAdd; draft[k].push(k === "biens" ? { id: uid(), nom: "", usage: "rp", valeur: null, partSteph: 50, crd: 0, mensualite: 0, loyer: 0 } : { id: uid(), nom: "", owner: "commun", crd: null, mensualite: null }); renderForm(); touch(); const rows = $(k === "biens" ? "pfBiens" : "pfCredits").querySelectorAll(".pf-row"); const last = rows[rows.length - 1]; last && last.querySelector("input").focus(); return; }
      const del = e.target.closest("[data-pf-del]");
      if (del) { draft[del.dataset.pfDel].splice(+del.dataset.i, 1); renderForm(); touch(); }
    });
    // Les <select> et cases à cocher déclenchent « change » ; on les traite comme une saisie.
    root.addEventListener("change", e => {
      const el = e.target; if (!el.matches("select[data-f],input[type=checkbox][data-f]")) return;
      setP(draft, el.dataset.f, el.type === "checkbox" ? el.checked : el.value); touch();
    });
    $("pfCancel").addEventListener("click", () => { draft = normalize(base); dirty = false; remoteChanged = false; renderForm(); renderStatus(); });
    $("pfSubmit").addEventListener("click", save);
  }

  async function save() {
    const db = window.Store.db; if (!db) return;
    const data = forCalc();
    const v = window.Calc.valider(data); if (v.erreurs.length) { renderMsgs(); return; }
    ["biens", "credits"].forEach(k => data[k] = data[k].map(x => Object.assign({}, x, { nom: (x.nom || "").trim() || (k === "biens" ? "Bien" : "Crédit") })));
    data.updatedAt = new Date().toISOString();
    saving = true; renderMsgs(["", "Enregistrement…"]);
    try {
      await db.doc("profil/main").set(data);
      dirty = false; remoteChanged = false; draft = normalize(data); base = clone(data);
      saving = false; renderForm(); renderStatus(); renderMsgs(["ok", "Profil enregistré. Ma position et Acheter ou placer sont à jour."]);
    } catch (e) {
      saving = false;
      renderMsgs(["err", e && e.code === "invalid_argument" ? "Enregistrement refusé : vous n'avez pas les droits d'écriture sur ce tableau de bord." : "Enregistrement impossible pour le moment (" + (e && e.code || "erreur") + "). Votre saisie est conservée : réessayez dans un instant."]);
    }
  }

  function update(snap, visible) {
    const prev = S; S = snap;
    if (snap.profilLoaded || snap.dbOk === false) {
      const changed = JSON.stringify(snap.profil) !== JSON.stringify(base);
      if (changed) {
        if (dirty && prev) remoteChanged = true;
        else { draft = normalize(snap.profil); base = snap.profil ? clone(snap.profil) : null; if (visible) renderForm(); else formStale = true; }
      }
    }
    if (visible) { if (formStale) { renderForm(); formStale = false; } renderStatus(); }
  }
  let formStale = true;
  function show() { if (formStale) { renderForm(); formStale = false; } renderStatus(); }
  function headline() {
    if (!S || !(S.profilLoaded || S.dbOk === false)) return "–";
    return S.profil ? window.Calc.completude(S.profil) + " % rempli" : "À remplir";
  }
  const api = { mount, update, show, headline };
  const reg = () => App.register("profil", api); if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
