(function(){
/* Pilotage › Risque — « Mon portefeuille correspond-il à mon profil ? ». Lecture seule, au tutoiement.
   En haut : verdict en une phrase (profil déclaré vs profil équivalent du portefeuille) et une ligne sur l'allocation ;
   « Faire mon profil de risque avec Claude » (sans profil) ou « Le revoir avec Claude » (ClaudePrompts.phrase, section risque :
   le questionnaire se fait dans Claude, avec un formulaire interactif, puis se valide dans Agent › À valider), et
   « Demander à Claude » ; bascule « Compter mon immobilier » si un bien est renseigné (affichage, non enregistré).
   Trois cartes (UI.carte) → panneau (UI.panneau) : profil déclaré (description, score, garde-fous, réponses validées en
   lecture), comportement du portefeuille et perte plausible (volatilité, baisse plausible, pire baisse, méthode).
   Barres d'allocation par classe avec la fourchette du profil ; accordéons fermés (état gardé d'un rendu à l'autre) : d'où vient
   le risque (5 classes puis « Voir plus »), méthode ; classement des poches en lecture avec « Corriger avec Claude », chaque ligne
   d'une poche menant à sa fiche de Patrimoine › Comptes (adresse d'App.ouvrir({ ligne }) : App.lienCompte / ComptesView.lien).
   Calculs : Risque (risque.js : evaluer, synthese, ecarts), Marche (marche.js : classeRisque, CLASSES), Calc, Plan (budget).
   Aucune écriture au store (spec 2026-10-11-saisie-par-agent).
   Fonctions pures exportées pour les tests (module.exports) : prerempli, valeurPreremplie, valide, geometrie, fpct, ecartNiveaux,
   horsFourchette, verdict, libelleReponse, resume, questionClaude, phraseRisque. */

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
  return (v<0&&s!=="0"?"−":"")+s+"\u00a0%";
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
  if(!d) return {phrase:"Ton profil de risque n'est pas encore défini : fais-le avec Claude pour comparer ton portefeuille à ce que tu peux supporter.",ton:"",ecart:null,allocation:""};
  if(!e) return {phrase:"Aucun placement à comparer à ton profil "+d.label+" pour le moment.",ton:"",ecart:null,allocation:""};
  if(k===0) return {phrase:"Oui : ton portefeuille se comporte comme un profil "+e.label+", conforme à ton profil.",ton:"ok",ecart:0,allocation};
  if(k>0) return {phrase:"Non : ton portefeuille se comporte comme un profil "+e.label+", alors que ton profil est "+d.label+" ; il prend plus de risque que tu ne le souhaites.",ton:"crit",ecart:k,allocation};
  return {phrase:"Pas tout à fait : ton portefeuille se comporte comme un profil "+e.label+", alors que ton profil est "+d.label+" ; il prend moins de risque que ton profil ne le permet.",ton:"warn",ecart:k,allocation};
}
/** Libellé lisible d'une réponse : option choisie, cases cochées, ou « 5 ans (5 à 9 ans) ». "" si aucune réponse valide. */
function libelleReponse(q,v){
  if(!valide(q,v)) return "";
  if(q.type==="multi") return q.options.filter(o=>v.includes(o.v)).map(o=>o.label).join(", ");
  if(q.type==="nombre"){ const x=Math.round(+v), o=q.options.filter(op=>x>=op.min).pop(); return x+" an"+(x>1?"s":"")+(o?" ("+o.label.charAt(0).toLowerCase()+o.label.slice(1)+")":""); }
  const o=q.options.find(x=>x.v===String(v)); return o?o.label:"";
}
/** Réponses lisibles, une ligne par question { id, theme, texte, reponse, prerempli, manque } (réponses validées : pre = {}). */
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
/* Phrases « Compléter avec Claude » (claude-prompts.js : window.ClaudePrompts, ou require sous Node), avec un repli. */
const prompts=()=>(typeof window!=="undefined"&&window&&window.ClaudePrompts)||
  (typeof module==="object"&&module.exports&&typeof require==="function"?require("./claude-prompts.js"):null);
/** Phrase prête des liens vers Claude : section « risque » (profil de risque) ou « placements » (classement des poches), avec le
    contexte (« revoir mon profil Équilibré du 1er octobre 2026 »…). */
function phraseRisque(section,contexte){
  const P=prompts();
  if(P&&typeof P.phrase==="function") return P.phrase(section,contexte);
  return "Boussole : aide-moi à remplir mon profil de risque"+(contexte?" ("+contexte+")":"")+". Commence par demarrer_session, puis utilise les formulaires interactifs Boussole.";
}
const PURE={prerempli,valeurPreremplie,valide,geometrie,fpct,ecartNiveaux,horsFourchette,verdict,libelleReponse,resume,questionClaude,phraseRisque};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;


/* ---------- vue ---------- */
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null,risque:null,classes:{}};
/* avecImmo : profil de risque calculé sur les actifs financiers, hors résidence, sauf si l'utilisateur compte son immobilier
   (affichage seulement, non enregistré ; cohérent avec Bonnes pratiques). panneau : null | "declare" | "risque". */
