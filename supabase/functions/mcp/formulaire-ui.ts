// Page du formulaire interactif Boussole, ressource ui://boussole/formulaire (MCP Apps, text/html;profile=mcp-app) : un seul
// document HTML/CSS/JS, sans dépendance ni URL externe (CSP restrictive par défaut de l'hôte). Protocole MCP Apps écrit à la
// main (JSON-RPC 2.0 sur postMessage avec l'hôte) :
//   vue → hôte : ui/initialize (appInfo, appCapabilities, protocolVersion) puis ui/notifications/initialized ;
//   hôte → vue : ui/notifications/tool-input (ignoré : le formulaire complet arrive dans le résultat), ui/notifications/tool-result
//                (structuredContent de l'outil formulaire → rendu), ui/notifications/host-context-changed (thème, variables) ;
//   vue → hôte : tools/call soumettre_formulaire (réponses), ui/update-model-context (résumé pour le modèle),
//                ui/notifications/size-changed (hauteur du contenu).
// Thème : hostContext.theme (clair / sombre) et hostContext.styles.variables (variables CSS de l'hôte), avec valeurs de secours.
// La logique (navigation, validation, exclusivité, bornes, réponses) est formulaire-logique.js, injecté tel quel (chaîne générée
// dans formulaire-logique.gen.ts par npm run gen) ; ce fichier ne contient que l'habillage et le câblage du protocole.
import { LOGIQUE_FORMULAIRE } from "./formulaire-logique.gen.ts";

export const PROTOCOLE = "2026-01-26";
export const MENTION_UI = "Indicateur pédagogique, pas un conseil en investissement.";

