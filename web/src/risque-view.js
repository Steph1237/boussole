(function(){
/* Diagnostic › Profil de risque : questionnaire en cartes (une question par écran), résultat (profil, score, garde-fous),
   allocation cible vs réelle (barres doubles), risque réel du portefeuille et rattachement des poches à une classe.
   Calculs : Risque (risque.js : evaluer, synthese), Marche (marche.js : classeRisque, CLASSES), Calc, Plan (budget).
   Écritures : Store.db.doc("profil/main").update({risque}) à la fin du questionnaire, update({classes}) pour les poches.
   Le brouillon des réponses vit dans localStorage (« risque-brouillon ») jusqu'à « Voir mon profil ».
   Fonctions pures exportées pour les tests (module.exports) : prerempli, geometrie, valide, basculer, effectives, fpct. */

/* ---------- logique pure ---------- */
const nb=v=>v!==null&&v!==undefined&&v!==""&&isFinite(+v);
/** Valeurs préremplies depuis l'état : matelas (mois de dépenses, comme le Bilan : poche « Épargne » ÷ dépenses du budget,
    sinon dépenses de la cible de matelas en mois) et tranche d'âge du Profil. deps = { Calc, Plan }. */
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
const PURE={prerempli,valeurPreremplie,valide,basculer,effectives,geometrie,fpct};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
const BROUILLON="risque-brouillon";
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null,risque:null,classes:{}};
let root=null,dirty=true,mode=null,pmsg="",draft={reponses:{},i:0},immoAlloc=false,immoRisque=false,/* Profil de risque = actifs financiers, hors résidence (pratique usuelle, cohérent avec Bonnes pratiques). */msg="",avance=null;
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nf=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const eur=v=>nf.format(Math.round(v))+" €";
const R=()=>window.Risque||null, M=()=>window.Marche||null;
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
function ctx(avecImmo){ const p=pre(); return {positions:S.positions,scope:S.scope,surcharge:S.classes||{},immobilierPhysique:avecImmo?immoPhysique():0,matelasMois:p.matelasMois,age:p.age}; }
const repondues=()=>{ const e=effectives(QS(),draft.reponses,pre()); return QS().filter(q=>valide(q,e[q.id])).length; };

/* ---------- rendu ---------- */
function render(){
  if(!root) return;
  const ok=!!(R()&&window.Calc);
  if(!ok){ $("rvMain").innerHTML='<p class="muted">Le calcul du profil n\'est pas disponible dans cette vue.</p>'; $("rvClasses").hidden=true; return; }
  if(mode!=="quiz") mode=S.risque&&S.risque.profil?"result":"intro";
  if(mode==="quiz") renderQuiz(); else if(mode==="result") renderResult(); else renderIntro();
  $("rvClasses").hidden=mode==="quiz";
  if(mode!=="quiz") renderClasses();
}

function renderIntro(){
  const n=repondues(), total=QS().length, enCours=Object.keys(draft.reponses||{}).length>0;
  $("rvMain").innerHTML=`<section class="panel rv-intro" aria-labelledby="rvIntroT">
    <h2 id="rvIntroT">Votre profil de risque</h2>
    <p class="rv-lead">${total} questions, 3 minutes. Ce profil sert à comparer votre portefeuille à ce que vous pouvez supporter.</p>
    <p class="small muted">Horizon, réaction à une baisse, perte acceptable, connaissances, revenus : inspiré du questionnaire d'adéquation des conseillers (MiFID II). Vos réponses restent modifiables.</p>
    <div class="rv-actions">
      <button type="button" class="rv-btn" data-rv="start">${enCours?"Reprendre ("+n+" / "+total+")":"Commencer"}</button>
      <a class="rv-btn ghost" href="#profil/claude" data-goto="profil/claude">Le faire avec Claude</a>
    </div>
    ${enCours?'<button type="button" class="rv-lnk small" data-rv="reset">Effacer mes réponses et recommencer</button>':""}
  </section>`;
}

function optLabel(q,v){ const o=q.options.find(x=>x.v===v); return o?o.label:v; }
function renderQuiz(focus){
  const L=QS(), total=L.length;
  draft.i=Math.min(Math.max(0,draft.i),total-1);
  const q=L[draft.i], p=pre(), brut=draft.reponses[q.id], preV=valide(q,brut)?undefined:valeurPreremplie(q,p), val=valide(q,brut)?brut:preV;
  const dernier=draft.i===total-1, pourcent=Math.round((draft.i+1)/total*100);
  let opts="";
  if(q.type==="nombre"){
    const x=nb(val)?+val:null, o=x==null?null:q.options.filter(op=>x>=op.min).pop();
    opts=`<div class="rv-step">
      <button type="button" class="rv-sb" data-rv="moins" aria-label="Une année de moins">−</button>
      <input type="number" id="rvNombre" min="0" max="80" step="1" inputmode="numeric" value="${x==null?"":x}" aria-label="Nombre d'années">
      <button type="button" class="rv-sb" data-rv="plus" aria-label="Une année de plus">+</button>
      <span class="rv-unit">an${x!=null&&x>1?"s":""}</span></div>
      <p class="rv-match small" aria-live="polite">${o?esc(o.label):""}</p>`;
  }else{
    const multi=q.type==="multi", sel=multi?(Array.isArray(val)?val:[]):[val];
    opts=`<div class="rv-opts${multi?" multi":""}" role="${multi?"group":"radiogroup"}" aria-labelledby="rvQ">`+q.options.map((o,k)=>{
      const on=sel.includes(o.v);
      return `<button type="button" class="rv-opt" data-opt="${esc(o.v)}" ${multi?`aria-pressed="${on}"`:`role="radio" aria-checked="${on}"`}>${k<9?`<kbd>${k+1}</kbd>`:""}<span>${esc(o.label)}</span></button>`;
    }).join("")+"</div>";
  }
  const note=preV!==undefined?`<p class="rv-pre small"><span>Pré-rempli d'après votre ${q.prerempli==="age"?"profil":"bilan"}${q.prerempli==="matelas"&&nb(p.matelasMois)?" ("+String(Math.round(p.matelasMois*10)/10).replace(".",",")+" mois de dépenses)":""}</span> · <button type="button" class="rv-lnk" data-rv="modifier">modifier</button></p>`:"";
  const aide=q.aide&&!q.prerempli&&!AIDE_REDONDANTE.includes(q.id)?`<p class="rv-aide small muted">${esc(q.aide)}</p>`:"";
  $("rvMain").innerHTML=`<section class="panel rv-quiz" aria-labelledby="rvQ">
    <div class="rv-prog"><span class="rv-theme">${esc(q.theme)}</span><span class="num">${draft.i+1} / ${total}</span></div>
    <span class="rv-pbar" role="progressbar" aria-label="Avancement du questionnaire" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${draft.i+1}"><span style="width:${Math.max(4,pourcent)}%"></span></span>
    <h2 class="rv-q" id="rvQ" tabindex="-1">${esc(q.texte)}</h2>
    <p class="rv-why small"><b>Pourquoi cette question</b> ${esc(POURQUOI[q.id]||"")}</p>
    ${aide}${note}${opts}
    <p class="rv-err small" id="rvErr" role="alert">${esc(msg)}</p>
    <div class="rv-nav">
      <button type="button" class="rv-btn ghost" data-rv="retour">Retour</button>
      <button type="button" class="rv-btn" data-rv="${dernier?"voir":"suivant"}" ${valide(q,val)?"":"disabled"}>${dernier?"Voir mon profil":"Suivant"}</button>
    </div>
    <p class="rv-keys small muted">Clavier : 1 à 9 pour choisir, Entrée pour continuer, Échap pour revenir.</p>
  </section>`;
  if(focus){ const f=focus==="nombre"?$("rvNombre"):$("rvQ"); if(f) f.focus({preventScroll:false}); }
}

function sectionAllocation(sa,risque){
  const alloc=sa.allocation, immo=immoPhysique();
  const toggle=immo>0?`<label class="rv-chk"><input type="checkbox" data-rv-immo="alloc" ${immoAlloc?"checked":""}> Compter mon immobilier</label>`:"";
  if(!(alloc.total>0)) return `<section class="panel rv-alloc"><div class="panel-head"><h2>Allocation cible et réelle</h2>${toggle}</div>
    <p class="muted">Aucun placement à comparer pour ce périmètre. <a class="rv-a" href="#bilan/placements" data-goto="bilan/placements">Ajouter des placements</a></p></section>`;
  const EC=sa.ecarts, ST={dans:"dans la fourchette",sous:"en dessous","au-dessus":"au-dessus"};
  const rows=EC.map(e=>{
    const g=geometrie(e.min,e.max,e.reel);
    const ecart=e.statut==="dans"?"":` · écart ${e.ecartPts>0?"+":"−"}${String(Math.abs(Math.round(e.ecartPts*10)/10)).replace(".",",")} pt${Math.abs(e.ecartPts)>=2?"s":""}`;
    return `<div class="rv-arow">
      <div class="rv-ahead"><span class="rv-al">${esc(e.label)}</span><span class="rv-st ${e.statut==="dans"?"ok":"off"}">${ST[e.statut]}</span></div>
      <span class="rv-track" role="img" aria-label="${esc(e.label+" : "+fpct(e.reel)+", cible "+e.min+" à "+e.max+" %, "+ST[e.statut])}">
        <span class="rv-band${g.bandeLargeur?"":" zero"}" style="left:${g.bandeGauche}%;width:${g.bandeLargeur}%"></span>
        <span class="rv-real ${e.statut==="dans"?"ok":"off"}" style="width:${g.reel.toFixed(2)}%"></span>
        <span class="rv-mark" style="left:${g.reel.toFixed(2)}%"></span>
      </span>
      <div class="rv-anum small"><b class="num">${fpct(e.reel)}</b> <span class="muted">· cible ${e.min === e.max ? e.min + " %" : e.min + " à " + e.max + " %"}${ecart}</span></div>
    </div>`;
  }).join("");
  const div=alloc.pct.diversifiants||0;
  return `<section class="panel rv-alloc" aria-labelledby="rvAllocT">
    <div class="panel-head"><h2 id="rvAllocT">Allocation cible et réelle</h2>${toggle}</div>
    <p class="small muted rv-sub">Fourchette du profil ${esc(risque.label)} (bande) et répartition réelle ${esc(scopeDe())} (barre), sur ${eur(alloc.total)}${immoAlloc&&immo>0?" immobilier compris":""}.</p>
    <div class="rv-arows">${rows}</div>
    <p class="rv-div small"><b>${esc((R().GROUPES_LABELS||{}).diversifiants||"Or et autres")}</b> : <span class="num">${fpct(div)}</span> <span class="muted">· à part : ils diversifient sans entrer dans les fourchettes.</span></p>
    <div class="rv-legend small muted"><span><i class="lg-band"></i>fourchette cible</span><span><i class="lg-real"></i>réel dans la fourchette</span><span><i class="lg-off"></i>réel hors fourchette</span></div>
  </section>`;
}

function sectionRisque(sr){
  const r=sr.risque, immo=immoPhysique(), M_=M();
  const toggle=immo>0?`<label class="rv-chk"><input type="checkbox" data-rv-immo="risque" ${immoRisque?"checked":""}> Compter mon immobilier</label>`:"";
  if(!r.profilEquivalent) return `<section class="panel rv-risk"><div class="panel-head"><h2>Risque réel du portefeuille</h2>${toggle}</div><p class="muted">${esc(sr.comparaison.texte)}</p></section>`;
  const total=sr.allocation.total, perte=-r.baissePlausible;
  const lab=k=>(M_&&M_.CLASSES[k]&&M_.CLASSES[k].label)||(window.Calc.CLASSES_LABELS[k])||k;
  const maxC=Math.max(1,...r.contributions.map(c=>c.contributionPct));
  const contrib=r.contributions.filter(c=>c.contributionPct>=0.05||c.poids>=0.5).map(c=>`<div class="rv-crow">
    <span class="rv-cl" title="${esc(lab(c.classe))}">${esc(lab(c.classe))}</span>
    <span class="rv-ctrack" aria-hidden="true"><span style="width:${(c.contributionPct/maxC*100).toFixed(2)}%"></span></span>
    <span class="num rv-cv">${fpct(c.contributionPct,0)}</span><span class="num rv-cp muted">${fpct(c.poids,0)} du total</span></div>`).join("");
  const ecart=sr.comparaison.ecartNiveaux, cls=ecart==null||ecart===0?"ok":ecart>0?"crit":"warn";
  return `<section class="panel rv-risk" aria-labelledby="rvRiskT">
    <div class="panel-head"><h2 id="rvRiskT">Risque réel du portefeuille</h2>${toggle}</div>
    <p class="rv-bad">Dans une mauvaise année (1 sur 100), votre portefeuille pourrait perdre environ <b>${fpct(perte,0)}</b>${total>0?", soit environ <b class=\"num\">"+eur(total*perte/100)+"</b>":""}.</p>
    <div class="rv-kpis">
      <div class="rv-kpi"><span class="label">Volatilité annuelle</span><b class="num">${fpct(r.volatilite)}</b><span class="small muted">variation typique sur un an</span></div>
      <div class="rv-kpi"><span class="label">Baisse plausible sur un an</span><b class="num">${fpct(r.baissePlausible,0)}</b><span class="small muted">1 année sur 100</span></div>
      <div class="rv-kpi"><span class="label">Pire baisse historique</span><b class="num">${fpct(r.pireBaisseHistorique,0)}</b><span class="small muted">pondérée par vos classes</span></div>
      <div class="rv-kpi"><span class="label">Profil équivalent</span><b>${esc(labelProfil(r.profilEquivalent))}</b><span class="small muted">au vu de cette baisse</span></div>
    </div>
    <p class="rv-cmp ${cls}">${esc(sr.comparaison.texte)}</p>
    <h3 class="rv-h3">D'où vient le risque</h3>
    <p class="small muted rv-sub">Part de chaque classe dans la variabilité du portefeuille : une petite ligne très volatile peut peser lourd.</p>
    <div class="rv-crows">${contrib}</div>
    <details class="rv-how small"><summary>Comment c'est calculé</summary>
      <p>Volatilité du portefeuille à partir de la volatilité historique de chaque classe et de corrélations simplifiées. Baisse plausible : la plus grave de deux estimations, 2,33 volatilités (une année sur 100 avec une loi normale) ou la moitié de la pire baisse historique pondérée, car la loi normale sous-estime les krachs. Profil équivalent : le moins risqué des profils dont la perte tolérée couvre cette baisse.</p>
      <p class="muted">Sources : MSCI, Bloomberg Euro Aggregate, IEIF, LBMA, CoinMarketCap, Banque de France. Ordres de grandeur historiques, pas des prévisions.</p>
    </details>
  </section>`;
}

function renderResult(){
  const rq=S.risque, decl=profilDe(rq.profil);
  const sa=R().synthese(rq.reponses||{},ctx(immoAlloc)), sr=immoAlloc===immoRisque?sa:R().synthese(rq.reponses||{},ctx(immoRisque));
  const ev=sa.evaluation, score=nb(rq.score)?+rq.score:ev.score;
  /* Écarts calculés sur le profil enregistré (il peut différer d'un recalcul si le prérempli a changé depuis). */
  if(decl&&sa.profil&&sa.profil.id!==decl.id){ sa.ecarts=R().ecarts(decl.id,sa.allocation); }
  if(decl&&sr.profil&&sr.profil.id!==decl.id){ const e=sr.risque.profilEquivalent?profilDe(sr.risque.profilEquivalent):null, d=decl.label;
    const k=e?R().PROFILS.indexOf(e)-R().PROFILS.indexOf(decl):null;
    sr.comparaison={...sr.comparaison,ecartNiveaux:k,texte:!e?sr.comparaison.texte:k===0?"Votre portefeuille se comporte comme un profil "+e.label+", conforme à votre profil."
      :"Votre portefeuille se comporte comme un profil "+e.label+", alors que votre profil est "+d+" : il prend "+(k>0?"plus de risque que vous ne le souhaitez.":"moins de risque que votre profil ne le permet.")}; }
  const bandes=R().PROFILS.map((p,k)=>`<span class="rv-gb${p.id===rq.profil?" on":""}" style="left:${k*20}%"><span>${esc(p.label)}</span></span>`).join("");
  const gf=(ev.gardeFous||[]).length&&ev.profilAvantGardeFous!==rq.profil?ev.gardeFous:[];
  const gfHtml=gf.length?`<div class="rv-gf"><p class="rv-gft"><b>Plafonné à ${esc(labelProfil(rq.profil))}</b> : ${esc(gf.map(g=>raison(g,ev)).join(", "))}.</p>
    <p class="small muted">Votre score seul donnerait ${esc(labelProfil(ev.profilAvantGardeFous))}.</p>
    <ul class="small">${gf.map(g=>`<li>${esc(g.texte)}</li>`).join("")}</ul></div>`:"";
  const date=rq.date?new Date(String(rq.date).slice(0,10)+"T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"}):"";
  $("rvMain").innerHTML=`<section class="panel rv-hero" aria-labelledby="rvProfT">
    <div class="rv-hl">
      <h2 class="label">Votre profil de risque</h2>
      <div class="rv-name" id="rvProfT">${esc(decl?decl.label:rq.profil)}</div>
      <p class="rv-desc">${esc(decl?decl.description:"")}</p>
      ${decl?`<p class="small muted">Perte maximale tolérée sur un an : ${decl.perteMax} %${date?" · réponses du "+esc(date):""}</p>`:""}
    </div>
    <div class="rv-gauge">
      <div class="rv-gh"><span class="label">Score</span><b class="num">${nb(score)?score:"—"}<span class="muted">/100</span></b></div>
      <span class="rv-gt" role="img" aria-label="${esc("Score "+score+" sur 100 : de 0 à 19 Prudent, 20 à 39 Modéré, 40 à 59 Équilibré, 60 à 79 Dynamique, 80 à 100 Offensif")}">${bandes}<span class="rv-gm" style="left:${Math.max(0,Math.min(100,+score||0))}%"></span></span>
      <div class="rv-gs small muted"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
    </div>
    ${gfHtml}
    <div class="rv-actions">
      <button type="button" class="rv-btn ghost" data-rv="refaire">Refaire le questionnaire</button>
      <a class="rv-btn ghost" href="#profil/claude" data-goto="profil/claude">Le revoir avec Claude</a>
    </div>
  </section>
  ${decl?sectionAllocation(sa,decl):""}
  ${sectionRisque(sr)}`;
}

