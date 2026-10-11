(function(){
"use strict";
/* Pilotage › Santé — « Ma situation est-elle saine ? » : bonnes pratiques notées (Pratiques.evaluer, pratiques.js).
   En haut : note sur 100 (ou « — »), badge (Solide · Correct · À consolider · Provisoire), verdict en une phrase,
   « Demander à Claude ». Puis les 4 familles (Sécurité, Effort, Allocation, Efficacité) en accordéons fermés, note de la famille
   dans le titre ; chaque critère noté ou informatif est une carte (UI.carte) qui ouvre un panneau (UI.panneau) : situation,
   repère, piste, règle et source (accordéon), lien vers la vue où agir, « Demander à Claude ». Les critères « à compléter »
   sont regroupés en fin de page, par action qui les débloque. Méthode en accordéon fermé. Respecte le périmètre (Foyer / personne).
   Aucun calcul ici : les chiffres viennent de Pratiques.evaluer.
   Fonctions pures exportées pour les tests (module.exports) : verdict, niveau, resumeFamille, groupesACompleter, lienDe,
   lienLabel, lienPanneau, questionCritere, questionPage, valeurCarte, detailCritereHtml, famillesHtml, aCompleterHtml. */

/* ---------- logique pure ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NOMBRES=["aucun","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix"];
const nombre=n=>NOMBRES[n]||String(n);
const s_=n=>n>1?"s":"";
/* Libellé du bouton selon la vue où compléter (le lien vient du critère) ; destination lisible pour « Où agir ». */
const LIEN_LABEL={"patrimoine/budget":"Compléter le budget","patrimoine/objectifs":"Compléter les objectifs","compte/donnees":"Compléter le profil",
  "patrimoine/placements":"Voir les placements","pilotage/risque":"Ouvrir le profil de risque","aujourdhui/vue":"Voir Aujourd'hui","agent/connexion":"Compléter avec Claude"};
const DESTINATION={"patrimoine/budget":"Patrimoine › Budget","patrimoine/objectifs":"Patrimoine › Objectifs","compte/donnees":"Compte › Données",
  "patrimoine/placements":"Patrimoine › Placements","pilotage/risque":"Pilotage › Risque","aujourdhui/vue":"Aujourd'hui","agent/connexion":"Agent › Connexion"};
const lienLabel=r=>LIEN_LABEL[r]||"Compléter";
/* Critères qui portent sur les objectifs : leur lien « patrimoine/budget » mène à Patrimoine › Objectifs. */
const CRITERES_OBJECTIFS=["liquidite_objectifs","apport"];
function lienDe(c){
  if(!c||!c.lien) return null;
  return c.lien==="patrimoine/budget"&&CRITERES_OBJECTIFS.includes(c.cle)?"patrimoine/objectifs":c.lien;
}
function niveau(c){ return c.informatif?"info":c.aCompleter?"na":c.points>=16?"good":c.points>=10?"warn":"crit"; }
const classeTotal=t=>t>=80?"good":t>=60?"warn":"crit";
const notes=r=>r.criteres.filter(c=>!c.aCompleter&&!c.informatif);
const BADGES={good:{texte:"Bon",ton:"bon"},warn:{texte:"À surveiller",ton:"attention"},crit:{texte:"À travailler",ton:"critique"},
  info:{texte:"Information",ton:"info"},na:{texte:"À compléter",ton:"neutre"}};

/** Verdict de la page, en une phrase : { note ("78" ou "—"), label (Solide · Correct · À consolider · Provisoire · ""), phrase,
    ton (good · warn · crit · ""), provisoire, partiel (critères qui ne comptent pas encore, ou "") }. Seuils : 80 et 60. */
function verdict(r){
  if(!r) return {note:"—",label:"",phrase:"Le score n'est pas disponible dans cette vue.",ton:"",provisoire:false,partiel:""};
  const N=notes(r), aTravailler=N.filter(c=>c.points<16).length, aCompl=r.criteres.filter(c=>c.aCompleter).length;
  if(!r.familles.some(f=>f.total!=null))
    return {note:"—",label:"",phrase:"Pas encore de note : complétez votre budget, votre profil et vos placements pour la calculer.",ton:"",provisoire:false,
      partiel:aCompl?aCompl+" critère"+s_(aCompl)+" à compléter, regroupé"+s_(aCompl)+" en bas de page.":""};
  const partiel=aCompl?"Note calculée sur "+N.length+" critère"+s_(N.length)+" : "+aCompl+" à compléter ne compte"+(aCompl>1?"nt":"")+" pas encore.":"";
  const notees=r.familles.filter(f=>f.total!=null).length;
  if(r.provisoire) return {note:String(r.total),label:"Provisoire",ton:"",provisoire:true,partiel,
    phrase:"Note provisoire : "+notees+" famille"+s_(notees)+" sur "+r.familles.length+" notée"+s_(notees)+" ; complétez votre bilan pour une note fiable."};
  const reste=aTravailler?", avec "+nombre(aTravailler)+" point"+s_(aTravailler)+" à travailler":"";
  const t=r.total;
  const label=t>=80?"Solide":t>=60?"Correct":"À consolider";
  const phrase=t>=80?"Oui, votre situation est solide"+reste+"."
    :t>=60?"Dans l'ensemble, oui : votre situation est correcte"+reste+"."
    :"Pas encore : votre situation est à consolider"+reste+".";
  return {note:String(t),label,phrase,ton:classeTotal(t),provisoire:false,partiel};
}

/** Résumé d'une famille pour le titre de son accordéon : { note, ton, notes, aTravailler, aCompleter, sous }. */
function resumeFamille(f){
  const cs=f.criteres||[], N=cs.filter(c=>!c.aCompleter&&!c.informatif), aT=N.filter(c=>c.points<16).length, aC=cs.filter(c=>c.aCompleter).length;
  const morceaux=[];
  if(N.length) morceaux.push(N.length+" critère"+s_(N.length)+" noté"+s_(N.length), aT?aT+" à travailler":"tout est au vert");
  if(aC) morceaux.push(aC+" à compléter");
  return {note:f.total==null?"—":String(f.total),ton:f.total==null?"na":classeTotal(f.total),notes:N.length,aTravailler:aT,aCompleter:aC,
    sous:morceaux.length?morceaux.join(" · "):"aucun critère pour le moment"};
}

/** Critères à compléter, regroupés par action qui les débloque (dans l'ordre d'apparition) : [{ route, action, criteres }]. */
function groupesACompleter(criteres){
  const out=[];
  (criteres||[]).filter(c=>c&&c.aCompleter).forEach(c=>{
    const route=lienDe(c);
    let g=out.find(x=>x.route===route);
    if(!g){ g={route,action:route?lienLabel(route):"À compléter",criteres:[]}; out.push(g); }
    g.criteres.push(c);
  });
  return out;
}

/** Lien du pied du panneau, vers la vue où compléter ou agir ; aucun pour un critère au vert (16/20 ou plus) ou informatif. */
function lienPanneau(c){
  const r=lienDe(c);
  if(!r||!(c.aCompleter||(!c.informatif&&c.points<16))) return null;
  return {label:c.aCompleter?lienLabel(r):"Où agir : "+(DESTINATION[r]||r),href:"#"+r};
}

const plat=t=>String(t??"").replace(/\s+/g," ").trim();
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
    `<dl class="st-d-dl"><dt>Votre situation</dt><dd>${esc(c.texte)}</dd><dt>Repère</dt><dd>${esc(c.cible)}</dd></dl>`+piste+
    U.accordeon({titre:"Règle et source",contenu:`<dl class="st-d-src"><dt>Règle</dt><dd>${esc(c.regle)}</dd><dt>Source</dt><dd>${esc(c.source)}</dd></dl>`});
}

const CHEVRON='<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';
/** Les 4 familles en accordéons (fermés sauf ceux de `ouvertes`) ; critères notés et informatifs en cartes. */
function famillesHtml(r,U,ouvertes){
  const o=ouvertes||new Set();
  return r.familles.map(f=>{
    const rf=resumeFamille(f), cs=f.criteres.filter(c=>!c.aCompleter);
    const corps=cs.length?U.voirPlus(cs,5,c=>carteCritere(c,U),"Voir plus","div")
      :'<p class="st-vide">Aucun critère noté pour le moment'+(rf.aCompleter?" : "+rf.aCompleter+" à compléter, en bas de page.":".")+"</p>";
    const plus=cs.length&&rf.aCompleter?`<p class="st-plus">${rf.aCompleter} critère${s_(rf.aCompleter)} à compléter, en bas de page.</p>`:"";
    return `<details class="ui-acc st-fam ${rf.ton}" data-st-fam="${esc(f.cle)}"${o.has(f.cle)?" open":""}>
      <summary class="ui-acc-titre"><span class="st-fam-t"><span class="st-fam-nom">${esc(f.titre)}</span><span class="st-fam-sous">${esc(rf.sous)}</span></span>
        <span class="st-fam-note num ${rf.ton}">${esc(rf.note)}<span class="st-sur">/100</span></span><span class="ui-acc-chevron">${CHEVRON}</span></summary>
      <div class="ui-acc-corps"><p class="st-poids">poids ${f.poids} % de la note globale</p><div class="st-crits">${corps}</div>${plus}</div>
    </details>`;
  }).join("");
}

const FAMILLE_TITRE={securite:"Sécurité",effort:"Effort",allocation:"Allocation",efficacite:"Efficacité"};
/** Critères à compléter, par action : un bloc par action (lien vers la vue concernée) et les critères qu'elle débloque, en cartes. */
function aCompleterHtml(criteres,U){
  return groupesACompleter(criteres).map(g=>`<div class="st-grp">
    <div class="st-grp-tete"><p class="st-grp-t">Débloque ${g.criteres.length} critère${s_(g.criteres.length)}</p>
      ${g.route?`<a class="st-go" href="#${esc(g.route)}" data-goto="${esc(g.route)}">${esc(g.action)}</a>`:""}</div>
    <div class="st-crits">${g.criteres.map(c=>U.carte({id:c.cle,titre:FAMILLE_TITRE[c.famille]||"À compléter",valeur:c.titre,sous:c.texte})).join("")}</div>
  </div>`).join("");
}

const PURE={verdict,niveau,resumeFamille,groupesACompleter,lienDe,lienLabel,lienPanneau,questionCritere,questionPage,valeurCarte,detailCritereHtml,famillesHtml,aCompleterHtml};
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
  try{ return window.Pratiques.evaluer({positions:S.positions,profil:S.profil,config:S.config,budget:S.budget,objectifs:S.objectifs,scope:S.scope,risque:S.risque,classes:S.classes,today:new Date()}); }
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
const optionsPanneau=(c,u)=>({titre:c.titre,contenu:detailCritereHtml(c,u),lien:lienPanneau(c),pied:u.demanderAClaude(questionCritere(c))});
function ouvrir(cle,el){
  const u=U(), c=critere(cle);
  if(!u||!c) return;
  ouvertId=cle; retourCarte=el||null;
  const o=optionsPanneau(c,u); sigPanneau=o.contenu+"|"+c.titre;
  u.panneau.ouvrir(Object.assign(o,{retour:retourCarte,surFermeture:fermeture}));
}
/* Le store a émis pendant l'ouverture : contenu mis à jour s'il a changé (retour et rappel conservés par UI.panneau). */
function rafraichirPanneau(){
  const u=U();
  if(!ouvertId||!u||!u.panneau.ouvert()) return;
  const c=critere(ouvertId);
  if(!c){ u.panneau.fermer({focus:false}); return; }
  const o=optionsPanneau(c,u), s=o.contenu+"|"+c.titre;
  if(s===sigPanneau) return;
  sigPanneau=s; u.panneau.ouvrir(o);
}
/* Fermeture : focus rendu à la carte d'origine ; si la page a été redessinée, à la carte du même critère, sinon au verdict. */
function fermeture(o){
  const cle=ouvertId, el=retourCarte;
  ouvertId=null; retourCarte=null; sigPanneau="";
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
    if(d.open) ouvertes.add(k); else ouvertes.delete(k);
    /* Le HTML mémorisé suit l'état ouvert / fermé du DOM : le prochain rendu ne réécrit rien s'il n'a pas changé. */
    const u=U(); if(last&&u) sig.fam=famillesHtml(last,u,ouvertes);
  },true);
  const u=U(); if(u) u.brancher(root,{surCarte:(id,el)=>ouvrir(id,el)});
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null,
    objectifs:snap.objectifs||[],risque:snap.risque||null,classes:snap.classes||{}};
  last=calcule(); dirty=true; if(visible){render();dirty=false;}
}
function show(){ if(dirty){render();dirty=false;} }
/* Chiffre clé : « 90/100 », ou « – » tant qu'aucune famille n'est notée. */
function headline(){ return last&&last.familles.some(f=>f.total!=null)?last.total+"/100":"–"; }
const api={mount,update,show,headline};
const reg=()=>App.register("sante",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