let root=null,dirty=true,avecImmo=false,panneau=null,retourPanneau=null;
const sig={main:"",classes:""};
/* Accordéons de la page ouverts (data-rv-acc) : gardés ouverts quand la page est réécrite. */
const accOuverts=new Set();
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eur=v=>(window.Fmt?window.Fmt.fmtEUR(v):Math.round(v)+"\u00a0€");
const R=()=>window.Risque||null, M=()=>window.Marche||null, U=()=>window.UI||null;
const QS=()=>(R()&&R().QUESTIONS)||[];
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

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
const dateFr=d=>d&&window.Fmt?window.Fmt.fmtDate(String(d).slice(0,10)):"";

/* ---------- contexte de calcul ---------- */
const pre=()=>prerempli(S,{Calc:window.Calc,Plan:window.Plan});
const immoPhysique=()=>{ try{ return window.Calc.immobilier(S.profil,S.scope); }catch(e){ return 0; } };
function ctx(immo){ const p=pre(); return {positions:S.positions,scope:S.scope,surcharge:S.classes||{},immobilierPhysique:immo?immoPhysique():0,matelasMois:p.matelasMois,age:p.age}; }

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
/* Liens vers Claude : faire le profil (sans profil), le revoir (profil enregistré), corriger le classement des poches. */
const lienFaire=()=>U().demanderAClaude(phraseRisque("risque"),"Faire mon profil de risque avec Claude");
const lienRevoir=E=>U().demanderAClaude(phraseRisque("risque","revoir mon profil "+E.decl.label+(E.rq.date?" du "+dateFr(E.rq.date):"")),"Le revoir avec Claude");
const lienQuestion=E=>U().demanderAClaude(questionClaude({declare:E.decl,equivalent:E.eq,profils:R().PROFILS}));

