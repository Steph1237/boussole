(function(){
/* Diagnostic › Santé : bonnes pratiques notées (Pratiques.evaluer, pratiques.js) en pleine page.
   Note globale sur 100 et verdict, puis les 4 familles (Sécurité, Effort, Allocation, Efficacité) en cartes : note de la famille,
   poids, et chaque critère (points sur 20, situation, repère, piste, règle et source dépliables, lien pour compléter une donnée).
   Les critères « informatifs » (exposition hors euro) sont affichés sans note. Respecte le périmètre (Foyer / personne). */
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null,objectifs:[],risque:null,classes:{}};
let root=null,dirty=true,last=null;
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

const NOMBRES=["aucun","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix"];
/* Libellé du bouton selon la vue où compléter ou agir (le lien vient du critère). */
const LIEN_LABEL={"avenir/plan":"Compléter le budget","profil/donnees":"Compléter le profil","bilan/placements":"Voir les placements",
  "diagnostic/risque":"Ouvrir le profil de risque","recos/actions":"Voir les actions","profil/claude":"Compléter avec Claude"};
const lienLabel=r=>LIEN_LABEL[r]||"Compléter";
function niveau(c){ return c.informatif?"info":c.aCompleter?"na":c.points>=16?"good":c.points>=10?"warn":"crit"; }
const classeTotal=t=>t>=80?"good":t>=60?"warn":"crit";
const notes=r=>r.criteres.filter(c=>!c.aCompleter&&!c.informatif);

function calcule(){
  if(!window.Pratiques||typeof window.Pratiques.evaluer!=="function") return null;
  try{ return window.Pratiques.evaluer({positions:S.positions,profil:S.profil,config:S.config,budget:S.budget,objectifs:S.objectifs,scope:S.scope,risque:S.risque,classes:S.classes,today:new Date()}); }
  catch(e){ console.error("bonnes pratiques",e); return null; }
}

function critereHtml(c){
  const niv=niveau(c), jauge=c.aCompleter||c.informatif?0:Math.max(0,Math.min(100,c.points/(c.sur||20)*100));
  const pts=c.informatif?'<span class="pill">information</span>':c.aCompleter?'<span class="pill">à compléter</span>':c.points+'<span class="muted">/'+c.sur+"</span>";
  const det=Array.isArray(c.details)&&c.details.length?'<ul class="sc-det">'+c.details.map(d=>`<li class="${esc(d.statut)}">${esc(d.texte)}</li>`).join("")+"</ul>":"";
  const go=c.lien&&(c.aCompleter||(!c.informatif&&c.points<16))?`<a class="sc-go${c.aCompleter?" cta":""}" href="#${esc(c.lien)}" data-goto="${esc(c.lien)}">${esc(c.aCompleter?lienLabel(c.lien):"Où agir")}</a>`:"";
  return `<article class="scrit ${niv}" data-cle="${esc(c.cle)}">
    <div class="sc-head"><h4>${esc(c.titre)}</h4><span class="sc-pts num">${pts}</span></div>
    ${c.informatif?"":`<span class="sg" role="img" aria-label="${c.aCompleter?"à compléter":c.points+" sur "+c.sur}"><span class="sgf ${niv}" style="width:${jauge}%"></span></span>`}
    <dl class="sc-dl"><dt>Votre situation</dt><dd>${esc(c.texte)}</dd><dt>Repère</dt><dd>${esc(c.cible)}</dd></dl>
    ${det?det:c.piste?`<p class="sc-piste small">${esc(c.piste)}</p>`:""}
    <details class="sc-src small"><summary>Règle et source</summary><dl><dt>Règle</dt><dd>${esc(c.regle)}</dd><dt>Source</dt><dd>${esc(c.source)}</dd></dl></details>
    ${go}
  </article>`;
}

function render(){
  const r=last;
  $("santeTitle").textContent="Bonnes pratiques "+scopeDe();
  if(!r){
    $("santeTotal").textContent="—"; $("santeVerdict").textContent="Le score n'est pas disponible dans cette vue."; $("santeVerdict").className="sante-verdict";
    $("santePartiel").textContent=""; $("santeJauge").innerHTML=""; $("santeFamilles").innerHTML=""; return;
  }
  const N=notes(r), aTravailler=N.filter(c=>c.points<16).length, aCompl=r.criteres.filter(c=>c.aCompleter).length;
  const note=r.familles.some(f=>f.total!=null);
  $("santeTotal").textContent=note?String(r.total):"—";
  const notees=r.familles.filter(f=>f.total!=null).length;
  $("santeVerdict").textContent=!note?"Complétez le budget, le profil et vos placements pour calculer la note."
    :r.provisoire?"Note provisoire : "+notees+" famille"+(notees>1?"s":"")+" sur "+r.familles.length+" notée"+(notees>1?"s":"")+". Complétez votre bilan pour une note fiable."
    :r.total>=80?"Solide":r.total>=60?"Correct, "+(NOMBRES[aTravailler]||aTravailler)+" point"+(aTravailler>1?"s":"")+" à travailler":"À consolider";
  $("santeVerdict").className="sante-verdict "+(note&&!r.provisoire?classeTotal(r.total):"");
  $("santePartiel").textContent=note&&aCompl?"Note calculée sur "+N.length+" critère"+(N.length>1?"s":"")+" : "+aCompl+" à compléter ne compte"+(aCompl>1?"nt":"")+" pas encore.":"";
  $("santeJauge").innerHTML=`<span class="sj-f ${note?classeTotal(r.total):"na"}" style="width:${note?Math.max(0,Math.min(100,r.total)):0}%"></span>`;
  $("santeFamilles").innerHTML=r.familles.map(f=>{
    const cls=f.total==null?"na":classeTotal(f.total);
    return `<section class="sfam ${cls}" aria-labelledby="sfam-${esc(f.cle)}">
      <div class="sf-head"><div><h3 id="sfam-${esc(f.cle)}">${esc(f.titre)}</h3><span class="small muted">poids ${f.poids} % de la note</span></div>
        <span class="sf-pts num">${f.total==null?"—":f.total}<span class="muted">/100</span></span></div>
      <span class="sg sf-g" aria-hidden="true"><span class="sgf ${cls}" style="width:${f.total==null?0:f.total}%"></span></span>
      <div class="sf-crits">${f.criteres.length?f.criteres.map(critereHtml).join(""):'<p class="small muted">Aucun critère ne s\'applique à votre situation pour le moment.</p>'}</div>
    </section>`;
  }).join("");
}

function mount(r){ root=r; }
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
