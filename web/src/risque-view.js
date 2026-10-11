(function(){
/* Pilotage › Risque — « Mon portefeuille correspond-il à mon profil ? ».
   En haut : verdict en une phrase (profil déclaré vs profil équivalent du portefeuille) et une ligne sur l'allocation,
   « Refaire le questionnaire », « Le revoir avec Claude » ; bascule « Compter mon immobilier » si un bien est renseigné.
   Trois cartes (UI.carte) → panneau (UI.panneau) : profil déclaré (description, score, garde-fous, réponses),
   comportement du portefeuille et perte plausible (volatilité, baisse plausible, pire baisse, méthode).
   Barres d'allocation par classe avec la fourchette du profil ; accordéons fermés : d'où vient le risque, méthode,
   classement des poches. Sans profil : invitation au questionnaire.
   Questionnaire dans le panneau, une question à la fois : étapes, Précédent / Suivant, résumé des réponses avec le profil
   obtenu, puis « Enregistrer mon profil ». Clavier : ↑ ↓ ou 1 à 9 pour choisir, Entrée pour continuer, Échap ferme
   (les réponses restent dans le brouillon).
   Calculs : Risque (risque.js : evaluer, synthese, ecarts), Marche (marche.js : classeRisque, CLASSES), Calc, Plan (budget).
   Écritures : Store.db.doc("profil/main").update({risque}) à l'enregistrement du questionnaire, update({classes}) pour les poches.
   Le brouillon des réponses vit dans localStorage (« risque-brouillon ») jusqu'à l'enregistrement.
   Fonctions pures exportées pour les tests (module.exports) : prerempli, valeurPreremplie, valide, basculer, effectives,
   geometrie, fpct, ecartNiveaux, horsFourchette, verdict, etape, premiereEtape, libelleReponse, resume, questionClaude. */

/* ---------- logique pure ---------- */
const nb=v=>v!==null&&v!==undefined&&v!==""&&isFinite(+v);
/** Valeurs préremplies depuis l'état : matelas (mois de dépenses, comme le Bilan : poche « Épargne » ÷ dépenses du budget,
    sinon dépenses de la cible de matelas en mois) et tranche d'âge de Compte › Données. deps = { Calc, Plan }. */
function prerempli(S,deps){
  const s=S||{},d=deps||{},C=d.Calc,P=d.Plan,scope=s.scope||"foyer",out={matelasMois:null,age:null};
  const age=s.profil&&s.profil.foyer&&s.profil.foyer.age; if(age) out.age=String(age);
  if(C&&P&&typeof P.budgetTotaux==="function"){
    try{
      const lignes=s.budget&&Array.isArray(s.budget.lignes)?s.budget.lignes:[];
      const t=P.budgetTotaux(lignes,s.profil,scope), m=C.matelas(s.config);
      const dep=t.depensesLignes>0?t.depenses:m&&m.mode==="months"&&m.depenses>0?m.depenses:0;
      if(dep>0) out.matelasMois=C.poche(s.positions||[],scope,"Épargne")/dep;
    }catch(e){ /* budget illisible : pas de prérempli */ }
  }
  return out;
}
/** Réponse préremplie d'une question (valeur au format de la question) ou undefined. */
function valeurPreremplie(q,pre){
  if(!q||!q.prerempli||!pre) return undefined;
  if(q.prerempli==="matelas"&&nb(pre.matelasMois)) return +pre.matelasMois>=3?"oui":"non";
  if(q.prerempli==="age"&&pre.age&&q.options.some(o=>o.v===pre.age)) return pre.age;
  return undefined;
}
/** Réponse exploitable ? choix : une option connue ; multi : au moins une case connue ; nombre : entier ≥ 0. */
function valide(q,v){
  if(!q||v===undefined||v===null||v==="") return false;
  if(q.type==="multi") return Array.isArray(v)&&v.some(x=>q.options.some(o=>o.v===x));
  if(q.type==="nombre") return nb(v)&&+v>=0;
  return q.options.some(o=>o.v===String(v));
}
/** Coche / décoche une case d'une question multiple ; une option « exclusif » (Aucun) efface les autres et inversement. */
function basculer(q,valeurs,v){
  const cur=Array.isArray(valeurs)?valeurs.slice():[], o=q.options.find(x=>x.v===v);
  if(!o) return cur;
  if(cur.includes(v)) return cur.filter(x=>x!==v);
  if(o.exclusif) return [v];
  const excl=q.options.filter(x=>x.exclusif).map(x=>x.v);
  return cur.filter(x=>!excl.includes(x)).concat(v);
}
/** Réponses effectives : brouillon, complété par le prérempli pour les questions sans réponse. */
function effectives(questions,reponses,pre){
  const out={};
  (questions||[]).forEach(q=>{
    const r=reponses&&reponses[q.id];
    const v=valide(q,r)?r:valeurPreremplie(q,pre);
    if(v!==undefined) out[q.id]=v;
  });
  return out;
}
/** Géométrie d'une barre double sur une échelle 0-100 % : fourchette cible (bande) et réel (barre), bornés à l'échelle. */
function geometrie(min,max,reel){
  const c=x=>Math.max(0,Math.min(100,+x||0));
  const a=c(Math.min(min,max)),b=c(Math.max(min,max));
  return {bandeGauche:a,bandeLargeur:b-a,reel:c(reel)};
}
/** Pourcentage à la française : « 43,7 % » (dec décimales, zéros inutiles retirés), signe − typographique. */
function fpct(x,dec){
  if(!nb(x)) return "—";
  const v=+x, f=Math.abs(v).toFixed(dec==null?1:dec), s=(f.includes(".")?f.replace(/\.?0+$/,""):f).replace(".",",");
  return (v<0&&s!=="0"?"−":"")+s+" %";
}
/** Écart en niveaux entre le profil équivalent du portefeuille et le profil déclaré (rang dans PROFILS) ; null si l'un manque. */
function ecartNiveaux(profils,declId,eqId){
  const ids=(profils||[]).map(p=>p.id), a=ids.indexOf(declId), b=ids.indexOf(eqId);
  return a<0||b<0?null:b-a;
}
/** Nombre de classes hors de la fourchette du profil (résultat de Risque.ecarts). */
const horsFourchette=ecarts=>(ecarts||[]).filter(e=>e&&e.statut!=="dans").length;
/** Verdict de la page en une phrase. o = { declare: {id,label}|null, equivalent: {id,label}|null, ecarts }, profils = Risque.PROFILS.
    → { phrase, ton (ok · warn · crit · ""), ecart (niveaux, null si non comparable), allocation (phrase sur les fourchettes, ou "") }. */
function verdict(o,profils){
  const d=o&&o.declare, e=o&&o.equivalent, k=d&&e?ecartNiveaux(profils,d.id,e.id):null;
  const h=horsFourchette(o&&o.ecarts), n=(o&&o.ecarts||[]).length;
  const allocation=d&&n?(h?h+" classe"+(h>1?"s":"")+" sur "+n+" hors de la fourchette du profil "+d.label+".":"Chaque classe est dans la fourchette du profil "+d.label+"."):"";
  if(!d) return {phrase:"Votre profil de risque n'est pas encore défini : répondez au questionnaire pour comparer votre portefeuille à ce que vous pouvez supporter.",ton:"",ecart:null,allocation:""};
  if(!e) return {phrase:"Aucun placement à comparer à votre profil "+d.label+" pour le moment.",ton:"",ecart:null,allocation:""};
  if(k===0) return {phrase:"Oui : votre portefeuille se comporte comme un profil "+e.label+", conforme à votre profil.",ton:"ok",ecart:0,allocation};
  if(k>0) return {phrase:"Non : votre portefeuille se comporte comme un profil "+e.label+", alors que votre profil est "+d.label+" ; il prend plus de risque que vous ne le souhaitez.",ton:"crit",ecart:k,allocation};
  return {phrase:"Pas tout à fait : votre portefeuille se comporte comme un profil "+e.label+", alors que votre profil est "+d.label+" ; il prend moins de risque que votre profil ne le permet.",ton:"warn",ecart:k,allocation};
}
/** Étape i du questionnaire (0 … n-1 : questions, n : résumé avant enregistrement), i borné.
    → { type: "question" | "resume", index, numero, total, question, premier, suivant: { action, label } }. */
function etape(questions,i){
  const L=questions||[], n=L.length, j=Math.max(0,Math.min(n,Math.floor(+i)||0));
  if(j===n) return {type:"resume",index:n,numero:n,total:n,question:null,premier:n===0,suivant:{action:"enregistrer",label:"Enregistrer mon profil"}};
  return {type:"question",index:j,numero:j+1,total:n,question:L[j],premier:j===0,suivant:{action:"suivant",label:j===n-1?"Voir le résumé":"Suivant"}};
}
/** Première étape à montrer : la première question sans réponse effective, sinon le résumé. */
function premiereEtape(questions,reponses,pre){
  const L=questions||[], e=effectives(L,reponses,pre), i=L.findIndex(q=>!valide(q,e[q.id]));
  return i<0?L.length:i;
}
/** Libellé lisible d'une réponse : option choisie, cases cochées, ou « 5 ans (5 à 9 ans) ». "" si aucune réponse valide. */
function libelleReponse(q,v){
  if(!valide(q,v)) return "";
  if(q.type==="multi") return q.options.filter(o=>v.includes(o.v)).map(o=>o.label).join(", ");
  if(q.type==="nombre"){ const x=Math.round(+v), o=q.options.filter(op=>x>=op.min).pop(); return x+" an"+(x>1?"s":"")+(o?" ("+o.label.charAt(0).toLowerCase()+o.label.slice(1)+")":""); }
  const o=q.options.find(x=>x.v===String(v)); return o?o.label:"";
}
/** Résumé avant enregistrement : une ligne par question { id, theme, texte, reponse, prerempli, manque }. */
function resume(questions,reponses,pre){
  return (questions||[]).map(q=>{
    const r=reponses&&reponses[q.id], explicite=valide(q,r), v=explicite?r:valeurPreremplie(q,pre);
    return {id:q.id,theme:q.theme,texte:q.texte,reponse:libelleReponse(q,v),prerempli:!explicite&&v!==undefined,manque:!valide(q,v)};
  });
}
/** Question préremplie de « Demander à Claude », selon le verdict. */
function questionClaude(o){
  const d=o&&o.declare, e=o&&o.equivalent;
  if(!d) return "Aide-moi à définir mon profil de risque dans Boussole : pose-moi les questions une à une et explique-moi pourquoi chacune compte.";
  if(!e) return "Mon profil de risque dans Boussole est "+d.label+" : explique-moi ce qu'il implique pour la répartition de mes placements.";
  const k=ecartNiveaux(o.profils,d.id,e.id);
  if(k===0) return "Dans Boussole, mon portefeuille se comporte comme un profil "+e.label+", conforme à mon profil "+d.label+" : qu'est-ce que je dois surveiller pour le rester ?";
  return "Dans Boussole, mon portefeuille se comporte comme un profil "+e.label+" alors que mon profil est "+d.label+" : explique-moi l'écart et comment le réduire progressivement.";
}
const PURE={prerempli,valeurPreremplie,valide,basculer,effectives,geometrie,fpct,ecartNiveaux,horsFourchette,verdict,etape,premiereEtape,libelleReponse,resume,questionClaude};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
const BROUILLON="risque-brouillon";
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null,risque:null,classes:{}};
/* avecImmo : profil de risque calculé sur les actifs financiers, hors résidence, sauf si l'utilisateur compte son immobilier
   (pratique usuelle, cohérent avec Bonnes pratiques). panneau : null | "quiz" | "declare" | "risque". */
let root=null,dirty=true,pmsg="",draft={reponses:{},i:0},avecImmo=false,msg="",avance=null,panneau=null,corps=null,retourPanneau=null,occupe=false;
const sig={main:"",classes:""};
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const eur=v=>nf.format(Math.round(v))+" €";
const R=()=>window.Risque||null, M=()=>window.Marche||null, U=()=>window.UI||null;
const QS=()=>(R()&&R().QUESTIONS)||[];
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

/* Pourquoi chaque question (une phrase, affichée sous la question). */
const POURQUOI={
  horizon:"Plus l'échéance est lointaine, plus une baisse a le temps d'être rattrapée.",
  objectif:"Le rendement que vous visez fixe la part de risque utile.",
  reaction:"Vendre au plus bas transforme une baisse temporaire en perte définitive.",
  perte_max:"Elle fixe la baisse que votre portefeuille ne devrait pas dépasser.",
  connaissances:"On garde sereinement ce que l'on comprend, même quand ça baisse.",
  experience:"Avoir déjà traversé des baisses aide à les supporter.",
  revenus:"Des revenus stables évitent de devoir vendre pendant une baisse.",
  matelas:"Sans réserve, un imprévu oblige à vendre au mauvais moment.",
  part_investie:"Elle mesure la place que vous acceptez de donner au risque.",
  age:"L'âge renseigne sur l'horizon et le temps pour se refaire après une baisse.",
};
/* Questions dont l'aide de risque.js redit le « pourquoi » : on ne l'affiche pas deux fois. */
const AIDE_REDONDANTE=["horizon","revenus"];
/* Raison courte de chaque garde-fou, pour « Plafonné à Modéré : horizon de moins de 2 ans ». */
function raison(g,ev){
  if(g.cle==="horizon") return "horizon de moins de 2 ans";
  if(g.cle==="matelas") return "moins de 3 mois de dépenses de côté";
  if(g.cle==="connaissances") return "actions et ETF non connus";
  if(g.cle==="perte_max"){ const d=(ev.details||[]).find(x=>x.id==="perte_max"), q=QS().find(x=>x.id==="perte_max"), o=q&&d&&q.options.find(x=>x.v===d.valeur); return "baisse acceptée de "+(o&&o.perte!=null?o.perte+" %":"…")+" au plus"; }
  return g.cle;
}
const profilDe=id=>(R()&&R().PROFILS.find(p=>p.id===id))||null;
const labelProfil=id=>{ const p=profilDe(id); return p?p.label:id; };
const CHEVRON='<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';

/* ---------- brouillon ---------- */
function lireBrouillon(){
  try{ const d=JSON.parse(localStorage.getItem(BROUILLON)||"null"); if(d&&typeof d==="object"&&d.reponses&&typeof d.reponses==="object") return {reponses:d.reponses,i:Math.max(0,+d.i||0)}; }catch(e){}
  return {reponses:{},i:0};
}
function ecrireBrouillon(){ try{ localStorage.setItem(BROUILLON,JSON.stringify(draft)); }catch(e){} }
function effacerBrouillon(){ try{ localStorage.removeItem(BROUILLON); }catch(e){} }

/* ---------- contexte de calcul ---------- */
const pre=()=>prerempli(S,{Calc:window.Calc,Plan:window.Plan});
const immoPhysique=()=>{ try{ return window.Calc.immobilier(S.profil,S.scope); }catch(e){ return 0; } };
function ctx(immo){ const p=pre(); return {positions:S.positions,scope:S.scope,surcharge:S.classes||{},immobilierPhysique:immo?immoPhysique():0,matelasMois:p.matelasMois,age:p.age}; }
const repondues=()=>{ const e=effectives(QS(),draft.reponses,pre()); return QS().filter(q=>valide(q,e[q.id])).length; };

/* Synthèse affichée : celle de Risque.synthese, avec les écarts et la comparaison rapportés au profil ENREGISTRÉ
   (il peut différer d'un recalcul si le prérempli a changé depuis). */
function etat(){
  const rq=S.risque&&S.risque.profil?S.risque:null, decl=rq?profilDe(rq.profil):null;
  const sa=R().synthese(rq?rq.reponses||{}:{},ctx(avecImmo));
  if(decl&&sa.profil&&sa.profil.id!==decl.id) sa.ecarts=R().ecarts(decl.id,sa.allocation);
  if(rq&&!decl) sa.ecarts=[];
  const eq=sa.risque.profilEquivalent?profilDe(sa.risque.profilEquivalent):null;
  const v=verdict({declare:decl,equivalent:eq,ecarts:decl?sa.ecarts:[]},R().PROFILS);
  return {rq,decl,sa,eq,v};
}

/* ---------- rendu de la page ---------- */
function render(){
  if(!root) return;
  const ok=!!(R()&&window.Calc&&U());
  if(!ok){ $("rvMain").innerHTML='<p class="muted">Le calcul du profil n\'est pas disponible dans cette vue.</p>'; $("rvClasses").hidden=true; sig.main=""; return; }
  const E=etat();
  const h=E.rq?resultatHtml(E):introHtml(E);
  if(h!==sig.main){
    const actif=root.contains(document.activeElement)?document.activeElement:null, cle=actif&&actif.getAttribute&&(actif.getAttribute("data-rv")||actif.getAttribute("data-ui-carte"));
    sig.main=h; $("rvMain").innerHTML=h;
    brancherImmo();
    /* Le focus était sur un bouton ou une carte redessinés : on le rend au même élément. */
    if(cle&&actif&&!actif.isConnected){ const n=root.querySelector('[data-rv="'+CSS.escape(cle)+'"]')||root.querySelector('[data-ui-carte="'+CSS.escape(cle)+'"]'); if(n) n.focus(); }
  }
  $("rvClasses").hidden=false;
  renderClasses();
}

function brancherImmo(){
  const b=$("rvImmo"), u=U(); if(!b||!u) return;
  u.bascule(b,{label:"Compter mon immobilier",options:[{id:"non",label:"Placements seuls"},{id:"oui",label:"Avec mon immobilier"}],actif:avecImmo?"oui":"non",
    surChange:id=>{ avecImmo=id==="oui"; render(); const n=$("rvImmo"); const r=n&&n.querySelector('[aria-checked="true"]'); if(r) r.focus(); }});
}
const immoHtml=()=>immoPhysique()>0?`<div class="rv-immo"><span class="rv-immo-l" id="rvImmoL">Compter mon immobilier</span><div id="rvImmo"></div></div>`:"";

function cartesHtml(E){
  const u=U(), r=E.sa.risque, total=E.sa.allocation.total, out=[];
  if(E.decl){
    const ev=E.sa.evaluation, gf=(ev.gardeFous||[]).length&&ev.profilAvantGardeFous!==E.rq.profil;
    const score=nb(E.rq.score)?+E.rq.score:ev.score;
    out.push(u.carte({id:"declare",titre:"Profil déclaré",valeur:E.decl.label,sous:"Score "+(nb(score)?score:"—")+"/100 · perte tolérée "+E.decl.perteMax+" % sur un an",
      badge:gf?{texte:"Plafonné",ton:"attention"}:null}));
  }
  if(E.eq){
    const k=E.v.ecart, b=k==null?null:k===0?{texte:"Conforme",ton:"bon"}:k>0?{texte:"Plus risqué",ton:"critique"}:{texte:"Moins risqué",ton:"attention"};
    out.push(u.carte({id:"equivalent",titre:"Comportement du portefeuille",valeur:E.eq.label,sous:"Volatilité "+fpct(r.volatilite)+" par an",badge:b}));
    out.push(u.carte({id:"perte",titre:"Perte plausible sur un an",valeur:fpct(r.baissePlausible,0),
      sous:(total>0?"≈ −"+eur(total*-r.baissePlausible/100)+" ":"")+"dans une mauvaise année (1 sur 100)"}));
  }
  return out.length?`<div class="ui-cartes rv-cartes">${out.join("")}</div>`:"";
}

function introHtml(E){
  const n=repondues(), total=QS().length, enCours=Object.keys(draft.reponses||{}).length>0;
  return `<section class="panel rv-hero" aria-labelledby="rvTitre">
    <h2 class="label" id="rvTitre">Mon portefeuille correspond-il à mon profil ?</h2>
    <p class="rv-verdict" id="rvVerdict" tabindex="-1">Votre profil de risque n'est pas encore défini.</p>
    <p class="rv-lead">${total} questions, 3 minutes. Ce profil sert à comparer votre portefeuille à ce que vous pouvez supporter.</p>
    <p class="rv-note">Horizon, réaction à une baisse, perte acceptable, connaissances, revenus : inspiré du questionnaire d'adéquation des conseillers (MiFID II). Vos réponses restent modifiables.</p>
    <div class="rv-actions">
      <button type="button" class="rv-btn" data-rv="start" aria-haspopup="dialog">${enCours?"Reprendre le questionnaire ("+n+" / "+total+")":"Commencer le questionnaire"}</button>
      <a class="rv-btn ghost" href="#agent/connexion" data-goto="agent/connexion">Le faire avec Claude</a>
    </div>
    ${enCours?'<button type="button" class="rv-lnk" data-rv="reset">Effacer mes réponses et recommencer</button>':""}
    ${immoHtml()}
  </section>
  ${E.eq?`<p class="rv-sec-t">${esc("Votre portefeuille se comporte aujourd'hui comme un profil "+E.eq.label+" : le questionnaire dira si c'est le risque que vous pouvez supporter.")}</p>`:""}
  ${cartesHtml(E)}
  ${E.eq?accordeonsHtml(E):""}`;
}

function resultatHtml(E){
  const u=U();
  return `<section class="panel rv-hero" aria-labelledby="rvTitre">
    <h2 class="label" id="rvTitre">Mon portefeuille correspond-il à mon profil ?</h2>
    <p class="rv-verdict ${E.v.ton}" id="rvVerdict" tabindex="-1">${esc(E.v.phrase)}</p>
    ${E.v.allocation?`<p class="rv-note">${esc(E.v.allocation)}</p>`:""}
    <div class="rv-actions">
      <button type="button" class="rv-btn ghost" data-rv="refaire" aria-haspopup="dialog">Refaire le questionnaire</button>
      ${u.demanderAClaude(questionClaude({declare:E.decl,equivalent:E.eq,profils:R().PROFILS}),"Le revoir avec Claude")}
    </div>
    ${immoHtml()}
  </section>
  ${cartesHtml(E)}
  ${E.decl?sectionAllocation(E.sa,E.decl):""}
  ${E.eq?accordeonsHtml(E):""}`;
}

function sectionAllocation(sa,decl){
  const alloc=sa.allocation;
  if(!(alloc.total>0)) return `<section class="panel rv-alloc" aria-labelledby="rvAllocT"><h2 class="rv-h2" id="rvAllocT">Allocation par classe</h2>
    <p class="muted">Aucun placement à comparer pour ce périmètre. <a class="rv-a" href="#patrimoine/placements" data-goto="patrimoine/placements">Ajouter des placements</a></p></section>`;
  const ST={dans:"dans la fourchette",sous:"en dessous","au-dessus":"au-dessus"};
  const rows=sa.ecarts.map(e=>{
    const g=geometrie(e.min,e.max,e.reel);
    const ecart=e.statut==="dans"?"":` · écart ${e.ecartPts>0?"+":"−"}${String(Math.abs(Math.round(e.ecartPts*10)/10)).replace(".",",")} pt${Math.abs(e.ecartPts)>=2?"s":""}`;
    return `<div class="rv-arow">
      <div class="rv-ahead"><span class="rv-al">${esc(e.label)}</span><span class="rv-st ${e.statut==="dans"?"ok":"off"}">${ST[e.statut]}</span></div>
      <span class="rv-track" role="img" aria-label="${esc(e.label+" : "+fpct(e.reel)+", cible "+e.min+" à "+e.max+" %, "+ST[e.statut])}">
        <span class="rv-band${g.bandeLargeur?"":" zero"}" style="left:${g.bandeGauche}%;width:${g.bandeLargeur}%"></span>
        <span class="rv-real ${e.statut==="dans"?"ok":"off"}" style="width:${g.reel.toFixed(2)}%"></span>
        <span class="rv-mark" style="left:${g.reel.toFixed(2)}%"></span>
      </span>
      <div class="rv-anum"><b class="num">${fpct(e.reel)}</b> <span class="muted">· cible ${e.min===e.max?e.min+" %":e.min+" à "+e.max+" %"}${ecart}</span></div>
    </div>`;
  }).join("");
  const div=alloc.pct.diversifiants||0;
  return `<section class="panel rv-alloc" aria-labelledby="rvAllocT">
    <h2 class="rv-h2" id="rvAllocT">Allocation par classe</h2>
    <p class="rv-sub">Fourchette du profil ${esc(decl.label)} (bande) et répartition réelle ${esc(scopeDe())} (barre), sur ${eur(alloc.total)}${avecImmo&&immoPhysique()>0?" immobilier compris":""}.</p>
    <div class="rv-arows">${rows}</div>
    <p class="rv-div"><b>${esc((R().GROUPES_LABELS||{}).diversifiants||"Or et autres")}</b> : <span class="num">${fpct(div)}</span> <span class="muted">· à part : ils diversifient sans entrer dans les fourchettes.</span></p>
    <div class="rv-legend"><span><i class="lg-band"></i>fourchette cible</span><span><i class="lg-real"></i>réel dans la fourchette</span><span><i class="lg-off"></i>réel hors fourchette</span></div>
  </section>`;
}

const acc=(titre,contenu,cls)=>`<details class="ui-acc ${cls||""}"><summary class="ui-acc-titre"><span>${esc(titre)}</span><span class="ui-acc-chevron">${CHEVRON}</span></summary><div class="ui-acc-corps">${contenu}</div></details>`;
const METHODE=`<div class="rv-meth"><p>Volatilité du portefeuille à partir de la volatilité historique de chaque classe et de corrélations simplifiées. Baisse plausible : la plus grave de deux estimations, 2,33 volatilités (une année sur 100 avec une loi normale) ou la moitié de la pire baisse historique pondérée, car la loi normale sous-estime les krachs. Profil équivalent : le moins risqué des profils dont la perte tolérée couvre cette baisse.</p>
  <p class="muted">Sources : MSCI, Bloomberg Euro Aggregate, IEIF, LBMA, CoinMarketCap, Banque de France. Ordres de grandeur historiques, pas des prévisions.</p></div>`;
function accordeonsHtml(E){
  const r=E.sa.risque, M_=M();
  const lab=k=>(M_&&M_.CLASSES[k]&&M_.CLASSES[k].label)||(window.Calc.CLASSES_LABELS[k])||k;
  const maxC=Math.max(1,...r.contributions.map(c=>c.contributionPct));
  const contrib=r.contributions.filter(c=>c.contributionPct>=0.05||c.poids>=0.5).map(c=>`<div class="rv-crow">
    <span class="rv-cl" title="${esc(lab(c.classe))}">${esc(lab(c.classe))}</span>
    <span class="rv-ctrack" aria-hidden="true"><span style="width:${(c.contributionPct/maxC*100).toFixed(2)}%"></span></span>
    <span class="num rv-cv">${fpct(c.contributionPct,0)}</span><span class="num rv-cp muted">${fpct(c.poids,0)} du total</span></div>`).join("");
  return `<div class="rv-accs">${acc("D'où vient le risque",`<p class="rv-sub">Part de chaque classe dans la variabilité du portefeuille : une petite ligne très volatile peut peser lourd.</p><div class="rv-crows">${contrib}</div>`)}
    ${acc("Comment c'est calculé",METHODE)}</div>`;
}

/* Rattachement poche → classe : blocs présents dans le périmètre, classe détectée et surcharge enregistrée (profiles.classes). */
const ORDRE_CLASSES=["actions","small_caps","emergents","levier","obligations","fonds_euros","monetaire","immobilier","or","crypto","autres"];
function classeLabel(k){ const M_=M(); return window.Calc.CLASSES_LABELS[k]||(M_&&M_.CLASSES[k]&&M_.CLASSES[k].label)||k; }
function renderClasses(){
  const box=$("rvClassesBody"), M_=M(), sur=S.classes||{};
  const vivantes=(S.positions||[]).filter(p=>window.Calc.inScope(p,S.scope)&&window.Calc.counted(p));
  const blocs=[...new Set(vivantes.map(p=>p.bloc).filter(Boolean))];
  const detecte=(p,s)=>M_?M_.classeRisque(p,s):window.Calc.classe(p.bloc,s);
  let h;
  if(!blocs.length) h='<p class="muted">Aucune poche dans ce périmètre.</p>';
  else{
    const rows=blocs.map(b=>{
      const L=vivantes.filter(p=>p.bloc===b), montant=L.reduce((a,p)=>a+window.Calc.val(p),0);
      const auto=[...new Set(L.map(p=>detecte(p,null)))], effectif=[...new Set(L.map(p=>detecte(p,sur)))];
      const corrige=Object.prototype.hasOwnProperty.call(sur,b);
      const opts=`<option value="">Automatique (${esc(auto.map(classeLabel).join(" + "))})</option>`+ORDRE_CLASSES.map(k=>`<option value="${k}"${corrige&&sur[b]===k?" selected":""}>${esc(classeLabel(k))}</option>`).join("");
      return `<div class="rv-prow">
        <div class="rv-pn"><b>${esc(b)}</b><span class="muted">${L.length} ligne${L.length>1?"s":""} · <span class="num">${eur(montant)}</span>${corrige?" · corrigé":""}</span>
          <span>Classée : ${esc(effectif.map(classeLabel).join(" + "))}</span></div>
        <select data-rv-bloc="${esc(b)}" aria-label="${esc("Classe de la poche "+b)}">${opts}</select>
      </div>`;
    }).join("");
    h=`<p class="muted">La classe de chaque poche est déduite de son nom. Corrigez-la si elle ne correspond pas à son contenu : par exemple, une poche « Protection » qui mélange fonds euros et or. Le rattachement vaut pour tout le foyer ; seules les poches ${esc(scopeDe())} sont listées.</p>
      <div class="rv-prows">${rows}</div>`;
  }
  if(h!==sig.classes){
    const actif=document.activeElement, bloc=actif&&box.contains(actif)&&actif.getAttribute("data-rv-bloc");
    sig.classes=h; box.innerHTML=h+`<p class="rv-pmsg" id="rvPMsg" role="status">${esc(pmsg)}</p>`;
    if(bloc){ const s=box.querySelector('[data-rv-bloc="'+CSS.escape(bloc)+'"]'); if(s) s.focus(); }
  }
}

/* ---------- panneaux de détail (cartes) ---------- */
function profilPanneauHtml(E){
  const rq=E.rq, decl=E.decl, ev=E.sa.evaluation, score=nb(rq.score)?+rq.score:ev.score;
  const bandes=R().PROFILS.map((p,k)=>`<span class="rv-gb${p.id===rq.profil?" on":""}" style="left:${k*20}%"><span>${esc(p.label)}</span></span>`).join("");
  const gf=(ev.gardeFous||[]).length&&ev.profilAvantGardeFous!==rq.profil?ev.gardeFous:[];
  const gfHtml=gf.length?`<div class="rv-gf"><p class="rv-gft"><b>Plafonné à ${esc(labelProfil(rq.profil))}</b> : ${esc(gf.map(g=>raison(g,ev)).join(", "))}.</p>
    <p class="rv-muet">Votre score seul donnerait ${esc(labelProfil(ev.profilAvantGardeFous))}.</p>
    <ul>${gf.map(g=>`<li>${esc(g.texte)}</li>`).join("")}</ul></div>`:"";
  const date=rq.date?new Date(String(rq.date).slice(0,10)+"T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"}):"";
  const lignes=resume(QS(),rq.reponses||{},{}).map(l=>`<li><span class="rv-rq">${esc(l.theme)}</span><span class="rv-rv">${esc(l.reponse||"sans réponse")}</span></li>`).join("");
  return `<p class="rv-desc">${esc(decl.description)}</p>
    <p class="rv-muet">Perte maximale tolérée sur un an : ${decl.perteMax} %${date?" · réponses du "+esc(date):""}</p>
    <div class="rv-gauge">
      <div class="rv-gh"><span class="rv-gl">Score</span><b class="num">${nb(score)?score:"—"}<span class="rv-muet">/100</span></b></div>
      <span class="rv-gt" role="img" aria-label="${esc("Score "+score+" sur 100 : de 0 à 19 Prudent, 20 à 39 Modéré, 40 à 59 Équilibré, 60 à 79 Dynamique, 80 à 100 Offensif")}">${bandes}<span class="rv-gm" style="left:${Math.max(0,Math.min(100,+score||0))}%"></span></span>
      <div class="rv-gs"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
    </div>
    ${gfHtml}
    ${U().accordeon({titre:"Vos réponses",contenu:`<ol class="rv-rlist">${lignes}</ol>`})}
    <div class="rv-pacts"><button type="button" class="rv-btn" data-rv="refaire">Refaire le questionnaire</button></div>`;
}
function risquePanneauHtml(E){
  const r=E.sa.risque, total=E.sa.allocation.total, perte=-r.baissePlausible, cls=E.v.ecart==null||E.v.ecart===0?"ok":E.v.ecart>0?"crit":"warn";
  return `<p class="rv-bad">Dans une mauvaise année (1 sur 100), votre portefeuille pourrait perdre environ <b>${fpct(perte,0)}</b>${total>0?", soit environ <b class=\"num\">"+eur(total*perte/100)+"</b>":""}.</p>
    <div class="rv-kpis">
      <div class="rv-kpi"><span class="rv-kl">Volatilité annuelle</span><b class="num">${fpct(r.volatilite)}</b><span class="rv-muet">variation typique sur un an</span></div>
      <div class="rv-kpi"><span class="rv-kl">Baisse plausible sur un an</span><b class="num">${fpct(r.baissePlausible,0)}</b><span class="rv-muet">1 année sur 100</span></div>
      <div class="rv-kpi"><span class="rv-kl">Pire baisse historique</span><b class="num">${fpct(r.pireBaisseHistorique,0)}</b><span class="rv-muet">pondérée par vos classes</span></div>
      <div class="rv-kpi"><span class="rv-kl">Profil équivalent</span><b>${esc(labelProfil(r.profilEquivalent))}</b><span class="rv-muet">au vu de cette baisse</span></div>
    </div>
    <p class="rv-cmp ${cls}">${esc(E.decl?E.v.phrase:"Votre portefeuille se comporte comme un profil "+(E.eq?E.eq.label:"—")+". Répondez au questionnaire pour le comparer à votre profil.")}</p>
    ${U().accordeon({titre:"Comment c'est calculé",contenu:METHODE})}`;
}
function ouvrirCarte(id,el){
  const u=U(); if(!u||!R()) return;
  const E=etat();
  if(id==="declare"&&E.decl){
    panneau="declare"; retourPanneau=el||null;
    corps=u.panneau.ouvrir({titre:"Profil "+E.decl.label,contenu:profilPanneauHtml(E),retour:el,surFermeture:fermeturePanneau,
      pied:u.demanderAClaude("Mon profil de risque dans Boussole est "+E.decl.label+" : explique-moi ce qu'il implique et si mes réponses me semblent cohérentes.")});
    brancherCorps(corps);
  }else if((id==="equivalent"||id==="perte")&&E.eq){
    panneau="risque"; retourPanneau=el||null;
    corps=u.panneau.ouvrir({titre:"Risque réel du portefeuille",contenu:risquePanneauHtml(E),retour:el,surFermeture:fermeturePanneau,
      pied:u.demanderAClaude(questionClaude({declare:E.decl,equivalent:E.eq,profils:R().PROFILS}))});
    brancherCorps(corps);
  }
}
/* Fermeture d'un panneau : si l'élément d'origine a été redessiné, le focus va à son remplaçant, sinon au verdict. */
function fermeturePanneau(o){
  const el=retourPanneau, etait=panneau;
  panneau=null; retourPanneau=null; clearTimeout(avance);
  if((o&&o.focus===false)||!root) return;
  if(el&&el.isConnected) return;
  const cle=el&&el.getAttribute&&(el.getAttribute("data-ui-carte")||el.getAttribute("data-rv"));
  const n=(cle&&(root.querySelector('[data-ui-carte="'+CSS.escape(cle)+'"]')||root.querySelector('[data-rv="'+CSS.escape(cle)+'"]')))
    ||(etait==="quiz"&&root.querySelector('[data-rv="start"],[data-rv="refaire"]'))||$("rvVerdict");
  if(n) n.focus();
}

