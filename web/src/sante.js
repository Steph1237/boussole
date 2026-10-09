(function(){
/* Diagnostic › Santé : score de santé financière (Plan.score, plan.js) en pleine page.
   Note sur 100, verdict, puis les cinq critères (sur 20) en cartes : jauge, situation, repère, piste toujours visible,
   lien vers la vue où compléter une donnée manquante. Respecte le périmètre (Foyer / personne). */
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null};
let root=null,dirty=true,last=null;
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

const NOMBRES=["aucun","un","deux","trois","quatre","cinq"];
/* Où compléter la donnée manquante : budget (Avenir) pour le matelas et l'épargne, Profil pour l'âge et les revenus,
   Placements pour la diversification. */
const SANTE_LIEN={matelas:"avenir/plan",epargne:"avenir/plan",endettement:"profil/donnees",patrimoine:"profil/donnees",concentration:"bilan/placements"};
const LIEN_LABEL={"avenir/plan":"Compléter le budget","profil/donnees":"Compléter le profil","bilan/placements":"Ajouter des placements"};
function santeNiveau(i){ return i.aCompleter?"na":i.points>=16?"good":i.points>=10?"warn":"crit"; }

function calcule(){
  if(!window.Plan||typeof window.Plan.score!=="function") return null;
  try{ return window.Plan.score({positions:S.positions,profil:S.profil,config:S.config,budget:S.budget,scope:S.scope,today:new Date()}); }
  catch(e){ console.error("score",e); return null; }
}

function render(){
  const sc=last;
  $("santeTitle").textContent="Santé financière "+scopeDe();
  if(!sc){
    $("santeTotal").textContent="—"; $("santeVerdict").textContent="Le score n'est pas disponible dans cette vue."; $("santeVerdict").className="sante-verdict";
    $("santePartiel").textContent=""; $("santeItems").innerHTML=""; return;
  }
  const complets=sc.items.filter(i=>!i.aCompleter), aTravailler=complets.filter(i=>i.points<16).length;
  $("santeTotal").textContent=complets.length?String(sc.total):"—";
  $("santeVerdict").textContent=!complets.length?"Complétez le budget et le profil pour calculer le score."
    :sc.total>=80?"Solide":sc.total>=60?"Correct, "+(NOMBRES[aTravailler]||aTravailler)+" point"+(aTravailler>1?"s":"")+" à travailler":"À consolider";
  $("santeVerdict").className="sante-verdict "+(!complets.length?"":sc.total>=80?"good":sc.total>=60?"warn":"crit");
  $("santePartiel").textContent=!sc.complet&&complets.length?"Score calculé sur "+complets.length+" critère"+(complets.length>1?"s":"")+" sur 5 : les critères à compléter ne comptent pas.":"";
  const jaugeTot=complets.length?Math.max(0,Math.min(100,sc.total)):0;
  $("santeJauge").innerHTML=`<span class="sj-f ${complets.length?(sc.total>=80?"good":sc.total>=60?"warn":"crit"):"na"}" style="width:${jaugeTot}%"></span>`;
  $("santeItems").innerHTML=sc.items.map(i=>{
    const niv=santeNiveau(i), lien=i.aCompleter?SANTE_LIEN[i.cle]:null;
    const jauge=i.aCompleter?0:Math.max(0,Math.min(100,i.points/i.sur*100));
    return `<article class="scard ${niv}" data-cle="${esc(i.cle)}">
      <div class="sc-head"><h3>${esc(i.titre)}</h3><span class="sc-pts num">${i.aCompleter?'<span class="pill">à compléter</span>':i.points+'<span class="muted">/'+i.sur+'</span>'}</span></div>
      <span class="sg" role="img" aria-label="${i.aCompleter?"à compléter":i.points+" sur "+i.sur}"><span class="sgf ${niv}" style="width:${jauge}%"></span></span>
      <dl class="sc-dl"><dt>Votre situation</dt><dd>${esc(i.texte)}</dd><dt>Repère</dt><dd>${esc(i.cible)}</dd></dl>
      <p class="sc-piste small">${esc(i.piste)}</p>
      ${lien?`<a class="sc-go" href="#${lien}" data-goto="${lien}">${LIEN_LABEL[lien]}</a>`:""}
    </article>`;
  }).join("");
}

/* Repères d'âge de l'explication, lus dans plan.js pour rester alignés sur le calcul. */
const AGES=[["u30","avant 30 ans"],["a30","de 30 à 39 ans"],["a40","de 40 à 49 ans"],["a50","de 50 à 59 ans"],["a60","de 60 à 69 ans"],["a70","à partir de 70 ans"]];
function mount(r){
  root=r;
  const R=window.Plan&&window.Plan.REPERES_AGE;
  if(R) $("santeReperes").textContent=AGES.filter(([k])=>R[k]!=null).map(([k,l])=>String(R[k]).replace(".",",")+" an"+(R[k]>1?"s":"")+" "+l).join(", ");
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null};
  last=calcule(); dirty=true; if(visible){render();dirty=false;}
}
function show(){ if(dirty){render();dirty=false;} }
/* Chiffre clé : « 94/100 », ou « – » tant qu'aucun critère n'est calculable. */
function headline(){ return last&&last.items.some(i=>!i.aCompleter)?last.total+"/100":"–"; }
const api={mount,update,show,headline};
const reg=()=>App.register("sante",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
