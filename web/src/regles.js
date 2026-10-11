(function(){
"use strict";
/* Compte › Règles — « Qu'est-ce qui déclenche mes alertes ? » : règles d'alerte (config.rules) et cible du matelas de précaution
   (config.cushion), écrites dans config/main (mêmes écritures qu'avant : update({rules}) et update({cushion})). Les alertes qui en
   découlent s'affichent dans Aujourd'hui.
   Une carte par règle : type, règle en français (Rules.describe), état du moment (Rules.evaluate sur cette seule règle), et une
   bascule actif / inactif (role="switch") ; une règle inactive garde ses réglages et porte actif: false. La carte ouvre un panneau
   (UI.panneau) pour la modifier ou la supprimer ; « Ajouter une règle » ouvre le même formulaire. 5 règles puis « Voir plus ».
   L'épargne de précaution est une carte (UI.carte) : cible, épargne disponible, badge ; son panneau règle la cible (bascule
   « En montant » / « En mois de dépenses »).
   Aucun calcul ici : Rules (rules.js) et Calc (calc.js) restent la source des règles, des alertes et du matelas.
   Fonctions pures exportées pour les tests (module.exports) : estActive, resumeRegle, compteRegles, basculerRegle,
   regleDepuisSaisie, epargneDisponible, resumeMatelas, questionPage, questionRegle, questionMatelas, carteRegleHtml, listeHtml,
   formRegleHtml, reglePanneauHtml, matelasPanneauHtml. */

/* ---------- logique pure ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const s_=k=>k>1?"s":"";
const nf0=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1});
const fmt2=new Intl.NumberFormat("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2});
const eur0=v=>nf0.format(Math.round(+v||0))+" €";
const eur2=v=>v==null||isNaN(v)?"—":fmt2.format(v)+" €";
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
/** Règle saisie, validée par Rules.normalize → { rule } ou { error }. En modification, les clés propres à l'ancienne règle (actif: false,
    note…) sont conservées ; les champs d'un autre type de règle ne le sont pas. */
function regleDepuisSaisie(raw,ancienne,R){
  const n=R.normalize(raw); if(n.error) return {error:n.error};
  const connus=new Set(["type"].concat(...Object.keys(R.TYPES).map(k=>R.TYPES[k].fields)));
  const garde={}; if(ancienne&&typeof ancienne==="object") Object.keys(ancienne).forEach(k=>{ if(!connus.has(k)) garde[k]=ancienne[k]; });
  return {rule:Object.assign(garde,n.rule)};
}
/** Épargne disponible du foyer (poche « Épargne », lignes comptées), comme le contrôle intégré du matelas. */
const epargneDisponible=(positions,C)=>(positions||[]).filter(p=>p&&p.bloc==="Épargne"&&C.counted(p)).reduce((a,p)=>a+C.val(p),0);
/** Carte du matelas : { regle, valeur, sous, badge } d'après Calc.matelas ; badge sous / dans / au-dessus de la cible (mêmes seuils que
    le contrôle intégré). */
function resumeMatelas(config,epargne,C){
  const m=C.matelas(config);
  if(!m||!(m.min>0)) return {regle:false,valeur:"Non réglée",sous:"Fixez une cible pour être prévenu quand l'épargne disponible s'en écarte.",badge:{texte:"À régler",ton:"neutre"}};
  const valeur=m.mode==="months"?nf1.format(m.months)+" mois de dépenses":m.max!=null&&m.max>0?eur0(m.min)+" à "+eur0(m.max):"Au moins "+eur0(m.min);
  const e=+epargne||0;
  const badge=e<m.min?{texte:"Sous la cible",ton:"attention"}:m.max!=null&&m.max>0&&e>m.max?{texte:"Au-dessus de la cible",ton:"info"}:{texte:"Dans la cible",ton:"bon"};
  return {regle:true,valeur,sous:(m.mode==="months"?"soit "+eur0(m.min)+" · ":"")+eur0(e)+" d'épargne disponible",badge};
}
const plat=t=>String(t??"").replace(/\s+/g," ").trim();
/** Question de la page pour « Demander à Claude ». */
function questionPage(rules,ctx,R){
  const L=(Array.isArray(rules)?rules:[]).slice(0,8);
  if(!L.length) return "Quelles règles d'alerte me conseilles-tu de mettre en place dans Boussole pour surveiller mes placements ?";
  return "Dans Boussole, mes règles d'alerte sont : "+L.map(r=>plat(R?R.describe(r,ctx):r.type)+(estActive(r)?"":" (inactive)")).join(" ; ")+". Lesquelles me conseilles-tu d'ajouter, d'ajuster ou de désactiver ?";
}
const questionRegle=res=>"Dans Boussole, ma règle d'alerte « "+plat(res.texte)+" » ("+(res.actif?plat(res.etat).toLowerCase():"inactive")+") est-elle pertinente pour moi ? Faut-il ajuster son seuil ?";
const questionMatelas=res=>res.regle?"Dans Boussole, la cible de mon épargne de précaution est "+plat(res.valeur)+" ("+plat(res.sous)+"). Est-elle adaptée à ma situation ?"
  :"Quelle épargne de précaution me conseilles-tu de garder, au vu de ma situation dans Boussole ?";

/** Carte d'une règle : bouton qui ouvre le panneau, et bascule actif / inactif (deux boutons voisins, pas l'un dans l'autre). */
function carteRegleHtml(res,i){
  return `<li class="rg-regle${res.actif?"":" off"}">`+
    `<button type="button" class="rg-ouvrir" data-rg-ouvrir="${i}" aria-haspopup="dialog">`+
      `<span class="rg-type">${esc(res.titre)}</span><span class="rg-texte">${esc(res.texte)}</span>`+
      `<span class="rg-etat ${esc(res.ton)}">${esc(res.etat)}</span><span class="rg-chevron">${CHEVRON}</span></button>`+
    `<button type="button" class="rg-switch" role="switch" aria-checked="${res.actif?"true":"false"}" data-rg-bascule="${i}" aria-label="${esc("Activer la règle : "+res.texte)}">`+
      `<span class="rg-piste" aria-hidden="true"><span class="rg-pouce"></span></span><span class="rg-switch-txt" aria-hidden="true">${res.actif?"Active":"Inactive"}</span></button></li>`;
}
const VIDE='<div class="rg-vide"><p>Aucune règle pour l\'instant : seuls les contrôles intégrés (cibles, matelas, mise à jour, échéances) s\'appliquent.</p><p>Ajoutez-en une, ou demandez à Claude lesquelles mettre en place.</p></div>';
/** Liste des cartes ([{ i, res }]) : 5 puis « Voir les autres règles » (UI.voirPlus) ; état vide qui oriente. */
function listeHtml(items,U){
  if(!items.length) return VIDE;
  return U?U.voirPlus(items,5,x=>carteRegleHtml(x.res,x.i),"Voir les autres règles","ul"):'<ul class="ui-voirplus-liste">'+items.map(x=>carteRegleHtml(x.res,x.i)).join("")+"</ul>";
}

/** Formulaire d'une règle (ajout ou modification) : type, puis les seuls champs de ce type (Rules.TYPES[type].fields). */
function formRegleHtml(o,R){
  o=o||{};
  const T=R.TYPES, type=T[o.type]?o.type:"max_line_pct", need=T[type].fields, v=o.regle||{}, ch=o.choix||{};
  const cache=f=>need.includes(f)?"":" hidden";
  const opts=(list,cur)=>list.map(([val,txt])=>`<option value="${esc(val)}"${String(val)===String(cur??"")?" selected":""}>${esc(txt)}</option>`).join("");
  /* La valeur de la règle reste proposée même si elle n'est plus dans les choix (ligne clôturée, poche vidée) ; liste vide : invite. */
  const liste=(list,cur,txt,videTxt)=>{
    let L=(list||[]).slice();
    if(cur!=null&&cur!==""&&!L.some(([x])=>String(x)===String(cur))) L.push([cur,txt||cur]);
    return L.length?L:[["",videTxt]];
  };
  const nombre=(id,champ,label,attrs,ph)=>`<label id="${id}L"${cache(champ)}>${label}<input id="${id}" type="number" ${attrs} placeholder="${ph}" value="${esc(v[champ]??"")}"></label>`;
  return `<form id="ruleForm" class="rg-form" autocomplete="off" novalidate aria-label="${o.edition?"Modifier la règle":"Ajouter une règle"}">`+
    `<label class="rg-large">Type de règle<select id="rfType">${opts(Object.keys(T).map(k=>[k,T[k].label]),type)}</select></label>`+
    `<label id="rfBlocL"${cache("bloc")}>Poche<select id="rfBloc">${opts(liste((ch.blocs||[]).map(x=>[x,x]),v.bloc,null,"Aucune poche"),v.bloc)}</select></label>`+
    `<label id="rfPosL"${cache("position_id")}>Ligne cotée<select id="rfPos">${opts(liste(ch.positions,v.position_id,"Ligne "+v.position_id,"Aucune ligne cotée"),v.position_id)}</select></label>`+
    `<label id="rfEnvL"${cache("envelope")}>Enveloppe<select id="rfEnv">${opts(liste((ch.envs||[]).map(x=>[x,x]),v.envelope,null,"Aucune enveloppe"),v.envelope)}</select></label>`+
    nombre("rfPct","pct","Pourcentage (%)",'step="any" min="0" max="100" inputmode="decimal"',"ex. 15")+
    nombre("rfPrice","price","Seuil de cours (€)",'step="any" min="0" inputmode="decimal"',"ex. 170")+
    nombre("rfCap","cap","Plafond (€)",'step="any" min="0" inputmode="decimal"',"ex. 22950")+
    nombre("rfDays","days","Jours sans cours",'step="1" min="1" inputmode="numeric"',"ex. 4")+
    `<div class="rg-actions"><button class="rg-btn" type="submit" id="rfBtn">${o.edition?"Enregistrer les modifications":"Ajouter la règle"}</button></div>`+
    `<p class="rg-pmsg" id="rfMsg" aria-live="polite"></p></form>`;
}
const NIVEAU={crit:"Urgent",warn:"À surveiller",info:"Information"};
/** Panneau d'une règle : état, alertes du moment, formulaire de modification, suppression. */
function reglePanneauHtml(res,formHtml){
  const alertes=res.actif&&res.alertes.length?'<ul class="rg-p-alertes">'+res.alertes.map(a=>`<li class="${esc(a.level)}"><span class="rg-p-niv">${esc(NIVEAU[a.level]||"Alerte")}</span><b>${esc(a.title)}</b> ${esc(a.text)}</li>`).join("")+"</ul>":"";
  return `<div class="rg-p"><div class="rg-p-tete"><span class="ui-badge ${res.actif?"bon":"neutre"}">${res.actif?"Active":"Inactive"}</span></div>`+
    `<p class="rg-p-texte">${esc(res.texte)}</p>`+
    `<p class="rg-p-etat ${esc(res.ton)}">${esc(res.actif?res.etat:"Inactive : elle ne déclenche aucune alerte. Réactivez-la avec la bascule de sa carte.")}</p>`+alertes+
    `<h3 class="rg-p-h">Modifier la règle</h3>${formHtml}`+
    `<div class="rg-p-suppr"><button type="button" class="rg-btn danger" data-rg-suppr>Supprimer la règle</button></div></div>`;
}
/** Panneau du matelas : cible actuelle, épargne disponible, méthode, formulaire (la bascule de mode est posée après insertion dans #cuMode). */
function matelasPanneauHtml(cushion,res,badgeHtml){
  const c=cushion||{}, mois=c.mode==="months";
  const champ=(id,label,attrs,ph,val,cache)=>`<label id="${id}L"${cache?" hidden":""}>${label}<input id="${id}" type="number" ${attrs} placeholder="${ph}" value="${esc(val??"")}"></label>`;
  return `<div class="rg-p"><div class="rg-p-tete"><span class="rg-p-val">${esc(res.valeur)}</span>${badgeHtml||""}</div>`+
    `<p class="rg-p-sous">${esc(res.sous)}</p>`+
    `<p class="rg-p-intro">L'épargne disponible est celle de la poche « Épargne » du foyer (livrets, comptes). Exprimée en mois de dépenses, la cible vaut le nombre de mois multiplié par vos dépenses mensuelles, sans plafond.</p>`+
    `<h3 class="rg-p-h">Régler la cible</h3>`+
    `<form id="cushForm" class="rg-form" autocomplete="off" novalidate aria-label="Matelas de précaution">`+
      `<div class="rg-large rg-champ"><span class="rg-lbl">Cible exprimée</span><div id="cuMode"></div></div>`+
      champ("cuMin","Minimum (€)",'step="any" min="0" inputmode="decimal"',"ex. 15000",c.min,mois)+
      champ("cuMax","Maximum (€)",'step="any" min="0" inputmode="decimal"',"ex. 20000",c.max,mois)+
      champ("cuMonths","Nombre de mois",'step="any" min="0" inputmode="decimal"',"ex. 6",c.months,!mois)+
      champ("cuDep","Dépenses mensuelles (€)",'step="any" min="0" inputmode="decimal"',"ex. 2500",c.depenses,!mois)+
      `<div class="rg-actions"><button class="rg-btn" type="submit" id="cuBtn">Enregistrer le matelas</button></div>`+
      `<p class="rg-pmsg" id="cuMsg" aria-live="polite"></p></form></div>`;
}

const PURE={estActive,resumeRegle,compteRegles,basculerRegle,regleDepuisSaisie,epargneDisponible,resumeMatelas,questionPage,questionRegle,questionMatelas,
  carteRegleHtml,listeHtml,formRegleHtml,reglePanneauHtml,matelasPanneauHtml};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
let S={scope:"foyer",people:[],positions:[],config:null,status:null,db:null};
let root=null,dirty=true;
let ouvert=null; // panneau ouvert : { genre: "regle" | "ajout" | "matelas", index?, regle? }
const sig={liste:"",matelas:"",claude:""};
const $=id=>root.querySelector("#"+id);
const U=()=>window.UI||null;
const R=()=>window.Rules||null;
const today=()=>new Date().toISOString().slice(0,10);
function ruleCtx(){ return {positions:S.positions,config:S.config||{},scope:S.scope,people:S.people,today:today(),status:S.status}; }
const rulesOf=()=>(S.config&&Array.isArray(S.config.rules))?S.config.rules:[];
const ecrire=(id,cle,h)=>{ if(sig[cle]!==h){ sig[cle]=h; $(id).innerHTML=h; } };
const erreurTexte=(e,quoi)=>e&&e.code==="invalid_argument"?"Enregistrement refusé : vous n'avez pas les droits d'écriture.":(quoi||"Enregistrement impossible")+" ("+((e&&e.code)||"erreur")+"). Réessayez.";
function annoncer(t){ const m=$("rgMsg"); if(m) m.textContent=t||""; }

/* Choix des formulaires : poches, enveloppes et lignes cotées des placements (et poches des cibles d'allocation). */
function choix(){
  const ps=[...S.positions].filter(p=>p.status!=="clôturé").sort((a,b)=>(a.envelope+a.name).localeCompare(b.envelope+b.name,"fr"));
  const envs=[...new Set(S.positions.map(p=>p.envelope))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"fr"));
  const tg=(S.config&&S.config.targets)||{};
  const blocs=[...new Set([...S.positions.map(p=>p.bloc),...(S.people||[]).flatMap(p=>Object.keys(tg[p.id]||{}))])].filter(Boolean).sort((a,b)=>a.localeCompare(b,"fr"));
  return {blocs,envs,positions:ps.filter(p=>p.mode==="market").map(p=>[p.id,p.name+(p.price!=null?" · "+eur2(p.price):"")])};
}

function render(){
  const rules=rulesOf(), u=U(), Rl=R(), C=window.Calc, ctx=ruleCtx();
  $("ruleCount").textContent=compteRegles(rules);
  if(u) ecrire("rgClaude","claude",u.demanderAClaude(questionPage(rules,ctx,Rl)));
  const items=rules.map((r,i)=>({i,res:resumeRegle(r,ctx,Rl)}));
  const sigL=JSON.stringify(items.map(x=>[x.res.titre,x.res.texte,x.res.actif,x.res.etat,x.res.ton]));
  if(sigL!==sig.liste){
    const avant=$("ruleList").querySelector("[data-ui-voirplus]"), deplie=!!avant&&avant.getAttribute("aria-expanded")==="true";
    sig.liste=sigL; $("ruleList").innerHTML=listeHtml(items,u);
    const apres=deplie&&$("ruleList").querySelector("[data-ui-voirplus]"); if(apres) apres.click(); // « Voir plus » reste déplié
  }
  if(u&&C){ const m=resumeMatelas(S.config,epargneDisponible(S.positions,C),C);
    ecrire("rgMatelas","matelas",'<div class="rg-cartes">'+u.carte({id:"matelas",titre:"Cible du matelas",valeur:m.valeur,sous:m.sous,badge:m.badge})+"</div>"); }
}

/* ---------- focus ---------- */
function focusCarte(i){
  const b=root.querySelector('[data-rg-ouvrir="'+i+'"]');
  if(!b){ const a=$("rgAjouter"); if(a) a.focus(); return; }
  if(b.closest("[hidden]")){ const vp=$("ruleList").querySelector("[data-ui-voirplus]"); if(vp&&vp.getAttribute("aria-expanded")!=="true") vp.click(); }
  b.focus();
}
/* Fermeture d'un panneau : UI rend le focus à l'élément d'origine ; s'il a été redessiné, à la carte équivalente. */
function fermeture(o){
  const p=ouvert; ouvert=null;
  if((o&&o.focus===false)||!root||!p) return;
  if(p.retour&&p.retour.isConnected) return;
  if(p.genre==="matelas"){ const c=root.querySelector('[data-ui-carte="matelas"]'); if(c) c.focus(); }
  else if(p.genre==="regle") focusCarte(p.index);
  else { const a=$("rgAjouter"); if(a) a.focus(); }
}
function fermerPanneau(){ const u=U(); ouvert=null; if(u&&u.panneau.ouvert()) u.panneau.fermer({focus:false}); }

/* ---------- écritures ---------- */
/* Toutes les modifications de la liste passent par ici : config/main ← { rules } ; la vue suit tout de suite, sans attendre le store. */
async function ecrireRegles(rules){
  await S.db.doc("config/main").update({rules});
  S.config=Object.assign({},S.config||{},{rules});
  render();
}
/* Index courant d'une règle ouverte en panneau (la liste a pu changer depuis) : -1 si elle n'existe plus telle quelle. */
function indexDe(p){
  const L=rulesOf(), j=JSON.stringify(p.regle);
  if(p.index!=null&&JSON.stringify(L[p.index])===j) return p.index;
  return L.findIndex(r=>JSON.stringify(r)===j);
}
async function basculer(i){
  const Rl=R(); if(!Rl) return;
  if(!S.db){ annoncer("Base indisponible dans cette vue."); return; }
  const rules=basculerRegle(rulesOf(),i), r=rules[i]; if(!r) return;
  const b0=root.querySelector('[data-rg-bascule="'+i+'"]'); if(b0) b0.disabled=true;
  try{ await ecrireRegles(rules); annoncer((estActive(r)?"Règle réactivée : ":"Règle désactivée : ")+Rl.describe(r,ruleCtx())+"."); }
  catch(e){ annoncer(erreurTexte(e,"Modification impossible")); }
  const b=root.querySelector('[data-rg-bascule="'+i+'"]');
  if(b){ b.disabled=false; if(b.closest("[hidden]")) focusCarte(i); b.focus(); }
}

/* ---------- panneaux ---------- */
function brancherFormRegle(corps,p){
  const Rl=R(), f=corps.querySelector("#ruleForm"), sel=corps.querySelector("#rfType");
  let type=Rl.TYPES[p.regle&&p.regle.type]?p.regle.type:"max_line_pct";
  const msg=(t,ton)=>{ const m=corps.querySelector("#rfMsg"); m.textContent=t; m.className="rg-pmsg"+(ton?" "+ton:""); };
  const champs=()=>{ const need=Rl.TYPES[type].fields;
    [["rfPctL","pct"],["rfBlocL","bloc"],["rfPosL","position_id"],["rfEnvL","envelope"],["rfPriceL","price"],["rfCapL","cap"],["rfDaysL","days"]].forEach(([id,k])=>{ const l=corps.querySelector("#"+id); if(l) l.hidden=!need.includes(k); }); };
  sel.addEventListener("change",()=>{ if(Rl.TYPES[sel.value]) type=sel.value; champs(); msg(""); });
  f.addEventListener("submit",async ev=>{
    ev.preventDefault();
    if(!S.db) return msg("Base indisponible dans cette vue.","err");
    const val=id=>{ const el=corps.querySelector("#"+id); return el?el.value:""; };
    const raw={type,pct:val("rfPct"),bloc:val("rfBloc"),position_id:val("rfPos"),envelope:val("rfEnv"),price:val("rfPrice"),cap:val("rfCap"),days:val("rfDays")};
    const n=regleDepuisSaisie(raw,p.regle||null,Rl); if(n.error) return msg(n.error,"err");
    const rules=rulesOf().slice(); let cible;
    if(p.genre==="regle"){ cible=indexDe(p); if(cible<0) return msg("Cette règle a changé entre-temps : fermez le panneau et rouvrez-la.","err"); rules[cible]=n.rule; }
    else { rules.push(n.rule); cible=rules.length-1; }
    const btn=corps.querySelector("#rfBtn"); btn.disabled=true; msg("Enregistrement…");
    try{
      await ecrireRegles(rules);
      fermerPanneau();
      annoncer((p.genre==="regle"?"Règle modifiée : ":"Règle ajoutée : ")+Rl.describe(n.rule,ruleCtx())+".");
      focusCarte(cible);
    }catch(e){ btn.disabled=false; msg(erreurTexte(e),"err"); }
  });
  const suppr=corps.querySelector("[data-rg-suppr]");
  if(suppr) suppr.addEventListener("click",async()=>{
    if(!S.db) return msg("Base indisponible dans cette vue.","err");
    if(!suppr.hasAttribute("data-arme")){ suppr.setAttribute("data-arme",""); suppr.textContent="Confirmer la suppression"; msg("Cliquez à nouveau pour supprimer définitivement cette règle."); return; }
    const i=indexDe(p); if(i<0) return msg("Cette règle a changé entre-temps : fermez le panneau et rouvrez-la.","err");
    suppr.disabled=true;
    try{
      await ecrireRegles(rulesOf().filter((_,j)=>j!==i));
      fermerPanneau(); annoncer("Règle supprimée.");
      const n=rulesOf().length; focusCarte(n?Math.min(i,n-1):-1);
    }catch(e){ suppr.disabled=false; msg(erreurTexte(e,"Suppression impossible"),"err"); }
  });
}
function ouvrirRegle(i,el){
  const u=U(), Rl=R(), r=rulesOf()[i]; if(!u||!Rl||!r) return;
  const res=resumeRegle(r,ruleCtx(),Rl);
  ouvert={genre:"regle",index:i,regle:JSON.parse(JSON.stringify(r)),retour:el||null};
  const corps=u.panneau.ouvrir({titre:res.titre,contenu:reglePanneauHtml(res,formRegleHtml({type:r.type,regle:r,choix:choix(),edition:true},Rl)),
    pied:u.demanderAClaude(questionRegle(res)),retour:el||undefined,surFermeture:fermeture});
  if(corps) brancherFormRegle(corps,ouvert);
}
function ouvrirAjout(el){
  const u=U(), Rl=R(); if(!u||!Rl) return;
  ouvert={genre:"ajout",retour:el||null};
  const corps=u.panneau.ouvrir({titre:"Ajouter une règle",
    contenu:'<div class="rg-p"><p class="rg-p-intro">Choisissez le type de règle, puis son seuil. Une alerte apparaîtra dans Aujourd\'hui dès que la règle sera franchie.</p>'+formRegleHtml({type:"max_line_pct",choix:choix(),edition:false},Rl)+"</div>",
    pied:u.demanderAClaude(questionPage(rulesOf(),ruleCtx(),Rl)),retour:el||undefined,surFermeture:fermeture});
  if(corps) brancherFormRegle(corps,ouvert);
}
function ouvrirMatelas(el){
  const u=U(), C=window.Calc; if(!u||!C) return;
  const c=(S.config&&S.config.cushion)||{}, res=resumeMatelas(S.config,epargneDisponible(S.positions,C),C);
  let mode=c.mode==="months"?"months":"amount";
  ouvert={genre:"matelas",retour:el||null};
  const badge=res.badge?'<span class="ui-badge '+esc(res.badge.ton)+'">'+esc(res.badge.texte)+"</span>":"";
  const corps=u.panneau.ouvrir({titre:"Épargne de précaution",contenu:matelasPanneauHtml(c,res,badge),pied:u.demanderAClaude(questionMatelas(res)),
    retour:el||undefined,surFermeture:fermeture});
  if(!corps) return;
  const q=id=>corps.querySelector("#"+id);
  const msg=(t,ton)=>{ const m=q("cuMsg"); m.textContent=t; m.className="rg-pmsg"+(ton?" "+ton:""); };
  const champs=()=>{ const m=mode==="months"; ["cuMinL","cuMaxL"].forEach(id=>{ q(id).hidden=m; }); ["cuMonthsL","cuDepL"].forEach(id=>{ q(id).hidden=!m; }); };
  u.bascule(q("cuMode"),{label:"Cible exprimée",options:[{id:"amount",label:"En montant"},{id:"months",label:"En mois de dépenses"}],actif:mode,surChange:id=>{ mode=id; champs(); msg(""); }});
  const numv=id=>{ const v=q(id).value; return v===""?null:Number(v); };
  q("cushForm").addEventListener("submit",async ev=>{
    ev.preventDefault();
    if(!S.db) return msg("Base indisponible dans cette vue.","err");
    let cushion;
    if(mode==="months"){ const mo=numv("cuMonths"), dep=numv("cuDep"); if(!(mo>0)||!(dep>0)) return msg("Indiquez un nombre de mois et des dépenses mensuelles positifs.","err"); cushion={mode:"months",months:mo,depenses:dep}; }
    else { const mi=numv("cuMin"), ma=numv("cuMax"); if(mi==null||mi<0) return msg("Indiquez un montant minimum.","err"); if(ma!=null&&ma<mi) return msg("Le maximum doit être supérieur au minimum.","err"); cushion={mode:"amount",min:mi,max:ma}; }
    const btn=q("cuBtn"); btn.disabled=true; msg("Enregistrement…");
    try{
      await S.db.doc("config/main").update({cushion});
      S.config=Object.assign({},S.config||{},{cushion}); render();
      fermerPanneau(); annoncer("Matelas enregistré.");
      const carte=root.querySelector('[data-ui-carte="matelas"]'); if(carte) carte.focus();
    }catch(e){ btn.disabled=false; msg("Enregistrement impossible ("+((e&&e.code)||"erreur")+").","err"); }
  });
}

function mount(r){
  root=r;
  const u=U();
  if(u) u.brancher(root,{surCarte:(id,el)=>{ if(id==="matelas"){ annoncer(""); ouvrirMatelas(el); } }});
  root.addEventListener("click",ev=>{
    const t=ev.target; if(!t||!t.closest) return;
    const b=t.closest("[data-rg-bascule]"); if(b&&root.contains(b)){ basculer(+b.getAttribute("data-rg-bascule")); return; }
    const o=t.closest("[data-rg-ouvrir]"); if(o&&root.contains(o)){ annoncer(""); ouvrirRegle(+o.getAttribute("data-rg-ouvrir"),o); return; }
    const a=t.closest("#rgAjouter"); if(a){ annoncer(""); ouvrirAjout(a); }
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