/* ---------- questionnaire (dans le panneau) ---------- */
function etapeHtml(){
  const L=QS(), e=etape(L,draft.i);
  draft.i=e.index;
  const nav=`<p class="rv-err" id="rvErr" role="alert">${esc(msg)}</p>
    <div class="rv-nav">
      <button type="button" class="rv-btn ghost" data-rv="precedent"${e.premier?" disabled":""}>Précédent</button>
      <button type="button" class="rv-btn" data-rv="${e.suivant.action}"${e.type==="question"&&!valide(e.question,valeurCourante(e.question))?" disabled":""}>${esc(e.suivant.label)}</button>
    </div>`;
  if(e.type==="resume"){
    const p=pre(), rep=effectives(L,draft.reponses,p), lignes=resume(L,draft.reponses,p), ev=R().evaluer(rep,{});
    const gf=(ev.gardeFous||[]).length&&ev.profilAvantGardeFous!==ev.profil?ev.gardeFous:[];
    const apercu=ev.profil?`<div class="rv-apercu"><span class="rv-kl">Profil obtenu</span><b>${esc(labelProfil(ev.profil))}</b><span class="rv-muet">score ${ev.score}/100${gf.length?" · plafonné : "+esc(gf.map(g=>raison(g,ev)).join(", ")):""}</span></div>`:"";
    return `<div class="rv-quiz rv-resume">
      <div class="rv-prog"><span class="rv-theme">Résumé</span><span class="num">avant d'enregistrer</span></div>
      <span class="rv-pbar" role="progressbar" aria-label="Avancement du questionnaire" aria-valuemin="0" aria-valuemax="${e.total}" aria-valuenow="${e.total}"><span style="width:100%"></span></span>
      <h3 class="rv-q" id="rvQ" tabindex="-1">Vérifiez vos réponses</h3>
      ${apercu}
      <ol class="rv-rlist">${lignes.map((l,k)=>`<li class="${l.manque?"manque":""}"><span class="rv-rq">${esc(l.theme)}</span><span class="rv-rv">${esc(l.manque?"à répondre":l.reponse)}${l.prerempli?' <span class="rv-muet">(pré-rempli)</span>':""}</span>
        <button type="button" class="rv-lnk" data-rv="aller" data-i="${k}" aria-label="${esc("Modifier : "+l.theme)}">Modifier</button></li>`).join("")}</ol>
      ${nav}
      <p class="rv-keys">Entrée pour enregistrer, Échap pour fermer : vos réponses restent gardées.</p>
    </div>`;
  }
  const q=e.question, p=pre(), brut=draft.reponses[q.id], preV=valide(q,brut)?undefined:valeurPreremplie(q,p), val=valide(q,brut)?brut:preV;
  const pourcent=Math.round(e.numero/(e.total+1)*100);
  let opts="";
  if(q.type==="nombre"){
    const x=nb(val)?+val:null, o=x==null?null:q.options.filter(op=>x>=op.min).pop();
    opts=`<div class="rv-step">
      <button type="button" class="rv-sb" data-rv="moins" aria-label="Une année de moins">−</button>
      <input type="number" id="rvNombre" min="0" max="80" step="1" inputmode="numeric" value="${x==null?"":x}" aria-label="Nombre d'années" aria-describedby="rvQ">
      <button type="button" class="rv-sb" data-rv="plus" aria-label="Une année de plus">+</button>
      <span class="rv-unit">an${x!=null&&x>1?"s":""}</span></div>
      <p class="rv-match" aria-live="polite">${o?esc(o.label):""}</p>`;
  }else{
    const multi=q.type==="multi", sel=multi?(Array.isArray(val)?val:[]):[val];
    const tab=multi?null:(q.options.findIndex(o=>sel.includes(o.v))+1||1)-1; /* radio : seule l'option choisie (ou la première) est tabulable */
    opts=`<div class="rv-opts${multi?" multi":""}" role="${multi?"group":"radiogroup"}" aria-labelledby="rvQ">`+q.options.map((o,k)=>{
      const on=sel.includes(o.v);
      return `<button type="button" class="rv-opt" data-opt="${esc(o.v)}" ${multi?`aria-pressed="${on}"`:`role="radio" aria-checked="${on}" tabindex="${k===tab?0:-1}"`}>${k<9?`<kbd aria-hidden="true">${k+1}</kbd>`:""}<span>${esc(o.label)}</span></button>`;
    }).join("")+"</div>";
  }
  const note=preV!==undefined?`<p class="rv-pre"><span>Pré-rempli d'après votre ${q.prerempli==="age"?"profil":"bilan"}${q.prerempli==="matelas"&&nb(p.matelasMois)?" ("+String(Math.round(p.matelasMois*10)/10).replace(".",",")+" mois de dépenses)":""}</span> · <button type="button" class="rv-lnk" data-rv="modifier">modifier</button></p>`:"";
  const aide=q.aide&&!q.prerempli&&!AIDE_REDONDANTE.includes(q.id)?`<p class="rv-aide">${esc(q.aide)}</p>`:"";
  return `<div class="rv-quiz">
    <div class="rv-prog"><span class="rv-theme">${esc(q.theme)}</span><span class="num">Question ${e.numero} sur ${e.total}</span></div>
    <span class="rv-pbar" role="progressbar" aria-label="Avancement du questionnaire" aria-valuemin="0" aria-valuemax="${e.total}" aria-valuenow="${e.numero}"><span style="width:${Math.max(4,pourcent)}%"></span></span>
    <h3 class="rv-q" id="rvQ" tabindex="-1">${esc(q.texte)}</h3>
    <p class="rv-why"><b>Pourquoi cette question</b> ${esc(POURQUOI[q.id]||"")}</p>
    ${aide}${note}${opts}
    ${nav}
    <p class="rv-keys">Clavier : ${q.type==="nombre"?"chiffres ou − / +":"↑ ↓ ou 1 à "+Math.min(9,q.options.length)} pour choisir, Entrée pour continuer, Échap pour fermer (vos réponses sont gardées).</p>
  </div>`;
}
/* Réécrit l'étape dans le panneau ouvert ; focus : "question" (titre de l'étape), "nombre" (champ), un sélecteur, ou rien. */
function renderEtape(focus){
  if(panneau!=="quiz"||!corps) return;
  corps.innerHTML=etapeHtml(); corps.scrollTop=0;
  if(!focus) return;
  const f=focus==="question"?$q("#rvQ"):focus==="nombre"?$q("#rvNombre"):$q(focus);
  if(f) f.focus();
}
const $q=sel=>corps?corps.querySelector(sel):null;
function ouvrirQuiz(i,retour){
  const u=U(); if(!u||!R()) return;
  clearTimeout(avance);
  draft.i=Math.max(0,Math.min(QS().length,i)); msg="";
  panneau="quiz"; retourPanneau=retour||null;
  corps=u.panneau.ouvrir({titre:"Questionnaire de profil de risque",contenu:etapeHtml(),retour:retour||undefined,surFermeture:fermeturePanneau});
  brancherCorps(corps);
  const q=questionCourante(); renderEtape(q&&q.type==="nombre"?"nombre":"question");
}
function questionCourante(){ return draft.i<QS().length?QS()[draft.i]:null; }
function valeurCourante(q){ const b=draft.reponses[q.id]; return valide(q,b)?b:valeurPreremplie(q,pre()); }
/* Choix d'une option ; focus "option" (souris, flèches) ou "question" (chiffres : Entrée continue) ; auto : passage à la
   question suivante après un court délai (clic sur une question à choix unique). */