/* ---------- rendu de la page ---------- */
const pageHtml=E=>E.rq?resultatHtml(E):introHtml(E);
function render(){
  if(!root) return;
  const ok=!!(R()&&window.Calc&&U());
  if(!ok){ $("rvMain").innerHTML='<p class="muted">Le calcul du profil n\'est pas disponible dans cette vue.</p>'; $("rvClasses").hidden=true; sig.main=""; return; }
  const E=etat();
  const h=pageHtml(E);
  if(h!==sig.main){
    const actif=root.contains(document.activeElement)?document.activeElement:null, cle=actif&&actif.getAttribute&&(actif.getAttribute("data-ui-carte")||actif.getAttribute("data-rv-acc-t"));
    sig.main=h; $("rvMain").innerHTML=h;
    brancherImmo();
    /* Le focus était sur une carte ou un titre d'accordéon redessinés : on le rend au même élément. */
    if(cle&&actif&&!actif.isConnected){ const n=root.querySelector('[data-ui-carte="'+CSS.escape(cle)+'"]')||root.querySelector('[data-rv-acc-t="'+CSS.escape(cle)+'"]'); if(n) n.focus(); }
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

/* Chip de l'écart entre le profil déclaré et le comportement du portefeuille (statut avec libellé, jamais la couleur seule). */
function ecartHtml(E){
  const k=E.v.ecart;
  if(k==null) return "";
  const [c,t]=k===0?["bon","Conforme à ton profil"]:k>0?["travailler","Plus risqué que ton profil"]:["surveiller","Moins risqué que ton profil"];
  return `<span class="ui-puce ${c}"><span class="ui-puce-point" aria-hidden="true"></span>${t}</span>`;
}
/* Sans profil : une carte d'état vide (la seule action Claude de la page : le questionnaire se fait dans Claude), à côté de ce qui se calcule déjà. */
function introHtml(E){
  const hero=`<section class="panel rv-hero" aria-labelledby="rvTitre">
    <h2 class="rv-h2" id="rvTitre">Profil de risque</h2>
    <p class="rv-verdict" id="rvVerdict" tabindex="-1">Ton profil de risque n'est pas encore défini.</p>
    <p class="rv-lead">${QS().length||10} questions, 3 minutes, dans Claude : un formulaire interactif te les pose une à une. Ce profil sert à comparer ton portefeuille à ce que tu peux supporter.</p>
    <p class="rv-note">Horizon, réaction à une baisse, perte acceptable, connaissances, revenus : inspiré du questionnaire d'adéquation réglementaire (MiFID II). Claude dépose ensuite ton profil en proposition : tu le valides dans Agent › À valider.</p>
    <div class="rv-actions">${lienFaire()}</div>
    ${E.eq?`<p class="rv-sec-t">${esc("Ton portefeuille se comporte aujourd'hui comme un profil "+E.eq.label+" : le questionnaire dira si c'est le risque que tu peux supporter.")}</p>`:""}
    ${immoHtml()}
  </section>`;
  const cartes=cartesHtml(E);
  return `<div class="rv-top${cartes?" deux":""}">${hero}${cartes}</div>
  ${E.eq?accordeonsHtml(E):""}`;
}

/* Avec profil : la réponse (statut en chip, phrase, fourchettes), les trois cartes, l'allocation et les explications. « Le revoir avec Claude »
   et la question sur le profil sont dans les panneaux des cartes ; la demande de la page est le bouton Claude de l'en-tête. */
function resultatHtml(E){
  return `<section class="rv-hero rv-reponse" aria-labelledby="rvTitre">
    <h2 class="ui-sr" id="rvTitre">Profil de risque</h2>
    ${ecartHtml(E)}
    <p class="rv-verdict" id="rvVerdict" tabindex="-1">${esc(E.v.phrase)}</p>
    ${E.v.allocation?`<p class="rv-note">${esc(E.v.allocation)}</p>`:""}
    ${E.decl?"":immoHtml()}
  </section>
  ${cartesHtml(E)}
  ${E.decl?sectionAllocation(E.sa,E.decl):""}
  ${E.eq?accordeonsHtml(E):""}`;
}

function sectionAllocation(sa,decl){
  const alloc=sa.allocation;
  if(!(alloc.total>0)) return `<section class="panel rv-alloc" aria-labelledby="rvAllocT"><h2 class="rv-h2" id="rvAllocT">Allocation par classe</h2>
    <p class="muted">Aucun placement à comparer pour ce périmètre. <a class="rv-a" href="#patrimoine/placements" data-goto="patrimoine/placements">Voir les placements</a></p></section>`;
  const ST={dans:"dans la fourchette",sous:"en dessous","au-dessus":"au-dessus"};
  const rows=sa.ecarts.map(e=>{
    const g=geometrie(e.min,e.max,e.reel);
    const ecart=e.statut==="dans"?"":` · écart ${e.ecartPts>0?"+":"−"}${String(Math.abs(Math.round(e.ecartPts*10)/10)).replace(".",",")} pt${Math.abs(e.ecartPts)>=2?"s":""}`;
    return `<div class="rv-arow">
      <div class="rv-ahead"><span class="rv-al">${esc(e.label)}</span><span class="ui-puce ${e.statut==="dans"?"bon":"surveiller"}"><span class="ui-puce-point" aria-hidden="true"></span>${ST[e.statut].charAt(0).toUpperCase()+ST[e.statut].slice(1)}</span></div>
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
    <div class="rv-ahd"><div><h2 class="rv-h2" id="rvAllocT">Allocation par classe</h2>
    <p class="rv-sub">Fourchette du profil ${esc(decl.label)} (bande) et répartition réelle ${esc(scopeDe())} (barre), sur ${eur(alloc.total)}${avecImmo&&immoPhysique()>0?" immobilier compris":""}.</p></div>${immoHtml()}</div>
    <div class="rv-arows">${rows}<p class="rv-div"><b>${esc((R().GROUPES_LABELS||{}).diversifiants||"Or et autres")}</b> : <span class="num">${fpct(div)}</span> <span class="muted">· à part : ils diversifient sans entrer dans les fourchettes.</span></p></div>
    <div class="rv-legend"><span><i class="lg-band"></i>fourchette cible</span><span><i class="lg-real"></i>réel dans la fourchette</span><span><i class="lg-off"></i>réel hors fourchette</span></div>
  </section>`;
}

/* Accordéon de la page : fermé par défaut, ouvert s'il l'était au rendu précédent (accOuverts, mis à jour au « toggle »). */
const acc=(cle,titre,contenu,cls)=>`<details class="ui-acc ${cls||""}" data-rv-acc="${esc(cle)}"${accOuverts.has(cle)?" open":""}><summary class="ui-acc-titre" data-rv-acc-t="${esc(cle)}"><span>${esc(titre)}</span><span class="ui-acc-chevron">${CHEVRON}</span></summary><div class="ui-acc-corps">${contenu}</div></details>`;
const METHODE=`<div class="rv-meth"><p>Volatilité du portefeuille à partir de la volatilité historique de chaque classe et de corrélations simplifiées. Baisse plausible : la plus grave de deux estimations, 2,33 volatilités (une année sur 100 avec une loi normale) ou la moitié de la pire baisse historique pondérée, car la loi normale sous-estime les krachs. Profil équivalent : le moins risqué des profils dont la perte tolérée couvre cette baisse.</p>
  <p class="muted">Sources : MSCI, Bloomberg Euro Aggregate, IEIF, LBMA, CoinMarketCap, Banque de France. Ordres de grandeur historiques, pas des prévisions.</p></div>`;
function accordeonsHtml(E){
  const r=E.sa.risque, M_=M();
  const lab=k=>(M_&&M_.CLASSES[k]&&M_.CLASSES[k].label)||(window.Calc.CLASSES_LABELS[k])||k;
  const maxC=Math.max(1,...r.contributions.map(c=>c.contributionPct));
  const lignes=r.contributions.filter(c=>c.contributionPct>=0.05||c.poids>=0.5);
  const contrib=U().voirPlus(lignes,5,c=>`<div class="rv-crow">
    <span class="rv-cl" title="${esc(lab(c.classe))}">${esc(lab(c.classe))}</span>
    <span class="rv-ctrack" aria-hidden="true"><span style="width:${(c.contributionPct/maxC*100).toFixed(2)}%"></span></span>
    <span class="num rv-cv">${fpct(c.contributionPct,0)}</span><span class="num rv-cp muted">${fpct(c.poids,0)} du total</span></div>`,"Voir plus","div","rv-contributions");
  return `<div class="rv-accs">${acc("contributions","D'où vient le risque",`<p class="rv-sub">Part de chaque classe dans la variabilité du portefeuille : une petite ligne très volatile peut peser lourd.</p><div class="rv-crows">${contrib}</div>`)}
    ${acc("methode","Comment c'est calculé",METHODE)}</div>`;
}

/* Rattachement poche → classe, en lecture : blocs présents dans le périmètre, classe détectée et correction enregistrée
   (profiles.classes). La correction se fait avec Claude. */
function classeLabel(k){ const M_=M(); return window.Calc.CLASSES_LABELS[k]||(M_&&M_.CLASSES[k]&&M_.CLASSES[k].label)||k; }
/* Fiche d'une ligne dans Patrimoine › Comptes : même adresse qu'App.ouvrir({ ligne }) (App.lienCompte → ComptesView.lien). */
function lienLigne(id){
  const A=window.App, CV=window.ComptesView;
  if(A&&typeof A.lienCompte==="function") return A.lienCompte({ligne:id});
  if(CV&&typeof CV.lien==="function") return CV.lien({ligne:id});
  return "patrimoine/comptes?ligne="+encodeURIComponent(String(id));
}
const MAX_LIGNES_POCHE=6;
/** Lignes d'une poche en liens vers leur fiche (les plus grosses d'abord, MAX_LIGNES_POCHE au plus). */
function lignesPocheHtml(L){
  const tri=L.slice().sort((a,b)=>window.Calc.val(b)-window.Calc.val(a)), vus=tri.slice(0,MAX_LIGNES_POCHE);
  return `<ul class="rv-plignes">${vus.map(p=>{const r=lienLigne(p.id);return `<li><a href="#${esc(r)}" data-goto="${esc(r)}">${esc(p.name||"Ligne sans nom")}</a></li>`;}).join("")}${tri.length>vus.length?`<li class="muted">et ${tri.length-vus.length} autre${tri.length-vus.length>1?"s":""}</li>`:""}</ul>`;
}
function renderClasses(){
  const box=$("rvClassesBody"), M_=M(), sur=S.classes||{}, u=U();
  const vivantes=(S.positions||[]).filter(p=>window.Calc.inScope(p,S.scope)&&window.Calc.counted(p));
  const blocs=[...new Set(vivantes.map(p=>p.bloc).filter(Boolean))];
  const detecte=(p,s)=>M_?M_.classeRisque(p,s):window.Calc.classe(p.bloc,s);
  let h;
  if(!blocs.length) h='<p class="muted">Aucune poche dans ce périmètre.</p>';
  else{
    const rows=blocs.map(b=>{
      const L=vivantes.filter(p=>p.bloc===b), montant=L.reduce((a,p)=>a+window.Calc.val(p),0);
      const effectif=[...new Set(L.map(p=>detecte(p,sur)))];
      const corrige=Object.prototype.hasOwnProperty.call(sur,b);
      return `<li class="rv-prow">
        <div class="rv-pn"><b>${esc(b)}</b><span class="muted">${L.length} ligne${L.length>1?"s":""} · <span class="num">${eur(montant)}</span></span></div>
        <div class="rv-pc"><span>${esc(effectif.map(classeLabel).join(" + "))}</span><span class="rv-pt">${corrige?"corrigée":"automatique"}</span></div>
        ${lignesPocheHtml(L)}
      </li>`;
    }).join("");
    h=`<p class="muted">La classe de chaque poche est déduite de son nom. Si elle ne correspond pas à son contenu (par exemple une poche « Protection » qui mélange fonds euros et or), corrige-la avec Claude. Le rattachement vaut pour tout le foyer ; seules les poches ${esc(scopeDe())} sont listées.</p>
      <ul class="rv-prows">${rows}</ul>
      <div class="rv-pacts">${u?u.demanderAClaude(phraseRisque("placements","corriger la classe de risque d'une de mes poches (Pilotage › Risque)"),"Corriger avec Claude"):""}</div>`;
  }
  if(h!==sig.classes){ sig.classes=h; box.innerHTML=h; }
}

/* ---------- panneaux de détail (cartes) ---------- */
function profilPanneauHtml(E){
  const rq=E.rq, decl=E.decl, ev=E.sa.evaluation, score=nb(rq.score)?+rq.score:ev.score;
  const bandes=R().PROFILS.map((p,k)=>`<span class="rv-gb${p.id===rq.profil?" on":""}" style="left:${k*20}%"><span>${esc(p.label)}</span></span>`).join("");
  const gf=(ev.gardeFous||[]).length&&ev.profilAvantGardeFous!==rq.profil?ev.gardeFous:[];
  const gfHtml=gf.length?`<div class="rv-gf"><p class="rv-gft"><b>Plafonné à ${esc(labelProfil(rq.profil))}</b> : ${esc(gf.map(g=>raison(g,ev)).join(", "))}.</p>
    <p class="rv-muet">Ton score seul donnerait ${esc(labelProfil(ev.profilAvantGardeFous))}.</p>
    <ul>${gf.map(g=>`<li>${esc(g.texte)}</li>`).join("")}</ul></div>`:"";
  const date=dateFr(rq.date);
  const lignes=resume(QS(),rq.reponses||{},{}).map(l=>`<li><span class="rv-rq">${esc(l.theme)}</span><span class="rv-rv">${esc(l.reponse||"sans réponse")}</span></li>`).join("");
  return `<p class="rv-desc">${esc(decl.description)}</p>
    <p class="rv-muet">Perte maximale tolérée sur un an : ${decl.perteMax} %${date?" · réponses du "+esc(date):""}</p>
    <div class="rv-gauge">
      <div class="rv-gh"><span class="rv-gl">Score</span><b class="num">${nb(score)?score:"—"}<span class="rv-muet">/100</span></b></div>
      <span class="rv-gt" role="img" aria-label="${esc("Score "+score+" sur 100 : de 0 à 19 Prudent, 20 à 39 Modéré, 40 à 59 Équilibré, 60 à 79 Dynamique, 80 à 100 Offensif")}">${bandes}<span class="rv-gm" style="left:${Math.max(0,Math.min(100,+score||0))}%"></span></span>
      <div class="rv-gs"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
    </div>
    ${gfHtml}
    ${U().accordeon({titre:"Tes réponses validées",contenu:`<ol class="rv-rlist">${lignes}</ol>`})}
    <div class="rv-pacts">${lienRevoir(E)}</div>`;
}
function risquePanneauHtml(E){
  const r=E.sa.risque, total=E.sa.allocation.total, perte=-r.baissePlausible, cls=E.v.ecart==null||E.v.ecart===0?"ok":E.v.ecart>0?"crit":"warn";
  return `<p class="rv-bad">Dans une mauvaise année (1 sur 100), ton portefeuille pourrait perdre environ <b>${fpct(perte,0)}</b>${total>0?", soit environ <b class=\"num\">"+eur(total*perte/100)+"</b>":""}.</p>
    <div class="rv-kpis">
      <div class="rv-kpi"><span class="rv-kl">Volatilité annuelle</span><b class="num">${fpct(r.volatilite)}</b><span class="rv-muet">variation typique sur un an</span></div>
      <div class="rv-kpi"><span class="rv-kl">Baisse plausible sur un an</span><b class="num">${fpct(r.baissePlausible,0)}</b><span class="rv-muet">1 année sur 100</span></div>
      <div class="rv-kpi"><span class="rv-kl">Pire baisse historique</span><b class="num">${fpct(r.pireBaisseHistorique,0)}</b><span class="rv-muet">pondérée par tes classes</span></div>
      <div class="rv-kpi"><span class="rv-kl">Profil équivalent</span><b>${esc(labelProfil(r.profilEquivalent))}</b><span class="rv-muet">au vu de cette baisse</span></div>
    </div>
    <p class="rv-cmp ${cls}">${esc(E.decl?E.v.phrase:"Ton portefeuille se comporte comme un profil "+(E.eq?E.eq.label:"—")+". Fais ton profil de risque avec Claude pour le comparer à ce que tu peux supporter.")}</p>
    ${E.decl?"":`<div class="rv-pacts">${lienFaire()}</div>`}
    ${U().accordeon({titre:"Comment c'est calculé",contenu:METHODE})}`;
}
function ouvrirCarte(id,el){
  const u=U(); if(!u||!R()) return;
  const E=etat();
  if(id==="declare"&&E.decl){
    panneau="declare"; retourPanneau=el||null;
    u.panneau.ouvrir({titre:"Profil "+E.decl.label,contenu:profilPanneauHtml(E),retour:el,surFermeture:fermeturePanneau,
      pied:u.demanderAClaude("Mon profil de risque dans Boussole est "+E.decl.label+" : explique-moi ce qu'il implique et si mes réponses me semblent cohérentes.")});
  }else if((id==="equivalent"||id==="perte")&&E.eq){
    panneau="risque"; retourPanneau=el||null;
    u.panneau.ouvrir({titre:"Risque réel du portefeuille",contenu:risquePanneauHtml(E),retour:el,surFermeture:fermeturePanneau,
      pied:u.demanderAClaude(questionClaude({declare:E.decl,equivalent:E.eq,profils:R().PROFILS}))});
  }
}
/* Fermeture d'un panneau : si la carte d'origine a été redessinée, le focus va à son remplaçant, sinon au verdict. */
function fermeturePanneau(o){
  const el=retourPanneau;
  panneau=null; retourPanneau=null;
  if((o&&o.focus===false)||!root) return;
  if(el&&el.isConnected) return;
  const cle=el&&el.getAttribute&&el.getAttribute("data-ui-carte");
  const n=(cle&&root.querySelector('[data-ui-carte="'+CSS.escape(cle)+'"]'))||$("rvVerdict");
  if(n) n.focus();
}

function mount(r){
  root=r;
  /* État des accordéons de la page gardé d'un rendu à l'autre ; le HTML mémorisé suit le DOM (pas de réécriture inutile). */
  root.addEventListener("toggle",e=>{
    const d=e.target; if(!d||!d.getAttribute) return;
    const k=d.getAttribute("data-rv-acc"); if(!k) return;
    if(d.hasAttribute("open")) accOuverts.add(k); else accOuverts.delete(k);
    if(R()&&window.Calc&&U()) sig.main=pageHtml(etat());
  },true);
  const u=U(); if(u) u.brancher(root,{surCarte:(id,el)=>ouvrirCarte(id,el)});
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null,
    risque:snap.risque&&typeof snap.risque==="object"?snap.risque:null,classes:snap.classes||{}};
  dirty=true;
  if(visible){ render(); dirty=false; }
}
function show(){ if(dirty){ render(); dirty=false; } }
/* Chiffre clé : le profil enregistré, sinon « À définir ». */
function headline(){ const id=S.risque&&S.risque.profil; return id?labelProfil(id):"À définir"; }
const api={mount,update,show,headline};
const reg=()=>App.register("risque-view",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