export const CSS = String.raw`
:root {
  color-scheme: light;
  --fb-fond: var(--color-background-primary, #ffffff);
  --fb-fond2: var(--color-background-secondary, #f5f4f0);
  --fb-texte: var(--color-text-primary, #1d1c1a);
  --fb-texte2: var(--color-text-secondary, #5b5852);
  --fb-bord: var(--color-border-primary, #d9d6cf);
  --fb-accent: #2e6b5a;
  --fb-accent-fond: #e6f1ed;
  --fb-sur-accent: #ffffff;
  --fb-erreur: var(--color-text-danger, #b3261e);
  --fb-erreur-fond: var(--color-background-danger, #fbeceb);
  --fb-ok-fond: var(--color-background-success, #e8f3ec);
  --fb-rayon: var(--border-radius-md, 10px);
  --fb-police: var(--font-sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --fb-fond: var(--color-background-primary, #1c1b19);
  --fb-fond2: var(--color-background-secondary, #262522);
  --fb-texte: var(--color-text-primary, #f2f0eb);
  --fb-texte2: var(--color-text-secondary, #b4b0a8);
  --fb-bord: var(--color-border-primary, #3d3b37);
  --fb-accent: #7cc4ad;
  --fb-accent-fond: #213a33;
  --fb-sur-accent: #10241e;
  --fb-erreur: var(--color-text-danger, #f2a19b);
  --fb-erreur-fond: var(--color-background-danger, #3a2321);
  --fb-ok-fond: var(--color-background-success, #1f3328);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --fb-fond: var(--color-background-primary, #1c1b19);
    --fb-fond2: var(--color-background-secondary, #262522);
    --fb-texte: var(--color-text-primary, #f2f0eb);
    --fb-texte2: var(--color-text-secondary, #b4b0a8);
    --fb-bord: var(--color-border-primary, #3d3b37);
    --fb-accent: #7cc4ad;
    --fb-accent-fond: #213a33;
    --fb-sur-accent: #10241e;
    --fb-erreur: var(--color-text-danger, #f2a19b);
    --fb-erreur-fond: var(--color-background-danger, #3a2321);
    --fb-ok-fond: var(--color-background-success, #1f3328);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--fb-fond); color: var(--fb-texte); font-family: var(--fb-police); font-size: 15px; line-height: 1.45; }
.fb { max-width: 560px; margin: 0 auto; padding: 16px; }
.fb-etat { color: var(--fb-texte2); padding: 24px 0; text-align: center; }
.fb-titre { font-size: 1.15rem; font-weight: 650; margin: 0 0 4px; }
.fb-intro { margin: 0 0 12px; color: var(--fb-texte2); }
.fb-prog { display: flex; align-items: center; gap: 10px; margin: 8px 0 18px; font-size: 0.85rem; color: var(--fb-texte2); }
.fb-barre { flex: 1; height: 6px; border-radius: 3px; background: var(--fb-fond2); overflow: hidden; }
.fb-barre span { display: block; height: 100%; width: 0; background: var(--fb-accent); border-radius: 3px; transition: width .2s ease; }
.fb-theme { margin: 0 0 4px; font-size: 0.78rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--fb-accent); }
.fb-lib { font-size: 1.08rem; font-weight: 600; margin: 0 0 6px; }
.fb-aide { margin: 0 0 6px; color: var(--fb-texte2); font-size: 0.92rem; }
.fb-donnees { margin: 0 0 10px; padding: 8px 10px; border-radius: var(--fb-rayon); background: var(--fb-fond2); font-size: 0.9rem; }
.fb-actuelle { margin: 8px 0 0; font-size: 0.85rem; color: var(--fb-texte2); }
.fb-ctrl { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.fb-opt { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 10px 12px; text-align: left; font: inherit; color: var(--fb-texte);
  background: var(--fb-fond); border: 1px solid var(--fb-bord); border-radius: var(--fb-rayon); cursor: pointer; }
.fb-opt:hover { border-color: var(--fb-accent); }
.fb-opt:focus-visible, .fb-btn:focus-visible, .fb-champ:focus-visible, .fb-curseur:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
.fb-opt[aria-checked="true"] { border-color: var(--fb-accent); background: var(--fb-accent-fond); font-weight: 600; }
.fb-marque { flex: none; width: 18px; height: 18px; border: 2px solid var(--fb-bord); border-radius: 50%; }
.fb-opt[role="checkbox"] .fb-marque { border-radius: 4px; }
.fb-opt[aria-checked="true"] .fb-marque { border-color: var(--fb-accent); background: var(--fb-accent); box-shadow: inset 0 0 0 3px var(--fb-accent-fond); }
.fb-sep { font-size: 0.8rem; color: var(--fb-texte2); text-align: center; margin: 2px 0; }
.fb-oui-non { flex-direction: row; }
.fb-oui-non .fb-opt { justify-content: center; }
.fb-valeur { font-size: 2rem; font-weight: 700; text-align: center; margin: 4px 0 0; }
.fb-valeur.fb-vide { color: var(--fb-texte2); font-size: 1.1rem; font-weight: 500; }
.fb-repere { text-align: center; color: var(--fb-texte2); font-size: 0.9rem; margin: 0; min-height: 1.3em; }
.fb-curseur { width: 100%; accent-color: var(--fb-accent); min-height: 32px; }
.fb-bornes { display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--fb-texte2); }
.fb-montant { display: flex; align-items: center; gap: 8px; }
.fb-champ { flex: 1; width: 100%; min-height: 44px; padding: 10px 12px; font: inherit; font-size: 1.05rem; color: var(--fb-texte); background: var(--fb-fond);
  border: 1px solid var(--fb-bord); border-radius: var(--fb-rayon); }
.fb-unite { color: var(--fb-texte2); white-space: nowrap; }
.fb-erreur { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--fb-rayon); background: var(--fb-erreur-fond); color: var(--fb-erreur); font-size: 0.92rem; }
.fb-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; }
.fb-btn { min-height: 44px; padding: 10px 16px; font: inherit; font-weight: 600; border-radius: var(--fb-rayon); border: 1px solid var(--fb-bord);
  background: var(--fb-fond); color: var(--fb-texte); cursor: pointer; }
.fb-btn[disabled] { opacity: .45; cursor: default; }
.fb-prim { margin-left: auto; background: var(--fb-accent); border-color: var(--fb-accent); color: var(--fb-sur-accent); }
.fb-lien { border-color: transparent; background: transparent; color: var(--fb-texte2); font-weight: 500; text-decoration: underline; padding-inline: 6px; }
.fb-fin { padding: 12px; border-radius: var(--fb-rayon); background: var(--fb-ok-fond); }
.fb-fin h2 { font-size: 1.08rem; margin: 0 0 6px; }
.fb-fin p { margin: 0 0 8px; }
.fb-resume { margin: 8px 0; padding: 0; list-style: none; }
.fb-resume li { padding: 6px 0; border-top: 1px solid var(--fb-bord); font-size: 0.92rem; }
.fb-resume b { display: block; font-weight: 500; color: var(--fb-texte2); font-size: 0.85rem; }
.fb-profil { margin-top: 10px; padding: 10px; border-radius: var(--fb-rayon); background: var(--fb-fond); border: 1px solid var(--fb-bord); }
.fb-profil h3 { margin: 0 0 4px; font-size: 1rem; }
.fb-mention { margin: 18px 0 0; font-size: 0.78rem; color: var(--fb-texte2); text-align: center; }
@media (max-width: 420px) {
  .fb { padding: 12px; }
  .fb-nav .fb-prim { flex: 1 1 100%; order: -1; margin-left: 0; }
}
`;