/* Rattachement poche → classe : blocs présents dans le périmètre, classe détectée et surcharge enregistrée (profiles.classes). */
const ORDRE_CLASSES=["actions","small_caps","emergents","levier","obligations","fonds_euros","monetaire","immobilier","or","crypto","autres"];
function classeLabel(k){ const M_=M(); return window.Calc.CLASSES_LABELS[k]||(M_&&M_.CLASSES[k]&&M_.CLASSES[k].label)||k; }
function renderClasses(){
  const box=$("rvClassesBody"), M_=M(), sur=S.classes||{};
  const vivantes=(S.positions||[]).filter(p=>window.Calc.inScope(p,S.scope)&&window.Calc.counted(p));
  const blocs=[...new Set(vivantes.map(p=>p.bloc).filter(Boolean))];
  const detecte=(p,s)=>M_?M_.classeRisque(p,s):window.Calc.classe(p.bloc,s);
  if(!blocs.length){ box.innerHTML='<p class="muted small">Aucune poche dans ce périmètre.</p>'; return; }
  const rows=blocs.map(b=>{
    const L=vivantes.filter(p=>p.bloc===b), montant=L.reduce((a,p)=>a+window.Calc.val(p),0);
    const auto=[...new Set(L.map(p=>detecte(p,null)))], effectif=[...new Set(L.map(p=>detecte(p,sur)))];
    const corrige=Object.prototype.hasOwnProperty.call(sur,b);
    const opts=`<option value="">Automatique (${esc(auto.map(classeLabel).join(" + "))})</option>`+ORDRE_CLASSES.map(k=>`<option value="${k}"${corrige&&sur[b]===k?" selected":""}>${esc(classeLabel(k))}</option>`).join("");
    return `<div class="rv-prow">
      <div class="rv-pn"><b>${esc(b)}</b><span class="small muted">${L.length} ligne${L.length>1?"s":""} · <span class="num">${eur(montant)}</span>${corrige?" · corrigé":""}</span>
        <span class="small">Classée : ${esc(effectif.map(classeLabel).join(" + "))}</span></div>
      <select data-rv-bloc="${esc(b)}" aria-label="${esc("Classe de la poche "+b)}">${opts}</select>
    </div>`;
  }).join("");
  box.innerHTML=`<p class="small muted">La classe de chaque poche est déduite de son nom. Corrigez-la si elle ne correspond pas à son contenu : par exemple, une poche « Protection » qui mélange fonds euros et or. Le rattachement vaut pour tout le foyer ; seules les poches ${esc(scopeDe())} sont listées.</p>
    <div class="rv-prows">${rows}</div><p class="small rv-pmsg" id="rvPMsg" role="status">${esc(pmsg)}</p>`;
}

