(function(){
"use strict";
/* Pilotage › Santé — « Ma situation est-elle saine ? » : bonnes pratiques notées (Pratiques.evaluer, pratiques.js).
   En haut : note sur 100 (ou « — »), badge (Solide · Correct · À consolider · Provisoire), verdict en une phrase,
   « Demander à Claude ». Puis les 4 familles (Sécurité, Effort, Allocation, Efficacité) en accordéons fermés, note de la famille
   dans le titre ; chaque critère noté ou informatif est une carte (UI.carte) qui ouvre un panneau (UI.panneau) : situation,
   repère, piste, règle et source (accordéon), lien vers la vue où agir, « Demander à Claude ». Les critères « à compléter »
   sont regroupés en fin de page, par section : « Compléter avec Claude » ciblé (ClaudePrompts.phrase : budget, revenus,
   protection, risque, objectifs, placements) et lien vers la vue. Méthode en accordéon fermé. Respecte le périmètre.
   Lecture seule : aucune écriture au store ; la saisie se fait dans Claude (spec 2026-10-11-saisie-par-agent). Au tutoiement.
   Aucun calcul ici : les chiffres viennent de Pratiques.evaluer.
   Fonctions pures exportées pour les tests (module.exports) : verdict, niveau, resumeFamille, groupesACompleter, sectionDe,
   lienLabel, lienPanneau, phraseCompleter, questionCritere, questionPage, piedCritere, valeurCarte, detailCritereHtml,
   famillesHtml, aCompleterHtml. */

/* ---------- logique pure ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NOMBRES=["aucun","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix"];
const nombre=n=>NOMBRES[n]||String(n);
const s_=n=>n>1?"s":"";
/* Libellé du lien vers la vue concernée (le lien vient du critère, pratiques.js) ; destination lisible pour « Où agir ».
   L'app est en lecture seule : on y va pour voir, la saisie se fait avec Claude. */
const LIEN_LABEL={"patrimoine/budget":"Voir le budget","patrimoine/objectifs":"Voir les objectifs","compte/donnees":"Voir tes données",
  "patrimoine/placements":"Voir les placements","pilotage/risque":"Voir le profil de risque","aujourdhui/vue":"Voir Aujourd'hui","agent/connexion":"Connecter Claude"};
const DESTINATION={"patrimoine/budget":"Patrimoine › Budget","patrimoine/objectifs":"Patrimoine › Objectifs","compte/donnees":"Compte › Données",
  "patrimoine/placements":"Patrimoine › Placements","pilotage/risque":"Pilotage › Risque","aujourdhui/vue":"Aujourd'hui","agent/connexion":"Agent › Connexion"};
const lienLabel=r=>LIEN_LABEL[r]||"Voir le détail";
/* Section de « Compléter avec Claude » (ClaudePrompts.phrase) : d'après le critère, sinon d'après la vue où il se complète. */
const SECTION_CRITERE={protection:"protection",endettement:"revenus",frais:"placements"};
const SECTION_ROUTE={"patrimoine/budget":"budget","patrimoine/objectifs":"objectifs","compte/donnees":"revenus","pilotage/risque":"risque","patrimoine/placements":"placements"};
function sectionDe(c){ return (c&&(SECTION_CRITERE[c.cle]||SECTION_ROUTE[c.lien]))||"bilan"; }
/* Titre d'un groupe « À compléter » : ce qui manque, en mots (pas de compteur, règle 9). */
const TITRE_SECTION={budget:"Ton budget",objectifs:"Tes objectifs",revenus:"Tes revenus",protection:"Ta protection",risque:"Ton profil de risque",placements:"Tes placements",bilan:"Ton bilan"};
function niveau(c){ return c.informatif?"info":c.aCompleter?"na":c.points>=16?"good":c.points>=10?"warn":"crit"; }
const classeTotal=t=>t>=80?"good":t>=60?"warn":"crit";
const notes=r=>r.criteres.filter(c=>!c.aCompleter&&!c.informatif);
const BADGES={good:{texte:"Bon",ton:"bon"},warn:{texte:"À surveiller",ton:"attention"},crit:{texte:"À travailler",ton:"critique"},
  info:{texte:"Information",ton:"info"},na:{texte:"À compléter",ton:"neutre"}};

/** Verdict de la page, en une phrase : { note ("78" ou "—"), label (Solide · Correct · À consolider · Provisoire · ""), phrase,
    ton (good · warn · crit · ""), provisoire, partiel (mention des critères qui ne comptent pas encore, ou "") }. Seuils : 80 et 60. */
function verdict(r){
  if(!r) return {note:"—",label:"",phrase:"Le score n'est pas disponible dans cette vue.",ton:"",provisoire:false,partiel:""};
  const N=notes(r), aTravailler=N.filter(c=>c.points<16).length, aCompl=r.criteres.filter(c=>c.aCompleter).length;
  if(!r.familles.some(f=>f.total!=null))
    return {note:"—",label:"",phrase:"Pas encore de note : complète ton budget, ton profil et tes placements avec Claude pour la calculer.",ton:"",provisoire:false,
      partiel:aCompl?"Les critères à compléter sont regroupés en bas de page.":""};
  const partiel=aCompl?"Les critères à compléter ne comptent pas encore dans la note : ils sont regroupés en bas de page.":"";
  const notees=r.familles.filter(f=>f.total!=null).length;
  if(r.provisoire) return {note:String(r.total),label:"Provisoire",ton:"",provisoire:true,partiel,
    phrase:"Note provisoire : "+notees+" famille"+s_(notees)+" sur "+r.familles.length+" notée"+s_(notees)+" ; complète ton bilan pour une note fiable."};
  const reste=aTravailler?", avec "+nombre(aTravailler)+" point"+s_(aTravailler)+" à travailler":"";
  const t=r.total;
  const label=t>=80?"Solide":t>=60?"Correct":"À consolider";
  const phrase=t>=80?"Oui, ta situation est solide"+reste+"."
    :t>=60?"Dans l'ensemble, oui : ta situation est correcte"+reste+"."
    :"Pas encore : ta situation est à consolider"+reste+".";
  return {note:String(t),label,phrase,ton:classeTotal(t),provisoire:false,partiel};
}

/** Résumé d'une famille pour le titre de son accordéon : { note, ton, notes, aTravailler, aCompleter, sous }. `sous` dit l'état en
    mots (« des points à travailler · des données à compléter »), sans compteur (règle 9 : compteurs dans la navigation seulement). */
function resumeFamille(f){
  const cs=f.criteres||[], N=cs.filter(c=>!c.aCompleter&&!c.informatif), aT=N.filter(c=>c.points<16).length, aC=cs.filter(c=>c.aCompleter).length;
  const morceaux=[];
  if(N.length) morceaux.push(aT?"des points à travailler":"tout est au vert");
  if(aC) morceaux.push("des données à compléter");
  return {note:f.total==null?"—":String(f.total),ton:f.total==null?"na":classeTotal(f.total),notes:N.length,aTravailler:aT,aCompleter:aC,
    sous:morceaux.length?morceaux.join(" · "):"aucun critère pour le moment"};
}

/** Critères à compléter, regroupés par section de Claude qui les débloque (dans l'ordre d'apparition) :
    [{ section, titre, route, action (libellé du lien vers la vue, ou ""), criteres }]. */
function groupesACompleter(criteres){
  const out=[];
  (criteres||[]).filter(c=>c&&c.aCompleter).forEach(c=>{
    const section=sectionDe(c);
    let g=out.find(x=>x.section===section);
    if(!g){ const route=c.lien||null; g={section,titre:TITRE_SECTION[section]||"À compléter",route,action:route?lienLabel(route):"",criteres:[]}; out.push(g); }
    g.criteres.push(c);
  });
  return out;
}

/** Lien du pied du panneau, vers la vue concernée ; aucun pour un critère au vert (16/20 ou plus) ou informatif. */
function lienPanneau(c){
  const r=c&&c.lien;
  if(!r||!(c.aCompleter||(!c.informatif&&c.points<16))) return null;
  return {label:c.aCompleter?lienLabel(r):"Où agir : "+(DESTINATION[r]||r),href:"#"+r};
}

const plat=t=>String(t??"").replace(/\s+/g," ").trim();
/* Phrases « Compléter avec Claude » (claude-prompts.js : window.ClaudePrompts, ou require sous Node), avec un repli. */
const prompts=()=>(typeof window!=="undefined"&&window&&window.ClaudePrompts)||
  (typeof module==="object"&&module.exports&&typeof require==="function"?require("./claude-prompts.js"):null);
/** Phrase prête pour compléter un critère (ou un groupe de critères) avec Claude. */
function phraseCompleter(section,contexte){
  const P=prompts();
  if(P&&typeof P.phrase==="function") return P.phrase(section,contexte);
  return "Boussole : aide-moi à compléter mon bilan"+(contexte?" ("+plat(contexte)+")":"")+". Commence par demarrer_session, puis utilise les formulaires interactifs Boussole.";
}
/** Question préremplie de « Demander à Claude » pour un critère. */
function questionCritere(c){
  const t=plat(c.texte);
  if(c.aCompleter) return "Dans Boussole, le critère « "+plat(c.titre)+" » de mes bonnes pratiques est à compléter ("+t+"). Que dois-je renseigner, et peux-tu m'aider à le faire ?";
  if(c.informatif) return "Dans Boussole, l'indicateur « "+plat(c.titre)+" » dit : "+t+" Qu'est-ce que cela implique pour moi ?";
  return "Dans Boussole, mon critère « "+plat(c.titre)+" » est à "+c.points+"/"+c.sur+" : "+t+" Explique-moi pourquoi et ce que je pourrais faire.";
}
/** Question de la page. */
function questionPage(r){
  const v=verdict(r);
  if(v.note==="—") return "Aide-moi à compléter mon bilan dans Boussole pour calculer ma note de bonnes pratiques.";
  return "Ma note de bonnes pratiques dans Boussole est de "+v.note+"/100"+(v.provisoire?" (provisoire)":"")+" : explique-la-moi simplement et dis-moi ce que je devrais travailler en premier.";
}
/** Pied du panneau d'un critère : « Compléter avec Claude » ciblé pour un critère à compléter, « Demander à Claude » sinon. */
function piedCritere(c,U){
  return c.aCompleter?U.demanderAClaude(phraseCompleter(sectionDe(c),"le critère « "+plat(c.titre)+" » de mes bonnes pratiques"),"Compléter avec Claude")
    :U.demanderAClaude(questionCritere(c));
}

/** Valeur affichée sur la carte d'un critère : « 16/20 », « À compléter », ou la part pour l'information (« 34 % »). */
function valeurCarte(c){
  if(c.aCompleter) return "À compléter";
  if(c.informatif) return typeof c.valeur==="number"&&isFinite(c.valeur)?String(Math.round(c.valeur*100))+" %":"Information";
  return c.points+"/"+c.sur;
}
const carteCritere=(c,U)=>U.carte({id:c.cle,titre:c.titre,valeur:valeurCarte(c),sous:c.texte,badge:c.aCompleter?null:BADGES[niveau(c)]});

/** Contenu du panneau d'un critère (HTML échappé) : note et jauge, situation, repère, détails ou piste, règle et source. */
function detailCritereHtml(c,U){
  const niv=niveau(c), b=BADGES[niv];
  const jauge=c.aCompleter||c.informatif?"":`<span class="st-g" role="img" aria-label="${esc(c.points+" sur "+c.sur)}"><span class="st-gf ${niv}" style="width:${Math.max(0,Math.min(100,c.points/(c.sur||20)*100))}%"></span></span>`;
  const tete=`<div class="st-d-tete"><span class="st-d-pts num">${esc(valeurCarte(c))}</span><span class="ui-badge ${esc(b.ton)}">${esc(b.texte)}</span></div>`;
  const det=Array.isArray(c.details)&&c.details.length?'<ul class="st-d-det">'+c.details.map(d=>`<li class="${esc(d.statut)}">${esc(d.texte)}</li>`).join("")+"</ul>":"";
  const piste=det||(c.piste?`<p class="st-d-piste"><b>${c.aCompleter?"Pour le compléter":"Piste"}</b> ${esc(c.piste)}</p>`:"");
  return tete+jauge+
    `<dl class="st-d-dl"><dt>Ta situation</dt><dd>${esc(c.texte)}</dd><dt>Repère</dt><dd>${esc(c.cible)}</dd></dl>`+piste+
    U.accordeon({titre:"Règle et source",contenu:`<dl class="st-d-src"><dt>Règle</dt><dd>${esc(c.regle)}</dd><dt>Source</dt><dd>${esc(c.source)}</dd></dl>`});
}

const CHEVRON='<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
/** Les 4 familles en accordéons (fermés sauf ceux de `ouvertes`) ; critères notés et informatifs en cartes. */
function famillesHtml(r,U,ouvertes){
  const o=ouvertes||new Set();
  return r.familles.map(f=>{
    const rf=resumeFamille(f), cs=f.criteres.filter(c=>!c.aCompleter);
    const corps=cs.length?U.voirPlus(cs,5,c=>carteCritere(c,U),"Voir plus","div","st-fam-"+f.cle)
      :'<p class="st-vide">Aucun critère noté pour le moment'+(rf.aCompleter?" : il manque des données, voir « À compléter » en bas de page.":".")+"</p>";
    const plus=cs.length&&rf.aCompleter?'<p class="st-plus">D\'autres critères de cette famille sont à compléter, en bas de page.</p>':"";
    return `<details class="ui-acc st-fam ${rf.ton}" data-st-fam="${esc(f.cle)}"${o.has(f.cle)?" open":""}>
      <summary class="ui-acc-titre"><span class="st-fam-t"><span class="st-fam-nom">${esc(f.titre)}</span><span class="st-fam-sous">${esc(rf.sous)}</span></span>
        <span class="st-fam-note num ${rf.ton}">${esc(rf.note)}<span class="st-sur">/100</span></span><span class="ui-acc-chevron">${CHEVRON}</span></summary>
      <div class="ui-acc-corps"><p class="st-poids">poids ${f.poids} % de la note globale</p><div class="st-crits">${corps}</div>${plus}</div>
    </details>`;
  }).join("");
}

const FAMILLE_TITRE={securite:"Sécurité",effort:"Effort",allocation:"Allocation",efficacite:"Efficacité"};
/** Critères à compléter, par section : ce qui manque, « Compléter avec Claude » ciblé (section du critère), lien vers la vue
    concernée, puis les critères débloqués, en cartes. */
function aCompleterHtml(criteres,U){
  return groupesACompleter(criteres).map(g=>`<div class="st-grp" data-st-section="${esc(g.section)}">
    <div class="st-grp-tete"><p class="st-grp-t">${esc(g.titre)} <span class="st-grp-etat">à compléter</span></p>
      <div class="st-grp-actions">${U.demanderAClaude(phraseCompleter(g.section,g.criteres.map(c=>plat(c.titre)).join(", ")),"Compléter avec Claude")}${g.route?`<a class="st-go" href="#${esc(g.route)}" data-goto="${esc(g.route)}">${esc(g.action)}</a>`:""}</div></div>
    <div class="st-crits">${g.criteres.map(c=>U.carte({id:c.cle,titre:FAMILLE_TITRE[c.famille]||"À compléter",valeur:c.titre,sous:c.texte})).join("")}</div>
  </div>`).join("");
}

const PURE={verdict,niveau,resumeFamille,groupesACompleter,sectionDe,lienLabel,lienPanneau,phraseCompleter,questionCritere,questionPage,piedCritere,valeurCarte,detailCritereHtml,famillesHtml,aCompleterHtml};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null,objectifs:[],risque:null,classes:{}};
let root=null,dirty=true,last=null,ouvertId=null,retourCarte=null,sigPanneau="";
const sig={fam:"",ac:"",claude:""};
const ouvertes=new Set();
const $=id=>root.querySelector("#"+id);
const U=()=>window.UI||null;
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

function calcule(){
  if(!window.Pratiques||typeof window.Pratiques.evaluer!=="function") return null;
  try{ return window.Pratiques.evaluer({positions:S.positions,profil:S.profil,config:S.config,budget:S.budget,objectifs:S.objectifs,scope:S.scope,risque:S.risque,classes:S.classes,banque:S.banque||null,today:new Date()}); }
  catch(e){ console.error("bonnes pratiques",e); return null; }
}
/* Rien n'est réécrit (ni focus perdu, ni « Voir plus » replié) quand le HTML n'a pas changé. */
const ecrire=(id,cle,h)=>{ if(sig[cle]!==h){ sig[cle]=h; $(id).innerHTML=h; } };
const TON_BADGE={good:"bon",warn:"attention",crit:"critique"};

function render(){
  const r=last, u=U(), v=verdict(r);
  $("santeTitle").textContent="Bonnes pratiques "+scopeDe();
  $("santeTotal").textContent=v.note;
  $("santeSur").hidden=v.note==="—";
  const badge=$("santeBadge"); badge.textContent=v.label; badge.hidden=!v.label;
  badge.className="ui-badge "+(TON_BADGE[v.ton]||"neutre");
  $("santeVerdict").textContent=v.phrase;
  $("santeVerdict").className="st-verdict "+v.ton;
  $("santePartiel").textContent=v.partiel; $("santePartiel").hidden=!v.partiel;
  const pct=v.note==="—"?0:Math.max(0,Math.min(100,+v.note));
  $("santeJauge").innerHTML=`<span class="st-jf ${v.ton||"na"}" style="width:${pct}%"></span>`;
  if(!r||!u){ ecrire("santeFamilles","fam",""); $("santeFamSec").hidden=true; $("santeACompleter").hidden=true; ecrire("santeClaude","claude",""); return; }
  ecrire("santeClaude","claude",u.demanderAClaude(questionPage(r)));
  $("santeFamSec").hidden=false;
  ecrire("santeFamilles","fam",famillesHtml(r,u,ouvertes));
  const ac=r.criteres.some(c=>c.aCompleter);
  $("santeACompleter").hidden=!ac;
  ecrire("santeACList","ac",ac?aCompleterHtml(r.criteres,u):"");
  rafraichirPanneau();
}

/* ---------- panneau d'un critère ---------- */
const critere=cle=>(last&&last.criteres.find(c=>c.cle===cle))||null;
const carteDe=cle=>root&&cle!=null?root.querySelector('[data-ui-carte="'+CSS.escape(String(cle))+'"]'):null;
const optionsPanneau=(c,u)=>({titre:c.titre,contenu:detailCritereHtml(c,u),lien:lienPanneau(c),pied:piedCritere(c,u)});
/* Structure du pied (lien vers la vue, type de bouton Claude) : si elle change, le panneau est rouvert ; sinon seuls le corps et
   l'adresse du lien Claude sont réécrits. */
const structurePied=c=>JSON.stringify([lienPanneau(c),!!c.aCompleter]);
const questionPied=c=>c.aCompleter?phraseCompleter(sectionDe(c),"le critère « "+plat(c.titre)+" » de mes bonnes pratiques"):questionCritere(c);
let corpsPanneau=null,structPied="";
function ouvrir(cle,el){
  const u=U(), c=critere(cle);
  if(!u||!c) return;
  ouvertId=cle; retourCarte=el||null;
  const o=optionsPanneau(c,u); sigPanneau=o.contenu+"|"+c.titre+"|"+questionPied(c); structPied=structurePied(c);
  corpsPanneau=u.panneau.ouvrir(Object.assign(o,{retour:retourCarte,surFermeture:fermeture}));
}
/* Réécrit le corps d'un panneau ouvert sans voler le focus : accordéons ouverts gardés, focus rendu à l'élément de même rang
   s'il était dans le corps (UI.panneau.ouvrir, lui, remet le focus sur le titre). */
const FOCALISABLES="a[href],button,summary,input,select,textarea,[tabindex]";
function reecrireCorps(corps,html){
  const actif=document.activeElement, dedans=!!actif&&actif!==corps&&corps.contains(actif);
  const i=dedans?Array.from(corps.querySelectorAll(FOCALISABLES)).indexOf(actif):-1;
  const ouverts=Array.from(corps.querySelectorAll("details")).map(d=>d.hasAttribute("open"));
  corps.innerHTML=html;
  Array.from(corps.querySelectorAll("details")).forEach((d,k)=>{ if(ouverts[k]) d.setAttribute("open",""); });
  if(!dedans) return;
  const f=Array.from(corps.querySelectorAll(FOCALISABLES)), n=f[Math.min(Math.max(i,0),f.length-1)];
  const t=corps.parentNode&&corps.parentNode.querySelector(".ui-panneau-titre");
  if(n) n.focus(); else if(t) t.focus();
}
/* Le store a émis pendant l'ouverture : corps (et titre, lien Claude) mis à jour s'ils ont changé, sans rouvrir le panneau. */
function rafraichirPanneau(){
  const u=U();
  if(!ouvertId||!u||!u.panneau.ouvert()) return;
  const c=critere(ouvertId);
  if(!c){ u.panneau.fermer({focus:false}); return; }
  const o=optionsPanneau(c,u), q=questionPied(c), s=o.contenu+"|"+c.titre+"|"+q;
  if(s===sigPanneau) return;
  sigPanneau=s;
  if(structurePied(c)!==structPied||!corpsPanneau||!corpsPanneau.isConnected){ structPied=structurePied(c); corpsPanneau=u.panneau.ouvrir(o); return; }
  reecrireCorps(corpsPanneau,o.contenu);
  const pan=corpsPanneau.parentNode, t=pan&&pan.querySelector(".ui-panneau-titre"), pied=pan&&pan.querySelector(".ui-panneau-pied"),a=pied&&pied.querySelector(".ui-claude");
  if(t&&t.textContent!==c.titre) t.textContent=c.titre;
  if(a) a.setAttribute("href",u.urlClaude(q));
}
/* Fermeture : focus rendu à la carte d'origine ; si la page a été redessinée, à la carte du même critère, sinon au verdict. */
function fermeture(o){
  const cle=ouvertId, el=retourCarte;
  ouvertId=null; retourCarte=null; sigPanneau=""; corpsPanneau=null; structPied="";
  if((o&&o.focus===false)||!root) return;
  if(el&&el.isConnected) return;
  const c=carteDe(cle); if(c) c.focus(); else { const v=$("santeVerdict"); if(v) v.focus(); }
}

function mount(r){
  root=r;
  /* État des accordéons gardé entre deux rendus (le store peut émettre à tout moment). */
  root.addEventListener("toggle",e=>{
    const d=e.target; if(!d||!d.getAttribute) return;
    const k=d.getAttribute("data-st-fam"); if(!k) return;
    if(d.hasAttribute("open")) ouvertes.add(k); else ouvertes.delete(k);
    /* Le HTML mémorisé suit l'état ouvert / fermé du DOM : le prochain rendu ne réécrit rien s'il n'a pas changé. */
    const u=U(); if(last&&u) sig.fam=famillesHtml(last,u,ouvertes);
  },true);
  const u=U(); if(u) u.brancher(root,{surCarte:(id,el)=>ouvrir(id,el)});
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null,
    objectifs:snap.objectifs||[],risque:snap.risque||null,classes:snap.classes||{},banque:snap.banque||null};
  last=calcule(); dirty=true; if(visible){render();dirty=false;}
}
function show(){ if(dirty){render();dirty=false;} }
/* Chiffre clé : « 90/100 », ou « – » tant qu'aucune famille n'est notée. */
function headline(){ return last&&last.familles.some(f=>f.total!=null)?last.total+"/100":"–"; }
const api={mount,update,show,headline};
const reg=()=>App.register("sante",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
