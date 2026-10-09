(function(){
/* Bilan › Placements (module « pilotage ») : synthèse du financier, courbe, enveloppes, allocation, registre des positions,
   saisie des mouvements, ordres, versements programmés, hypothèses et journal. Les données viennent du Store commun.
   Le score de santé est dans Diagnostic › Santé (sante.js), les alertes dans Recommandations › Actions (actions.js),
   les règles d'alerte et la cible du matelas dans Profil et données › Règles (regles.js). */
let S={scope:"foyer",people:[],positions:[],snapshots:[],tx:[],config:null,status:null,db:null};
let root=null,dirty=true;
const fmt=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const fmt2=new Intl.NumberFormat("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtq=new Intl.NumberFormat("fr-FR",{maximumFractionDigits:4});
const eur=v=>v==null||isNaN(v)?"—":fmt.format(Math.round(v))+" €";
const eur2=v=>v==null||isNaN(v)?"—":fmt2.format(v)+" €";
const pct=(v,d=1)=>v==null||isNaN(v)?"—":(v).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d})+" %";
const sgn=v=>v>0?"+":"";
const $=id=>root.querySelector("#"+id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((new Date(b)-new Date(a))/864e5);
const frDate=d=>d?new Date(d+"T12:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—";
const BLOC_COLORS={"Nasdaq 2x":"--s6","Monde":"--s1","Europe":"--s2","Convictions tech":"--s4","Asie":"--s5","Protection":"--s9","SCPI":"--s3","Épargne":"--s8","Crypto":"--s7","Obligations":"--s2"};
const col=b=>`var(${BLOC_COLORS[b]||"--s8"})`;

function val(p){ if(p.mode==="market"&&p.qty!=null&&p.price!=null) return p.qty*p.price; return Number(p.value)||0; }
function inScope(p){ return S.scope==="foyer"||p.owner===S.scope; }
function counted(p){ return p.status!=="à recevoir"&&p.status!=="clôturé"; }
function scoped(){ return S.positions.filter(p=>inScope(p)&&p.status!=="clôturé"); }
function snapVal(s){ return s[S.scope]; }
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

/* ---------- render ---------- */
function render(){
  const ps=scoped(); const live=ps.filter(counted);
  const total=live.reduce((a,p)=>a+val(p),0);
  const pend=ps.filter(p=>p.status==="à recevoir");
  $("totLabel").textContent="Patrimoine financier "+scopeDe();
  $("total").textContent=eur(total);
  $("pending").textContent=pend.length?("+ "+pend.map(p=>eur(val(p))+" "+p.name.toLowerCase()).join(", ")+" (non compté)"):"";
  // 30 days
  const snaps=S.snapshots.filter(s=>snapVal(s)!=null).sort((a,b)=>a.date<b.date?-1:1);
  const ref=[...snaps].reverse().find(s=>daysBetween(s.date,today())>=28);
  if(ref){const d=total-snapVal(ref);$("d30").textContent=sgn(d)+eur(d);$("d30").className="mid delta "+(d>=0?"up":"down");$("d30s").textContent="vs "+frDate(ref.date)+" ("+sgn(d)+pct(d/snapVal(ref)*100)+")";}
  else{$("d30").textContent="—";$("d30").className="mid delta";$("d30s").textContent="historique en cours de constitution";}
  // P/L
  let pl=0,cost=0; live.forEach(p=>{if(p.mode==="market"&&p.pru&&p.qty&&p.price){pl+=p.qty*(p.price-p.pru);cost+=p.qty*p.pru;}});
  $("pl").textContent=sgn(pl)+eur(pl); $("pl").className="mid "+(pl>=0?"pos":"neg");
  // épargne de précaution (poche « Épargne ») ; la cible (config.cushion) porte sur le foyer
  const cushPs=S.positions.filter(p=>p.bloc==="Épargne"&&inScope(p));
  const cushLive=cushPs.filter(counted).reduce((a,p)=>a+val(p),0);
  const cushPend=cushPs.filter(p=>p.status==="à recevoir").reduce((a,p)=>a+val(p),0);
  $("cush").textContent=eur(cushLive);
  const m=window.Calc.matelas(S.config);
  const cible=!m||!m.min?"pas de cible définie":(S.scope==="foyer"?"cible ":"cible du foyer ")+(m.max!=null&&m.max>0?eur(m.min)+" à "+eur(m.max):eur(m.min)+(m.mode==="months"?" ("+m.months+" mois)":""));
  $("cushs").textContent=cible+(cushPend?" · +"+eur(cushPend)+" à recevoir":"");
  const T=total||1; if(snaps.length||total) renderChart(snaps,total); else $("chart").innerHTML='<p class="muted">Chargement de l\'historique…</p>'; renderAlloc(live,T); renderEnv(live,T); renderLedger(ps,T);
  renderLists(); renderAgentNote(); fillSelects();
}

function renderAgentNote(){
  const st=S.status;
  $("agentNote").textContent=st?.summary?("Dernier compte rendu de l'agent : "+st.summary):"";
}

/* ---------- évolution : période et pas (periodes.js), résumé, courbe ----------
   Choix mémorisés dans localStorage « pilotage-evo ». La valeur en direct est le dernier point de la période courante. */
const EVO_KEY="pilotage-evo";
let evo={periode:"tout",du:"",au:"",gran:"auto"}, lastChart=null;
try{ const o=JSON.parse(localStorage.getItem(EVO_KEY)||"null"); if(o&&typeof o==="object") evo=Object.assign(evo,o); }catch(e){}
function saveEvo(){ try{ localStorage.setItem(EVO_KEY,JSON.stringify(evo)); }catch(e){} }
const ids=list=>(list||[]).map(x=>x.id);
function evoBornes(P,t,first){
  if(!ids(P.PERIODES).includes(evo.periode)) evo.periode="tout";
  if(evo.periode==="perso") return evo.du&&evo.au?P.bornes({du:evo.du,au:evo.au},t,first):P.bornes("tout",t,first);
  return P.bornes(evo.periode,t,first);
}
function syncEvoCtl(P,b,g){
  const box=$("evoCtl"); if(!box) return; box.hidden=false;
  box.querySelectorAll("[data-evo-per]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.evoPer===evo.periode)));
  $("evoPerso").hidden=evo.periode!=="perso";
  if(document.activeElement!==$("evoDu")) $("evoDu").value=b.du; if(document.activeElement!==$("evoAu")) $("evoAu").value=b.au;
  const sel=$("evoGran"); if(!ids(P.GRANULARITES).includes(evo.gran)) evo.gran="auto"; sel.value=evo.gran;
  const lab=(P.GRANULARITES.find(x=>x.id===g)||{}).label||g, oa=sel.querySelector('option[value="auto"]'); if(oa) oa.textContent="Auto ("+String(lab).toLowerCase()+")";
}
function renderChart(snaps,liveTotal){
  lastChart={snaps,liveTotal};
  const el=$("chart"), t=today(), P=window.Periodes;
  const pts=snaps.map(s=>({date:s.date,v:snapVal(s),src:s.source}));
  const withLive=!pts.length||pts[pts.length-1].date<t; if(withLive) pts.push({date:t,v:liveTotal,live:true});
  let serie, res=null;
  if(P&&typeof P.agreger==="function"){
    const b=evoBornes(P,t,pts.length?pts[0].date:t), g=!evo.gran||evo.gran==="auto"?P.auto(b):evo.gran;
    const ag=P.agreger(pts,b,g,p=>p.v);
    serie=ag.map(a=>({d:a.date,v:a.valeur,label:a.label}));
    if(withLive&&serie.length&&serie[serie.length-1].d===t) serie[serie.length-1].live=true;
    res=ag.length?P.resume(ag,pts,b,p=>p.v):null;
    syncEvoCtl(P,b,g);
  } else serie=pts.map(p=>({d:p.date,v:p.v,live:p.live,label:null}));
  const rs=$("evoRes");
  if(rs){ const ok=res&&res.variation!=null&&isFinite(res.variation);
    rs.innerHTML=ok?`<span class="delta ${res.variation>=0?"up":"down"}">${sgn(res.variation)}${eur(res.variation)}${res.variationPct!=null&&isFinite(res.variationPct)?" ("+sgn(res.variationPct)+pct(res.variationPct)+")":""}</span> sur la période`:""; }
  if(serie.length<2){el.innerHTML=P?'<p class="muted">Pas assez de points sur cette période pour tracer une courbe : élargissez la période.</p>':'<p class="muted">La courbe apparaîtra après le deuxième passage de l\'agent.</p>';return;}
  const W=640,H=260,L=64,R=16,T=14,B=30, n=serie.length;
  const xs=serie.map(p=>new Date(p.d+"T12:00:00").getTime()); const x0=Math.min(...xs),x1=Math.max(...xs);
  let lo=Math.min(...serie.map(p=>p.v)),hi=Math.max(...serie.map(p=>p.v)); const pad=(hi-lo)*.15||hi*.05||1; lo=Math.max(0,lo-pad);hi=hi+pad;
  const step=niceStep((hi-lo)/4); lo=Math.floor(lo/step)*step; hi=Math.ceil(hi/step)*step;
  const X=t=>L+(x1===x0?0:(t-x0)/(x1-x0))*(W-L-R), Y=v=>T+(1-(v-lo)/(hi-lo))*(H-T-B);
  let g=""; for(let v=lo;v<=hi+1;v+=step){g+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end">${fmt.format(v/1000)} k€</text>`;}
  // Libellés d'axe : jusqu'à 5, le dernier toujours, sans chevauchement (écart minimal de 70 unités).
  const nt=Math.min(5,n), ks=[]; for(let i=nt-1;i>=0;i--){const k=Math.round(i*(n-1)/(nt-1||1)); if(!ks.length||X(xs[ks[ks.length-1]])-X(xs[k])>=70) ks.push(k);}
  ks.forEach(k=>{const lab=serie[k].label||new Date(xs[k]).toLocaleDateString("fr-FR",{month:"short",year:"2-digit"});
    g+=`<text x="${X(xs[k])}" y="${H-8}" text-anchor="${k===n-1?"end":X(xs[k])-L<40?"start":"middle"}">${esc(lab)}</text>`;});
  const real=serie.filter(p=>!p.live); const line=real.map((p,i)=>(i?"L":"M")+X(xs[i]).toFixed(1)+","+Y(p.v).toFixed(1)).join("");
  const area=real.length>1?line+`L${X(xs[real.length-1])},${Y(lo)}L${X(xs[0])},${Y(lo)}Z`:"";
  const lastR=real[real.length-1], lp=serie[n-1];
  let dash=""; if(lp.live&&lastR) dash=`<line x1="${X(xs[real.length-1])}" y1="${Y(lastR.v)}" x2="${X(xs[n-1])}" y2="${Y(lp.v)}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 4"/>`;
  const dots=serie.map((p,i)=>i===n-1||n<=120?`<circle cx="${X(xs[i])}" cy="${Y(p.v)}" r="${i===n-1?5:2.5}" fill="${i===n-1?"var(--accent)":"var(--surface)"}" stroke="var(--accent)" stroke-width="1.5"><title>${esc(p.label||frDate(p.d))} : ${eur(p.v)}${p.live?" (en direct)":""}</title></circle>`:"").join("");
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du patrimoine">${g}${area?`<path d="${area}" fill="var(--accent-soft)" opacity=".7"/>`:""}${line?`<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>`:""}${dash}${dots}<text x="${X(xs[n-1])-8}" y="${Y(lp.v)-10}" text-anchor="end" style="fill:var(--ink);font-weight:500">${eur(lp.v)}</text></svg>`;
  const rec=snaps.some(s=>s.source==="relevés");
  $("chartNote").textContent=(rec?"premiers points reconstitués depuis vos relevés · ":"")+(lp.live?"pointillé : valeur en direct":"");
}
function niceStep(r){const p=Math.pow(10,Math.floor(Math.log10(r||1)));const n=r/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;}

function blocTargets(){ const t=S.config?.targets||{}; return S.scope==="foyer"?null:t[S.scope]||null; }
function renderAlloc(live,total){
  const by={}; live.forEach(p=>{by[p.bloc]=(by[p.bloc]||0)+val(p);});
  const tg=blocTargets()||{}; const tol=S.config?.targets?.tolerancePts??3;
  const keys=[...new Set([...Object.keys(by),...Object.keys(tg)])].sort((a,b)=>(by[b]||0)-(by[a]||0));
  const maxPct=Math.max(...keys.map(k=>Math.max((by[k]||0)/total*100,tg[k]||0)),1);
  $("alloc").innerHTML=keys.map(k=>{
    const cur=(by[k]||0)/total*100, t=tg[k]; const gap=t!=null?cur-t:null;
    const cls=gap==null?"":Math.abs(gap)>tol*2?"crit":Math.abs(gap)>tol?"warn":"good";
    return `<div class="arow"><div class="name" title="${esc(k)}"><span class="sw" style="background:${col(k)}"></span>${esc(k)}</div>
      <div class="track" title="${pct(cur)}${t!=null?" · cible "+pct(t):""}"><div class="fill" style="width:${cur/maxPct*100}%;background:${col(k)}"></div>${t!=null?`<div class="target" style="left:calc(${t/maxPct*100}% - 1px)"></div>`:""}</div>
      <div class="v"><span class="num">${pct(cur)}</span>${gap!=null?` <span class="pill ${cls}">${sgn(gap)}${gap.toFixed(1).replace(".",",")}</span>`:""}</div></div>`;}).join("");
  $("allocNote").textContent=blocTargets()?"trait = cible · écart en points":"cibles définies par personne";
}
function renderEnv(live,total){
  const by={}; live.forEach(p=>{by[p.envelope]=(by[p.envelope]||0)+val(p);});
  const ks=Object.keys(by).sort((a,b)=>by[b]-by[a]); const cs=["--s1","--s2","--s3","--s4","--s5","--s6","--s7","--s8","--s9"];
  $("envbar").innerHTML=ks.map((k,i)=>`<span style="width:${by[k]/total*100}%;background:var(${cs[i%9]})" title="${esc(k)} ${pct(by[k]/total*100)}"></span>`).join("");
  $("envlist").innerHTML=ks.map((k,i)=>`<li><span><span class="sw" style="background:var(${cs[i%9]})"></span>${esc(k)}</span><span class="num">${eur(by[k])} <span class="muted">· ${pct(by[k]/total*100,0)}</span></span></li>`).join("");
}
function renderLedger(ps,total){
  const envs={}; ps.forEach(p=>{(envs[p.envelope]=envs[p.envelope]||[]).push(p);});
  const order=Object.keys(envs).sort((a,b)=>envs[b].reduce((s,p)=>s+val(p),0)-envs[a].reduce((s,p)=>s+val(p),0));
  let h=""; const t=today();
  order.forEach(e=>{const list=envs[e].sort((a,b)=>val(b)-val(a)); const sub=list.filter(counted).reduce((s,p)=>s+val(p),0);
    h+=`<tr class="group"><td>${esc(e)}</td><td></td><td></td><td class="n">${eur(sub)}</td><td></td><td class="n">${pct(sub/total*100)}</td><td></td></tr>`;
    list.forEach(p=>{const v=val(p); const g=(p.mode==="market"&&p.pru&&p.qty&&p.price)?p.qty*(p.price-p.pru):null; const gp=g!=null?(p.price/p.pru-1)*100:null;
      let chip; if(p.status==="à recevoir") chip='<span class="pill">à recevoir</span>';
      else if(p.mode==="manual") chip=`<span class="pill">manuel · ${frDate(p.valueDate)}</span>`;
      else if(!p.priceDate) chip='<span class="pill warn">cours à récupérer</span>';
      else { const age=daysBetween(p.priceDate,t); chip=`<span class="pill ${age<=4?"good":"warn"}">cours ${frDate(p.priceDate)}</span>`; }
      if(p.qtyEstimated) chip+=' <span class="pill warn">qté estimée</span>';
      if(p.hypothesis) chip+=' <span class="pill acc">hypothèse</span>';
      h+=`<tr class="${p.status==="à recevoir"?"pending":""}"><td>${esc(p.name)}${S.scope==="foyer"&&(S.people||[]).length>1?' <span class="pill">'+esc(nomOf(p.owner))+'</span>':""}<span class="sub">${esc(p.bloc)}${p.isin?" · "+esc(p.isin):""}</span></td>
        <td class="n">${p.mode==="market"&&p.qty!=null?fmtq.format(p.qty):"—"}</td>
        <td class="n">${p.mode==="market"&&p.price!=null?eur2(p.price):"—"}</td>
        <td class="n">${eur(v)}</td>
        <td class="n ${g==null?"":g>=0?"pos":"neg"}">${g==null?"—":sgn(g)+eur(g)+" <span class='small'>("+sgn(gp)+pct(gp,0)+")</span>"}</td>
        <td class="n">${counted(p)?pct(v/total*100):"—"}</td><td>${chip}</td></tr>`;});});
  $("ledger").querySelector("tbody").innerHTML=h||'<tr><td colspan="7" class="muted">Aucune position enregistrée pour ce périmètre.</td></tr>';
}

function renderLists(){
  const cfg=S.config||{};
  $("todo").innerHTML=(cfg.todo||[]).map((o,i)=>`<li><label><input type="checkbox" data-todo="${i}" ${o.done?"checked":""}><span class="${o.done?"done":""}">${esc(o.text)}${o.amount?` <span class="muted">· ${esc(o.amount)}</span>`:""}</span></label></li>`).join("")||'<li class="muted">Aucun ordre en attente.</li>';
  $("recur").innerHTML=(cfg.recurring||[]).map(r=>{const p=S.positions.find(x=>x.id===r.positionId);const future=r.start>today();return `<li><span>${esc(r.label)}<span class="sub small muted">${p?esc(p.envelope):""} · le ${r.day} du mois${future?" · à partir du "+frDate(r.start):""}${r.lastApplied?" · dernier : "+esc(r.lastApplied):""}</span></span><span class="num">${eur(r.amount)} ${r.hypothesis?'<span class="pill acc">hypothèse</span>':future?'<span class="pill">prévu</span>':'<span class="pill good">actif</span>'}</span></li>`;}).join("");
  const H=[]; S.positions.forEach(p=>{if(p.hypothesis) H.push({kind:"pos",id:p.id,text:p.name+" : "+p.hypothesis});});
  (cfg.recurring||[]).forEach((r,i)=>{if(r.hypothesis) H.push({kind:"rec",id:i,text:r.label+" : "+r.hypothesis});});
  (cfg.hypotheses||[]).forEach((h,i)=>{if(!h.done) H.push({kind:"cfg",id:i,text:h.text});});
  $("hypCount").textContent=H.length?H.length+" en attente":"";
  $("hyps").innerHTML=H.map(h=>`<li><span class="small">${esc(h.text)}</span><button class="btn ghost tiny" data-hyp="${h.kind}:${h.id}">Confirmer</button></li>`).join("")||'<li class="muted">Toutes les hypothèses sont confirmées.</li>';
  const tx=[...S.tx].sort((a,b)=>(b.date+b.createdAt)>(a.date+a.createdAt)?1:-1).slice(0,20);
  $("journal").innerHTML=tx.map(x=>{const p=S.positions.find(y=>y.id===x.positionId);return `<li><span><strong>${esc({achat:"Achat",vente:"Vente",versement:"Versement",retrait:"Retrait",solde:"Nouveau solde",programme:"Versement programmé",creation:"Nouvelle ligne"}[x.type]||x.type)}</strong> · ${esc(p?p.name:x.positionId)}<span class="sub small muted">${frDate(x.date)}${x.source==="agent"?" · agent":""}${x.note?" · "+esc(x.note):""}</span></span><span class="num">${x.qty?fmtq.format(x.qty)+" × "+eur2(x.price)+" ":""}${x.amount!=null?eur(x.amount):""}</span></li>`;}).join("")||'<li class="muted">Aucun mouvement enregistré. Les achats, ventes et versements saisis ci-dessus apparaîtront ici.</li>';
}

function fillSelects(){
  const sel=$("txPos"); const cur=sel.value;
  const ps=[...S.positions].filter(p=>p.status!=="clôturé").sort((a,b)=>(a.envelope+a.name).localeCompare(b.envelope+b.name,"fr"));
  sel.innerHTML=ps.map(p=>`<option value="${esc(p.id)}">${esc(p.envelope)} · ${esc(p.name)}</option>`).join(""); if(cur) sel.value=cur;
  const opts=(el,list)=>{const sig=JSON.stringify(list); if(el.dataset.sig===sig) return; const c=el.value; el.innerHTML=list.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join(""); el.dataset.sig=sig; if(list.some(([v])=>v===c)) el.value=c;};
  const envs=[...new Set(S.positions.map(p=>p.envelope))].sort((a,b)=>a.localeCompare(b,"fr"));
  const tg=S.config?.targets||{};
  const blocs=[...new Set([...S.positions.map(p=>p.bloc),...(S.people||[]).flatMap(p=>Object.keys(tg[p.id]||{}))])].filter(Boolean).sort((a,b)=>a.localeCompare(b,"fr"));
  opts($("nfEnv"),envs.map(x=>[x,x])); opts($("nfBloc"),blocs.map(x=>[x,x]));
  opts($("nfOwner"),(S.people&&S.people.length?S.people:[{id:"p1",nom:"Moi"}]).map(p=>[p.id,p.nom||DEFAULT_NOMS[p.id]]));
}


/* ---------- module ---------- */
function mount(r){
  root=r;
  $("txDate").value=today();
  // Évolution : périodes et pas proposés par periodes.js (contrôles masqués sans lui).
  const P=window.Periodes;
  if(P&&Array.isArray(P.PERIODES)&&Array.isArray(P.GRANULARITES)){
    $("evoPer").innerHTML=P.PERIODES.map(x=>`<button type="button" data-evo-per="${esc(x.id)}" aria-pressed="false">${esc(x.label)}</button>`).join("");
    $("evoGran").innerHTML=P.GRANULARITES.map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("");
    const redraw=()=>{ saveEvo(); if(lastChart) renderChart(lastChart.snaps,lastChart.liveTotal); };
    $("evoPer").addEventListener("click",ev=>{const b=ev.target.closest("[data-evo-per]"); if(!b) return;
      if(b.dataset.evoPer==="perso"&&!(evo.du&&evo.au)){ evo.du=$("evoDu").value; evo.au=$("evoAu").value; }
      evo.periode=b.dataset.evoPer; redraw();});
    const dates=()=>{ if($("evoDu").value&&$("evoAu").value){ evo.du=$("evoDu").value; evo.au=$("evoAu").value; evo.periode="perso"; redraw(); } };
    $("evoDu").addEventListener("change",dates); $("evoAu").addEventListener("change",dates);
    $("evoGran").addEventListener("change",()=>{evo.gran=$("evoGran").value; redraw();});
  }
  // Import groupé : fichier CSV ou réponse d'assistant, aperçu dans la fenêtre d'import, écriture en une fois.
  const ib=$("importBtn");
  if(ib){ if(!window.Import) ib.hidden=true; else ib.addEventListener("click",()=>Import.open({people:window.Store.get().people,onApply:rows=>window.Store.db.collection("positions").addMany(rows)})); }
  const numv=id=>{const v=$(id).value;return v===""?null:Number(v);};

  $("txForm").addEventListener("submit",async ev=>{ev.preventDefault(); if(!S.db){$("txMsg").textContent="Base indisponible dans cette vue.";return;}
    const type=$("txType").value, id=$("txPos").value, p=S.positions.find(x=>x.id===id); if(!p) return;
    let qty=numv("txQty"), price=numv("txPrice"), amt=numv("txAmt"); const date=$("txDate").value||today(), note=$("txNote").value.trim();
    const upd={}; const msg=m=>{$("txMsg").textContent=m;};
    if(type==="achat"||type==="vente"){
      if(p.mode!=="market"){ if(amt==null&&qty!=null&&price!=null) amt=qty*price; if(amt==null) return msg("Indiquez un montant pour une ligne à valeur manuelle."); upd.value=(Number(p.value)||0)+(type==="achat"?amt:-amt); upd.valueDate=date; }
      else { if(qty==null&&amt!=null&&price) qty=amt/price; if(qty==null||price==null) return msg("Indiquez la quantité et le prix unitaire."); const q0=p.qty||0;
        if(type==="achat"){ const q1=q0+qty; upd.qty=q1; upd.pru=p.pru?((p.pru*q0+qty*price)/q1):price; }
        else { if(qty>q0+1e-9) return msg("Quantité vendue supérieure à la quantité détenue."); upd.qty=q0-qty; if(upd.qty<1e-9) upd.status="clôturé"; }
        if(!p.priceDate||date>=p.priceDate){upd.price=price;upd.priceDate=date;} amt=qty*price; }
    } else if(type==="versement"||type==="retrait"){
      if(amt==null) return msg("Indiquez un montant.");
      if(p.mode==="market"){ const px=price||p.price; if(!px) return msg("Indiquez le prix unitaire pour convertir le montant en parts."); qty=amt/px; price=px; const q0=p.qty||0; const q1=type==="versement"?q0+qty:q0-qty; if(q1<-1e-9) return msg("Retrait supérieur à la position."); upd.qty=q1; if(type==="versement") upd.pru=p.pru?((p.pru*q0+amt)/q1):px; }
      else { upd.value=(Number(p.value)||0)+(type==="versement"?amt:-amt); upd.valueDate=date; }
    } else { // solde
      if(p.mode==="market"){ if(qty==null) return msg("Indiquez la nouvelle quantité."); upd.qty=qty; upd.qtyEstimated=false; if(price!=null){upd.price=price;upd.priceDate=date;} }
      else { if(amt==null) return msg("Indiquez le nouveau solde."); upd.value=amt; upd.valueDate=date; }
    }
    $("txBtn").disabled=true;
    try{ await S.db.doc("positions/"+id).update(upd);
      await S.db.collection("transactions").add({date,type,positionId:id,qty:qty??null,price:price??null,amount:amt??null,note,source:"manuel",createdAt:new Date().toISOString()});
      msg("Enregistré."); $("txQty").value="";$("txPrice").value="";$("txAmt").value="";$("txNote").value="";
    }catch(e){ msg(e?.code==="invalid_argument"?"Enregistrement refusé : vous n'avez pas les droits d'écriture sur ce tableau de bord.":"Enregistrement impossible pour le moment ("+(e?.code||"erreur")+"). Réessayez dans un instant."); }
    finally{$("txBtn").disabled=false;}
  });

  $("newForm").addEventListener("submit",async ev=>{ev.preventDefault(); if(!S.db) return;
    const name=$("nfName").value.trim(); if(!name) return;
    const mode=$("nfMode").value; const id=(($("nfEnv").value||"x").toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,10)+"-"+name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g,"-").slice(0,30)).replace(/-+$/,"");
    const q=numv("nfQty"), pr=numv("nfPrice"), v=numv("nfVal");
    const doc={id,name,envelope:$("nfEnv").value,owner:$("nfOwner").value,bloc:$("nfBloc").value,isin:$("nfIsin").value.trim()||null,mode,qty:mode==="market"?q:null,pru:mode==="market"?pr:null,price:mode==="market"?pr:null,priceDate:mode==="market"&&pr?today():null,value:mode==="manual"?v:null,valueDate:mode==="manual"?today():null,status:"actif",hypothesis:null,qtyEstimated:false};
    try{ await S.db.doc("positions/"+id).set(doc); await S.db.collection("transactions").add({date:today(),type:"creation",positionId:id,qty:q,price:pr,amount:mode==="market"&&q&&pr?q*pr:v,note:"",source:"manuel",createdAt:new Date().toISOString()}); $("nfMsg").textContent="Ligne créée. L'agent récupérera son cours ce soir."; ev.target.reset(); }
    catch(e){ $("nfMsg").textContent="Création impossible ("+(e?.code||"erreur")+")."; }
  });

  root.addEventListener("change",async ev=>{const i=ev.target.dataset?.todo; if(i==null||!S.db||!S.config) return;
    const todo=S.config.todo.map((o,k)=>k==+i?{...o,done:ev.target.checked,doneDate:ev.target.checked?today():null}:o);
    try{await S.db.doc("config/main").update({todo});}catch(e){ev.target.checked=!ev.target.checked;}
  });
  root.addEventListener("click",async ev=>{const h=ev.target.dataset?.hyp; if(!h||!S.db) return; ev.target.disabled=true;
    const [kind,id]=h.split(":");
    try{ if(kind==="pos") await S.db.doc("positions/"+id).update({hypothesis:null});
      else if(kind==="rec"){const rec=S.config.recurring.map((r,k)=>k==+id?{...r,hypothesis:null}:r); await S.db.doc("config/main").update({recurring:rec});}
      else {const hy=S.config.hypotheses.map((r,k)=>k==+id?{...r,done:true}:r); await S.db.doc("config/main").update({hypotheses:hy});}
    }catch(e){ev.target.disabled=false;}
  });
}
function update(snap,visible){
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions,snapshots:snap.snapshots,tx:snap.tx,config:snap.config,status:snap.status,db:window.Store.db};
  dirty=true; if(visible){render();dirty=false;}
}
function show(){ if(dirty){render();dirty=false;} }
function headline(){ return S.positions.length?eur(scoped().filter(counted).reduce((a,p)=>a+val(p),0)):"–"; }
const api={mount,update,show,headline};
const reg=()=>App.register("pilotage",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