/* ---------- actions ---------- */
function setMode(m,focus){ mode=m; msg=""; render(); if(focus&&root) { const h=root.querySelector(m==="quiz"?"#rvQ":"h2"); if(h){ if(!h.hasAttribute("tabindex")) h.setAttribute("tabindex","-1"); h.focus(); } } }
function questionCourante(){ return QS()[draft.i]; }
function valeurCourante(q){ const b=draft.reponses[q.id]; return valide(q,b)?b:valeurPreremplie(q,pre()); }
function choisir(v,auto,clavier){
  const q=questionCourante(); if(!q) return;
  if(q.type==="multi") draft.reponses[q.id]=basculer(q,valeurCourante(q),v);
  else draft.reponses[q.id]=v;
  msg=""; ecrireBrouillon(); renderQuiz(clavier?true:false);
  /* Au clavier, le focus reste sur la question (Entrée = continuer) ; à la souris ou au doigt, sur l'option choisie. */
  if(!clavier){ const btn=root.querySelector('[data-opt="'+CSS.escape(v)+'"]'); if(btn) btn.focus(); }
  if(auto&&q.type==="choix"){ clearTimeout(avance); const i=draft.i; avance=setTimeout(()=>{ if(mode==="quiz"&&draft.i===i&&draft.i<QS().length-1) suivant(); },220); }
}
function suivant(){
  const q=questionCourante(); if(!q) return;
  const v=valeurCourante(q);
  if(!valide(q,v)){ msg="Choisissez une réponse pour continuer."; renderQuiz(); return; }
  if(draft.reponses[q.id]===undefined) draft.reponses[q.id]=v; /* le prérempli accepté devient une réponse */
  if(draft.i>=QS().length-1) return voir();
  draft.i++; ecrireBrouillon(); msg=""; renderQuiz(QS()[draft.i].type==="nombre"?"nombre":true);
}
function retour(){
  clearTimeout(avance);
  if(draft.i>0){ draft.i--; ecrireBrouillon(); msg=""; renderQuiz(true); return; }
  setMode(S.risque&&S.risque.profil?"result":"intro",true);
}
async function voir(){
  const L=QS(), rep=effectives(L,draft.reponses,pre());
  const manque=L.findIndex(q=>!valide(q,rep[q.id]));
  if(manque>=0){ draft.i=manque; msg="Il manque une réponse à cette question."; ecrireBrouillon(); renderQuiz(true); return; }
  const ev=R().evaluer(rep,{});
  const risque={reponses:rep,profil:ev.profil,score:ev.score,date:new Date().toISOString().slice(0,10)};
  const b=root.querySelector('[data-rv="voir"]'); if(b){ b.disabled=true; b.textContent="Enregistrement…"; }
  try{
    await window.Store.db.doc("profil/main").update({risque});
    effacerBrouillon(); draft={reponses:{},i:0};
    S.risque=risque; setMode("result",true); window.scrollTo&&window.scrollTo({top:0});
  }catch(e){
    console.error("profil de risque",e);
    msg="Enregistrement impossible : "+(e&&e.message||e)+". Vos réponses sont gardées, réessayez.";
    renderQuiz();
  }
}
async function classer(bloc,valeur){
  const c=Object.assign({},S.classes||{});
  if(valeur) c[bloc]=valeur; else delete c[bloc];
  const dire=t=>{ pmsg=t; const n=$("rvPMsg"); if(n) n.textContent=t; };
  dire("Enregistrement…");
  try{ await window.Store.db.doc("profil/main").update({classes:c}); S.classes=c; dire("Classe de « "+bloc+" » enregistrée : le profil de risque et les bonnes pratiques en tiennent compte."); }
  catch(e){ console.error("classes",e); dire("Enregistrement impossible : "+(e&&e.message||e)+"."); }
}

