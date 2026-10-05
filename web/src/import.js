/* Import CSV de placements : lecture tolérante d'un fichier exporté d'un tableur ou d'une banque, aperçu ligne par
   ligne, puis remise des lignes normalisées à l'appelant. Aucune écriture en base ici : `open({ onApply })` appelle
   onApply(rows) et c'est l'appelant qui écrit (positions + request_instrument).

   window.Import = { parseCSV(text, { people }) → { rows, erreurs, avertissements, lignes }, open(opts), template(),
                     splitCSV(text) }
   - Séparateur détecté sur la ligne d'en-tête : « ; », « , » ou tabulation (les virgules entre guillemets ne
     comptent pas). Décimales françaises acceptées (« 1 234,56 »).
   - En-têtes insensibles à la casse et aux accents, synonymes acceptés (voir COLS).
   - Chaque ligne passe par la même normalisation que la réponse d'un assistant (Assistant.parse(…, "positions")),
     donc une ligne importée a exactement la forme d'une ligne collée depuis Claude ou ChatGPT.
   - `lignes` décrit chaque ligne du fichier pour l'aperçu : { ligne, ok, row, brut, erreur }.
   - opts.people = [{ id: "p1", nom: "Camille" }, { id: "p2", nom: "Sam" }] : un titulaire écrit avec le prénom
     est rattaché à la bonne personne. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Import = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  // Assistant est résolu à l'appel : dans le navigateur, assistant.js peut être chargé après ce fichier.
  function assistant() {
    if (root && root.Assistant) return root.Assistant;
    if (typeof require === "function") { try { return require("./assistant.js"); } catch (e) { /* navigateur */ } }
    throw new Error("assistant.js doit être chargé avant d'importer un fichier.");
  }

  const MAX_LINES = 1000;
  const low = v => String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const key = v => low(v).replace(/[^a-z0-9]/g, "");

  /* ---------- en-têtes reconnus ---------- */
  const COLS = {
    nom: ["nom", "name", "libelle", "intitule", "produit", "placement", "designation", "valeurmobiliere", "fonds", "titre"],
    isin: ["isin", "codeisin", "isincode"],
    enveloppe: ["enveloppe", "envelope", "compte", "contrat", "typedecompte", "typecompte", "support", "wrapper"],
    titulaire: ["titulaire", "owner", "proprietaire", "personne", "detenteur", "qui"],
    poche: ["poche", "bloc", "classe", "classedactif", "classedactifs", "categorie", "allocation", "strategie"],
    quantite: ["quantite", "qty", "quantity", "qte", "parts", "nbparts", "nombredeparts", "nombre", "nbtitres", "titres", "unites"],
    pru: ["pru", "prixderevient", "prixderevientunitaire", "prixrevient", "prixmoyen", "prixmoyendachat", "pam", "coutmoyen"],
    valeur: ["valeur", "value", "montant", "solde", "encours", "valorisation", "valeuractuelle", "montanteur", "montanteuros"],
    statut: ["statut", "status", "etat"],
  };
  const HEAD = {};
  Object.keys(COLS).forEach(c => COLS[c].forEach(s => { HEAD[s] = c; }));

  /* ---------- découpage CSV (RFC 4180 : guillemets, "" échappé, retours à la ligne entre guillemets) ---------- */
  function detectSep(text) {
    const counts = { ";": 0, ",": 0, "\t": 0 };
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (inQ && text[i + 1] === '"') { i++; continue; } inQ = !inQ; continue; }
      if (inQ) continue;
      if (c === "\n" || c === "\r") { if (counts[";"] + counts[","] + counts["\t"] > 0) break; continue; }
      if (c in counts) counts[c]++;
    }
    if (counts["\t"] > counts[";"] && counts["\t"] > counts[","]) return "\t";
    return counts[","] > counts[";"] ? "," : ";";
  }

  function splitCSV(text, sep) {
    const t = String(text || "").replace(/^﻿/, "");
    const s = sep || detectSep(t);
    const out = [];
    let row = [], cell = "", inQ = false, line = 1, rowLine = 1;
    const endCell = () => { row.push(cell); cell = ""; };
    const endRow = () => { endCell(); out.push({ line: rowLine, cells: row }); row = []; };
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inQ) {
        if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else { if (c === "\n") line++; cell += c; }
        continue;
      }
      if (c === '"' && cell.trim() === "") { cell = ""; inQ = true; }
      else if (c === s) endCell();
      else if (c === "\r") { if (t[i + 1] === "\n") i++; endRow(); line++; rowLine = line; }
      else if (c === "\n") { endRow(); line++; rowLine = line; }
      else cell += c;
    }
    if (cell !== "" || row.length) endRow();
    return { sep: s, rows: out };
  }

  /* ---------- lecture ---------- */
  function ownerFrom(v, people) {
    const s = low(v);
    if (!s) return "";
    for (const p of people || []) if (p && p.nom && low(p.nom) === s) return p.id;
    return String(v).trim(); // Assistant reconnaît p1 / p2 / conjoint / compagne…
  }

  function parseCSV(text, opts) {
    const o = opts || {};
    const A = assistant();
    const res = { rows: [], erreurs: [], avertissements: [], lignes: [] };
    const t = String(text || "").replace(/^﻿/, "");
    if (!t.trim()) { res.erreurs.push("Le fichier est vide."); return res; }

    const { rows: all } = splitCSV(t);
    const nonEmpty = all.filter(r => r.cells.some(c => c.trim() !== ""));
    if (!nonEmpty.length) { res.erreurs.push("Le fichier est vide."); return res; }

    const [head, ...data] = nonEmpty;
    const map = head.cells.map(h => HEAD[key(h)] || null);
    const seen = {};
    map.forEach((c, i) => { if (!c) return; if (seen[c] != null) map[i] = null; else seen[c] = i; });
    const ignored = head.cells.filter((h, i) => !map[i] && h.trim()).map(h => h.trim());

    if (seen.nom == null) {
      res.erreurs.push("Ligne " + head.line + " : colonne « nom » introuvable. La première ligne doit contenir les noms de colonnes : " + Object.keys(COLS).join(", ") + ".");
      return res;
    }
    if (seen.quantite == null && seen.valeur == null) {
      res.erreurs.push("Ligne " + head.line + " : il faut au moins une colonne « quantite » ou « valeur ».");
      return res;
    }
    if (ignored.length) res.avertissements.push("Colonnes ignorées : " + ignored.join(", ") + ".");
    if (!data.length) { res.erreurs.push("Aucune ligne de placement sous l'en-tête."); return res; }
    if (data.length > MAX_LINES) { res.erreurs.push("Fichier trop long : " + data.length + " lignes (maximum " + MAX_LINES + ")."); return res; }

    data.forEach(r => {
      const brut = {};
      map.forEach((c, i) => { if (c) brut[c] = (r.cells[i] ?? "").trim(); });
      const obj = {};
      Object.keys(brut).forEach(k => { if (brut[k] !== "") obj[k] = k === "titulaire" ? ownerFrom(brut[k], o.people) : brut[k]; });
      const p = A.parse(JSON.stringify({ positions: [obj] }), "positions");
      const fix = m => m.replace(/^Ligne \d+ : /, "Ligne " + r.line + " : ");
      if (p.erreurs.length) {
        const msg = fix(p.erreurs[0]);
        res.erreurs.push(msg);
        res.lignes.push({ ligne: r.line, ok: false, row: null, brut, erreur: msg.replace(/^Ligne \d+ : /, "") });
        return;
      }
      p.avertissements.forEach(w => res.avertissements.push(fix(w)));
      const row = p.data[0];
      res.rows.push(row);
      res.lignes.push({ ligne: r.line, ok: true, row, brut, erreur: null });
    });
    return res;
  }

  /* ---------- modèle ---------- */
  const TEMPLATE = [
    "nom;isin;enveloppe;titulaire;poche;quantite;pru;valeur;statut",
    "Amundi MSCI World;FR0011869353;PEA;p1;Monde;12;4,80;;actif",
    "Livret A;;Livrets;p1;Épargne de précaution;;;12000;actif",
    "Fonds euros;;Assurance-vie;p2;Fonds euros;;;8500,50;actif",
  ].join("\r\n") + "\r\n";
  const template = () => "﻿" + TEMPLATE;

  /* ---------- fenêtre d'import ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
  const fmt = v => (v == null ? "" : nf.format(v));
  const plural = (n, one, many) => n + " " + (n > 1 ? many : one);

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(buf);
    // Les CSV d'Excel en français sont souvent en Windows-1252 : caractères illisibles → second décodage.
    return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
  }

  let seq = 0;
  function open(opts) {
    const o = opts || {};
    const id = "im" + (++seq);
    const people = o.people || [];
    const who = v => { const p = people.find(x => x.id === v); return p ? p.nom : v === "p2" ? "Personne 2" : "Personne 1"; };
    const dlg = document.createElement("dialog");
    dlg.className = "im-dialog";
    dlg.setAttribute("aria-labelledby", id + "-t");
    dlg.innerHTML =
      '<form method="dialog" class="im-box">' +
      '<header class="im-head"><h2 id="' + id + '-t">Importer des placements</h2>' +
      '<button type="button" class="im-x" data-im="close" aria-label="Fermer">×</button></header>' +
      '<div class="im-body">' +
      '<p class="im-intro">Un fichier CSV avec une ligne d\'en-tête : <code>nom, isin, enveloppe, titulaire, poche, quantite, pru, valeur, statut</code>. ' +
      'Pour un titre coté, indiquez l\'ISIN et la quantité ; pour un livret ou un fonds euros, la valeur. Séparateur « ; » ou « , ». ' +
      '<a href="#" data-im="template">Télécharger un modèle</a></p>' +
      (typeof Assistant !== "undefined" ? '<p class="im-intro">Ou faites-les lister par votre assistant (Claude, ChatGPT…) à partir de vos relevés : <a href="#" data-im="prompt">copier le message à lui envoyer</a>, puis collez sa réponse ci-dessous.</p>' : "") +
      '<div class="im-src">' +
      '<label class="im-file"><span>Choisir un fichier .csv</span><input type="file" accept=".csv,text/csv,text/plain" id="' + id + '-f"></label>' +
      '<label class="im-lbl" for="' + id + '-p">ou collez le contenu</label>' +
      '<textarea id="' + id + '-p" class="im-paste" rows="5" spellcheck="false" placeholder="nom;isin;enveloppe;titulaire;poche;quantite;pru;valeur;statut"></textarea>' +
      "</div>" +
      '<div class="im-res" aria-live="polite"></div>' +
      "</div>" +
      '<footer class="im-foot"><span class="im-msg" role="status"></span>' +
      '<button type="button" class="im-btn ghost" data-im="close">Annuler</button>' +
      '<button type="button" class="im-btn" data-im="apply" disabled>Importer</button></footer>' +
      "</form>";
    document.body.appendChild(dlg);

    const $ = s => dlg.querySelector(s);
    const paste = $("#" + id + "-p"), file = $("#" + id + "-f"), out = $(".im-res"), apply = $('[data-im="apply"]'), msg = $(".im-msg");
    let last = null, busy = false, tmr = null;

    function render(r) {
      last = r;
      const ok = r.rows.length, ko = r.lignes.filter(l => !l.ok).length;
      const blocking = r.erreurs.length > 0;
      apply.disabled = busy || blocking || !ok;
      apply.textContent = ok ? "Importer " + plural(ok, "ligne", "lignes") : "Importer";
      if (!r.lignes.length) {
        out.innerHTML = r.erreurs.length ? '<ul class="im-errs">' + r.erreurs.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul>" : "";
        return;
      }
      const rows = r.lignes.map(l => {
        const x = l.row, b = l.brut;
        const qv = x ? (x.mode === "market" ? fmt(x.qty) + " parts" : fmt(x.value) + " €") : esc(b.quantite || b.valeur || "");
        return '<tr class="' + (l.ok ? "ok" : "ko") + '"><td class="num">' + l.ligne + "</td>" +
          "<td>" + esc(x ? x.name : b.nom) + (x && x.isin ? '<span class="im-isin">' + esc(x.isin) + "</span>" : "") + "</td>" +
          "<td>" + esc(x ? x.envelope : b.enveloppe) + "</td>" +
          "<td>" + esc(x ? who(x.owner) : b.titulaire) + "</td>" +
          "<td>" + esc(x ? x.bloc : b.poche) + "</td>" +
          '<td class="num">' + qv + "</td>" +
          "<td>" + esc(x ? x.status : b.statut) + "</td>" +
          "<td>" + (l.ok ? '<span class="im-ok">✓</span>' : '<span class="im-ko">' + esc(l.erreur) + "</span>") + "</td></tr>";
      }).join("");
      out.innerHTML =
        '<p class="im-count"><b>' + plural(ok, "ligne prête", "lignes prêtes") + "</b>" + (ko ? ' · <b class="im-ko">' + plural(ko, "erreur", "erreurs") + "</b> : corrigez le fichier puis rechargez-le" : "") + "</p>" +
        (r.avertissements.length ? '<ul class="im-warns">' + r.avertissements.map(e => "<li>" + esc(e) + "</li>").join("") + "</ul>" : "") +
        '<div class="im-table-wrap"><table class="im-table"><caption class="im-sr">Aperçu de l\'import</caption><thead><tr>' +
        '<th scope="col">Ligne</th><th scope="col">Nom</th><th scope="col">Enveloppe</th><th scope="col">Titulaire</th><th scope="col">Poche</th><th scope="col">Quantité / valeur</th><th scope="col">Statut</th><th scope="col">État</th>' +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>";
    }
    /* Une réponse d'assistant (bloc JSON) passe par Assistant.parse ; tout le reste est lu comme du CSV. */
    const looksJson = t => /```/.test(t) || /^\s*[[{]/.test(t);
    function fromAssistant(text) {
      const r = Assistant.parse(text, "positions");
      const rows = r.data || [];
      const lignes = rows.map((row, i) => ({ ligne: i + 1, ok: true, row, brut: {} }))
        .concat(r.erreurs.map(e => ({ ligne: "—", ok: false, row: null, brut: {}, erreur: e })));
      return { rows, erreurs: r.erreurs, avertissements: r.avertissements, lignes };
    }
    const analyse = text => { msg.textContent = ""; if (!String(text || "").trim()) { last = null; out.innerHTML = ""; apply.disabled = true; apply.textContent = "Importer"; return; } render(typeof Assistant !== "undefined" && looksJson(text) ? fromAssistant(text) : parseCSV(text, { people })); };

    file.addEventListener("change", async () => {
      const f = file.files && file.files[0]; if (!f) return;
      try { const text = await readFile(f); paste.value = text; analyse(text); }
      catch (e) { msg.textContent = "Lecture du fichier impossible : " + (e.message || e); }
    });
    paste.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(() => analyse(paste.value), 250); });

    function close() { if (busy) return; dlg.close(); }
    dlg.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
    dlg.addEventListener("close", () => { dlg.remove(); if (typeof o.onClose === "function") o.onClose(); });
    dlg.addEventListener("click", async e => {
      const b = e.target.closest("[data-im]");
      if (!b) { if (e.target === dlg) close(); return; }
      e.preventDefault();
      const act = b.dataset.im;
      if (act === "close") close();
      else if (act === "template") download("boussole-modele-placements.csv", template());
      else if (act === "prompt") {
        const text = Assistant.prompt("positions");
        try { await navigator.clipboard.writeText(text); msg.textContent = "Message copié : collez-le dans votre assistant, puis sa réponse ici."; }
        catch (err) { paste.value = text; paste.select(); msg.textContent = "Message placé dans la zone : copiez-le (Ctrl+C / ⌘C), puis remplacez-le par la réponse."; }
      }
      else if (act === "apply") {
        if (!last || last.erreurs.length || !last.rows.length) return;
        busy = true; apply.disabled = true; msg.textContent = "Import en cours…";
        try {
          if (typeof o.onApply === "function") await o.onApply(last.rows.slice());
          busy = false; dlg.close();
        } catch (err) {
          busy = false; apply.disabled = false;
          msg.textContent = "L'import a échoué : " + ((err && err.message) || err) + ". Vérifiez la liste de vos placements avant de réessayer.";
        }
      }
    });

    dlg.showModal();
    file.focus();
    return { close, dialog: dlg };
  }

  return { parseCSV, splitCSV, detectSep, template, open, COLS };
});