function choisir(v,o){
  const q=questionCourante(); if(!q) return;
  const opt=o||{};
  if(q.type==="multi") draft.reponses[q.id]=basculer(q,valeurCourante(q),v);
  else draft.reponses[q.id]=v;
  msg=""; ecrireBrouillon();
  renderEtape(opt.focus==="question"?"question":'[data-opt="'+CSS.escape(v)+'"]');
  if(opt.auto&&q.type==="choix"){ clearTimeout(avance); const i=draft.i; avance=setTimeout(()=>{ if(panneau==="quiz"&&draft.i===i) suivant(); },220); }
}
function suivant(){
  const q=questionCourante(); if(!q) return enregistrer();
  const v=valeurCourante(q);
  if(!valide(q,v)){ msg="Choisissez une réponse pour continuer."; renderEtape("question"); return; }
  if(draft.reponses[q.id]===undefined) draft.reponses[q.id]=v; /* le prérempli accepté devient une réponse */
  draft.i++; ecrireBrouillon(); msg="";
  const n=questionCourante(); renderEtape(n&&n.type==="nombre"?"nombre":"question");
}
function precedent(){
  clearTimeout(avance);
  if(draft.i<=0) return;
  draft.i--; ecrireBrouillon(); msg="";
  const q=questionCourante(); renderEtape(q&&q.type==="nombre"?"nombre":"question");
}
function aller(k){ clearTimeout(avance); draft.i=Math.max(0,Math.min(QS().length,k)); ecrireBrouillon(); msg=""; const q=questionCourante(); renderEtape(q&&q.type==="nombre"?"nombre":"question"); }
async function enregistrer(){
  if(occupe) return;
  const L=QS(), rep=effectives(L,draft.reponses,pre());
  const manque=L.findIndex(q=>!valide(q,rep[q.id]));
  if(manque>=0){ draft.i=manque; msg="Il manque une réponse à cette question."; ecrireBrouillon(); renderEtape("question"); return; }
  const ev=R().evaluer(rep,{});
  const risque={reponses:rep,profil:ev.profil,score:ev.score,date:new Date().toISOString().slice(0,10)};
  const b=$q('[data-rv="enregistrer"]'); if(b){ b.disabled=true; b.textContent="Enregistrement…"; }
  occupe=true;
  try{
    await window.Store.db.doc("profil/main").update({risque});
    effacerBrouillon(); draft={reponses:{},i:0};
    S.risque=risque;
    const u=U(); if(u&&u.panneau.ouvert()) u.panneau.fermer({focus:false});
    render();
    const v=$("rvVerdict"); if(v) v.focus();
    if(window.scrollTo) window.scrollTo({top:0});
  }catch(e){
    console.error("profil de risque",e);
    msg="Enregistrement impossible : "+(e&&e.message||e)+". Vos réponses sont gardées, réessayez.";
    renderEtape('[data-rv="enregistrer"]');
  }finally{ occupe=false; }
}