function onKey(e){
  if(!root||root.hidden||mode!=="quiz"||e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey) return;
  const t=e.target, champ=t&&/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  if(document.querySelector("dialog[open]")) return;
  if(e.key==="Escape"){ e.preventDefault(); retour(); return; }
  /* Entrée sur une option ou un bouton de navigation : clic natif ; sur la question, le champ ou le compteur (− / +) : continuer. */
  if(e.key==="Enter"){ if(t&&/^(BUTTON|A)$/.test(t.tagName)&&!t.classList.contains("rv-sb")) return; e.preventDefault(); suivant(); return; }
  if(champ) return;
  const q=questionCourante();
  if(q&&q.type!=="nombre"&&/^[1-9]$/.test(e.key)){ const o=q.options[+e.key-1]; if(o){ e.preventDefault(); choisir(o.v,false,true); } }
  else if(q&&q.type==="nombre"&&/^[0-9]$/.test(e.key)){ const i=$("rvNombre"); if(i){ i.focus(); } }
}

function mount(r){
  root=r;
  draft=lireBrouillon();
  root.addEventListener("click",e=>{
    const o=e.target.closest("[data-opt]"); if(o&&mode==="quiz"){ choisir(o.dataset.opt,true); return; }
    const b=e.target.closest("[data-rv]"); if(!b) return;
    const a=b.dataset.rv;
    if(a==="start"){ draft.i=Math.min(draft.i,QS().length-1); const i=QS().findIndex(q=>!valide(q,effectives(QS(),draft.reponses,pre())[q.id])); if(i>=0) draft.i=i; setMode("quiz",true); }
    else if(a==="reset"){ effacerBrouillon(); draft={reponses:{},i:0}; render(); }
    else if(a==="refaire"){ draft={reponses:Object.assign({},(S.risque&&S.risque.reponses)||{}),i:0}; ecrireBrouillon(); setMode("quiz",true); }
    else if(a==="suivant") suivant();
    else if(a==="voir") voir();
    else if(a==="retour") retour();
    else if(a==="modifier"){ const f=root.querySelector(".rv-opt[aria-checked=\"true\"],.rv-opt[aria-pressed=\"true\"],#rvNombre"); if(f) f.focus(); }
    else if(a==="moins"||a==="plus"){ const q=questionCourante(), v=valeurCourante(q), x=nb(v)?+v:0; draft.reponses[q.id]=Math.max(0,Math.min(80,a==="plus"?(nb(v)?x+1:1):x-1)); ecrireBrouillon(); renderQuiz(); const n=root.querySelector('[data-rv="'+a+'"]'); if(n) n.focus(); }
  });
  root.addEventListener("input",e=>{
    if(e.target.id!=="rvNombre") return;
    const q=questionCourante(), v=e.target.value;
    if(v===""){ delete draft.reponses[q.id]; } else if(nb(v)&&+v>=0) draft.reponses[q.id]=Math.min(80,Math.round(+v));
    ecrireBrouillon();
    const x=draft.reponses[q.id], o=nb(x)?q.options.filter(op=>x>=op.min).pop():null;
    const m=root.querySelector(".rv-match"); if(m) m.textContent=o?o.label:"";
    const u=root.querySelector(".rv-unit"); if(u) u.textContent="an"+(nb(x)&&x>1?"s":"");
    const n=root.querySelector('[data-rv="suivant"],[data-rv="voir"]'); if(n) n.disabled=!valide(q,x);
  });
  root.addEventListener("change",e=>{
    const im=e.target.closest("[data-rv-immo]"); if(im){ if(im.dataset.rvImmo==="alloc") immoAlloc=im.checked; else immoRisque=im.checked; render(); const f=root.querySelector('[data-rv-immo="'+im.dataset.rvImmo+'"]'); if(f) f.focus(); return; }
    const s=e.target.closest("[data-rv-bloc]"); if(s) classer(s.dataset.rvBloc,s.value);
  });
  document.addEventListener("keydown",onKey);
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null,
    risque:snap.risque&&typeof snap.risque==="object"?snap.risque:null,classes:snap.classes||{}};
  dirty=true;
  /* Pendant le questionnaire, une mise à jour du store ne réécrit pas la carte en cours (focus et saisie préservés). */
  if(visible&&mode!=="quiz"){ render(); dirty=false; }
}
function show(){ if(dirty&&mode!=="quiz"){ render(); dirty=false; } else if(mode==="quiz"&&!$("rvQ")) render(); }
/* Chiffre clé : le profil enregistré, sinon « À définir ». */
function headline(){ const id=S.risque&&S.risque.profil; return id?labelProfil(id):"À définir"; }
const api={mount,update,show,headline};
const reg=()=>App.register("risque-view",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
