(function(){
"use strict";
/* Compte › Règles — « Qu'est-ce qui déclenche mes alertes ? » : règles d'alerte (config.rules) et cible du matelas de précaution
   (config.cushion), en LECTURE SEULE sauf la bascule actif / inactif (spec 2026-10-11-saisie-par-agent) : c'est la seule écriture
   de la page (config/main ← update({rules}), la règle porte actif: false ou ne le porte plus). Ajouter une règle, changer un seuil,
   en supprimer une ou régler le matelas se fait avec Claude : « Régler avec Claude » (UI.demanderAClaude + ClaudePrompts.phrase,
   section « regles », avec la règle ou le matelas en contexte). Claude modifie les règles d'alerte après l'accord de l'utilisateur
   dans la conversation (update_config) ; la cible du matelas passe par une proposition (regler_matelas, cible config, migration
   0019) validée dans Agent › À valider. Les alertes qui en découlent s'affichent dans Aujourd'hui.
   Une carte par règle : type, règle en français (Rules.describe), état du moment (Rules.evaluate sur cette seule règle), et une
   bascule actif / inactif (role="switch", aria-label « Règle : <texte> », l'état est porté par aria-checked). La carte ouvre un
   panneau en lecture (état, alertes du moment, « Régler avec Claude »). 5 règles puis « Voir les autres règles » (clé fixe).
   L'épargne de précaution est une carte (UI.carte) : cible, épargne disponible, badge ; son panneau explique la cible et propose
   « Régler avec Claude ».
   Aucun calcul ici : Rules (rules.js) et Calc (calc.js) restent la source des règles, des alertes et du matelas.
   Fonctions pures exportées pour les tests (module.exports) : estActive, resumeRegle, compteRegles, basculerRegle,
   epargneDisponible, resumeMatelas, phraseRegles, phraseRegle, phraseMatelas, carteRegleHtml, listeHtml, reglePanneauHtml,
   matelasPanneauHtml. */

const glob=k=>(typeof window!=="undefined"&&window[k])||(typeof self!=="undefined"&&self[k])||null;
/* Phrases « Régler avec Claude » : global du navigateur, sinon le module voisin sous Node (tests). */
const prompts=()=>glob("ClaudePrompts")||(typeof module==="object"&&module.exports&&typeof require==="function"?require("./claude-prompts.js"):null);

/* ---------- logique pure ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const s_=k=>k>1?"s":"";
const nf0=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1});
const eur0=v=>nf0.format(Math.round(+v||0))+" €";
const plat=t=>String(t??"").replace(/\s+/g," ").trim();
const CHEVRON='<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';

/** Une règle est active sauf si elle porte actif: false. */
const estActive=r=>!(r&&r.actif===false);

/** Résumé d'une règle pour sa carte : { titre (type), texte (Rules.describe), actif, alertes, etat, ton (crit · warn · info · ok · off) }.
    Une règle inactive n'est pas évaluée. */
function resumeRegle(r,ctx,R){
  const titre=R&&r&&R.TYPES[r.type]?R.TYPES[r.type].label:"Règle";
  const texte=R?R.describe(r,ctx):String((r&&r.type)||"");
  if(!estActive(r)) return {titre,texte,actif:false,alertes:[],etat:"Inactive : aucune alerte",ton:"off"};
  const alertes=R?R.evaluate([r],ctx):[];
  const n=alertes.length;
  const ton=!n?"ok":alertes.some(a=>a.level==="crit")?"crit":alertes.some(a=>a.level==="warn")?"warn":"info";
  return {titre,texte,actif:true,alertes,etat:n?n+" alerte"+s_(n)+" en ce moment":"Rien à signaler",ton};
}
/** « 6 règles », « 6 règles, dont 1 inactive », "" sans règle. */
function compteRegles(rules){
  const L=Array.isArray(rules)?rules:[]; if(!L.length) return "";
  const off=L.filter(r=>!estActive(r)).length;
  return L.length+" règle"+s_(L.length)+(off?", dont "+off+" inactive"+s_(off):"");
}
/** Copie de la liste où la règle i change d'état (actif: false posé ou retiré) ; les autres règles sont inchangées. */
function basculerRegle(rules,i){
  return (Array.isArray(rules)?rules:[]).map((r,j)=>{
    if(j!==i) return r;
    const c=Object.assign({},r);
    if(estActive(r)) c.actif=false; else delete c.actif;
    return c;
  });
}
/** Épargne disponible du foyer (poche « Épargne », lignes comptées), comme le contrôle intégré du matelas. */
const epargneDisponible=(positions,C)=>(positions||[]).filter(p=>p&&p.bloc==="Épargne"&&C.counted(p)).reduce((a,p)=>a+C.val(p),0);
/** Carte du matelas : { regle, valeur, sous, badge } d'après Calc.matelas ; badge sous / dans / au-dessus de la cible (mêmes seuils que
    le contrôle intégré). */
function resumeMatelas(config,epargne,C){
  const m=C.matelas(config);
  if(!m||!(m.min>0)) return {regle:false,valeur:"Non réglée",sous:"Règle une cible avec Claude pour être prévenu quand l'épargne disponible s'en écarte.",badge:{texte:"À régler",ton:"neutre"}};
  const valeur=m.mode==="months"?nf1.format(m.months)+" mois de dépenses":m.max!=null&&m.max>0?eur0(m.min)+" à "+eur0(m.max):"Au moins "+eur0(m.min);
  const e=+epargne||0;
  const badge=e<m.min?{texte:"Sous la cible",ton:"attention"}:m.max!=null&&m.max>0&&e>m.max?{texte:"Au-dessus de la cible",ton:"info"}:{texte:"Dans la cible",ton:"bon"};
  return {regle:true,valeur,sous:(m.mode==="months"?"soit "+eur0(m.min)+" · ":"")+eur0(e)+" d'épargne disponible",badge};
}

/* Phrases prêtes (ClaudePrompts.phrase, section « regles ») : la page, une règle, le matelas. Repli si le module manque. */
const phrase=contexte=>{ const P=prompts(); return P?P.phrase("regles",contexte):"Boussole : aide-moi à régler mes règles d'alerte et mon épargne de précaution."+(contexte?" Concerne : "+contexte+".":""); };
/** Phrase de la page (ajouter, ajuster ou désactiver des règles). */
const phraseRegles=()=>phrase();
/** Phrase d'une règle : « la règle « Aucune ligne au-dessus de 15 % du patrimoine » (inactive) ». */
const phraseRegle=res=>phrase("la règle « "+plat(res&&res.texte)+" »"+(res&&!res.actif?" (inactive)":""));
/** Phrase du matelas : cible actuelle ou « pas encore de cible ». */
const phraseMatelas=res=>phrase("mon épargne de précaution ("+(res&&res.regle?"cible : "+plat(res.valeur):"pas encore de cible")+")");

/** Carte d'une règle : bouton qui ouvre le panneau, et bascule actif / inactif (deux boutons voisins, pas l'un dans l'autre).
    Le nom de la bascule est la règle ; son état (active / inactive) est porté par aria-checked. */
function carteRegleHtml(res,i){
  return `<li class="rg-regle${res.actif?"":" off"}">`+
    `<button type="button" class="rg-ouvrir" data-rg-ouvrir="${i}" aria-haspopup="dialog">`+
      `<span class="rg-type">${esc(res.titre)}</span><span class="rg-texte">${esc(res.texte)}</span>`+
      `<span class="rg-etat ${esc(res.ton)}">${esc(res.etat)}</span><span class="rg-chevron">${CHEVRON}</span></button>`+
    `<button type="button" class="rg-switch" role="switch" aria-checked="${res.actif?"true":"false"}" data-rg-bascule="${i}" aria-label="${esc("Règle : "+res.texte)}">`+
      `<span class="rg-piste" aria-hidden="true"><span class="rg-pouce"></span></span><span class="rg-switch-txt" aria-hidden="true">${res.actif?"Active":"Inactive"}</span></button></li>`;
}
const VIDE='<div class="rg-vide"><p>Aucune règle pour l\'instant : seuls les contrôles intégrés (cibles, matelas, mise à jour, échéances) s\'appliquent.</p><p>Pour en mettre en place, règle-les avec Claude : il te propose des seuils adaptés à tes placements.</p></div>';
/** Liste des cartes ([{ i, res }]) : 5 puis « Voir les autres règles » (UI.voirPlus, clé fixe : l'état déplié survit aux rendus) ;
    état vide qui oriente vers Claude. */
function listeHtml(items,U){
  if(!items.length) return VIDE;
  return U?U.voirPlus(items,5,x=>carteRegleHtml(x.res,x.i),"Voir les autres règles","ul","rg-regles"):'<ul class="ui-voirplus-liste">'+items.map(x=>carteRegleHtml(x.res,x.i)).join("")+"</ul>";
}

const NIVEAU={crit:"Urgent",warn:"À surveiller",info:"Information"};
/** Panneau d'une règle (lecture) : état, alertes du moment, et la façon de la modifier (avec Claude) ou de la mettre en pause. */
function reglePanneauHtml(res){
  const alertes=res.actif&&res.alertes.length?'<ul class="rg-p-alertes">'+res.alertes.map(a=>`<li class="${esc(a.level)}"><span class="rg-p-niv">${esc(NIVEAU[a.level]||"Alerte")}</span><b>${esc(a.title)}</b> ${esc(a.text)}</li>`).join("")+"</ul>":"";
  return `<div class="rg-p"><div class="rg-p-tete"><span class="ui-badge ${res.actif?"bon":"neutre"}">${res.actif?"Active":"Inactive"}</span></div>`+
    `<p class="rg-p-texte">${esc(res.texte)}</p>`+
    `<p class="rg-p-etat ${esc(res.ton)}">${esc(res.actif?res.etat:"Inactive : elle ne déclenche aucune alerte. Réactive-la avec la bascule de sa carte.")}</p>`+alertes+
    `<p class="rg-p-intro">Pour changer son seuil ou la supprimer, règle-la avec Claude. Claude modifie tes règles d'alerte après ton accord dans la conversation ; tu peux les mettre en pause ici, avec la bascule de leur carte.</p></div>`;
}
/** Panneau du matelas (lecture) : cible actuelle, épargne disponible, méthode ; le réglage se fait avec Claude. */
function matelasPanneauHtml(res,badgeHtml){
  return `<div class="rg-p"><div class="rg-p-tete"><span class="rg-p-val">${esc(res.valeur)}</span>${badgeHtml||""}</div>`+
    `<p class="rg-p-sous">${esc(res.sous)}</p>`+
    `<p class="rg-p-intro">L'épargne disponible est celle de la poche « Épargne » du foyer (livrets, comptes). La cible s'exprime en montant (minimum, et maximum facultatif) ou en mois de dépenses : elle vaut alors le nombre de mois multiplié par tes dépenses mensuelles, sans plafond.</p>`+
    `<p class="rg-p-intro">Pour la fixer ou la changer, règle-la avec Claude : il dépose une proposition que tu valides dans Agent › À valider.</p></div>`;
}

const PURE={estActive,resumeRegle,compteRegles,basculerRegle,epargneDisponible,resumeMatelas,phraseRegles,phraseRegle,phraseMatelas,
  carteRegleHtml,listeHtml,reglePanneauHtml,matelasPanneauHtml};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
let S={scope:"foyer",people:[],positions:[],config:null,status:null,db:null};
let root=null,dirty=true;
let ouvert=null; // panneau ouvert : { genre: "regle" | "matelas", index?, retour }
const sig={liste:"",matelas:"",claude:""};
const $=id=>root.querySelector("#"+id);
const U=()=>window.UI||null;
const R=()=>window.Rules||null;
const today=()=>new Date().toISOString().slice(0,10);
function ruleCtx(){ return {positions:S.positions,config:S.config||{},scope:S.scope,people:S.people,today:today(),status:S.status}; }
const rulesOf=()=>(S.config&&Array.isArray(S.config.rules))?S.config.rules:[];
const ecrire=(id,cle,h)=>{ if(sig[cle]!==h){ sig[cle]=h; $(id).innerHTML=h; } };
const regler=(u,q)=>u.demanderAClaude(q,"Régler avec Claude");
const erreurTexte=e=>e&&e.code==="invalid_argument"?"Modification refusée : tu n'as pas les droits d'écriture.":"Modification impossible ("+((e&&e.code)||"erreur")+"). Réessaie.";
function annoncer(t){ const m=$("rgMsg"); if(m) m.textContent=t||""; }

function render(){
  const rules=rulesOf(), u=U(), Rl=R(), C=window.Calc, ctx=ruleCtx();
  $("ruleCount").textContent=compteRegles(rules);
  if(u) ecrire("rgClaude","claude",regler(u,phraseRegles()));
  const items=rules.map((r,i)=>({i,res:resumeRegle(r,ctx,Rl)}));
  ecrire("ruleList","liste",listeHtml(items,u)); // « Voir plus » à clé fixe : l'état déplié est conservé par UI
  if(u&&C){ const m=resumeMatelas(S.config,epargneDisponible(S.positions,C),C);
    ecrire("rgMatelas","matelas",'<div class="rg-cartes">'+u.carte({id:"matelas",titre:"Cible du matelas",valeur:m.valeur,sous:m.sous,badge:m.badge})+"</div>"); }
}

/* ---------- focus ---------- */
function focusCarte(i){
  const b=root.querySelector('[data-rg-ouvrir="'+i+'"]');
  if(!b) return;
  if(b.closest("[hidden]")){ const vp=$("ruleList").querySelector("[data-ui-voirplus]"); if(vp&&vp.getAttribute("aria-expanded")!=="true") vp.click(); }
  b.focus();
}
/* Fermeture d'un panneau : UI rend le focus à l'élément d'origine ; s'il a été redessiné, à la carte équivalente. */
function fermeture(o){
  const p=ouvert; ouvert=null;
  if((o&&o.focus===false)||!root||!p) return;
  if(p.retour&&p.retour.isConnected) return;
  if(p.genre==="matelas"){ const c=root.querySelector('[data-ui-carte="matelas"]'); if(c) c.focus(); }
  else focusCarte(p.index);
}

/* ---------- seule écriture : la bascule actif / inactif ---------- */
/* config/main ← { rules } ; la vue suit tout de suite, sans attendre le store. */
async function ecrireRegles(rules){
  await S.db.doc("config/main").update({rules});
  S.config=Object.assign({},S.config||{},{rules});
  render();
}
async function basculer(i){
  const Rl=R(); if(!Rl) return;
  if(!S.db){ annoncer("Base indisponible dans cette vue."); return; }
  const rules=basculerRegle(rulesOf(),i), r=rules[i]; if(!r) return;
  const b0=root.querySelector('[data-rg-bascule="'+i+'"]'); if(b0) b0.disabled=true;
  try{ await ecrireRegles(rules); annoncer((estActive(r)?"Règle réactivée : ":"Règle désactivée : ")+Rl.describe(r,ruleCtx())+"."); }
  catch(e){ annoncer(erreurTexte(e)); }
  const b=root.querySelector('[data-rg-bascule="'+i+'"]');
  if(b){ b.disabled=false; if(b.closest("[hidden]")) focusCarte(i); b.focus(); }
}

/* ---------- panneaux (lecture) ---------- */
function ouvrirRegle(i,el){
  const u=U(), Rl=R(), r=rulesOf()[i]; if(!u||!Rl||!r) return;
  const res=resumeRegle(r,ruleCtx(),Rl);
  ouvert={genre:"regle",index:i,retour:el||null};
  u.panneau.ouvrir({titre:res.titre,contenu:reglePanneauHtml(res),pied:regler(u,phraseRegle(res)),retour:el||undefined,surFermeture:fermeture});
}
function ouvrirMatelas(el){
  const u=U(), C=window.Calc; if(!u||!C) return;
  const res=resumeMatelas(S.config,epargneDisponible(S.positions,C),C);
  ouvert={genre:"matelas",retour:el||null};
  const badge=res.badge?'<span class="ui-badge '+esc(res.badge.ton)+'">'+esc(res.badge.texte)+"</span>":"";
  u.panneau.ouvrir({titre:"Épargne de précaution",contenu:matelasPanneauHtml(res,badge),pied:regler(u,phraseMatelas(res)),retour:el||undefined,surFermeture:fermeture});
}

function mount(r){
  root=r;
  const u=U();
  if(u) u.brancher(root,{surCarte:(id,el)=>{ if(id==="matelas"){ annoncer(""); ouvrirMatelas(el); } }});
  root.addEventListener("click",ev=>{
    const t=ev.target; if(!t||!t.closest) return;
    const b=t.closest("[data-rg-bascule]"); if(b&&root.contains(b)){ basculer(+b.getAttribute("data-rg-bascule")); return; }
    const o=t.closest("[data-rg-ouvrir]"); if(o&&root.contains(o)){ annoncer(""); ouvrirRegle(+o.getAttribute("data-rg-ouvrir"),o); }
  });
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,status:snap.status,db:window.Store.db};
  dirty=true; if(visible){render();dirty=false;}
}
function show(){ if(dirty){render();dirty=false;} }
/* Chiffre clé : nombre de règles d'alerte de l'utilisateur. */
function headline(){ const n=rulesOf().length; return n?n+" règle"+(n>1?"s":""):"Aucune règle"; }
const api={mount,update,show,headline};
const reg=()=>App.register("regles",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