/* Écouteurs du panneau (créé une fois par UI et partagé avec les autres vues : on n'agit que sur nos panneaux). */
const corpsBranches=new WeakSet();
function brancherCorps(c){
  if(!c||corpsBranches.has(c)) return;
  corpsBranches.add(c);
  c.addEventListener("click",e=>{
    if(!panneau||!e.target||!e.target.closest) return;
    const o=e.target.closest("[data-opt]"); if(o&&panneau==="quiz"){ choisir(o.getAttribute("data-opt"),{auto:true,focus:"option"}); return; }
    const b=e.target.closest("[data-rv]"); if(!b||b.disabled) return;
    const a=b.getAttribute("data-rv");
    if(a==="refaire"){ commencerRefaire(retourPanneau); return; }
    if(panneau!=="quiz") return;
    if(a==="suivant") suivant();
    else if(a==="enregistrer") enregistrer();
    else if(a==="precedent") precedent();
    else if(a==="aller") aller(+b.getAttribute("data-i"));
    else if(a==="modifier"){ const f=$q('.rv-opt[aria-checked="true"],.rv-opt[aria-pressed="true"],#rvNombre'); if(f) f.focus(); }
    else if(a==="moins"||a==="plus"){ const q=questionCourante(), v=valeurCourante(q), x=nb(v)?+v:0; draft.reponses[q.id]=Math.max(0,Math.min(80,a==="plus"?(nb(v)?x+1:1):x-1)); ecrireBrouillon(); renderEtape('[data-rv="'+a+'"]'); }
  });
  c.addEventListener("input",e=>{
    if(panneau!=="quiz"||!e.target||e.target.id!=="rvNombre") return;
    const q=questionCourante(); if(!q) return;
    const v=e.target.value;
    if(v===""){ delete draft.reponses[q.id]; } else if(nb(v)&&+v>=0) draft.reponses[q.id]=Math.min(80,Math.round(+v));
    ecrireBrouillon();
    const x=draft.reponses[q.id], o=nb(x)?q.options.filter(op=>x>=op.min).pop():null;
    const m=$q(".rv-match"); if(m) m.textContent=o?o.label:"";
    const u=$q(".rv-unit"); if(u) u.textContent="an"+(nb(x)&&x>1?"s":"");
    const n=$q('[data-rv="suivant"]'); if(n) n.disabled=!valide(q,x);
  });
  c.addEventListener("keydown",e=>{
    if(panneau!=="quiz"||e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey) return;
    const t=e.target, champ=t&&/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
    /* Entrée sur un bouton ou un lien : clic natif ; sur le titre, le champ ou le compteur (− / +) : continuer. */
    if(e.key==="Enter"){ if(t&&/^(BUTTON|A|SUMMARY)$/.test(t.tagName)&&!(t.classList&&t.classList.contains("rv-sb"))) return; e.preventDefault(); suivant(); return; }
    const q=questionCourante(); if(!q||champ) return;
    if(q.type!=="nombre"&&/^[1-9]$/.test(e.key)){ const o=q.options[+e.key-1]; if(o){ e.preventDefault(); choisir(o.v,{focus:"question"}); } return; }
    if(q.type!=="nombre"&&(e.key==="ArrowDown"||e.key==="ArrowUp")&&t&&t.closest&&t.closest(".rv-opt")){
      const k=q.options.findIndex(o=>o.v===t.getAttribute("data-opt")), j=(k+(e.key==="ArrowDown"?1:-1)+q.options.length)%q.options.length;
      e.preventDefault();
      if(q.type==="multi"){ const n=$q('[data-opt="'+CSS.escape(q.options[j].v)+'"]'); if(n) n.focus(); }
      else choisir(q.options[j].v,{focus:"option"});
      return;
    }
    if(q.type==="nombre"&&/^[0-9]$/.test(e.key)){ const i=$q("#rvNombre"); if(i) i.focus(); }
  });
}
function commencerRefaire(retour){
  draft={reponses:Object.assign({},(S.risque&&S.risque.reponses)||{}),i:0}; ecrireBrouillon();
  ouvrirQuiz(0,retour&&retour.isConnected?retour:root.querySelector('[data-rv="refaire"]'));
}