export const CORPS = String.raw`
<main class="fb" id="app">
  <p id="fbChargement" class="fb-etat" role="status">Chargement du formulaire…</p>
  <section id="fbForm" hidden aria-labelledby="fbTitre">
    <header>
      <p id="fbTitre" class="fb-titre"></p>
      <p id="fbIntro" class="fb-intro" hidden></p>
      <div class="fb-prog"><div class="fb-barre" role="progressbar" id="fbProg" aria-valuemin="0" aria-valuemax="100"><span id="fbBarre"></span></div><span id="fbCompteur"></span></div>
    </header>
    <div id="fbQuestion"></div>
    <p id="fbErreur" class="fb-erreur" role="alert" hidden></p>
    <div class="fb-nav">
      <button type="button" class="fb-btn" id="fbPrec">Précédente</button>
      <button type="button" class="fb-btn fb-lien" id="fbPasser">Passer</button>
      <button type="button" class="fb-btn fb-prim" id="fbSuiv">Suivante</button>
    </div>
  </section>
  <section id="fbFin" class="fb-fin" hidden aria-live="polite"></section>
  <p class="fb-mention" id="fbMention">Indicateur pédagogique, pas un conseil en investissement.</p>
</main>
`;

/* Câblage du protocole et rendu (aucune donnée insérée en HTML : tout texte passe par textContent). */
export const SCRIPT_VUE = String.raw`
(function () {
  "use strict";
  var L = window.FormulaireLogique;
  var hote = window.parent;
  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };
  var suivant = 0, attente = {};
  var etat = null, formulaire = null, envoiEnCours = false, taille = { w: 0, h: 0 };

  function poster(m) { hote.postMessage(m, "*"); }
  function requete(method, params) {
    suivant += 1;
    var id = suivant;
    poster({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (ok, ko) { attente[id] = { ok: ok, ko: ko }; });
  }
  function notifier(method, params) { poster({ jsonrpc: "2.0", method: method, params: params || {} }); }

  function el(tag, classe, texte) {
    var e = doc.createElement(tag);
    if (classe) e.className = classe;
    if (texte != null) e.textContent = texte;
    return e;
  }
  function vider(e) { e.textContent = ""; }

  function appliquerContexte(ctx) {
    if (!ctx) return;
    var racine = doc.documentElement;
    if (ctx.theme === "dark" || ctx.theme === "light") racine.setAttribute("data-theme", ctx.theme);
    var vars = ctx.styles && ctx.styles.variables;
    if (vars && racine.style && racine.style.setProperty) {
      Object.keys(vars).forEach(function (k) { if (k.indexOf("--") === 0 && typeof vars[k] === "string" && vars[k]) racine.style.setProperty(k, vars[k]); });
    }
  }

  /* Hauteur du contenu (pas celle de la fenêtre : elle ne pourrait jamais diminuer), largeur de la vue. */
  function signalerTaille() {
    var r = doc.documentElement, b = doc.body, app = $("app");
    var h = Math.ceil(app && app.getBoundingClientRect ? app.getBoundingClientRect().height : (b && b.scrollHeight) || 0);
    var w = Math.ceil(r.clientWidth || r.scrollWidth || 0);
    if (h === taille.h && w === taille.w) return;
    taille = { w: w, h: h };
    notifier("ui/notifications/size-changed", { width: w, height: h });
  }

  function montrer(id) {
    ["fbChargement", "fbForm", "fbFin"].forEach(function (x) { $(x).hidden = x !== id; });
  }
  function message(texte) { $("fbChargement").textContent = texte; montrer("fbChargement"); signalerTaille(); }

  /* ---------- contrôles ---------- */
  function option(role, coche, label, surClic) {
    var b = el("button", "fb-opt");
    b.setAttribute("type", "button");
    b.setAttribute("role", role);
    b.setAttribute("aria-checked", coche ? "true" : "false");
    b.appendChild(el("span", "fb-marque"));
    b.appendChild(el("span", null, label));
    b.addEventListener("click", surClic);
    return b;
  }
  function choisir(v) { L.repondre(etat, v); rendre(); }

  function controle(q, zone) {
    var v = etat.reponses[q.champ];
    if (q.type === "choix") {
      zone.setAttribute("role", "radiogroup");
      zone.setAttribute("aria-labelledby", "fbLib");
      q.valeurs.forEach(function (o) {
        zone.appendChild(option("radio", v !== undefined && String(v) === String(o.v), o.label, function () { choisir(o.v); }));
      });
    } else if (q.type === "multi") {
      zone.setAttribute("role", "group");
      zone.setAttribute("aria-labelledby", "fbLib");
      var cur = Array.isArray(v) ? v : [];
      var ordinaires = q.valeurs.filter(function (o) { return !o.exclusif; }), exclusives = q.valeurs.filter(function (o) { return o.exclusif; });
      ordinaires.concat(exclusives).forEach(function (o, i) {
        if (o.exclusif && i === ordinaires.length && ordinaires.length) zone.appendChild(el("p", "fb-sep", "ou"));
        var coche = cur.some(function (x) { return String(x) === String(o.v); });
        zone.appendChild(option("checkbox", coche, o.label, function () { choisir(L.basculerMulti(q, etat.reponses[q.champ], o.v)); }));
      });
    } else if (q.type === "booleen") {
      zone.className = "fb-ctrl fb-oui-non";
      zone.setAttribute("role", "radiogroup");
      zone.setAttribute("aria-labelledby", "fbLib");
      [[true, "Oui"], [false, "Non"]].forEach(function (p) {
        zone.appendChild(option("radio", v === p[0], p[1], function () { choisir(p[0]); }));
      });
    } else if (q.type === "curseur") {
      var vide = v === undefined;
      var valeur = el("p", "fb-valeur" + (vide ? " fb-vide" : ""), vide ? "Déplace le curseur" : L.formaterCurseur(q, v));
      valeur.id = "fbValeur";
      var repere = el("p", "fb-repere", vide ? "" : (L.repereCurseur(q, v) || ""));
      var r = el("input", "fb-curseur");
      r.setAttribute("type", "range");
      r.setAttribute("min", String(q.min != null ? q.min : 0));
      r.setAttribute("max", String(q.max != null ? q.max : 100));
      r.setAttribute("step", String(q.pas || 1));
      r.setAttribute("aria-labelledby", "fbLib");
      r.value = String(vide ? (q.min != null ? q.min : 0) : v);
      r.addEventListener("input", function () {
        var x = L.borner(q, r.value);
        L.repondre(etat, x);
        valeur.textContent = L.formaterCurseur(q, x);
        valeur.className = "fb-valeur";
        repere.textContent = L.repereCurseur(q, x) || "";
        r.setAttribute("aria-valuetext", L.formaterCurseur(q, x));
        cacherErreur();
      });
      var bornes = el("div", "fb-bornes");
      bornes.appendChild(el("span", null, L.formaterCurseur(q, q.min != null ? q.min : 0)));
      bornes.appendChild(el("span", null, L.formaterCurseur(q, q.max != null ? q.max : 100)));
      zone.appendChild(valeur); zone.appendChild(repere); zone.appendChild(r); zone.appendChild(bornes);
    } else {
      var ligne = el("div", "fb-montant");
      var i = el("input", "fb-champ");
      i.id = "fbChamp";
      i.setAttribute("aria-labelledby", "fbLib");
      if (q.type === "montant") { i.setAttribute("type", "text"); i.setAttribute("inputmode", "decimal"); i.setAttribute("autocomplete", "off"); i.setAttribute("placeholder", "0"); }
      else if (q.type === "date") { i.setAttribute("type", "date"); if (q.min) i.setAttribute("min", q.min); if (q.max) i.setAttribute("max", q.max); }
      else { i.setAttribute("type", "text"); i.setAttribute("maxlength", String(q.max || L.TEXTE_MAX)); i.setAttribute("autocomplete", "off"); }
      i.value = v === undefined ? "" : String(v);
      var maj = function () { L.repondre(etat, i.value); cacherErreur(); };
      i.addEventListener("input", maj);
      i.addEventListener("change", maj);
      i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); avancer(); } });
      ligne.appendChild(i);
      if (q.unite && q.type === "montant") ligne.appendChild(el("span", "fb-unite", q.unite));
      zone.appendChild(ligne);
    }
  }

  function cacherErreur() { var e = $("fbErreur"); e.hidden = true; e.textContent = ""; }

  /* ---------- rendu ---------- */
  function rendre() {
    if (!etat) return;
    var q = L.question(etat), p = L.progression(etat);
    $("fbTitre").textContent = formulaire.titre || "Formulaire";
    $("fbIntro").textContent = formulaire.intro || "";
    $("fbIntro").hidden = !formulaire.intro;
    $("fbBarre").style.width = p.pct + "%";
    $("fbProg").setAttribute("aria-valuenow", String(p.pct));
    $("fbCompteur").textContent = p.texte;
    var zoneQ = $("fbQuestion");
    vider(zoneQ);
    zoneQ.setAttribute("data-champ", q.champ);
    if (q.theme) zoneQ.appendChild(el("p", "fb-theme", q.theme));
    var lib = el("h2", "fb-lib", q.libelle);
    lib.id = "fbLib";
    zoneQ.appendChild(lib);
    if (q.aide) zoneQ.appendChild(el("p", "fb-aide", q.aide));
    if (q.aide_donnees) zoneQ.appendChild(el("p", "fb-donnees", q.aide_donnees));
    var zone = el("div", "fb-ctrl");
    zone.id = "fbCtrl";
    controle(q, zone);
    zoneQ.appendChild(zone);
    if (q.valeur_actuelle !== undefined) zoneQ.appendChild(el("p", "fb-actuelle", "Déjà renseigné dans Boussole : " + L.libelleValeur(q, q.valeur_actuelle)));
    var err = $("fbErreur");
    err.hidden = !etat.erreur;
    err.textContent = etat.erreur || "";
    $("fbPrec").disabled = etat.index === 0;
    $("fbSuiv").textContent = envoiEnCours ? "Envoi en cours…" : L.dernier(etat) ? "Envoyer mes réponses" : "Suivante";
    $("fbSuiv").setAttribute("aria-busy", envoiEnCours ? "true" : "false");
    montrer("fbForm");
    signalerTaille();
  }

  function avancer() {
    if (!etat || envoiEnCours) return;
    if (L.dernier(etat)) return envoyer();
    var avant = etat.index;
    L.suivante(etat);
    rendre();
    if (etat.index !== avant) focusQuestion();
  }
  function focusQuestion() {
    var ctrl = $("fbCtrl"), c = $("fbChamp") || (ctrl && (ctrl.querySelector(".fb-opt") || ctrl.querySelector(".fb-curseur")));
    if (c && c.focus) c.focus();
  }

  function envoyer() {
    var r = L.envoyable(etat);
    if (!r.ok) { rendre(); return; }
    envoiEnCours = true;
    rendre();
    requete("tools/call", { name: "soumettre_formulaire", arguments: { formulaire_id: formulaire.formulaire_id, reponses: r.reponses } }).then(function (res) {
      envoiEnCours = false;
      if (!res || res.isError) {
        etat.erreur = texteDe(res) || "L'envoi a été refusé.";
        rendre();
        return;
      }
      afficherFin(res.structuredContent || {}, texteDe(res));
      var pour = (res.structuredContent && res.structuredContent.pour_le_modele) || texteDe(res);
      requete("ui/update-model-context", { content: [{ type: "text", text: pour }] }).catch(function () {});
    }, function (e) {
      envoiEnCours = false;
      etat.erreur = "L'envoi a échoué (" + ((e && e.message) || "erreur inconnue") + "). Tes réponses sont conservées : réessaie.";
      rendre();
    });
  }
  function texteDe(res) {
    var c = res && Array.isArray(res.content) ? res.content.filter(function (x) { return x && x.type === "text"; }) : [];
    return c.length ? c.map(function (x) { return x.text; }).join("\n") : "";
  }

  function afficherFin(sc, texte) {
    var fin = $("fbFin");
    vider(fin);
    fin.appendChild(el("h2", null, "Réponses envoyées"));
    fin.appendChild(el("p", null, sc.message || texte || "Réponses envoyées."));
    if (Array.isArray(sc.resume) && sc.resume.length) {
      var ul = el("ul", "fb-resume");
      sc.resume.forEach(function (x) { var li = el("li"); li.appendChild(el("b", null, x.libelle)); li.appendChild(el("span", null, x.valeur)); ul.appendChild(li); });
      fin.appendChild(ul);
    }
    var pe = sc.profil_estime;
    if (pe && pe.profil) {
      var bloc = el("div", "fb-profil");
      bloc.appendChild(el("h3", null, "Profil estimé : " + pe.profil.libelle + (pe.score != null ? " (" + pe.score + "/100)" : "")));
      (pe.garde_fous || []).forEach(function (g) { bloc.appendChild(el("p", null, g.texte)); });
      if (pe.comparaison) bloc.appendChild(el("p", null, pe.comparaison));
      if (pe.base) bloc.appendChild(el("p", "fb-aide", pe.base));
      fin.appendChild(bloc);
    }
    fin.appendChild(el("p", null, sc.rappel || "À valider dans Boussole › Agent › Propositions."));
    montrer("fbFin");
    signalerTaille();
  }

  function surResultat(params) {
    if (params && params.isError) return message(texteDe(params) || "Le formulaire n'a pas pu être préparé.");
    var sc = params && params.structuredContent;
    if (!sc || !Array.isArray(sc.questions) || !sc.questions.length) return message("Le formulaire n'a pas pu être affiché : réponds directement dans la conversation.");
    formulaire = sc;
    etat = L.creer(sc);
    rendre();
  }

  $("fbSuiv").addEventListener("click", avancer);
  $("fbPrec").addEventListener("click", function () { if (!etat || envoiEnCours) return; L.precedente(etat); rendre(); focusQuestion(); });
  $("fbPasser").addEventListener("click", function () {
    if (!etat || envoiEnCours) return;
    var avant = etat.index;
    L.passer(etat);
    rendre();
    if (etat.index !== avant) focusQuestion();
  });

  window.addEventListener("message", function (ev) {
    if (ev.source && ev.source !== hote) return;
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && !m.method) {
      var p = attente[m.id];
      if (!p) return;
      delete attente[m.id];
      if (m.error) p.ko(new Error(m.error.message || "erreur de l'hôte")); else p.ok(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") return surResultat(m.params || {});
    if (m.method === "ui/notifications/host-context-changed") { appliquerContexte(m.params || {}); return signalerTaille(); }
    if (m.method === "ui/notifications/tool-cancelled") return message("Le formulaire a été annulé.");
    if ((m.method === "ui/resource-teardown" || m.method === "ping") && m.id != null) return poster({ jsonrpc: "2.0", id: m.id, result: {} });
  });

  if (typeof ResizeObserver === "function") { try { new ResizeObserver(signalerTaille).observe($("app")); } catch (e) { /* hôte sans ResizeObserver */ } }

  requete("ui/initialize", { appInfo: { name: "Boussole — formulaire", version: "1.0.0" }, appCapabilities: { availableDisplayModes: ["inline"] }, protocolVersion: "PROTOCOLE" })
    .then(function (res) { appliquerContexte((res && res.hostContext) || {}); }, function () {})
    .then(function () { notifier("ui/notifications/initialized", {}); signalerTaille(); });
})();
`.replace('"PROTOCOLE"', JSON.stringify(PROTOCOLE));

const sansFinScript = (js: string) => js.replace(/<\/script/gi, "<\\/script");

/** Page complète : CSS, corps, logique injectée telle quelle, câblage. */
export function pageFormulaire(logique: string = LOGIQUE_FORMULAIRE): string {
  return "<!doctype html>\n<html lang=\"fr\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n" +
    "<title>Boussole — formulaire</title>\n<style>" + CSS + "</style>\n</head>\n<body>" + CORPS +
    "<script>\n" + sansFinScript(logique) + "\n</script>\n<script>" + sansFinScript(SCRIPT_VUE) + "</script>\n</body>\n</html>\n";
}

export const HTML_FORMULAIRE = pageFormulaire();
