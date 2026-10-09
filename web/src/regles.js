(function(){
/* Profil et données › Règles : règles d'alerte (config.rules) et cible du matelas de précaution (config.cushion),
   écrites dans config/main. Les alertes qui en découlent s'affichent dans Recommandations › Actions. */
let S={scope:"foyer",people:[],positions:[],config:null,status:null,db:null};
let root=null,dirty=true;
const fmt2=new Intl.NumberFormat("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2});
const eur2=v=>v==null||isNaN(v)?"—":fmt2.format(v)+" €";
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function ruleCtx(){ return {positions:S.positions,config:S.config||{},scope:S.scope,people:S.people,today:today(),status:S.status}; }
const rulesOf=()=>(S.config&&Array.isArray(S.config.rules))?S.config.rules:[];

function render(){ renderRules(); fillSelects(); }
function renderRules(){
  const rules=rulesOf(); const R=window.Rules;
  $("ruleCount").textContent=rules.length?rules.length+" règle"+(rules.length>1?"s":""):"";
  $("ruleList").innerHTML=rules.length?rules.map((r,i)=>`<li><span>${esc(R?R.describe(r,ruleCtx()):r.type)}</span><button type="button" class="btn ghost tiny" data-rule-del="${i}" aria-label="Supprimer la règle : ${esc(R?R.describe(r,ruleCtx()):r.type)}">Supprimer</button></li>`).join(""):'<li class="muted small">Aucune règle pour l\'instant : seuls les contrôles intégrés (cibles, matelas, mise à jour, échéances) s\'appliquent.</li>';
  // matelas : ne pas écraser une saisie en cours
  const f=$("cushForm"); if(f&&!f.contains(document.activeElement)&&!f.dataset.dirty){
    const c=(S.config&&S.config.cushion)||{}; const mode=c.mode==="months"?"months":"amount";
    $("cuMode").value=mode; $("cuMin").value=c.min??""; $("cuMax").value=c.max??""; $("cuMonths").value=c.months??""; $("cuDep").value=c.depenses??"";
    cushFields();
  }
}
function ruleFields(){
  const t=$("rfType").value, need=(window.Rules&&window.Rules.TYPES[t]?.fields)||[];
  [["rfPctL","pct"],["rfBlocL","bloc"],["rfPosL","position_id"],["rfEnvL","envelope"],["rfPriceL","price"],["rfCapL","cap"],["rfDaysL","days"]].forEach(([id,k])=>{$(id).hidden=!need.includes(k);});
}
function cushFields(){ const m=$("cuMode").value==="months"; ["cuMinL","cuMaxL"].forEach(id=>$(id).hidden=m); ["cuMonthsL","cuDepL"].forEach(id=>$(id).hidden=!m); }
function fillSelects(){
  const opts=(el,list)=>{const sig=JSON.stringify(list); if(el.dataset.sig===sig) return; const c=el.value; el.innerHTML=list.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join(""); el.dataset.sig=sig; if(list.some(([v])=>v===c)) el.value=c;};
  const ps=[...S.positions].filter(p=>p.status!=="clôturé").sort((a,b)=>(a.envelope+a.name).localeCompare(b.envelope+b.name,"fr"));
  const envs=[...new Set(S.positions.map(p=>p.envelope))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"fr"));
  const tg=S.config?.targets||{};
  const blocs=[...new Set([...S.positions.map(p=>p.bloc),...(S.people||[]).flatMap(p=>Object.keys(tg[p.id]||{}))])].filter(Boolean).sort((a,b)=>a.localeCompare(b,"fr"));
  opts($("rfBloc"),blocs.map(x=>[x,x])); opts($("rfEnv"),envs.map(x=>[x,x]));
  opts($("rfPos"),ps.filter(p=>p.mode==="market").map(p=>[p.id,p.name+(p.price!=null?" · "+eur2(p.price):"")]));
}

function mount(r){
  root=r;
  const numv=id=>{const v=$(id).value;return v===""?null:Number(v);};
  $("rfType").addEventListener("change",ruleFields); ruleFields();
  $("ruleForm").addEventListener("submit",async ev=>{ev.preventDefault(); const msg=m=>{$("rfMsg").textContent=m;};
    if(!S.db) return msg("Base indisponible dans cette vue.");
    const raw={type:$("rfType").value,pct:$("rfPct").value,bloc:$("rfBloc").value,position_id:$("rfPos").value,envelope:$("rfEnv").value,price:$("rfPrice").value,cap:$("rfCap").value,days:$("rfDays").value};
    const n=window.Rules.normalize(raw); if(n.error) return msg(n.error);
    const rules=[...rulesOf(),n.rule]; $("rfBtn").disabled=true;
    try{ await S.db.doc("config/main").update({rules}); msg("Règle ajoutée : "+window.Rules.describe(n.rule,ruleCtx())+"."); ["rfPct","rfPrice","rfCap","rfDays"].forEach(id=>$(id).value=""); }
    catch(e){ msg(e?.code==="invalid_argument"?"Enregistrement refusé : vous n'avez pas les droits d'écriture.":"Enregistrement impossible ("+(e?.code||"erreur")+"). Réessayez."); }
    finally{$("rfBtn").disabled=false;}
  });
  $("cuMode").addEventListener("change",()=>{cushFields(); $("cushForm").dataset.dirty="1";});
  $("cushForm").addEventListener("input",()=>{$("cushForm").dataset.dirty="1";});
  $("cushForm").addEventListener("submit",async ev=>{ev.preventDefault(); const msg=m=>{$("cuMsg").textContent=m;}; if(!S.db) return msg("Base indisponible dans cette vue.");
    const months=$("cuMode").value==="months"; let cushion;
    if(months){ const mo=numv("cuMonths"), dep=numv("cuDep"); if(!(mo>0)||!(dep>0)) return msg("Indiquez un nombre de mois et des dépenses mensuelles positifs."); cushion={mode:"months",months:mo,depenses:dep}; }
    else { const mi=numv("cuMin"), ma=numv("cuMax"); if(mi==null||mi<0) return msg("Indiquez un montant minimum."); if(ma!=null&&ma<mi) return msg("Le maximum doit être supérieur au minimum."); cushion={mode:"amount",min:mi,max:ma}; }
    $("cuBtn").disabled=true;
    try{ await S.db.doc("config/main").update({cushion}); delete $("cushForm").dataset.dirty; msg("Matelas enregistré."); }
    catch(e){ msg("Enregistrement impossible ("+(e?.code||"erreur")+")."); }
    finally{$("cuBtn").disabled=false;}
  });
  root.addEventListener("click",async ev=>{const d=ev.target.closest?.("[data-rule-del]"); if(!d||!S.db||!S.config) return; d.disabled=true;
    const k=+d.dataset.ruleDel; const rules=rulesOf().filter((_,i)=>i!==k);
    try{ await S.db.doc("config/main").update({rules}); $("rfMsg").textContent="Règle supprimée."; }catch(e){ d.disabled=false; $("rfMsg").textContent="Suppression impossible ("+(e?.code||"erreur")+")."; }
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