function mount(r){
  root=r;
  draft=lireBrouillon();
  root.addEventListener("click",e=>{
    const b=e.target.closest&&e.target.closest("[data-rv]"); if(!b||!root.contains(b)) return;
    const a=b.getAttribute("data-rv");
    if(a==="start") ouvrirQuiz(premiereEtape(QS(),draft.reponses,pre()),b);
    else if(a==="reset"){ effacerBrouillon(); draft={reponses:{},i:0}; render(); const s=root.querySelector('[data-rv="start"]'); if(s) s.focus(); }
    else if(a==="refaire") commencerRefaire(b);
  });
  root.addEventListener("change",e=>{
    const s=e.target.closest&&e.target.closest("[data-rv-bloc]"); if(s) classer(s.getAttribute("data-rv-bloc"),s.value);
  });
  const u=U(); if(u) u.brancher(root,{surCarte:(id,el)=>ouvrirCarte(id,el)});
}
async function classer(bloc,valeur){
  const c=Object.assign({},S.classes||{});
  if(valeur) c[bloc]=valeur; else delete c[bloc];
  const dire=t=>{ pmsg=t; const n=$("rvPMsg"); if(n) n.textContent=t; };
  dire("Enregistrement…");
  try{ await window.Store.db.doc("profil/main").update({classes:c}); S.classes=c; dire("Classe de « "+bloc+" » enregistrée : le profil de risque et les bonnes pratiques en tiennent compte."); }
  catch(e){ console.error("classes",e); dire("Enregistrement impossible : "+(e&&e.message||e)+"."); }
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null,
    risque:snap.risque&&typeof snap.risque==="object"?snap.risque:null,classes:snap.classes||{}};
  dirty=true;
  /* Le questionnaire vit dans le panneau : une mise à jour du store ne réécrit que la page (et seulement si elle a changé). */
  if(visible){ render(); dirty=false; }
}
function show(){ if(dirty){ render(); dirty=false; } }
/* Chiffre clé : le profil enregistré, sinon « À définir ». */
function headline(){ const id=S.risque&&S.risque.profil; return id?labelProfil(id):"À définir"; }
const api={mount,update,show,headline};
const reg=()=>App.register("risque-view",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
