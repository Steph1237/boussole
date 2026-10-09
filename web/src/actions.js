(function(){
/* Recommandations › Actions (provisoire, en attendant le moteur de recommandations) : une seule liste priorisée qui réunit
   les alertes des règles de l'utilisateur (Rules.evaluate sur config.rules), les contrôles intégrés (Rules.builtins)
   et les pistes du score de santé (Plan.score) pour les critères qui ne sont pas au maximum.
   Gravité : crit > warn > info > piste. Chaque entrée renvoie vers la vue où agir.
   Fonctions pures exportées pour les tests (module.exports) : ordonner, lienAlerte, lienPiste, pistes, construire.
   Dans le navigateur, window.Actions.items() donne la liste courante (utilisée par la vue d'ensemble du Bilan). */

/* ---------- logique pure ---------- */
const RANG={crit:0,warn:1,info:2,piste:3};
const rangDe=l=>RANG[l]??2;
/* Tri stable : gravité, puis `ordre` (les pistes les plus faibles d'abord), puis ordre d'arrivée. */
function ordonner(items){
  return (Array.isArray(items)?items:[]).map((x,i)=>({x,i}))
    .sort((a,b)=>(rangDe(a.x.level)-rangDe(b.x.level))||((a.x.ordre??0)-(b.x.ordre??0))||(a.i-b.i))
    .map(o=>o.x);
}
const L_PLACEMENTS={route:"bilan/placements",label:"Voir les placements"};
const L_BUDGET={route:"avenir/plan",label:"Ouvrir le budget"};
const L_PROFIL={route:"profil/donnees",label:"Compléter le profil"};
const L_REGLES={route:"profil/regles",label:"Modifier la règle"};
/* Où agir pour une alerte : une règle porte sur les placements (lien secondaire vers ses réglages) ; parmi les contrôles
   intégrés, le matelas renvoie au budget, les cibles, la mise à jour nocturne et les signaux de l'agent aux placements. */
function lienAlerte(a){
  if(a&&a.rule) return {lien:L_PLACEMENTS,lien2:L_REGLES};
  const t=String(a&&a.title||"");
  if(/^Matelas/i.test(t)) return {lien:L_BUDGET,lien2:{route:"profil/regles",label:"Régler la cible"}};
  if(/^Le .*\(dans \d+ jours?\)/.test(String(a&&a.text||""))) return {lien:{route:"avenir/plan",label:"Voir le plan"},lien2:null}; // échéance (config.milestones)
  return {lien:L_PLACEMENTS,lien2:null}; // écart aux cibles, mise à jour nocturne, signaux de l'agent
}
const PISTE_LIEN={matelas:L_BUDGET,epargne:L_BUDGET,endettement:L_PROFIL,patrimoine:L_PROFIL,concentration:L_PLACEMENTS};
const lienPiste=cle=>PISTE_LIEN[cle]||L_PROFIL;
/* Pistes du score : critères calculés (pas « à compléter ») et sous le maximum. */
function pistes(score){
  return ((score&&score.items)||[]).filter(i=>!i.aCompleter&&i.points<i.sur).map(i=>({
    level:"piste",title:i.titre+" : "+i.points+"/"+i.sur,text:i.texte+" "+i.piste,cle:i.cle,ordre:i.points,lien:lienPiste(i.cle),lien2:null}));
}
/* ctx = { positions, config, scope, people, today, status, profil, budget } ; Rules et Plan injectés (window ou require). */
function construire(ctx,Rules,Plan){
  const out=[];
  if(Rules){
    const cfg=ctx.config||{};
    let A=[]; try{ A=Rules.evaluate(cfg.rules||[],ctx).concat(Rules.builtins(ctx)); }catch(e){ if(typeof console!=="undefined") console.error("alertes",e); }
    A.forEach(a=>{ const l=lienAlerte(a); out.push({level:["crit","warn","info"].includes(a.level)?a.level:"info",title:a.title,text:a.text,rule:a.rule||null,lien:l.lien,lien2:l.lien2}); });
  }
  if(Plan&&typeof Plan.score==="function"){
    try{ out.push(...pistes(Plan.score({positions:ctx.positions,profil:ctx.profil,config:ctx.config,budget:ctx.budget,scope:ctx.scope,today:new Date()}))); }
    catch(e){ if(typeof console!=="undefined") console.error("score",e); }
  }
  return ordonner(out);
}
const urgents=items=>items.filter(i=>i.level==="crit"||i.level==="warn").length;
const PURE={ordonner,lienAlerte,lienPiste,pistes,construire,urgents,RANG};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
let S={scope:"foyer",people:[],positions:[],config:null,status:null,profil:null,budget:null};
let root=null,dirty=true,items=[],filtre="tout";
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const PILL={crit:"urgent",warn:"à traiter",info:"à surveiller",piste:"piste"};
const FILTRES={tout:()=>true,urgent:i=>i.level==="crit"||i.level==="warn",surveiller:i=>i.level==="info",pistes:i=>i.level==="piste"};
const VIDE={tout:"Rien à signaler pour le moment : vos règles d'alerte ne relèvent aucun point et le score de santé est au maximum sur chaque critère calculé.",
  urgent:"Rien d'urgent : aucune alerte à traiter.",surveiller:"Aucun point à surveiller.",pistes:"Aucune piste : chaque critère calculé du score est au maximum."};

function calcule(){
  items=construire({positions:S.positions,config:S.config||{},scope:S.scope,people:S.people,today:today(),status:S.status,profil:S.profil,budget:S.budget},window.Rules,window.Plan);
}
const lienHtml=(l,cls)=>l?`<a class="${cls}" href="#${esc(l.route)}" data-goto="${esc(l.route)}">${esc(l.label)}</a>`:"";
function render(){
  const lr=S.status&&S.status.veille&&S.status.veille.lastReport, t=lr?new Date(lr):null;
  $("acVeille").textContent=t&&!isNaN(t)?"Veille : dernier rapport le "+t.toLocaleDateString("fr-FR",{day:"2-digit",month:"long"})+" — les signaux et opportunités déposés par votre Claude apparaîtront ici (bientôt).":"Veille : jamais lancée — votre Claude pourra déposer ici des signaux et opportunités (bientôt).";
  const n={tout:items.length,urgent:items.filter(FILTRES.urgent).length,surveiller:items.filter(FILTRES.surveiller).length,pistes:items.filter(FILTRES.pistes).length};
  root.querySelectorAll("[data-ac-filtre]").forEach(b=>{const k=b.dataset.acFiltre; b.setAttribute("aria-pressed",String(k===filtre)); b.querySelector(".ac-n").textContent=n[k]?String(n[k]):"";});
  const u=urgents(items);
  $("acResume").textContent=!items.length?"Aucun point relevé.":(u?u+" point"+(u>1?"s":"")+" à traiter":"Rien d'urgent")+" · "+items.length+" au total";
  const list=items.filter(FILTRES[filtre]);
  $("acList").innerHTML=list.length?list.map(i=>`<li class="ac-row ${esc(i.level)}">
    <span class="pill ${esc(i.level)}">${PILL[i.level]||"info"}</span>
    <div class="ac-body"><strong class="ac-t">${esc(i.title)}</strong><p class="ac-x small">${esc(i.text)}</p>
    <div class="ac-links">${lienHtml(i.lien,"ac-go")}${lienHtml(i.lien2,"ac-go2")}</div></div></li>`).join("")
    :`<li class="ac-empty muted">${VIDE[filtre]}</li>`;
}

function mount(r){
  root=r;
  root.addEventListener("click",ev=>{const b=ev.target.closest("[data-ac-filtre]"); if(!b) return; filtre=b.dataset.acFiltre; render();});
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,status:snap.status,profil:snap.profil||null,budget:snap.budget||null};
  calcule(); dirty=true; if(visible){render();dirty=false;}
}
function show(){ if(dirty){render();dirty=false;} }
/* Pastille de la navigation : nombre d'alertes urgentes ou à traiter (crit + warn) ; vide quand il n'y en a pas. */
function headline(){ const u=urgents(items); return u?String(u):""; }
window.Actions={items:()=>items.slice(),...PURE};
const api={mount,update,show,headline};
const reg=()=>App.register("actions",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
