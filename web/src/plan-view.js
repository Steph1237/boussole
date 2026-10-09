/* Onglet Plan : budget mensuel (brouillon + « Enregistrer le budget »), objectifs datés, projection du patrimoine financier.
   Calculs dans plan.js (Plan) et calc.js (Calc) ; écritures par la façade Store.db (budget/main, objectifs). */
(function () {
  "use strict";
  let root = null, S = null;
  /* budget : brouillon de lignes, dernière version reçue du store, signature de la version de base */
  let draft = [], remote = [], baseSig = null, dirty = false, saving = false, remoteChanged = false, showErrs = false, msg = null;
  let budgetStale = true, viewSig = "";
  /* objectifs : formulaire ouvert ({ id: null pour un nouvel objectif, data, err, rendTouched }), suppression à confirmer */
  let objEdit = null, confirmDel = null, objBusy = false, objMsg = null;
  /* projection : réglages locaux, jamais enregistrés */
  let horizon = 10, versOverride = null;

  const $ = id => root.querySelector("#" + id);
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const eur = v => (v == null || !isFinite(v) ? "—" : nf.format(Math.round(v)) + " €");
  const eurM = v => eur(v) + "/mois";
  const pct = (v, d) => (v == null || !isFinite(v) ? "—" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: d || 0 }) + " %");
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => "bl-" + Math.random().toString(36).slice(2, 9);
  const safe = s => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
  const P = () => window.Plan, C = () => window.Calc;
  const moisAn = d => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "");
  const isoToday = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
  const plusMois = k => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + k + 1, 0)).toISOString().slice(0, 10); };

  /* ---------- vocabulaire ---------- */
  const TYPES = [["depense", "Dépense"], ["revenu", "Revenu"], ["epargne", "Épargne"]];
  const CAT_ORDER = ["Logement", "Alimentation", "Transport", "Enfants", "Santé", "Loisirs", "Abonnements", "Impôts", "Divers", "Autres"];
  const defCat = t => (t === "epargne" ? "Épargne" : t === "revenu" ? "Revenus" : "");
  const OBJ_TYPES = [["matelas", "Matelas"], ["apport", "Apport"], ["retraite", "Retraite"], ["projet", "Projet"]];
  const OBJ_LABEL = Object.fromEntries(OBJ_TYPES);
  const REND_DEF = { matelas: 2.4, apport: 2.4, retraite: 5, projet: 3 };
  const STATUT = {
    atteint: ["good", "atteint"], avance: ["good", "en avance"], dans_les_temps: ["acc", "dans les temps"],
    retard: ["warn", "en retard"], hors_portee: ["crit", "hors de portée"],
  };
  const ACTIONS = ["Monde", "Europe", "Asie", "Nasdaq 2x", "Convictions tech", "Convictions"];

  /* ---------- personnes et périmètre ---------- */
  const people = () => (S && Array.isArray(S.people) ? S.people : []);
  const two = () => people().length > 1;
  const nomOf = k => { const p = people().find(x => x.id === k); return (p && p.nom) || (k === "p2" ? "Conjoint(e)" : "Moi"); };
  const scope = () => (S && S.scope) || "foyer";
  const duScope = () => (scope() === "foyer" ? "du foyer" : C().deNom(nomOf(scope()), scope() === "p2" ? 2 : 1));

  /* ---------- budget : totaux du brouillon ---------- */
  const normLigne = l => Object.assign({}, l, { categorie: String(l.categorie || "").trim() || (l.type === "depense" ? "Autres" : defCat(l.type)) });
  const totaux = () => P().budgetTotaux(draft.map(normLigne), S && S.profil, scope());
  const part = l => C().partCredit(scope(), l.owner === "p1" || l.owner === "p2" ? l.owner : "commun");
  const SIG_KEYS = ["id", "type", "categorie", "libelle", "montant", "frequence", "owner"];
  const sig = lignes => JSON.stringify((lignes || []).map(l => SIG_KEYS.map(k => (l[k] == null ? null : l[k]))));

  /* Lignes issues du Profil (lecture seule) pour le périmètre courant. */
  function profileRows() {
    const pr = (S && S.profil) || {}, ps = pr.personnes || {}, sc = scope(), Ca = C();
    const who = sc === "foyer" ? ["p1"].concat(two() ? ["p2"] : []) : [sc];
    const rev = [], dep = [];
    who.forEach(k => {
      const sal = Ca.salaireNetMensuel(ps[k]);
      if (sal > 0) rev.push(["Salaire net " + Ca.deNom(nomOf(k), k === "p2" ? 2 : 1), sal]);
      const autres = Math.max(0, +(ps[k] && ps[k].autresRevenus) || 0);
      if (autres > 0) rev.push(["Autres revenus " + Ca.deNom(nomOf(k), k === "p2" ? 2 : 1), autres]);
    });
    (pr.biens || []).forEach(b => {
      const p = Ca.part(sc, b.part_p1);
      if (+b.loyer > 0 && p > 0) rev.push(["Loyer perçu · " + (b.nom || "Bien"), +b.loyer * p]);
      if (+b.mensualite > 0 && p > 0) dep.push(["Prêt · " + (b.nom || "Bien"), +b.mensualite * p]);
    });
    (pr.credits || []).forEach(c => {
      const p = Ca.partCredit(sc, c.owner);
      if (+c.mensualite > 0 && p > 0) dep.push([(c.nom || "Crédit") + (c.owner === "commun" && sc !== "foyer" ? " (moitié)" : ""), +c.mensualite * p]);
    });
    return { rev, dep };
  }

  /* Recharge un conteneur en gardant le focus (et le curseur) sur le champ actif s'il a un id. */
  function keepFocus(el, fn) {
    const a = document.activeElement, id = a && el.contains(a) && a.id ? a.id : null;
    let pos = null; try { pos = id ? a.selectionStart : null; } catch (e) {}
    fn();
    if (!id) return;
    const n = el.querySelector("#" + CSS.escape(id));
    if (n && n !== a) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch (e) {} }
  }

  /* ---------- rendu : synthèse ---------- */
  function renderSynth() {
    const t = totaux(), has = draft.length > 0;
    $("pvSynRev").textContent = "Revenus " + duScope() + " / mois";
    $("pvRev").textContent = eur(t.revenus);
    $("pvRevS").textContent = t.revenusProfil > 0 ? "dont " + eur(t.revenusProfil) + " repris du Profil" : "renseignez vos salaires dans le Profil";
    $("pvDep").textContent = eur(t.depenses);
    $("pvDepS").textContent = t.mensualites > 0 ? "dont " + eur(t.mensualites) + " de crédits" : "crédits compris";
    $("pvEp").textContent = eur(t.epargne);
    if (has && t.tauxEpargne != null) {
      const cls = t.tauxEpargne >= 0.15 ? "good" : t.tauxEpargne >= 0.05 ? "warn" : "crit";
      const lbl = cls === "good" ? "au-dessus du repère" : cls === "warn" ? "sous le repère" : "très bas";
      $("pvTaux").innerHTML = esc(pct(t.tauxEpargne)) + ' <span class="pill ' + cls + '">' + lbl + "</span>";
      $("pvTauxS").textContent = "épargne et reste positif, rapportés aux revenus ; repère 15 %";
    } else {
      $("pvTaux").textContent = "—";
      $("pvTauxS").textContent = has ? "revenus inconnus" : "remplissez le budget pour le calculer";
    }
    $("pvReste").textContent = has ? eur(t.reste) : "—";
    $("pvReste").classList.toggle("neg", has && t.reste < 0);
    $("pvResteS").textContent = !has ? "après dépenses et épargne, une fois le budget rempli" : t.reste < 0 ? "le budget dépense plus qu'il ne reçoit" : "après dépenses et épargne";
  }

  /* ---------- rendu : budget ---------- */
  function lineRow(l) {
    const id = "pvl-" + safe(l.id), t = l.type;
    const opt = (list, cur) => list.map(([v, x]) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(x) + "</option>").join("");
    const owners = [["p1", nomOf("p1")], ["p2", nomOf("p2")], ["commun", "Commun"]];
    const nom = (l.libelle || "").trim() || "sans libellé";
    return '<div class="pv-line" data-lid="' + esc(l.id) + '">' +
      '<label class="pv-f f-type"><span class="lbl">Type</span><select class="plain" id="' + id + '-type" data-k="type">' + opt(TYPES, t) + "</select></label>" +
      '<label class="pv-f f-cat"><span class="lbl">Catégorie</span><input class="plain" id="' + id + '-cat" data-k="categorie" list="pvCats" value="' + esc(l.categorie || "") + '" placeholder="ex. Logement"></label>' +
      '<label class="pv-f f-lib"><span class="lbl">Libellé</span><input class="plain" id="' + id + '-lib" data-k="libelle" value="' + esc(l.libelle || "") + '" placeholder="ex. Courses"></label>' +
      '<label class="pv-f f-mt"><span class="lbl">Montant</span><span class="money"><input id="' + id + '-mt" data-k="montant" type="number" inputmode="decimal" min="0" step="any" value="' + (l.montant == null ? "" : esc(l.montant)) + '"><span class="u">€</span></span></label>' +
      '<label class="pv-f f-fq"><span class="lbl">Fréquence</span><select class="plain" id="' + id + '-fq" data-k="frequence">' + opt([["mois", "par mois"], ["an", "par an"]], l.frequence || "mois") + "</select></label>" +
      (two() ? '<label class="pv-f f-ow"><span class="lbl">Titulaire</span><select class="plain" id="' + id + '-ow" data-k="owner">' + opt(owners, l.owner || "commun") + "</select></label>" : "") +
      '<button type="button" class="del" id="' + id + '-del" data-pv-del="' + esc(l.id) + '" aria-label="Supprimer la ligne ' + esc(nom) + '">Supprimer</button>' +
      '<span class="pv-eq small muted" data-eq="' + esc(l.id) + '"></span></div>';
  }
  const roRow = ([lib, v]) => '<div class="pv-ro"><span>' + esc(lib) + ' <span class="src-tag reel" title="Repris de votre Profil">réel</span></span><span class="num">' + esc(eurM(v)) + "</span></div>";
  const profilLink = '<a class="pv-link" href="#profil" data-goto-tab="profil">Modifier dans le Profil</a>';
  const addBtn = (type, txt) => '<button type="button" class="btn ghost small-btn" data-pv-addl="' + type + '">' + txt + "</button>";
  const head = () => '<div class="pv-lhead" aria-hidden="true"><span>Type</span><span>Catégorie</span><span>Libellé</span><span>Montant</span><span>Fréquence</span>' + (two() ? "<span>Titulaire</span>" : "") + "<span></span></div>";

  function renderBudget() {
    const el = $("pvBudget"), pr = profileRows();
    keepFocus(el, () => {
      el.classList.toggle("two", two());
      if (!draft.length) {
        const known = pr.rev.length || pr.dep.length;
        el.innerHTML = '<div class="pv-empty">' +
          "<h3>Votre budget est vide</h3>" +
          "<p>En quelques lignes (logement, courses, transport, épargne…), le budget donne trois repères que le reste de Boussole ne peut pas deviner :</p>" +
          "<ul><li><b>votre taux d'épargne</b>, la part des revenus mise de côté chaque mois ;</li>" +
          "<li><b>votre matelas en mois de dépenses</b>, pour savoir combien de temps vous tiendriez sans revenu ;</li>" +
          "<li><b>votre score de santé</b> financière, affiché dans Diagnostic › Santé.</li></ul>" +
          '<div class="pv-empty-act">' + addBtn("depense", "Ajouter une ligne") + '<button type="button" class="btn" data-pv-assist>Remplir avec mon assistant</button></div>' +
          (known ? '<div class="pv-known"><span class="lbl">Déjà connu grâce au Profil</span>' + pr.rev.concat(pr.dep).map(roRow).join("") + profilLink + "</div>" : "") +
          "</div>";
        return;
      }
      const L = type => draft.filter(l => l.type === type);
      const group = (type, title, ro, body, addTxt) =>
        '<div class="pv-grp" data-grp="' + type + '"><div class="pv-grp-h"><h3>' + title + '</h3><span class="num" data-gt="' + type + '"></span></div>' +
        (ro.length ? '<div class="pv-ros">' + ro.map(roRow).join("") + profilLink + "</div>" : "") + body + addBtn(type, addTxt) + "</div>";
      const lines = list => (list.length ? head() + list.map(lineRow).join("") : "");
      /* dépenses : regroupées par catégorie, sous-total mensuel par catégorie */
      const deps = L("depense"), cats = [];
      deps.forEach(l => { const c = normLigne(l).categorie; if (!cats.includes(c)) cats.push(c); });
      const rank = c => { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length - 1.5 : i; };
      cats.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "fr"));
      const depBody = (deps.length ? head() : "") + cats.map(c =>
        '<div class="pv-cat"><span>' + esc(c) + '</span><span class="num" data-cat="' + esc(c) + '"></span></div>' +
        deps.filter(l => normLigne(l).categorie === c).map(lineRow).join("")).join("");
      el.innerHTML =
        group("revenu", "Revenus", pr.rev, lines(L("revenu")), "Ajouter un revenu") +
        group("depense", "Dépenses", pr.dep, depBody, "Ajouter une dépense") +
        group("epargne", "Épargne", [], lines(L("epargne")), "Ajouter une épargne") +
        '<div class="pv-bar-wrap"><div class="lbl">Dépenses par catégorie</div><div id="pvBar"></div></div>';
    });
  }

  /* Sous-totaux, équivalents mensuels et barre des dépenses : mis à jour à chaque saisie sans reconstruire les lignes. */
  function renderTotalsInBudget() {
    const el = $("pvBudget"), t = totaux();
    $("pvBudgetNote").textContent = scope() === "foyer" ? "Montants mensuels du foyer" : "Vue " + duScope() + " : ses lignes, et la moitié des lignes communes";
    if (!draft.length) return;
    const gt = { revenu: t.revenus, depense: t.depenses, epargne: t.epargne };
    el.querySelectorAll("[data-gt]").forEach(x => { x.textContent = eurM(gt[x.dataset.gt]); });
    el.querySelectorAll("[data-cat]").forEach(x => { x.textContent = eurM(t.parCategorie[x.dataset.cat] || 0); });
    el.querySelectorAll("[data-eq]").forEach(x => {
      const l = draft.find(d => d.id === x.dataset.eq); if (!l) return;
      const p = part(l), m = P().mensuel(l);
      x.textContent = l.frequence === "an" && m > 0 ? "≈ " + eurM(m * p) + (p < 1 && p > 0 ? " (votre part)" : "") : p === 0 ? "hors de cette vue" : p < 1 && m > 0 ? "votre part : " + eurM(m * p) : "";
    });
    const bar = $("pvBar"); if (!bar) return;
    const cats = Object.entries(t.parCategorie).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const tot = cats.reduce((a, [, v]) => a + v, 0);
    if (!tot) { bar.innerHTML = '<p class="small muted">Aucune dépense saisie.</p>'; return; }
    const col = i => "var(--s" + ((i % 9) + 1) + ")";
    bar.innerHTML = '<div class="pv-stack" role="img" aria-label="' + esc(cats.map(([c, v]) => c + " " + pct(v / tot)).join(", ")) + '">' +
      cats.map(([c, v], i) => '<span style="width:' + (v / tot * 100).toFixed(2) + "%;background:" + col(i) + '" title="' + esc(c + " : " + eurM(v)) + '"></span>').join("") + "</div>" +
      '<ul class="pv-leg">' + cats.map(([c, v], i) => '<li><span class="sw" style="background:' + col(i) + '"></span>' + esc(c) + ' <b class="num">' + esc(eur(v)) + '</b> <span class="muted">' + pct(v / tot) + "</span></li>").join("") + "</ul>";
  }

  /* ---------- enregistrement du budget ---------- */
  function errors() {
    const out = [];
    draft.forEach((l, i) => {
      const lib = (l.libelle || "").trim(), nom = lib ? "« " + lib + " »" : "Ligne " + (i + 1) + " (sans libellé)";
      if (l.montant == null || l.montant === "" || !isFinite(+l.montant)) out.push(nom + " : indiquez un montant.");
      else if (+l.montant < 0) out.push(nom + " : le montant ne peut pas être négatif.");
    });
    return out;
  }
  function renderSaveBar() {
    const errs = showErrs ? errors() : [], out = [];
    errs.forEach(e => out.push(["err", e]));
    if (remoteChanged && dirty) out.push(["warn", "Le budget a été modifié ailleurs pendant votre saisie. Enregistrer remplacera cette version."]);
    if (msg) out.push(msg);
    if (!out.length && dirty) out.push(["", "Modifications non enregistrées."]);
    $("pvSave").hidden = !dirty && !msg;
    $("pvMsgs").innerHTML = out.map(([c, t]) => '<span class="' + c + '">' + esc(t) + "</span>").join("");
    $("pvSubmit").disabled = saving || !dirty || !(S && S.dbOk);
    $("pvCancel").hidden = !dirty;
  }
  function touch() { dirty = true; msg = null; refreshTotals(); }

  async function saveBudget() {
    const db = window.Store && window.Store.db; if (!db) return;
    showErrs = true;
    if (errors().length) { renderSaveBar(); return; }
    const lignes = draft.map(l => {
      const cat = String(l.categorie || "").trim() || defCat(l.type) || "Divers";
      const o = { id: l.id, type: l.type, categorie: cat, libelle: String(l.libelle || "").trim() || cat, montant: +l.montant, frequence: l.frequence === "an" ? "an" : "mois" };
      if (two() && l.owner) o.owner = l.owner;
      return o;
    });
    saving = true; msg = ["", "Enregistrement…"]; renderSaveBar();
    try {
      await db.doc("budget/main").set({ lignes });
      saving = false; dirty = false; remoteChanged = false; showErrs = false;
      draft = clone(lignes); remote = clone(lignes); baseSig = sig(lignes); budgetStale = true;
      msg = ["ok", "Budget enregistré. Le taux d'épargne et vos objectifs sont à jour."];
      render();
    } catch (e) {
      saving = false;
      msg = ["err", writeError(e, "Budget")];
      renderSaveBar();
    }
  }
  function writeError(e, quoi) {
    const m = (e && e.message) || "";
    if (e && e.code === "invalid_argument" && /^(Budget|Objectif)/.test(m)) return m;
    if (e && e.code === "invalid_argument") return "Enregistrement refusé : vous n'avez pas les droits d'écriture sur ce tableau de bord.";
    return "Enregistrement impossible pour le moment (" + ((e && e.code) || "erreur") + "). " + (quoi === "Budget" ? "Votre saisie est conservée : réessayez dans un instant." : "Réessayez dans un instant.");
  }

  /* ---------- remplissage par assistant : le résultat va dans le brouillon, jamais directement en base ---------- */
  function mountAssistant() {
    const A = window.Assistant, dlg = $("pvAssist");
    if (!A || !dlg || !dlg.showModal) { $("pvAssistBtn").hidden = true; return; }
    let pending = null;
    const open = () => {
      $("pvPrompt").value = A.prompt("budget"); $("pvPaste").value = ""; $("pvPreview").innerHTML = ""; $("pvApply").disabled = true; pending = null;
      dlg.showModal();
    };
    $("pvAssistBtn").addEventListener("click", open);
    root.addEventListener("click", e => { if (e.target.closest("[data-pv-assist]")) open(); });
    $("pvCopy").addEventListener("click", async () => {
      const b = $("pvCopy");
      try { await navigator.clipboard.writeText($("pvPrompt").value); b.textContent = "Message copié"; }
      catch (e) { $("pvPrompt").select(); b.textContent = "Sélectionné : copiez avec Ctrl+C / ⌘C"; }
      setTimeout(() => { b.textContent = "Copier le message"; }, 2500);
    });
    const TL = { revenu: "Revenu", depense: "Dépense", epargne: "Épargne" };
    const freq = f => (f === "an" ? "/an" : "/mois");
    $("pvRead").addEventListener("click", () => {
      const r = A.parse($("pvPaste").value, "budget"), out = [];
      r.erreurs.forEach(e => out.push('<p class="err">' + esc(e) + "</p>"));
      r.avertissements.forEach(w => out.push('<p class="warn">' + esc(w) + "</p>"));
      pending = null;
      if (r.data && r.data.length && !r.erreurs.length) {
        const next = clone(draft), changes = [];
        r.data.forEach(d => {
          const key = String(d.libelle || "").trim().toLowerCase();
          const hit = next.find(l => String(l.libelle || "").trim().toLowerCase() === key);
          if (hit) {
            if (+hit.montant !== +d.montant || (hit.frequence || "mois") !== d.frequence) {
              changes.push("<tr><td>" + esc(hit.libelle) + '</td><td class="n">' + esc(eur(hit.montant) + freq(hit.frequence)) + '</td><td class="n">→ ' + esc(eur(d.montant) + freq(d.frequence)) + "</td></tr>");
              hit.montant = d.montant; hit.frequence = d.frequence;
            }
          } else {
            const l = { id: uid(), type: d.type, categorie: d.categorie || defCat(d.type), libelle: d.libelle, montant: d.montant, frequence: d.frequence };
            if (two()) l.owner = d.owner === "p1" || d.owner === "p2" ? d.owner : "commun";
            next.push(l);
            changes.push('<tr><td class="add">+ ' + esc(TL[d.type] + " · " + (l.categorie ? l.categorie + " · " : "") + d.libelle) + '</td><td></td><td class="n">' + esc(eur(d.montant) + freq(d.frequence)) + "</td></tr>");
          }
        });
        if (!changes.length) out.push("<p>La réponse ne change rien à votre budget.</p>");
        else {
          pending = next;
          out.push("<p><b>" + changes.length + " changement" + (changes.length > 1 ? "s" : "") + "</b> à appliquer :</p><div class=\"pv-scroll\"><table>" + changes.join("") + "</table></div>");
        }
      }
      $("pvPreview").innerHTML = out.join("");
      $("pvApply").disabled = !pending;
    });
    $("pvApply").addEventListener("click", () => {
      if (!pending) return;
      draft = pending; pending = null; dlg.close();
      dirty = true; budgetStale = true;
      msg = ["warn", "Réponse appliquée au budget. Vérifiez, puis cliquez sur « Enregistrer le budget »."];
      render();
    });
  }

  /* ---------- objectifs ---------- */
  const sortedObjs = () => (S && Array.isArray(S.objectifs) ? S.objectifs.slice() : []).sort((a, b) =>
    ((a.priorite ?? Infinity) - (b.priorite ?? Infinity)) || String(a.dateCible || "9999").localeCompare(String(b.dateCible || "9999")));
  const livePos = () => (S && S.positions ? S.positions : []).filter(p => C().counted(p));
  const blocsDispo = () => [...new Set(livePos().map(p => p.bloc).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const envDispo = () => [...new Set(livePos().map(p => p.envelope).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const valeurDe = (key, name) => livePos().filter(p => C().inScope(p, scope()) && p[key] === name).reduce((a, p) => a + C().val(p), 0);
  const sourcesTxt = o => [].concat(o.poches || [], o.enveloppes || []).join(", ");

  function analyse() {
    const objs = sortedObjs(), t = totaux(), today = isoToday();
    const deja = P().affecterDeja(objs, S.positions, scope());
    /* La répartition de l'épargne suit les mêmes montants « déjà » que la cascade des poches. */
    const alloue = P().repartirEpargne(objs.map(o => Object.assign({}, o, { source: "saisi", deja: deja[o.id] || 0 })), P().capaciteEpargne(t), { today });
    return objs.map(o => {
      const st = P().statutObjectif(o, { deja: deja[o.id] || 0, versementAlloue: alloue[o.id] || 0, today });
      const brut = o.source === "poches" ? P().dejaObjectif(o, S.positions, scope()) : st.deja;
      return { o, st, brut };
    });
  }

  function card(x, i, n) {
    const { o, st, brut } = x, id = safe(o.id), [cls, lbl] = STATUT[st.statut] || ["", st.statut];
    const done = st.statut === "atteint", date = o.dateCible;
    const effort = done ? ["—", "objectif atteint"] : !date ? ["—", "pas d'échéance fixée"] : !isFinite(st.effort) ? ["—", "échéance dépassée"]
      : [eurM(st.effort), "pendant " + st.mois + " mois, à " + String(o.rendement ?? 0).replace(".", ",") + " %/an"];
    const src = o.source === "poches"
      ? (sourcesTxt(o) ? "pris sur " + sourcesTxt(o) : "aucune poche rattachée")
      : "montant saisi";
    const cascade = o.source === "poches" && brut > st.deja + 0.5 && !done
      ? '<p class="small muted">Ces poches contiennent ' + esc(eur(brut)) + " " + esc(duScope()) + " ; " + esc(eur(brut - st.deja)) + " servent d'abord un objectif prioritaire.</p>" : "";
    const quand = done ? "Objectif atteint : la somme est déjà de côté."
      : st.atteinte ? "Au rythme actuel, atteint vers " + moisAn(st.atteinte) + "."
      : st.versementAlloue > 0 ? "Pas atteint en 60 ans au rythme actuel." : "Aucune épargne n'y est affectée pour l'instant : pas atteint au rythme actuel.";
    const del = confirmDel === o.id
      ? '<span class="pv-confirm" role="group" aria-label="Confirmer la suppression">Supprimer ? <button type="button" class="btn danger" id="pvo-' + id + '-yes" data-pv-del-yes="' + esc(o.id) + '">Oui, supprimer</button><button type="button" class="btn ghost" id="pvo-' + id + '-no" data-pv-del-no>Non</button></span>'
      : '<button type="button" class="btn ghost" id="pvo-' + id + '-del" data-pv-odel="' + esc(o.id) + '">Supprimer</button>';
    const dis = objBusy || !(S && S.dbOk) ? " disabled" : "";
    return '<article class="pv-obj st-' + cls + '" aria-labelledby="pvo-' + id + '-h">' +
      '<div class="pv-obj-h"><span class="pv-rank" title="Priorité">' + (i + 1) + '</span><h3 id="pvo-' + id + '-h">' + esc(o.nom || "Objectif sans nom") + "</h3>" +
      '<span class="chip">' + esc(OBJ_LABEL[o.type] || o.type) + '</span><span class="pill ' + cls + '">' + esc(lbl) + "</span></div>" +
      '<div class="pv-nums">' +
      '<div><span>Cible</span><b class="num">' + esc(eur(o.cible)) + "</b><em>" + esc(date ? moisAn(date) : "sans échéance") + "</em></div>" +
      '<div><span>Déjà</span><b class="num">' + esc(eur(st.deja)) + "</b><em>" + esc(src) + "</em></div>" +
      '<div><span>Effort requis</span><b class="num">' + esc(effort[0]) + "</b><em>" + esc(effort[1]) + "</em></div>" +
      '<div><span>Votre épargne actuelle en couvre</span><b class="num">' + esc(eurM(st.versementAlloue)) + "</b><em>" + esc(done ? "plus rien à verser" : "versement alloué, par ordre de priorité") + "</em></div>" +
      "</div>" +
      '<div class="pv-prog" role="progressbar" aria-label="Progression" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(st.progression * 100) + '"><i style="width:' + (st.progression * 100).toFixed(1) + '%"></i></div>' +
      '<div class="pv-prog-l small"><span>' + pct(st.progression) + " de la cible</span><span>" + esc(quand) + "</span></div>" + cascade +
      '<div class="pv-obj-act">' +
      '<button type="button" class="btn ghost" id="pvo-' + id + '-up" data-pv-move="-1" data-id="' + esc(o.id) + '"' + (i === 0 ? " disabled" : dis) + ' aria-label="Monter la priorité de ' + esc(o.nom) + '">↑ Monter</button>' +
      '<button type="button" class="btn ghost" id="pvo-' + id + '-down" data-pv-move="1" data-id="' + esc(o.id) + '"' + (i === n - 1 ? " disabled" : dis) + ' aria-label="Descendre la priorité de ' + esc(o.nom) + '">↓ Descendre</button>' +
      '<button type="button" class="btn ghost" id="pvo-' + id + '-edit" data-pv-edit="' + esc(o.id) + '">Modifier</button>' + del +
      "</div></article>";
  }

  function formCard() {
    const d = objEdit.data, isNew = objEdit.id == null, f = "pvf-";
    const opt = (list, cur) => list.map(([v, x]) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(x) + "</option>").join("");
    const checks = (key, list, sel) => list.length ? list.map(n => '<label class="chk"><input type="checkbox" data-o-list="' + key + '" value="' + esc(n) + '"' + (sel.includes(n) ? " checked" : "") + "> " + esc(n) +
      ' <span class="muted num">' + esc(eur(valeurDe(key === "poches" ? "bloc" : "envelope", n))) + "</span></label>").join("") : '<span class="small muted">Aucune dans le Pilotage.</span>';
    const blocs = [...new Set(blocsDispo().concat(d.poches || []))], envs = [...new Set(envDispo().concat(d.enveloppes || []))];
    return '<article class="pv-obj pv-edit" aria-labelledby="pvf-h">' +
      '<h3 id="pvf-h">' + (isNew ? "Nouvel objectif" : "Modifier « " + esc(d.nom) + " »") + "</h3>" +
      '<div class="pv-form">' +
      '<div class="pv-field f-wide"><label class="lbl" for="' + f + 'nom">Nom</label><input class="plain" id="' + f + 'nom" data-o="nom" value="' + esc(d.nom) + '" placeholder="ex. Voyage au Japon"></div>' +
      '<div class="pv-field"><label class="lbl" for="' + f + 'type">Type</label><select class="plain" id="' + f + 'type" data-o="type">' + opt(OBJ_TYPES, d.type) + "</select></div>" +
      '<div class="pv-field"><label class="lbl" for="' + f + 'cible">Montant cible</label><span class="money"><input id="' + f + 'cible" data-o="cible" type="number" inputmode="decimal" min="0" step="any" value="' + esc(d.cible ?? "") + '"><span class="u">€</span></span></div>' +
      '<div class="pv-field"><label class="lbl" for="' + f + 'date">Date visée</label><input class="plain" id="' + f + 'date" data-o="dateCible" type="date" value="' + esc(d.dateCible || "") + '"></div>' +
      '<div class="pv-field f-wide"><span class="lbl" id="' + f + 'srcl">Déjà mis de côté</span><div class="seg" role="group" aria-labelledby="' + f + 'srcl">' +
      '<button type="button" id="' + f + 'src-saisi" data-o-src="saisi" aria-pressed="' + (d.source !== "poches") + '">Montant saisi</button>' +
      '<button type="button" id="' + f + 'src-poches" data-o-src="poches" aria-pressed="' + (d.source === "poches") + '">Poches de vos placements</button></div></div>' +
      (d.source === "poches"
        ? '<fieldset class="pv-checks f-wide"><legend class="lbl">Poches</legend>' + checks("poches", blocs, d.poches || []) + "</fieldset>" +
          '<fieldset class="pv-checks f-wide"><legend class="lbl">Enveloppes</legend>' + checks("enveloppes", envs, d.enveloppes || []) + "</fieldset>" +
          '<p class="small muted f-wide">L\'argent d\'une poche sert d\'abord l\'objectif prioritaire ; le reste passe au suivant.</p>'
        : '<div class="pv-field"><label class="lbl" for="' + f + 'deja">Montant déjà de côté</label><span class="money"><input id="' + f + 'deja" data-o="deja" type="number" inputmode="decimal" min="0" step="any" value="' + esc(d.deja ?? 0) + '"><span class="u">€</span></span></div>') +
      '<div class="pv-field"><label class="lbl" for="' + f + 'rend">Rendement attendu</label><span class="money"><input id="' + f + 'rend" data-o="rendement" type="number" inputmode="decimal" step="0.1" min="-50" max="50" value="' + esc(d.rendement ?? "") + '"><span class="u">% / an</span></span>' +
      '<span class="small muted">repère : Livret A 2,4 %, fonds euros ~2,5 %, actions mondiales ~6 % sur longue période</span></div>' +
      "</div>" +
      (objEdit.err ? '<p class="pv-err" role="alert">' + esc(objEdit.err) + "</p>" : "") +
      '<div class="pv-obj-act"><button type="button" class="btn ghost" id="pvf-cancel" data-pv-ocancel>Annuler</button>' +
      '<button type="button" class="btn" id="pvf-save" data-pv-osave' + (objBusy || !(S && S.dbOk) ? " disabled" : "") + ">" + (isNew ? "Ajouter l'objectif" : "Enregistrer l'objectif") + "</button></div></article>";
  }

  function renderObjectifs() {
    const el = $("pvObjs"), list = analyse();
    keepFocus(el, () => {
      const cards = list.map((x, i) => (objEdit && objEdit.id === x.o.id ? formCard() : card(x, i, list.length)));
      if (objEdit && objEdit.id == null) cards.push(formCard());
      el.innerHTML = cards.length ? cards.join("") : '<div class="pv-empty small"><p><b>Aucun objectif pour l\'instant.</b> Un objectif daté (matelas, apport, retraite, projet) dit combien mettre de côté chaque mois et si votre épargne actuelle suffit. Partez d\'un modèle ci-dessous.</p></div>';
    });
    const P_ = list.filter(x => x.o.source === "poches"), shared = P_.some((a, i) => P_.some((b, j) => j > i &&
      ((a.o.poches || []).some(p => (b.o.poches || []).includes(p)) || (a.o.enveloppes || []).some(p => (b.o.enveloppes || []).includes(p)))));
    const t = totaux();
    $("pvObjNote").textContent = list.length ? "Épargne mensuelle répartie par priorité : " + eurM(t.epargne) : "";
    $("pvObjMsg").innerHTML = (shared ? '<p class="small muted">Plusieurs objectifs partagent une poche : l\'argent d\'une poche sert d\'abord l\'objectif prioritaire.</p>' : "") +
      (objMsg ? '<p class="small ' + objMsg[0] + '">' + esc(objMsg[1]) + "</p>" : "");
    $("pvAdd").hidden = !!(objEdit && objEdit.id == null);
  }

  function template(kind) {
    const t = totaux(), blocs = blocsDispo(), ep = blocs.includes("Épargne");
    const base = { nom: "", type: kind, cible: 10000, dateCible: plusMois(24), source: "saisi", poches: [], enveloppes: [], deja: 0, rendement: REND_DEF[kind] };
    if (kind === "matelas") return Object.assign(base, { nom: "Matelas de précaution", cible: t.depenses > 0 ? Math.round(6 * t.depenses / 100) * 100 : 10000, dateCible: plusMois(12), source: ep ? "poches" : "saisi", poches: ep ? ["Épargne"] : [] });
    if (kind === "apport") return Object.assign(base, { nom: "Apport immobilier", cible: 40000, dateCible: plusMois(36), source: ep ? "poches" : "saisi", poches: ep ? ["Épargne"] : [] });
    if (kind === "retraite") {
      const age = { u30: 25, a30: 35, a40: 45, a50: 55, a60: 62, a70: 70 }[S && S.profil && S.profil.foyer && S.profil.foyer.age];
      const ans = Math.max(5, 64 - (age || 40)), act = blocs.filter(b => ACTIONS.includes(b));
      return Object.assign(base, { nom: "Retraite", cible: 300000, dateCible: plusMois(ans * 12), source: act.length ? "poches" : "saisi", poches: act });
    }
    return base;
  }

  function validObj(d) {
    if (!String(d.nom || "").trim()) return "Donnez un nom à l'objectif.";
    if (!(+d.cible > 0)) return "Indiquez un montant cible supérieur à 0 €.";
    if (d.dateCible && !/^\d{4}-\d{2}-\d{2}$/.test(d.dateCible)) return "Date visée invalide.";
    if (d.dateCible && d.dateCible <= isoToday()) return "La date visée doit être dans le futur.";
    if (d.source === "poches" && !(d.poches || []).length && !(d.enveloppes || []).length) return "Cochez au moins une poche ou une enveloppe, ou choisissez « Montant saisi ».";
    if (d.source !== "poches" && (d.deja === "" || d.deja == null || !(+d.deja >= 0))) return "Indiquez le montant déjà de côté (0 si rien).";
    if (d.rendement === "" || d.rendement == null || !isFinite(+d.rendement) || +d.rendement < -50 || +d.rendement > 50) return "Indiquez un rendement entre -50 et 50 % par an.";
    return null;
  }

  async function saveObj() {
    const db = window.Store && window.Store.db; if (!db || !objEdit) return;
    const d = objEdit.data, err = validObj(d);
    if (err) { objEdit.err = err; renderObjectifs(); return; }
    const objs = sortedObjs();
    const row = {
      nom: String(d.nom).trim(), type: d.type, cible: +d.cible, dateCible: d.dateCible || null, source: d.source === "poches" ? "poches" : "saisi",
      poches: d.source === "poches" ? d.poches || [] : [], enveloppes: d.source === "poches" ? d.enveloppes || [] : [],
      deja: d.source === "poches" ? 0 : +d.deja, rendement: +d.rendement,
    };
    if (objEdit.id != null) row.id = objEdit.id;
    else row.priorite = objs.reduce((m, o) => Math.max(m, +o.priorite || 0), 0) + 1;
    objBusy = true; objEdit.err = null; renderObjectifs();
    try {
      await db.collection("objectifs").upsert(row);
      objBusy = false; objEdit = null; objMsg = ["ok", "Objectif « " + row.nom + " » enregistré."];
    } catch (e) {
      objBusy = false; if (objEdit) objEdit.err = writeError(e, "Objectif");
    }
    refreshTotals();
  }

  async function moveObj(id, dir) {
    const db = window.Store.db, list = sortedObjs(), i = list.findIndex(o => o.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const order = list.slice(); [order[i], order[j]] = [order[j], order[i]];
    const ups = order.map((o, k) => ({ id: o.id, priorite: k + 1 })).filter(u => (list.find(o => o.id === u.id).priorite) !== u.priorite);
    objBusy = true; objMsg = null; renderObjectifs();
    try { for (const u of ups) await db.collection("objectifs").upsert(u); }
    catch (e) { objMsg = ["err", writeError(e, "Objectif")]; }
    objBusy = false; refreshTotals();
    const b = $("pvo-" + safe(id) + (dir < 0 ? "-up" : "-down")); if (b && !b.disabled) b.focus();
  }

  async function deleteObj(id) {
    const o = sortedObjs().find(x => x.id === id);
    objBusy = true; renderObjectifs();
    try { await window.Store.db.doc("objectifs/" + id).delete(); objMsg = ["ok", "Objectif « " + ((o && o.nom) || "") + " » supprimé."]; }
    catch (e) { objMsg = ["err", writeError(e, "Objectif")]; }
    objBusy = false; confirmDel = null; refreshTotals();
  }

  /* ---------- projection ---------- */
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r || 1))), n = r / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  const kEur = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M€" : nf.format(v / 1000) + " k€");

  function versementReel() {
    const t = totaux();
    if (draft.length && t.epargne > 0) return { v: t.epargne, src: "d'après l'épargne prévue au budget" };
    const rec = ((S && S.config && S.config.recurring) || []).filter(r => {
      const p = (S.positions || []).find(x => x.id === r.positionId);
      return scope() === "foyer" || (p && p.owner === scope());
    }).reduce((a, r) => a + Math.max(0, +r.amount || 0), 0);
    if (rec > 0) return { v: rec, src: "d'après vos versements programmés (budget sans épargne)" };
    return null;
  }

  function renderProjection(forceInput) {
    const real = versementReel(), inp = $("pvVers");
    const v = versOverride != null ? versOverride : real ? real.v : 0;
    if (forceInput || versOverride == null || document.activeElement !== inp) inp.value = String(Math.round(v * 100) / 100);
    $("pvVersTag").innerHTML = versOverride != null ? '<button type="button" class="src-tag scen" data-pv-vreset title="Revenir à la valeur réelle">scénario ↺</button>'
      : real ? '<span class="src-tag reel" title="Repris de vos données">réel</span>' : "";
    $("pvVersSrc").textContent = versOverride != null ? "simulation locale, non enregistrée" + (real ? " · réel : " + eurM(real.v) : "") : real ? real.src : "aucune épargne mensuelle connue : saisissez un montant";
    root.querySelectorAll("#pvHorizon [data-h]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.h === horizon)));

    const res = P().projection({ positions: S.positions, scope: scope(), versementMensuel: v, annees: horizon });
    const N = horizon, y0 = new Date().getFullYear();
    $("pvProjNote").textContent = "Patrimoine financier " + duScope() + " aujourd'hui : " + eur(res.central[0]);

    /* courbe : bande pessimiste–optimiste, ligne centrale */
    /* dessinée à l'échelle 1 (largeur réelle du conteneur) pour garder des libellés lisibles */
    const cw = $("pvChart").clientWidth || 640, narrow = cw < 520;
    const W = Math.round(Math.min(1150, Math.max(300, cw))), H = narrow ? 230 : 280, L = narrow ? 50 : 64, R = 14, T = 14, B = 28;
    let hi = Math.max(...res.optimiste, ...res.central, 1), lo = Math.min(0, ...res.pessimiste);
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const X = i => L + (N ? i / N : 0) * (W - L - R), Y = val => T + (1 - (val - lo) / (hi - lo)) * (H - T - B);
    let g = "";
    for (let val = lo; val <= hi + 1; val += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(val).toFixed(1) + '" y2="' + Y(val).toFixed(1) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 8) + '" y="' + (Y(val) + 4).toFixed(1) + '" text-anchor="end">' + kEur(val) + "</text>";
    const tick = N <= 5 ? 1 : N <= 10 ? 2 : 5;
    for (let i = 0; i <= N; i += tick) g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : i === N ? "end" : "middle") + '">' + (y0 + i) + "</text>";
    const path = s => res[s].map((val, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(val).toFixed(1)).join("");
    const band = path("optimiste") + res.pessimiste.map((val, i) => "L" + X(i).toFixed(1) + "," + Y(val).toFixed(1)).reverse().join("") + "Z";
    const dots = res.central.map((val, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(val).toFixed(1) + '" r="' + (i === N ? 4.5 : 2) + '" fill="' + (i === N ? "var(--accent)" : "var(--surface)") + '" stroke="var(--accent)" stroke-width="1.5"><title>' + (y0 + i) + " : " + eur(val) + " (central ; " + eur(res.pessimiste[i]) + " à " + eur(res.optimiste[i]) + ")</title></circle>").join("");
    const last = res.central[N];
    $("pvChart").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Projection sur ' + N + " ans : " + esc(eur(last)) + " dans le scénario central, entre " + esc(eur(res.pessimiste[N])) + " et " + esc(eur(res.optimiste[N])) + '">' + g +
      '<path d="' + band + '" fill="var(--accent-soft)" opacity=".85"/>' +
      '<path d="' + path("optimiste") + '" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="4 3" opacity=".7"/>' +
      '<path d="' + path("pessimiste") + '" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="4 3" opacity=".7"/>' +
      '<path d="' + path("central") + '" fill="none" stroke="var(--accent)" stroke-width="2.2"/>' + dots +
      '<text x="' + (X(N) - 8).toFixed(1) + '" y="' + (Y(last) - 10).toFixed(1) + '" text-anchor="end" class="pv-end">' + esc(eur(last)) + "</text></svg>";
    $("pvLegend").innerHTML = '<span><i class="ln"></i>scénario central</span><span><i class="bd"></i>entre pessimiste et optimiste (pointillés)</span>';

    const verse = res.central[0] + v * 12 * N;
    const row = (s, lbl) => "<tr><td>" + lbl + '</td><td class="n">' + eur(res[s][N]) + '</td><td class="n">' + eur(verse) + '</td><td class="n ' + (res[s][N] - verse < 0 ? "neg" : "") + '">' + (res[s][N] - verse >= 0 ? "+" : "") + eur(res[s][N] - verse) + "</td></tr>";
    $("pvProjTable").innerHTML = "<thead><tr><th>Scénario</th><th>Dans " + N + " ans (" + (y0 + N) + ")</th><th>Capital et versements</th><th>Effet des marchés</th></tr></thead><tbody>" +
      row("pessimiste", "Pessimiste") + row("central", "Central") + row("optimiste", "Optimiste") + "</tbody>";

    const R_ = P().RENDEMENTS, blocs = Object.keys(res.parBloc).sort((a, b) => res.parBloc[b].capital - res.parBloc[a].capital);
    const fr = x => String(x).replace(".", ",") + " %";
    $("pvHyp").innerHTML = "<thead><tr><th>Poche</th><th>Montant</th><th>Part</th><th>Pessimiste</th><th>Central</th><th>Optimiste</th></tr></thead><tbody>" +
      blocs.map(b => { const r = R_[b] || R_._autre, pb = res.parBloc[b];
        return "<tr><td>" + esc(b === "_autre" ? "Autres" : b) + '</td><td class="n">' + eur(pb.capital) + '</td><td class="n">' + pct(pb.poids) + '</td><td class="n">' + fr(r.pessimiste) + '</td><td class="n">' + fr(r.central) + '</td><td class="n">' + fr(r.optimiste) + "</td></tr>"; }).join("") + "</tbody>";
  }

  /* ---------- assemblage ---------- */
  function refreshTotals() {
    if (!root || !S) return;
    renderSynth(); renderTotalsInBudget(); renderSaveBar(); renderObjectifs(); renderProjection();
  }
  function render() {
    if (!root || !S) return;
    if (budgetStale) { renderBudget(); budgetStale = false; }
    refreshTotals();
  }

  function addLine(type) {
    const l = { id: uid(), type, categorie: defCat(type), libelle: "", montant: null, frequence: "mois" };
    if (two()) l.owner = "commun";
    draft.push(l); dirty = true; msg = null; budgetStale = true; render();
    const f = $("pvl-" + safe(l.id) + (type === "depense" ? "-cat" : "-lib")); if (f) f.focus();
  }

  function mount(r) {
    root = r;
    root.addEventListener("input", e => {
      const el = e.target;
      const ln = el.closest("[data-lid]"), k = el.dataset.k;
      if (ln && k) {
        const l = draft.find(x => x.id === ln.dataset.lid); if (!l) return;
        if (k === "montant") l.montant = el.value === "" ? null : +el.value;
        else if (k === "type") {
          if (l.type === el.value) return;
          if (!String(l.categorie || "").trim() || l.categorie === defCat(l.type)) l.categorie = defCat(el.value);
          l.type = el.value; dirty = true; msg = null; budgetStale = true; render(); return;
        } else l[k] = el.value;
        touch(); return;
      }
      if (el.dataset.o && objEdit) {
        const k2 = el.dataset.o; objEdit.data[k2] = el.value;
        if (k2 === "rendement") objEdit.rendTouched = true;
        if (k2 === "type" && !objEdit.rendTouched) { objEdit.data.rendement = REND_DEF[el.value]; const ri = $("pvf-rend"); if (ri) ri.value = objEdit.data.rendement; }
        return;
      }
      if (el.dataset.oList && objEdit) {
        const key = el.dataset.oList, cur = new Set(objEdit.data[key] || []);
        el.checked ? cur.add(el.value) : cur.delete(el.value);
        objEdit.data[key] = [...cur]; return;
      }
      if (el.id === "pvVers") { versOverride = el.value === "" ? 0 : Math.max(0, +el.value || 0); renderProjection(); }
    });
    /* Catégorie modifiée : regrouper les lignes une fois le champ quitté (léger délai pour ne pas avaler un clic). */
    root.addEventListener("change", e => {
      const el = e.target;
      if (el.dataset.k === "categorie") setTimeout(() => { budgetStale = true; render(); }, 180);
    });
    root.addEventListener("click", e => {
      const t = e.target;
      let b;
      if ((b = t.closest("[data-pv-addl]"))) return addLine(b.dataset.pvAddl);
      if ((b = t.closest("[data-pv-del]"))) { draft = draft.filter(l => l.id !== b.dataset.pvDel); dirty = true; msg = null; budgetStale = true; render(); return; }
      if ((b = t.closest("[data-pv-tpl]"))) { objEdit = { id: null, data: template(b.dataset.pvTpl), err: null, rendTouched: false }; objMsg = null; confirmDel = null; renderObjectifs(); const n = $("pvf-nom"); if (n) { n.focus(); n.scrollIntoView({ block: "nearest" }); } return; }
      if ((b = t.closest("[data-pv-edit]"))) {
        const o = sortedObjs().find(x => x.id === b.dataset.pvEdit); if (!o) return;
        objEdit = { id: o.id, data: Object.assign({ deja: 0, poches: [], enveloppes: [], source: "saisi" }, clone(o)), err: null, rendTouched: true };
        objMsg = null; confirmDel = null; renderObjectifs(); const n = $("pvf-nom"); if (n) n.focus(); return;
      }
      if (t.closest("[data-pv-ocancel]")) { const id = objEdit && objEdit.id; objEdit = null; renderObjectifs(); const f = id && $("pvo-" + safe(id) + "-edit"); if (f) f.focus(); return; }
      if (t.closest("[data-pv-osave]")) return saveObj();
      if ((b = t.closest("[data-o-src]")) && objEdit) { objEdit.data.source = b.dataset.oSrc; objEdit.err = null; renderObjectifs(); return; }
      if ((b = t.closest("[data-pv-move]"))) return moveObj(b.dataset.id, +b.dataset.pvMove);
      if ((b = t.closest("[data-pv-odel]"))) { confirmDel = b.dataset.pvOdel; renderObjectifs(); const y = $("pvo-" + safe(confirmDel) + "-yes"); if (y) y.focus(); return; }
      if (t.closest("[data-pv-del-no]")) { const id = confirmDel; confirmDel = null; renderObjectifs(); const d = id && $("pvo-" + safe(id) + "-del"); if (d) d.focus(); return; }
      if ((b = t.closest("[data-pv-del-yes]"))) return deleteObj(b.dataset.pvDelYes);
      if ((b = t.closest("#pvHorizon [data-h]"))) { horizon = +b.dataset.h; renderProjection(); return; }
      if (t.closest("[data-pv-vreset]")) { versOverride = null; renderProjection(true); $("pvVers").focus(); return; }
    });
    $("pvCancel").addEventListener("click", () => {
      draft = clone(remote); baseSig = sig(remote); dirty = false; remoteChanged = false; showErrs = false; msg = null; budgetStale = true; render();
    });
    $("pvSubmit").addEventListener("click", saveBudget);
    mountAssistant();
    let w = 0;
    window.addEventListener("resize", () => { const nw = root.clientWidth; if (S && !root.hidden && Math.abs(nw - w) > 24) { w = nw; renderProjection(); } });
  }

  function update(snap, visible) {
    S = snap;
    if (snap.ready || snap.dbOk === false) {
      const lignes = snap.budget && Array.isArray(snap.budget.lignes) ? snap.budget.lignes : [];
      remote = clone(lignes);
      const s = sig(lignes);
      if (s !== baseSig) {
        if (dirty && baseSig != null) remoteChanged = true;
        else { draft = clone(lignes); baseSig = s; budgetStale = true; }
      }
    }
    if (objEdit && objEdit.id != null && !(snap.objectifs || []).some(o => o.id === objEdit.id)) objEdit = null;
    const vs = JSON.stringify([snap.scope, people()]);
    if (vs !== viewSig) { viewSig = vs; budgetStale = true; }
    if (visible) render();
  }
  function show() { budgetStale = true; render(); }
  function headline() {
    if (!S || !(S.ready || S.dbOk === false)) return "–";
    const lignes = S.budget && Array.isArray(S.budget.lignes) ? S.budget.lignes : [];
    if (!lignes.length) return "Budget à remplir";
    const t = window.Plan.budgetTotaux(lignes, S.profil, S.scope).tauxEpargne;
    return t == null ? "Budget à remplir" : Math.round(t * 100) + " % épargnés";
  }

  const api = { mount, update, show, headline };
  const reg = () => App.register("plan", api); if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
