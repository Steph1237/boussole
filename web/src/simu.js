/* Acheter ou placer : simulateur acheter / louer + ETF / louer + locatif, porté depuis sources/simu.html.
   Le moteur (données de ville, règles par pays, simulation) est recopié à l'identique ; seuls changent
   la portée DOM (racine du module), la mémoire locale et le branchement sur les données réelles (Reel). */
(function(){
let root=null,ENG=null,SNAP=null,dirty=false;
/* Identifiants renommés dans le fragment pour éviter les collisions avec les autres onglets. */
const REN={alerts:"simu-alerts",chart:"simu-chart",reset:"simu-reset",tip:"simu-tip",scen:"simu-scen",credits:"simu-credits",apport:"simu-apport",apportR:"simu-apportR",apportV:"simu-apportV"};
/* Champs alimentés par les données réelles (profil + positions du Pilotage). */
const REAL=["apport","rev","credits","tmi","essai"];
const TMI_OK=["0","11","30","41","45"];

function engine(){
const GBP=1.1727;
/* Données de ville : p = prix €/m² (appartement), l = loyer €/m²/mois HC, tf = taxe foncière €/m²/an payée par le propriétaire occupant,
   tfi = idem pour un bien loué, ch = copropriété non récupérable €/m²/an, prov = gros travaux €/m²/an, ag = frais d'agence locataire €/m²,
   est = données partiellement estimées. Prix et loyers : MeilleursAgents (1er oct. 2026) en France, sources locales en Europe. */
const CITIES={
  paris:{n:"Paris",g:"Paris et petite couronne",c:"FR",p:9630,l:33.3,tf:19,ch:15,prov:12,ag:15.13,terrain:25,src:"MeilleursAgents, 1er oct. 2026"},
  boulogne:{n:"Boulogne-Billancourt",g:"Paris et petite couronne",c:"FR",p:8227,l:30.1,tf:14,ch:14,prov:11,ag:15.13,terrain:25,src:"MeilleursAgents, 1er oct. 2026"},
  vincennes:{n:"Vincennes",g:"Paris et petite couronne",c:"FR",p:9177,l:29.0,tf:20,ch:14,prov:11,ag:15.13,terrain:25,src:"MeilleursAgents, 1er oct. 2026"},
  montreuil:{n:"Montreuil",g:"Paris et petite couronne",c:"FR",p:6373,l:24.5,tf:26,ch:11,prov:10,ag:15.13,terrain:20,src:"MeilleursAgents, 1er oct. 2026"},
  pc:{n:"Petite couronne (moyenne 92-93-94)",g:"Paris et petite couronne",c:"FR",p:5198,l:23.1,tf:22,ch:11.5,prov:10,ag:15.13,terrain:20,src:"MeilleursAgents, 1er oct. 2026 (moyenne simple des 3 départements)"},
  versailles:{n:"Versailles",g:"Yvelines (78)",c:"FR",p:6500,l:21.3,tf:20,ch:12,prov:10,ag:15.13,terrain:25,src:"Prix : médiane MeilleursAgents, efficity et PAP (oct. 2026) ; loyer : MeilleursAgents"},
  sgl:{n:"Saint-Germain-en-Laye",g:"Yvelines (78)",c:"FR",p:6450,l:22.5,tf:20,ch:12,prov:10,ag:15.13,terrain:25,src:"Prix : médiane MeilleursAgents, efficity et PAP (oct. 2026) ; loyer : MeilleursAgents"},
  chesnay:{n:"Le Chesnay-Rocquencourt",g:"Yvelines (78)",c:"FR",p:5114,l:21.5,tf:20,ch:10.5,prov:9,ag:15.13,terrain:20,src:"MeilleursAgents, 1er oct. 2026"},
  y78:{n:"Yvelines (moyenne)",g:"Yvelines (78)",c:"FR",p:4000,l:19.6,tf:22,ch:10.5,prov:9,ag:13.12,terrain:20,src:"Prix : efficity et PAP (oct. 2026) ; loyer : MeilleursAgents"},
  lyon:{n:"Lyon",g:"Grandes villes",c:"FR",p:4714,l:17.7,tf:22,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  marseille:{n:"Marseille",g:"Grandes villes",c:"FR",p:3605,l:16.9,tf:28,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  toulouse:{n:"Toulouse",g:"Grandes villes",c:"FR",p:3565,l:15.4,tf:26,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  nice:{n:"Nice",g:"Grandes villes",c:"FR",p:5245,l:20.9,tf:25,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  nantes:{n:"Nantes",g:"Grandes villes",c:"FR",p:3371,l:14.7,tf:27,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  montpellier:{n:"Montpellier",g:"Grandes villes",c:"FR",p:3412,l:16.1,tf:28,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  strasbourg:{n:"Strasbourg",g:"Grandes villes",c:"FR",p:3740,l:15.5,tf:26,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  bordeaux:{n:"Bordeaux",g:"Grandes villes",c:"FR",p:4448,l:17.2,tf:28,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  lille:{n:"Lille",g:"Grandes villes",c:"FR",p:3409,l:16.6,tf:27,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  rennes:{n:"Rennes",g:"Grandes villes",c:"FR",p:4015,l:15.2,tf:25,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  grenoble:{n:"Grenoble",g:"Grandes villes",c:"FR",p:2501,l:14.7,tf:30,ch:10,prov:8,ag:13.12,terrain:15,src:"MeilleursAgents, 1er oct. 2026"},
  londres:{n:"Londres",g:"Europe",c:"UK",p:8561,l:35,tf:0,ch:40,prov:10,ag:0,terrain:30,est:true,src:"Land Registry via Plumplot, sept. 2026 ; loyer estimé d'après les rendements Numbeo (30 à 40 £/m²) ; service charge estimée"},
  madrid:{n:"Madrid",g:"Europe",c:"ES",itp:6,p:6458,l:23.4,tf:6,ch:15,prov:6,ag:0,terrain:25,est:true,src:"idealista, sept. 2026 ; charges estimées"},
  barcelone:{n:"Barcelone",g:"Europe",c:"ES",itp:10,p:5462,l:22,tf:8,ch:15,prov:6,ag:0,terrain:25,est:true,src:"Prix idealista, sept. 2026 ; loyer : moyenne idealista et Fotocasa ; charges estimées"},
  lisbonne:{n:"Lisbonne",g:"Europe",c:"PT",p:6256,l:25.1,tf:9,ch:10,prov:6,ag:0,terrain:25,est:true,src:"idealista, sept. 2026 (prix d'annonce, ~15 % au-dessus des ventes réelles INE) ; IMI et charges estimés"},
  porto:{n:"Porto",g:"Europe",c:"PT",p:4346,l:18,tf:7,ch:10,prov:6,ag:0,terrain:25,est:true,src:"idealista, sept. 2026 ; IMI et charges estimés"},
  berlin:{n:"Berlin",g:"Europe",c:"DE",p:5007,l:15.5,tf:0,ch:15,prov:10,ag:0,terrain:20,est:true,src:"Prix Immowelt (oct. 2026) ; loyer entre Immowelt et Guthmann ; Hausgeld non refacturable estimé"},
  amsterdam:{n:"Amsterdam",g:"Europe",c:"NL",p:8112,l:28.69,tf:4,ch:20,prov:8,ag:0,terrain:30,est:true,src:"Huizenzoeker (prix affichés, sept. 2026) et Pararius (T2 2026) ; VvE estimée"},
  bruxelles:{n:"Bruxelles",g:"Europe",c:"BE",p:3400,l:15,tf:11,ch:10,prov:8,ag:0,terrain:20,est:true,src:"Prix : La DH et Statbel (2025-2026) ; loyer estimé (Federia : ~1 300 € en nouveau bail)"},
  milan:{n:"Milan",g:"Europe",c:"IT",p:5659,l:22.3,tf:0,tfi:20,ch:12,prov:8,ag:22,terrain:25,est:true,src:"idealista, T3 2026 ; IMU sur bien loué et charges estimées"},
  rome:{n:"Rome",g:"Europe",c:"IT",p:3810,l:19.1,tf:0,tfi:13,ch:12,prov:8,ag:19,terrain:25,est:true,src:"idealista, T3 2026 ; IMU sur bien loué et charges estimées"}
};
const RATES={15:3.43,20:3.54,25:3.61};
function sdlt(pg,first,add){
  let t=0;
  if(first&&!add&&pg<=500000)t=Math.max(0,pg-300000)*0.05;
  else{let prev=0;for(const [cap,r] of [[125000,0],[250000,.02],[925000,.05],[1500000,.10],[1e12,.12]]){if(pg>prev)t+=(Math.min(pg,cap)-prev)*r;prev=cap;}}
  if(add)t+=pg*0.05;
  return t;
}
/* Règles par pays : taux de crédit, frais d'achat (% du prix), frais de revente (%) */
const COUNTRY={
  FR:{rate:d=>RATES[d],buy:(p,o)=>o.neuf?2.5:(o.inv?8:(o.primo?7.5:8)),sell:5},
  UK:{rate:()=>5.98,buy:(p,o)=>{const pg=Math.max(1,p/GBP);return sdlt(pg,o.primo&&!o.inv,o.inv)/pg*100+1},sell:2},
  ES:{rate:()=>3.01,buy:(p,o,c)=>(c.itp===10?(p<=600000?10:p<=900000?11:12):c.itp)+1,sell:4},
  PT:{rate:()=>3.0,buy:(p,o)=>o.inv?7.5:6,sell:6},
  DE:{rate:()=>4.02,buy:()=>11.6,sell:3.6},
  NL:{rate:()=>4.0,buy:(p,o)=>o.inv?10:4,sell:1.5},
  BE:{rate:()=>4.13,buy:(p,o)=>{const reg=(o.inv||p>600000)?0.125*p:0.125*Math.max(0,p-200000);return reg/Math.max(1,p)*100+2.5},sell:3.6},
  IT:{rate:()=>3.56,buy:(p,o)=>o.inv?7.5:4.5,sell:3}
};
const PS=0.186,PFU=0.314,PEA_CAP=150000,PS_FONC=0.172,PS_BIC=0.186,PS_PV=0.172;
const $=id=>root.querySelector('#'+CSS.escape(REN[id]||id));
const AUTO=["prix","loyer","fraisA","taux","tf","copro","provCopro","agence","revente","prixL","loyerL","apportL","fraisAL","mobilier","tfL","coproL","provCoproL","entretienL","honoL","rotation","terrain"];
const MKT=["prix","loyer","taux","copro","prixL","loyerL","coproL"];
const RANGES=["surface","apport","horizon","disc"];
const manual={},touched={};
const eur=(n,d=0)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:d,minimumFractionDigits:d}).format(n);
const k=n=>{const a=Math.abs(n);return (n<0?"−":"")+(a>=1e6?eur(a/1e6,2)+" M€":eur(Math.round(a/100)*100)+" €")};
const kk=n=>{const a=Math.abs(n);return (n<0?"−":"")+(a>=1e6?eur(a/1e6,2)+" M€":eur(Math.round(a/1000))+" k€")};
const num=id=>{const v=parseFloat($(id).value);return isFinite(v)?v:0};
const setA=(id,v)=>{if(!manual[id])$(id).value=v};
const r1=v=>Math.round(v*10)/10;
const ST=["rp","loc","inv"];
const SN={rp:"Acheter et y vivre",inv:"Louer + bien locatif",loc:"Louer + ETF"};
const SC={rp:"var(--buy)",inv:"var(--inv)",loc:"var(--etf)"};
const SD={rp:"b",inv:"i",loc:"e"};
const SNl={rp:"acheter et y vivre",inv:"louer + bien locatif",loc:"louer + ETF"};
const REG={nu_micro:"Nue · micro-foncier",nu_reel:"Nue · réel foncier",lmnp_micro:"Meublé · micro-BIC",lmnp_reel:"Meublé · LMNP réel"};
const pc=v=>(v>=0?"+":"−")+eur(Math.abs(v*100),1)+" %";

/* Score de précision : poids de chaque donnée personnelle (total 90, + 10 pour le choix de la ville) */
const PREC=[
  {id:"prix",g:20,l:"Prix du bien que tu vises",h:"Le prix de l'annonce, frais d'agence inclus",u:"€"},
  {id:"loyer",g:20,l:"Loyer d'un logement équivalent",h:"Ton loyer actuel ou une annonce comparable, hors charges",u:"€/mois"},
  {id:"taux",g:10,l:"Taux de crédit proposé",h:"Simulation de ta banque ou d'un courtier",u:"%"},
  {id:"horizon",g:8,l:"Combien de temps tu garderais le bien",h:"Les frais d'achat s'amortissent avec les années",u:"ans"},
  {id:"copro",g:7,l:"Charges de copro non récupérables",h:"Relevé annuel : total moins la part refacturable à un locataire",u:"€/m²/an"},
  {id:"tf",g:5,l:"Taxe foncière",h:"Indiquée dans l'annonce ou par le vendeur",u:"€/an"},
  {id:"travaux",g:5,l:"Travaux à prévoir",h:"DPE, procès-verbaux d'assemblée générale, devis",u:"€"},
  {id:"apport",g:4,l:"Apport exact",h:"Épargne mobilisable, hors épargne de précaution",u:"€"},
  {id:"rev",g:3,l:"Revenus nets du foyer",h:"Pour vérifier que la banque suivra",u:"€/mois"},
  {id:"tmi",g:3,l:"Tranche d'imposition",h:"Sur ton avis d'impôt ; compte pour le locatif",u:""},
  {id:"assurance",g:3,l:"Assurance emprunteur",h:"Devis d'assurance, délégation possible",u:"% / an"},
  {id:"env",g:2,l:"Enveloppe pour les ETF",h:"PEA déjà ouvert ou compte-titres",u:""}
];
const isDone=id=>AUTO.includes(id)?!!manual[id]:!!touched[id];

/* Listes de villes */
function fillCities(sel,def){
  const groups={};for(const id in CITIES){const c=CITIES[id];(groups[c.g]=groups[c.g]||[]).push([id,c.n]);}
  sel.innerHTML=Object.keys(groups).map(g=>'<optgroup label="'+g+'">'+groups[g].map(([id,n])=>'<option value="'+id+'"'+(id===def?' selected':'')+'>'+n+'</option>').join("")+'</optgroup>').join("");
}
fillCities($("zone"),"paris");fillCities($("zoneL"),"lyon");

function scenarios(){
  const b=i=>({a:num("a"+i)/100,ret:num("r"+i)/100,gl:num("l"+i)/100,vac:Math.max(0,Math.min(12,num("v"+i)))});
  const c=b(1),o=b(2),p=b(0);
  const flat=s=>({aY:Array(30).fill(s.a),retY:Array(30).fill(s.ret),glY:Array(30).fill(s.gl),vac:s.vac,gcAdd:0});
  const arr=f=>Array.from({length:30},(_,y)=>f(y));
  return [
    {id:"c",name:"Central",desc:"Prix des logements "+pc(c.a)+" par an, ETF "+pc(c.ret)+" par an, loyers "+pc(c.gl)+" par an.",...flat(c)},
    {id:"o",name:"Optimiste",desc:"Prix des logements "+pc(o.a)+" par an, ETF "+pc(o.ret)+" par an.",...flat(o)},
    {id:"p",name:"Pessimiste",desc:"Prix des logements "+pc(p.a)+" par an, ETF "+pc(p.ret)+" par an.",...flat(p)},
    {id:"k",name:"Krach boursier",desc:"Les ETF perdent 35 % la 3e année (comme en 2008), puis reprennent le rythme central.",aY:arr(()=>c.a),retY:arr(y=>y===2?-0.35:c.ret),glY:arr(()=>c.gl),vac:c.vac,gcAdd:0},
    {id:"m",name:"Baisse de l'immobilier",desc:"Les prix baissent de 3 % par an pendant 4 ans, puis reprennent le rythme central.",aY:arr(y=>y<4?-0.03:c.a),retY:arr(()=>c.ret),glY:arr(()=>c.gl),vac:c.vac,gcAdd:0},
    {id:"f",name:"Retour de l'inflation",desc:"Prix, loyers et charges montent de 1,5 point de plus chaque année ; le crédit reste à taux fixe.",aY:arr(()=>c.a+0.015),retY:arr(()=>c.ret+0.01),glY:arr(()=>c.gl+0.015),vac:c.vac,gcAdd:0.015}
  ];
}

/* Valeurs par défaut et mémoire locale (propre à ce navigateur) */
const FIELDS=[...$("params").querySelectorAll("input,select")].filter(e=>e.id&&!e.readOnly&&!e.id.endsWith("R"));
const DEF={};FIELDS.forEach(e=>DEF[e.id]=e.type==="checkbox"?e.checked:e.value);
const KEY="acheter-placer-fusion-v1";
let current=0,allMode=false,last=null;
function save(){try{const v={};FIELDS.forEach(e=>v[e.id]=e.type==="checkbox"?e.checked:e.value);localStorage.setItem(KEY,JSON.stringify({v,m:manual,t:touched,c:current,a:allMode,more:!$("more").hidden}));}catch(e){}}
function load(){try{const s=JSON.parse(localStorage.getItem(KEY)||"null");if(!s)return;for(const id in s.v){const el=$(id);if(!el||el.readOnly)continue;if(el.type==="checkbox")el.checked=!!s.v[id];else el.value=s.v[id];}Object.assign(manual,s.m||{});Object.assign(touched,s.t||{});current=s.c||0;allMode=!!s.a;if(s.more)setMore(true);}catch(e){}}

function setTag(id){
  const t=root.querySelector('.tag[data-for="'+id+'"]');if(!t)return;
  if(manual[id]){t.className="tag man";t.textContent="modifié ↺";t.title="Revenir à la valeur du marché";t.setAttribute("role","button");t.tabIndex=0;}
  else{t.className="tag auto";t.textContent=MKT.includes(id)?"marché":"auto";t.removeAttribute("title");t.removeAttribute("role");t.tabIndex=-1;}
}
function fillAuto(){
  const c=CITIES[$("zone").value],C=COUNTRY[c.c],s=num("surface"),neuf=$("type").value==="neuf"&&c.c==="FR";
  setA("prix",Math.round(s*c.p*Math.pow(50/s,0.05)/1000)*1000);
  setA("loyer",Math.round(s*c.l*Math.pow(50/s,0.15)/10)*10);
  setA("taux",C.rate($("duree").value));
  setA("fraisA",r1(C.buy(num("prix"),{inv:false,primo:$("primo").checked,neuf},c)));
  setA("tf",Math.round(s*c.tf*(neuf?0.3:1)/10)*10);
  setA("copro",c.ch);
  setA("provCopro",neuf?2:c.prov);
  setA("agence",c.ag);
  setA("revente",C.sell);
  const cl=CITIES[$("zoneL").value],CL=COUNTRY[cl.c],sL=num("surfaceL"),meuble=$("regime").value.startsWith("lmnp"),neufL=$("typeL")&&false;
  setA("prixL",Math.round(sL*cl.p*Math.pow(50/sL,0.05)/1000)*1000);
  setA("loyerL",Math.round(sL*cl.l*Math.pow(50/sL,0.15)*(meuble?1.1:1)/10)*10);
  setA("apportL",num("apport"));
  setA("fraisAL",r1(CL.buy(num("prixL"),{inv:true,neuf:false},cl)));
  setA("mobilier",meuble?Math.round((3000+80*sL)/500)*500:0);
  setA("tfL",Math.round(sL*(cl.tfi!=null?cl.tfi:cl.tf)/10)*10);
  setA("coproL",cl.ch);
  setA("provCoproL",cl.prov);
  setA("entretienL",meuble?20:12);
  setA("honoL",cl.c==="FR"?cl.ag:Math.round(cl.l*10)/10);
  setA("rotation",meuble?2:4);
  setA("terrain",cl.terrain);
  AUTO.forEach(setTag);
}
function pmt(L,r,N){return r===0?L/N:L*r/(1-Math.pow(1+r,-N))}

function inputs(){
  const g=num("garantie")/100,apport=num("apport"),dossier=num("dossier"),courtage=num("courtage");
  const N=parseInt($("duree").value,10)*12,rate=num("taux")/100,r=rate/12,ass=num("assurance")/100;
  const prix=num("prix"),n=num("fraisA")/100,travaux=num("travaux"),s=num("surface");
  const needs=prix*(1+n)+dossier+courtage+travaux;
  const L=Math.max(0,(needs-apport)/(1-g));
  const regime=$("regime").value,meuble=regime.startsWith("lmnp");
  const prixL=num("prixL"),notaireL=prixL*num("fraisAL")/100,travauxL=num("travauxL"),mobilier=meuble?num("mobilier"):0,sL=num("surfaceL");
  const needsL=prixL+notaireL+dossier+courtage+travauxL+mobilier;
  const apportUsed=Math.max(0,Math.min(num("apportL"),apport,needsL));
  const LL=Math.max(0,(needsL-apportUsed)/(1-g));
  const garantieL=g*LL;
  let initDed=0;
  if(regime==="nu_reel")initDed=travauxL+dossier+courtage+garantieL;
  if(regime==="lmnp_reel")initDed=notaireL+dossier+courtage+garantieL;
  const terrain=num("terrain")/100;
  return{g,apport,dossier,courtage,N,rate,r,ass,assCRD:$("assBase").value==="crd",
    prix,n,notaire:prix*n,travaux,s,L,surplus:Math.max(0,apport-needs),P:L>0?pmt(L,r,N):0,garantie:g*L,
    rent0:num("loyer"),agence0:s*num("agence"),reloc:Math.max(1,Math.round(num("reloc"))),
    tf0:num("tf"),coproNR0:s*num("copro"),prov0:s*num("provCopro"),entr0:s*num("entretien"),assuHab0:num("assuHab"),
    gc:num("gCharges")/100,
    regime,meuble,prixL,notaireL,travauxL,mobilier,sL,apportUsed,LL,PL:LL>0?pmt(LL,r,N):0,garantieL,invStart:apport-apportUsed,initDed,
    rentL0:num("loyerL"),tfL0:num("tfL"),coproNRL0:sL*num("coproL"),provL0:sL*num("provCoproL"),entrL0:sL*num("entretienL"),
    pno0:num("pno"),gli:num("gli")/100,gest:num("gestion")/100,honoL0:sL*num("honoL"),rot:Math.max(0.5,num("rotation")),
    cfe0:meuble?num("cfe"):0,compta0:regime==="lmnp_reel"?num("compta"):0,
    bienA:regime==="lmnp_reel"?prixL*(1-terrain)/30:0,travA:regime==="lmnp_reel"?travauxL/10:0,mobA:regime==="lmnp_reel"?mobilier/7:0,
    tmi:parseInt($("tmi").value,10)/100,
    H:Math.max(1,Math.min(30,Math.round(num("horizon")))),disc:Math.max(0,Math.min(100,num("disc")))/100,
    vente:$("vente").checked,fr:num("revente")/100,ira:$("ira").value==="oui",restit:num("restit")/100,
    env:$("env").value,cap:PEA_CAP*parseInt($("nbPea").value,10),
    rev:num("rev"),credits:num("credits"),essai:$("essai").checked};
}

/* Moteur */
function pot(cap,usePea){return{pea:0,peaC:0,cto:0,ctoC:0,cap,usePea}}
function add(p,x){if(x<=0)return;const toPea=p.usePea?Math.min(x,Math.max(0,p.cap-p.peaC)):0;p.pea+=toPea;p.peaC+=toPea;p.cto+=x-toPea;p.ctoC+=x-toPea;}
function grow(p,f){p.pea*=f;p.cto*=f;}
function netPot(p,Y){const tp=Y>=5?PS:PFU;return p.pea-Math.max(0,p.pea-p.peaC)*tp+p.cto-Math.max(0,p.cto-p.ctoC)*PFU;}
function sum(o){let s=0;for(const x in o)s+=o[x];return s}
function taxYear(I,acc,st,y){
  const R=acc.R,Int=acc.Int,Ch=acc.Ch+acc.init,t=I.tmi;
  let tax=0,base=0;
  switch(I.regime){
    case "nu_micro":
      if(R<=15000){base=0.7*R;tax=base*(t+PS_FONC);break;}
    case "nu_reel":{
      const res=R-Int-Ch;
      if(res>=0){const use=Math.min(res,st.carryF);st.carryF-=use;base=res-use;tax=base*(t+PS_FONC);}
      else{const def=-res,fromCh=Math.min(def,Math.max(0,Ch-Math.max(0,R-Int))),glob=Math.min(10700,fromCh);tax=-glob*t;st.carryF+=def-glob;st.globUsed+=glob;base=-def;}
      break;}
    case "lmnp_micro":base=0.5*R;tax=base*(t+PS_BIC);break;
    case "lmnp_reel":{
      const amB=y<30?I.bienA:0,amT=y<10?I.travA:0,amM=y<7?I.mobA:0,amY=amB+amT+amM;
      let res=R-Int-Ch;
      if(res<0){st.carryB+=-res;st.amStock+=amY;base=res;break;}
      const use=Math.min(res,st.carryB);st.carryB-=use;res-=use;
      const avail=st.amStock+amY,u=Math.min(res,avail),share=amY>0?(amB+amT)/amY:1;
      st.amBienUsed+=u*share;st.amStock=avail-u;res-=u;base=res;tax=res*(t+PS_BIC);
      break;}
  }
  return{tax,base};
}
function abIR(Y){return Y<6?0:Y>=22?1:0.06*(Y-5)}
function abPS(Y){return Y<6?0:Y<=21?0.0165*(Y-5):Y===22?0.28:Y<30?0.28+0.09*(Y-22):1}
function surtax(x){if(x<=50000)return 0;return x*(x<=100000?.02:x<=150000?.03:x<=200000?.04:x<=250000?.05:.06)}
function pvTax(I,V,fV,Y,amBien){
  const reel=I.regime==="nu_reel"||I.regime==="lmnp_reel";
  const acq=I.regime==="lmnp_reel"?0.075*I.prixL:Math.max(0.075*I.prixL,I.notaireL);
  const trv=Y>5?Math.max(0.15*I.prixL,reel?0:I.travauxL):(reel?0:I.travauxL);
  const pv=Math.max(0,V-fV-(I.prixL+acq+trv)+amBien);
  const pIR=pv*(1-abIR(Y)),pPS=pv*(1-abPS(Y));
  return{pv,tax:pIR*0.19+pPS*PS_PV+surtax(pIR)};
}
function simulate(I,S){
  const usePea=I.env==="pea",occ=Math.max(0,1-S.vac/12);
  const pIdx=[1],rIdx=[1];
  for(let y=0;y<30;y++){pIdx.push(pIdx[y]*(1+S.aY[y]));rIdx.push(rIdx[y]*(1+S.glY[y]));}
  const P={rp:pot(I.cap,usePea),inv:pot(I.cap,usePea),loc:pot(I.cap,usePea)};
  add(P.rp,I.surplus);add(P.loc,I.apport);add(P.inv,I.invStart);
  let bal=I.L,balL=I.LL;
  const st={carryF:0,carryB:0,amStock:0,amBienUsed:0,globUsed:0};
  let acc={R:0,Int:0,Ch:0,init:I.initDed};
  const cR={interets:0,assurance:0,tf:0,copro:0,prov:0,entretien:0,assuHab:0};
  const cL={loyers:0,agence:0};
  const cI={loyers:0,agence:0,interets:0,assurance:0,tf:0,copro:0,prov:0,entretien:0,pno:0,gli:0,gestion:0,reloc:0,cfeCompta:0,impots:0,loyersRecus:0};
  const out={rp:[],inv:[],loc:[]},parts={rp:[],inv:[],loc:[]};
  let snap=null,m1=null,y1=null,cf1=0,taxPay=0,lastTax=0;
  const relocM=Math.max(6,Math.round(12*I.rot));
  for(let m=1;m<=360;m++){
    const y=Math.floor((m-1)/12),fc=Math.pow(1+I.gc+S.gcAdd,y),fl=rIdx[y],rm=Math.pow(1+S.retY[y],1/12)-1;
    let it=0,princ=0,ins=0;
    if(m<=I.N&&bal>0.01){it=bal*I.r;princ=Math.min(bal,I.P-it);ins=(I.assCRD?bal:I.L)*I.ass/12;bal-=princ;}
    const rc={tf:I.tf0/12*fc,copro:I.coproNR0/12*fc,prov:I.prov0/12*fc,entretien:I.entr0/12*fc,assuHab:I.assuHab0/12*fc};
    const rpOut=it+princ+ins+sum(rc);
    const loyer=I.rent0*fl,ag=(m>1&&(m-1)%(12*I.reloc)===0)?I.agence0*fl:0;
    const locOut=loyer+ag;
    let itL=0,prL=0,insL=0;
    if(m<=I.N&&balL>0.01){itL=balL*I.r;prL=Math.min(balL,I.PL-itL);insL=(I.assCRD?balL:I.LL)*I.ass/12;balL-=prL;}
    const rentIn=I.rentL0*fl*occ;
    const lc={tf:I.tfL0/12*fc,copro:I.coproNRL0/12*fc,prov:I.provL0/12*fc,entretien:I.entrL0/12*fc,pno:I.pno0/12*fc,gli:rentIn*I.gli,gestion:rentIn*I.gest,
      reloc:(m>1&&(m-1)%relocM===0)?I.honoL0*fl:0,cfeCompta:(I.cfe0+I.compta0)/12*fc};
    const lcSum=sum(lc);
    acc.R+=rentIn;acc.Int+=itL;acc.Ch+=insL+lcSum;
    const taxM=taxPay;
    if(m<=12)cf1+=rentIn-(itL+prL+insL+lcSum);
    const invOut=locOut+itL+prL+insL+lcSum-rentIn+taxM;
    const budget=Math.max(rpOut,locOut,invOut);
    grow(P.rp,1+rm);grow(P.inv,1+rm);grow(P.loc,1+rm);
    add(P.rp,(budget-rpOut)*I.disc);add(P.inv,(budget-invOut)*I.disc);add(P.loc,(budget-locOut)*I.disc);
    if(m===1)m1={it,princ,ins,rc,rpOut,loyer,locOut,itL,prL,insL,lc,rentIn,invNoTax:invOut};
    if(m<=I.H*12){
      cR.interets+=it;cR.assurance+=ins;for(const x in rc)cR[x]+=rc[x];
      cL.loyers+=loyer;cL.agence+=ag;
      cI.loyers+=loyer;cI.agence+=ag;cI.interets+=itL;cI.assurance+=insL;for(const x in lc)cI[x]+=lc[x];cI.loyersRecus+=rentIn;
    }
    if(m%12===0){
      const t=taxYear(I,acc,st,y);
      if(y===0)y1={R:acc.R,Int:acc.Int,Ch:acc.Ch,init:acc.init,tax:t.tax,base:t.base};
      acc={R:0,Int:0,Ch:0,init:0};lastTax=t.tax;taxPay=t.tax/12;
      if(y<I.H)cI.impots+=t.tax;
      const Y=m/12,sold=I.vente;
      const v=I.prix*pIdx[Y],vL=I.prixL*pIdx[Y];
      const fV=sold?v*I.fr:0,ira=sold&&bal>0.01&&I.ira?Math.min(bal*I.rate/2,0.03*bal):0,rest=(sold||bal<=0.01)?I.garantie*I.restit:0;
      const fVL=sold?vL*I.fr:0,iraL=sold&&balL>0.01&&I.ira?Math.min(balL*I.rate/2,0.03*balL):0,restL=(sold||balL<=0.01)?I.garantieL*I.restit:0;
      const pvt=sold?pvTax(I,vL,fVL,Y,st.amBienUsed):{pv:0,tax:0};
      const eq={rp:v-fV-bal-ira+rest,inv:vL-fVL-balL-iraL+restL-pvt.tax-lastTax,loc:0};
      const et={rp:netPot(P.rp,Y),inv:netPot(P.inv,Y),loc:netPot(P.loc,Y)};
      ST.forEach(s=>{out[s].push(eq[s]+et[s]);parts[s].push({eq:eq[s],etf:et[s]});});
      if(Y===I.H){
        const raw=p=>p.pea+p.cto,cost=p=>p.peaC+p.ctoC;
        snap={v,fV,ira,rest,bal,vL,fVL,iraL,restL,balL,pvt,cR:{...cR},cL:{...cL},cI:{...cI},
          pots:{rp:{net:et.rp,raw:raw(P.rp),c:cost(P.rp)},inv:{net:et.inv,raw:raw(P.inv),c:cost(P.inv)},loc:{net:et.loc,raw:raw(P.loc),c:cost(P.loc)}},st:{...st}};
      }
    }
  }
  m1.taxAvg=y1.tax/12;m1.invOut=m1.invNoTax+m1.taxAvg;cf1-=y1.tax;
  return{out,parts,snap,m1,y1,cf1,occ};
}

/* Coût d'usage mensuel d'un propriétaire, scénario central */
function ownMonthly(I,price){
  const a=num("a1")/100,ret=num("r1")/100;
  const needs=price*(1+I.n)+I.dossier+I.courtage+I.travaux;
  const L=Math.max(0,(needs-I.apport)/(1-I.g)),w=price>0?Math.min(1,L/price):0;
  const capital=(w*I.rate+(1-w)*ret)*price;
  const parts={capital,assurance:L*I.ass,charges:I.tf0+I.coproNR0+I.prov0+I.entr0+I.assuHab0,
    frais:(price*I.n+I.dossier+I.courtage+I.g*L*(1-I.restit)+I.travaux+price*I.fr)/I.H,hausse:a*price};
  return{total:(parts.capital+parts.assurance+parts.charges+parts.frais-parts.hausse)/12,parts};
}

/* Rendu */
function rank(R,H){return ST.map(s=>[s,R.out[s][H-1]]).sort((a,b)=>b[1]-a[1])}
/* Données réelles : profil et positions du Pilotage, pour le périmètre choisi (Foyer = projet du foyer). */
const realOv=id=>!!(window.Reel&&Reel.isOverridden("simu",id));
const SRC_ID=Object.fromEntries(Object.entries(REN).map(([a,b])=>[b,a]));
function markReal(id){id=SRC_ID[id]||id;if(REAL.includes(id)&&window.Reel)Reel.override("simu",id);}
let realHas={};
function realData(){
  const S=SNAP;if(!S||S.dbOk===false||!window.Reel)return null;
  let V;try{V=Reel.values(S);}catch(e){console.error(e);return null;}
  const ps=(S.profil&&S.profil.personnes)||{},who=S.scope==="foyer"?["p1","p2"]:[S.scope];
  const tmi=V.foyer.tmi!=null&&TMI_OK.includes(String(V.foyer.tmi))?String(V.foyer.tmi):null;
  return{V,vals:{
    apport:V.has.positions?Math.round(V.apport.total):null,
    rev:V.has.revenus?Math.round(V.revenusSansLoyers+0.7*V.loyers):null, // les banques retiennent 70 % des loyers
    credits:V.has.patrimoine?Math.round(V.mensualites):null,
    tmi,
    essai:V.has.salaire?who.some(p=>!!(ps[p]&&ps[p].essai)):null}};
}
/* Avant fillAuto : chaque champ non modifié prend la valeur réelle, ou sa valeur d'exemple s'il n'y en a pas. */
function applyReal(){
  const R=realData(),act=document.activeElement;realHas={};
  REAL.forEach(id=>{
    const v=R?R.vals[id]:null;realHas[id]=v!=null;
    if(realOv(id))return;
    const el=$(id);
    if(act&&(act===el||(id==="apport"&&act===$("apportR"))||act===root.querySelector('[data-p="'+id+'"]')))return;
    const val=v!=null?v:DEF[REN[id]||id]; // DEF est indexé par l'id réel du DOM
    if(el.type==="checkbox")el.checked=!!val;else el.value=String(val);
  });
  $("apportR").max=String(Math.max(300000,Math.ceil(num("apport")/5000)*5000));
}
function renderReal(){
  root.querySelectorAll(".src-slot").forEach(s=>{const id=s.dataset.key;s.innerHTML=window.Reel?Reel.tag(Reel.kind("simu",id,!!realHas[id]),"simu",id):"";});
  const box=$("simu-fp"),S=SNAP,R=realData();
  if(!S||!R){box.hidden=true;return;}
  box.hidden=false;
  const V=R.V,A=V.apport,e0=v=>eur(Math.round(v))+" €",dash='<b class="muted">–</b>';
  const parts=[];
  if(A.libre>0)parts.push("épargne au-delà du matelas "+e0(A.libre));
  else if(A.matelas>0)parts.push("épargne sous le matelas de précaution ("+e0(A.matelas)+")");
  if(A.placements>0)parts.push("placements "+e0(A.placements));
  if(A.aRecevoir>0)parts.push("à recevoir "+e0(A.aRecevoir));
  const chipA='<span>Apport '+(V.has.positions?'<b>'+e0(A.total)+'</b>'+(parts.length?' <small class="muted">'+parts.join(" · ")+'</small>':''):dash)+'</span>';
  let h;
  if(!S.profil)h='<span>'+(S.ready||S.profilLoaded?"Votre profil n'est pas encore rempli : revenus, crédits et TMI utilisent des valeurs d'exemple.":"Chargement de vos données…")+'</span>'+(V.has.positions?chipA:'');
  else h='<span class="fp-t">Repris de vos données</span>'+chipA+
    '<span>Revenus '+(R.vals.rev!=null?'<b>'+e0(R.vals.rev)+'/mois</b>':dash)+'</span>'+
    '<span>Crédits '+(R.vals.credits!=null?'<b>'+e0(R.vals.credits)+'/mois</b>':dash)+'</span>'+
    '<span>TMI '+(R.vals.tmi!=null?'<b>'+R.vals.tmi+' %</b>':dash)+'</span>';
  root.querySelector('[data-fp="l1"]').innerHTML=h;
  const pr=Reel.prefs(),rg=root.querySelector('[data-fp="part"]'),ck=root.querySelector('[data-fp="rec"]');
  if(document.activeElement!==rg)rg.value=String(+pr.partPlacements||0);
  root.querySelector('[data-fp="partV"]').textContent=rg.value+" %";
  ck.checked=!!pr.inclureARecevoir;
}
function headline(){
  if(!last)return "–";
  return {rp:"Acheter",loc:"Louer + ETF",inv:"Louer + locatif"}[rank(last.runs[0],last.I.H)[0][0]];
}
function syncRanges(){
  RANGES.forEach(id=>{$(id+"R").value=$(id).value;});
  $("surfaceV").textContent=eur(num("surface"))+" m²";
  $("apportV").textContent=realHas.apport&&!realOv("apport")?eur(num("apport"))+" €":kk(num("apport"));
  $("horizonV").textContent=num("horizon")+" ans";
  $("discV").textContent=eur(num("disc"))+" %";
}
function render(){
  applyReal();fillAuto();syncRanges();
  const I=inputs(),SCN=scenarios();
  $("pret").value=eur(Math.round(I.L));
  $("pretL").value=eur(Math.round(I.LL));
  const runs=SCN.map(s=>simulate(I,s));
  last={I,runs,SCN};
  if(current>=SCN.length)current=0;
  renderAll();renderReal();save();
  if(window.App&&App.refreshHeadlines)App.refreshHeadlines();
}
function renderAll(){renderPrecision();renderFace();renderScen();renderVerdict();drawChart();renderMatrix();renderMonthly();renderCosts();renderRenta();renderBank();renderExplain();}

function renderFace(){
  const {I}=last,c=CITIES[$("zone").value],s=I.s,price=I.prix,rent=I.rent0;
  $("buySm").innerHTML='<b>'+eur(price/s)+' €/m²</b> · frais d\'achat <b>'+eur(I.n*100,1)+' %</b> ('+k(I.notaire)+')';
  const cc=c.c==="FR"?Math.round((rent+s*(c.ch/0.35)*0.65/12)/10)*10:0;
  $("rentSm").innerHTML='<b>'+eur(rent/s,1)+' €/m²</b> par mois, hors charges'+(cc?' · soit ~<b>'+eur(cc)+' €</b> charges comprises, comme dans les annonces':'');
  const yrs=rent>0?price/(rent*12):0,yld=price>0?rent*12/price:0;
  const own=ownMonthly(I,price),oc=own.total;
  // prix d'équilibre : celui pour lequel le coût d'usage égale le loyer
  let lo=0,hi=price*3,be=null;
  if(ownMonthly(I,hi).total>=rent&&ownMonthly(I,lo+1).total<=rent){for(let i=0;i<50;i++){const mid=(lo+hi)/2;if(ownMonthly(I,mid).total>rent)hi=mid;else lo=mid;}be=(lo+hi)/2;}
  const max=Math.max(oc,rent,1)*1.08;
  const verdict=oc>rent?'<b>louer coûte moins cher</b> chaque mois':'<b>posséder coûte moins cher</b> chaque mois';
  $("ratio").innerHTML=
    '<p class="headline">Le prix vaut <b>'+eur(yrs,1)+' ans de loyer</b> (rendement brut <b>'+eur(yld*100,1)+' %</b>). Repères : sous 20 ans, l\'achat est souvent gagnant ; au-delà de 25 ans, la location l\'est le plus souvent.</p>'+
    '<div class="bars">'+
      '<div class="br"><span>Coût réel d\'un propriétaire</span><div class="t"><i style="width:'+Math.max(0,oc/max*100)+'%;background:var(--buy)"></i></div><span class="v">'+eur(oc)+' €/mois</span></div>'+
      '<div class="br"><span>Loyer</span><div class="t"><i style="width:'+(rent/max*100)+'%;background:var(--etf)"></i></div><span class="v">'+eur(rent)+' €/mois</span></div>'+
    '</div>'+
    '<p class="seuil">Le coût réel compte ce qu\'un propriétaire ne récupère jamais : intérêts et rendement perdu sur l\'apport ('+eur(own.parts.capital/12)+' €), charges et taxes ('+eur((own.parts.charges+own.parts.assurance)/12)+' €), frais d\'achat et de revente étalés ('+eur(own.parts.frais/12)+' €), moins la hausse attendue des prix (−'+eur(own.parts.hausse/12)+' €). Ici, '+verdict+'. '+
    (oc>rent?(be?'L\'achat deviendrait plus intéressant à partir d\'un loyer de <b>'+eur(oc)+' €</b> ou d\'un prix d\'environ <b>'+kk(be)+'</b>.':'')
            :'Louer ne deviendrait intéressant qu\'au-dessous de <b>'+eur(oc)+' €</b> de loyer.')+'</p>';
  $("srcLine").innerHTML=(c.est?'<span class="tag est">en partie estimé</span> ':'<span class="tag auto">sourcé</span> ')+'Source : '+c.src+'. Prix et loyer moyens de la ville, à remplacer par ceux de l\'annonce que tu regardes.';
}

function renderScen(){
  const {I,runs,SCN}=last,H=I.H;
  const btn=(i,name,w)=>'<button type="button" class="pb" data-sc="'+i+'" aria-pressed="'+(i===-1?allMode:(!allMode&&i===current))+'">'+(w?'<i class="w" style="background:'+SC[w]+'"></i>':'')+name+'</button>';
  $("scen").innerHTML=SCN.map((s,i)=>btn(i,s.name,rank(runs[i],H)[0][0])).join("")+btn(-1,"Tous");
  root.querySelectorAll("#simu-scen .pb").forEach(b=>b.addEventListener("click",()=>{const i=+b.dataset.sc;if(i===-1)allMode=true;else{allMode=false;current=i;}renderAll();save();}));
}

function renderVerdict(){
  const {I,runs,SCN}=last,H=I.H;
  if(allMode){
    const wins={rp:0,inv:0,loc:0};runs.forEach(R=>wins[rank(R,H)[0][0]]++);
    const best=ST.slice().sort((a,b)=>wins[b]-wins[a])[0];
    $("verdict").innerHTML="Après "+H+" ans, <span class=\"w "+best+"\">"+SNl[best]+"</span> arrive en tête dans "+wins[best]+" scénario"+(wins[best]>1?"s":"")+" sur "+runs.length+".";
    $("sdesc").textContent="Zone colorée : du pire au meilleur scénario pour chaque stratégie. Trait plein : scénario central.";
    $("tiles").innerHTML=ST.map(s=>{
      const vals=runs.map(R=>R.out[s][H-1]),lo=Math.min(...vals),hi=Math.max(...vals);
      return '<div class="tile '+s+(s===best?' first':'')+'"><div class="t">'+SN[s]+'<span>gagne '+wins[s]+' / '+runs.length+'</span></div><div class="n">'+kk(lo)+' à '+kk(hi)+'</div><div class="s">central : '+kk(runs[0].out[s][H-1])+'</div></div>';
    }).join("");
    return;
  }
  const R=runs[current],rk=rank(R,H),w=rk[0][0];
  $("verdict").innerHTML="Après "+H+" ans, <span class=\"w "+w+"\">"+SNl[w]+"</span> te laisse "+kk(rk[0][1]-rk[1][1])+" de plus que la 2e option.";
  $("sdesc").textContent="Scénario "+SCN[current].name.toLowerCase()+" : "+SCN[current].desc;
  const pos={};rk.forEach(([s],j)=>pos[s]=j);
  $("tiles").innerHTML=ST.map(s=>{
    const v=R.out[s][H-1],j=pos[s];
    return '<div class="tile '+s+(j===0?' first':'')+'"><div class="t">'+SN[s]+'<span>'+(j+1)+(j===0?'er':'e')+'</span></div><div class="n">'+k(v)+'</div><div class="s">'+(j===0?'patrimoine net après '+H+' ans':'−'+kk(rk[0][1]-v)+' par rapport au 1er')+'</div></div>';
  }).join("");
}

const CH={W:640,H:290,ml:52,mr:12,mt:12,mb:30};
function niceStep(range){const raw=range/5,p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p;return (f<1.5?1:f<3?2:f<7?5:10)*p}
function drawChart(){
  const {I,runs,SCN}=last,H=I.H;
  const {W,H:Hh,ml,mr,mt,mb}=CH,pw=W-ml-mr,ph=Hh-mt-mb;
  const series=allMode?runs:[runs[current]];
  let all=[0];series.forEach(R=>ST.forEach(s=>all=all.concat(R.out[s])));
  let lo=Math.min(...all),hi=Math.max(...all);
  const stp=niceStep(hi-lo||1);lo=Math.floor(lo/stp)*stp;hi=Math.ceil(hi/stp)*stp;
  const x=y=>ml+(y-1)/29*pw,yv=v=>mt+(hi-v)/(hi-lo)*ph;
  let g="";
  for(let v=lo;v<=hi+1e-6;v+=stp){g+='<line x1="'+ml+'" x2="'+(W-mr)+'" y1="'+yv(v)+'" y2="'+yv(v)+'" stroke="var(--line)" stroke-width="'+(Math.abs(v)<1e-6?1.4:.8)+'"/><text x="'+(ml-6)+'" y="'+(yv(v)+4)+'" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">'+(Math.abs(v)>=1e6?eur(v/1e6,1)+"M":eur(v/1000)+"k")+'</text>';}
  [1,5,10,15,20,25,30].forEach(y=>{g+='<text x="'+x(y)+'" y="'+(Hh-10)+'" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">'+y+(y===1?" an":" ans")+'</text>';});
  const path=a=>a.map((v,i)=>(i?"L":"M")+x(i+1).toFixed(1)+" "+yv(v).toFixed(1)).join("");
  g+='<line x1="'+x(H)+'" x2="'+x(H)+'" y1="'+mt+'" y2="'+(mt+ph)+'" stroke="var(--fg)" stroke-dasharray="3 4" stroke-width="1"/>';
  g+='<text x="'+(x(H)+(H>24?-6:6))+'" y="'+(mt+12)+'" text-anchor="'+(H>24?"end":"start")+'" font-size="11" font-weight="600" fill="var(--fg)" font-family="Schibsted Grotesk,sans-serif">'+H+' ans</text>';
  const order=["inv","loc","rp"];
  if(allMode){
    order.forEach(s=>{
      const mn=[],mx=[];for(let y=0;y<30;y++){const vs=runs.map(R=>R.out[s][y]);mn.push(Math.min(...vs));mx.push(Math.max(...vs));}
      g+='<path d="'+path(mx)+mn.slice().reverse().map((v,i)=>"L"+x(30-i).toFixed(1)+" "+yv(v).toFixed(1)).join("")+'Z" fill="'+SC[s]+'" fill-opacity="0.13" stroke="none"/>';
    });
    order.forEach(s=>{g+='<path d="'+path(runs[0].out[s])+'" fill="none" stroke="'+SC[s]+'" stroke-width="2.4" stroke-linejoin="round"/>';});
  }else{
    const R=runs[current],sc=SCN[current];
    if(sc.id==="k")g+='<rect x="'+x(2.5)+'" y="'+mt+'" width="'+(x(3.5)-x(2.5))+'" height="'+ph+'" fill="var(--bad)" fill-opacity="0.08"/><text x="'+x(3)+'" y="'+(mt+ph-6)+'" text-anchor="middle" font-size="10.5" fill="var(--bad)" font-family="Schibsted Grotesk,sans-serif">krach</text>';
    if(sc.id==="m")g+='<rect x="'+x(1)+'" y="'+mt+'" width="'+(x(4.5)-x(1))+'" height="'+ph+'" fill="var(--bad)" fill-opacity="0.08"/><text x="'+x(2.75)+'" y="'+(mt+ph-6)+'" text-anchor="middle" font-size="10.5" fill="var(--bad)" font-family="Schibsted Grotesk,sans-serif">baisse des prix</text>';
    order.forEach(s=>{g+='<path d="'+path(R.out[s])+'" fill="none" stroke="'+SC[s]+'" stroke-width="'+(s==="inv"?2:2.8)+'" stroke-linejoin="round"'+(s==="inv"?' stroke-dasharray="6 4"':'')+'/>';});
    ST.forEach(s=>{g+='<circle cx="'+x(H)+'" cy="'+yv(R.out[s][H-1])+'" r="4.5" fill="'+SC[s]+'" stroke="var(--surface)" stroke-width="1.5"/>';});
  }
  g+='<line id="hov" x1="0" x2="0" y1="'+mt+'" y2="'+(mt+ph)+'" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>';
  $("chart").innerHTML='<svg viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="Patrimoine net des trois stratégies de 1 à 30 ans">'+g+'</svg>';
  $("chartCap").textContent="Patrimoine net si tu soldais tout l'année indiquée (frais, dette et impôts déduits). Survole pour lire, clique pour changer la durée.";
  const svg=$("chart").querySelector("svg");
  const yearAt=ev=>{const r=svg.getBoundingClientRect(),vx=(ev.clientX-r.left)/r.width*W;return Math.max(1,Math.min(30,Math.round((vx-ml)/pw*29)+1));};
  svg.addEventListener("pointermove",ev=>{
    const y=yearAt(ev),hov=$("hov");
    hov.setAttribute("x1",x(y));hov.setAttribute("x2",x(y));hov.setAttribute("visibility","visible");
    const base=allMode?runs[0]:runs[current];
    const rows=ST.map(s=>[s,base.out[s][y-1]]).sort((a,b)=>b[1]-a[1]);
    let html='<div class="y">Après '+y+' an'+(y>1?'s':'')+(allMode?' · central (fourchette)':'')+'</div>';
    html+=rows.map(([s,v])=>{let r="";if(allMode){const vs=runs.map(R=>R.out[s][y-1]);r=' <i class="r">'+kk(Math.min(...vs))+' à '+kk(Math.max(...vs))+'</i>';}return '<span><em><i class="dot '+SD[s]+'"></i>'+SN[s]+'</em><b>'+kk(v)+r+'</b></span>';}).join("");
    const tip=$("tip");tip.innerHTML=html;tip.hidden=false;
    const wr=$("chartwrap").getBoundingClientRect(),r=svg.getBoundingClientRect();
    let left=r.left-wr.left+x(y)/W*r.width+12;const tw=tip.offsetWidth||230;
    if(left+tw>wr.width)left=left-tw-24;
    tip.style.left=Math.max(0,left)+"px";tip.style.top="8px";
  });
  svg.addEventListener("pointerleave",()=>{$("tip").hidden=true;const h=$("hov");if(h)h.setAttribute("visibility","hidden");});
  svg.addEventListener("click",ev=>{$("horizon").value=yearAt(ev);touched.horizon=true;render();});
}

function renderMatrix(){
  const {I,runs,SCN}=last,H=I.H;
  $("mxH").textContent="patrimoine net après "+H+" ans";
  $("mx").innerHTML='<thead><tr><th>Scénario</th><th><i class="dot b"></i> Acheter</th><th><i class="dot e"></i> Louer + ETF</th><th><i class="dot i"></i> Louer + locatif</th></tr></thead><tbody>'+
    SCN.map((s,i)=>{const R=runs[i],w=rank(R,H)[0][0];
      return '<tr data-sc="'+i+'" class="'+(!allMode&&i===current?'sel':'')+'"><td><b>'+s.name+'</b><small>'+s.desc+'</small></td>'+ST.map(st=>'<td class="'+st+(st===w?' best':'')+'">'+kk(R.out[st][H-1])+'</td>').join("")+'</tr>';
    }).join("")+'</tbody>';
  root.querySelectorAll("#mx tbody tr").forEach(tr=>tr.addEventListener("click",()=>{allMode=false;current=+tr.dataset.sc;renderAll();save();window.scrollTo({top:$("scen").getBoundingClientRect().top+window.scrollY-OFF,behavior:"smooth"});}));
}

function detailRun(){return last.runs[allMode?0:current]}

function renderMonthly(){
  const {I}=last,m=detailRun().m1;
  const f=v=>v?eur(v)+' €':'–';
  const line=(l,a,b,c,cls)=>'<tr'+(cls?' class="'+cls+'"':'')+'><td>'+l+'</td><td>'+f(a)+'</td><td>'+f(b)+'</td><td>'+f(c)+'</td></tr>';
  const lc=m.lc,rc=m.rc,budget=Math.max(m.rpOut,m.invOut,m.locOut);
  $("sumCaches").textContent=eur(sum(rc))+" €/mois si tu achètes";
  $("monthly").innerHTML='<tr><th>1er mois</th><th>Acheter</th><th>Louer + ETF</th><th>Louer + locatif</th></tr>'+
    line("Ton loyer",0,m.loyer,m.loyer)+
    line("Mensualité de crédit",m.it+m.princ,0,m.itL+m.prL)+
    line("dont capital remboursé (épargne)",m.princ,0,m.prL,"sub")+
    line("Assurance emprunteur",m.ins,0,m.insL)+
    line("Taxe foncière",rc.tf,0,lc.tf)+
    line("Copropriété et gros travaux",rc.copro+rc.prov,0,lc.copro+lc.prov)+
    line("Entretien",rc.entretien,0,lc.entretien)+
    line("Assurances",rc.assuHab,0,lc.pno+lc.gli)+
    line("Gestion, CFE, comptable",0,0,lc.gestion+lc.cfeCompta)+
    line(m.taxAvg>=0?"Impôt sur les loyers (lissé)":"Économie d'impôt (lissée)",0,0,m.taxAvg)+
    line("Loyer encaissé, vacance déduite",0,0,-m.rentIn)+
    '<tr class="tot"><td>Dépense nette</td><td>'+eur(m.rpOut)+' €</td><td>'+eur(m.locOut)+' €</td><td>'+eur(m.invOut)+' €</td></tr>'+
    '<tr class="sub"><td>Placé en ETF</td><td>'+eur((budget-m.rpOut)*I.disc)+' €</td><td>'+eur((budget-m.locOut)*I.disc)+' €</td><td>'+eur((budget-m.invOut)*I.disc)+' €</td></tr>';
}

function renderCosts(){
  const {I}=last,R=detailRun(),s=R.snap,H=I.H,mo=H*12;
  const row=(l,v,h)=>'<tr><td>'+l+(h?'<span class="hint">'+h+'</span>':'')+'</td><td>'+k(v)+'</td></tr>';
  const c=s.cR,garNet=I.garantie-s.rest;
  const totB=I.notaire+I.dossier+I.courtage+garNet+I.travaux+c.interets+c.assurance+c.tf+c.copro+c.prov+c.entretien+c.assuHab+s.fV+s.ira;
  const pv=s.v-I.prix;
  $("costBuy").innerHTML='<tr><th>Poste</th><th>Cumul</th></tr>'+
    row("Frais d'achat, dossier, garantie",I.notaire+I.dossier+I.courtage+garNet)+row("Travaux à l'entrée",I.travaux)+
    row("Intérêts et assurance",c.interets+c.assurance)+row("Taxe foncière",c.tf)+row("Copro et gros travaux",c.copro+c.prov)+
    row("Entretien et assurance",c.entretien+c.assuHab)+(I.vente?row("Revente et pénalités",s.fV+s.ira):"")+
    '<tr class="tot"><td>Total</td><td>'+k(totB)+'</td></tr><tr class="sub"><td>Par mois</td><td>'+eur(totB/mo)+' €</td></tr>'+
    '<tr class="sub"><td>Plus-value (exonérée en France)</td><td class="'+(pv>=0?'pos':'neg')+'">'+(pv>=0?'+':'')+k(pv)+'</td></tr>';
  const cl=s.cL,p=s.pots.loc,totR=cl.loyers+cl.agence,gain=p.net-p.c;
  $("costRent").innerHTML='<tr><th>Poste</th><th>Cumul</th></tr>'+
    row("Loyers",cl.loyers)+row("Frais d'agence",cl.agence,Math.floor((H*12-1)/(12*I.reloc))+" déménagement(s)")+
    '<tr class="tot"><td>Total</td><td>'+k(totR)+'</td></tr><tr class="sub"><td>Par mois</td><td>'+eur(totR/mo)+' €</td></tr>'+
    '<tr class="sub"><td>Versé en ETF</td><td>'+k(p.c)+'</td></tr><tr class="sub"><td>Gain net d\'impôt</td><td class="'+(gain>=0?'pos':'neg')+'">'+(gain>=0?'+':'')+k(gain)+'</td></tr>';
  const ci=s.cI,garNetL=I.garantieL-s.restL;
  const costsI=ci.loyers+ci.agence+I.notaireL+I.dossier+I.courtage+garNetL+I.travauxL+I.mobilier+ci.interets+ci.assurance+ci.tf+ci.copro+ci.prov+ci.entretien+ci.pno+ci.gli+ci.gestion+ci.reloc+ci.cfeCompta+ci.impots+s.fVL+s.iraL+s.pvt.tax;
  const totI=costsI-ci.loyersRecus;
  $("costInv").innerHTML='<tr><th>Poste</th><th>Cumul</th></tr>'+
    row("Ton loyer et frais d'agence",ci.loyers+ci.agence)+row("Frais d'achat, travaux, mobilier",I.notaireL+I.dossier+I.courtage+garNetL+I.travauxL+I.mobilier)+
    row("Intérêts et assurance",ci.interets+ci.assurance)+row("Taxe foncière, copro, entretien",ci.tf+ci.copro+ci.prov+ci.entretien)+
    row("PNO, impayés, gestion, relocation",ci.pno+ci.gli+ci.gestion+ci.reloc+ci.cfeCompta)+
    row("Impôts (loyers et plus-value)",ci.impots+s.pvt.tax)+(I.vente?row("Revente et pénalités",s.fVL+s.iraL):"")+
    '<tr><td>Loyers encaissés</td><td class="pos">−'+k(ci.loyersRecus)+'</td></tr>'+
    '<tr class="tot"><td>Total net</td><td>'+k(totI)+'</td></tr><tr class="sub"><td>Par mois</td><td>'+eur(totI/mo)+' €</td></tr>';
}

function renderRenta(){
  const {I}=last,R=detailRun(),y1=R.y1,m=R.m1,s=R.snap;
  const coutTotal=I.prixL+I.notaireL+I.travauxL+I.mobilier+I.dossier+I.courtage+I.garantieL;
  const chargesAn=sum(m.lc)*12;
  const brut=I.prixL>0?I.rentL0*12/I.prixL:0;
  const net=coutTotal>0?(y1.R-chargesAn)/coutTotal:0;
  const netnet=coutTotal>0?(y1.R-chargesAn-y1.tax)/coutTotal:0;
  const cf=R.cf1/12;
  $("sumRenta").textContent=CITIES[$("zoneL").value].n+" · "+eur(brut*100,1)+" % brut · cash-flow "+(cf>=0?"+":"")+eur(cf)+" €/mois";
  $("kpisL").innerHTML=
    '<div class="kpi"><span class="l">Rendement brut</span><span class="n">'+eur(brut*100,2)+' %</span><span class="s">loyer annuel / prix</span></div>'+
    '<div class="kpi"><span class="l">Rendement net</span><span class="n">'+eur(net*100,2)+' %</span><span class="s">après vacance et charges</span></div>'+
    '<div class="kpi"><span class="l">Net-net</span><span class="n">'+eur(netnet*100,2)+' %</span><span class="s">après impôt</span></div>'+
    '<div class="kpi"><span class="l">Cash-flow</span><span class="n '+(cf>=0?'pos':'neg')+'">'+(cf>=0?'+':'')+eur(cf)+' €</span><span class="s">par mois, année 1</span></div>';
  $("fiscL").innerHTML='<tr><th>'+REG[I.regime]+' · année 1</th><th>Montant</th></tr>'+
    '<tr><td>Loyers encaissés</td><td>'+eur(y1.R)+' €</td></tr>'+
    '<tr><td>Charges déductibles hors intérêts'+(y1.init>0?'<span class="hint">dont '+eur(y1.init)+' € de frais d\'acquisition déduits la 1re année</span>':'')+'</td><td>'+eur(y1.Ch+y1.init)+' €</td></tr>'+
    '<tr><td>Intérêts</td><td>'+eur(y1.Int)+' €</td></tr>'+
    '<tr><td>'+(y1.tax>=0?'Impôt et prélèvements sociaux':'Économie d\'impôt (déficit foncier)')+'</td><td class="'+(y1.tax>0?'neg':'pos')+'">'+eur(Math.abs(y1.tax))+' €</td></tr>'+
    '<tr class="tot"><td>Impôt cumulé sur '+I.H+' ans</td><td>'+k(s.cI.impots)+'</td></tr>'+
    (I.vente?'<tr class="sub"><td>Impôt sur la plus-value à la revente</td><td>'+k(s.pvt.tax)+'</td></tr>':'');
}

function gaugeHTML(label,dti){
  const c=dti<=0.33?"var(--ok)":dti<=0.35?"var(--warn)":"var(--bad)";
  return '<div class="gline"><div class="gt"><span>'+label+'</span><b>'+eur(dti*100,1)+' %</b></div><div class="gauge"><i style="width:'+Math.min(100,dti/0.5*100)+'%;background:'+c+'"></i><b></b></div><div class="gauge-lbl"><span>0 %</span><span>35 % max</span><span>50 %</span></div></div>';
}
function renderBank(){
  const {I,runs}=last,rev=I.rev,other=I.credits,m=runs[0].m1;
  const mRP=I.P+I.L*I.ass/12,mL=I.PL+I.LL*I.ass/12;
  const dti=rev>0?(mRP+other)/rev:0;
  const revL=rev+0.7*I.rentL0,dtiL=revL>0?(mL+other)/revL:0;
  const unit=(I.r===0?1/I.N:I.r/(1-Math.pow(1+I.r,-I.N)))+I.ass/12;
  const Lmax=Math.max(0,0.35*rev-other)/unit;
  const prixMax=Math.max(0,(Lmax*(1-I.g)+I.apport-I.dossier-I.courtage-I.travaux)/(1+I.n));
  const pill=d=>d<=0.33?'<span class="pill ok">Finançable</span>':d<=0.35?'<span class="pill warn">Limite</span>':'<span class="pill bad">Au-delà de 35 %</span>';
  $("kpis").innerHTML=
    '<div class="kpi"><span class="l">Endettement achat</span><span class="n">'+eur(dti*100,1)+' %</span><span class="s">'+pill(dti)+'</span></div>'+
    '<div class="kpi"><span class="l">Endettement locatif</span><span class="n">'+eur(dtiL*100,1)+' %</span><span class="s">'+pill(dtiL)+'</span></div>'+
    '<div class="kpi"><span class="l">Prix max finançable</span><span class="n">'+kk(prixMax)+'</span><span class="s">à 35 %, frais inclus</span></div>'+
    '<div class="kpi"><span class="l">Mensualité achat</span><span class="n">'+eur(mRP)+' €</span><span class="s">crédit et assurance</span></div>';
  $("gauges").innerHTML=gaugeHTML("Achat : mensualité ÷ revenus",dti)+gaugeHTML("Locatif : mensualité ÷ (revenus + 70 % du loyer perçu)",dtiL);
  const al=[];
  const fraisRP=I.notaire+I.dossier+I.courtage+I.garantie;
  if(I.apport<fraisRP)al.push(["bad","Achat : l'apport ne couvre pas les frais d'entrée ("+k(fraisRP)+"). La plupart des banques l'exigent."]);
  if(dti>0.35)al.push(["bad","Achat : endettement au-dessus de 35 %. Baisse la surface, change de ville ou augmente l'apport."]);
  if(dtiL>0.35)al.push(["bad","Locatif : endettement au-dessus de 35 %, même en comptant 70 % du loyer."]);
  if(rev>0&&rev-other-m.rpOut<1000)al.push(["warn","Achat : reste à vivre sous 1 000 €/mois."]);
  if(I.essai)al.push(["warn","Période d'essai en cours : la plupart des banques attendent qu'elle soit terminée."]);
  const nb=al.filter(a=>a[0]==="bad").length,nw=al.filter(a=>a[0]==="warn").length;
  if(!al.length)al.push(["ok","Les deux projets sont finançables avec ces hypothèses."]);
  $("alerts").innerHTML=al.map(a=>'<div class="alert '+a[0]+'">'+a[1]+'</div>').join("");
  const txt=nb?nb+" point"+(nb>1?"s":"")+" bloquant"+(nb>1?"s":""):nw?nw+" point"+(nw>1?"s":"")+" d'attention":"finançable";
  $("sumBank").textContent=txt+" · revenus "+eur(rev)+" €/mois";
  $("bankline").innerHTML=nb||nw?'<span class="pill '+(nb?'bad':'warn')+'">Banque</span><span>'+txt+' avec '+eur(rev)+' €/mois de revenus.</span><button type="button" class="linkbtn" id="goBank">Voir le détail</button>':'<span class="pill ok">Banque</span><span>Finançable avec '+eur(rev)+' €/mois de revenus.</span><button type="button" class="linkbtn" id="goBank">Changer les revenus</button>';
  $("goBank").addEventListener("click",()=>{setMore(true);const d=$("accBank");d.open=true;d.scrollIntoView({behavior:"smooth",block:"start"});save();});
}

/* Explication */
function renderExplain(){
  const {I,runs,SCN}=last,R=runs[0],m=R.m1,H=I.H;
  const outs={rp:m.rpOut,loc:m.locOut,inv:m.invOut},budget=Math.max(outs.rp,outs.loc,outs.inv);
  const top=ST.slice().sort((a,b)=>outs[b]-outs[a])[0];
  const city=CITIES[$("zone").value].n;
  const rpEtfH=R.parts.rp[H-1].etf,rpEtf30=R.parts.rp[29].etf,loanY=I.N/12;
  const row=s=>'<tr><td><i class="dot '+SD[s]+'"></i> '+SN[s]+'</td><td>'+eur(outs[s])+' €</td><td>'+eur((budget-outs[s])*I.disc)+' €</td></tr>';
  $("exBudget").innerHTML='<h3>Avec quel argent investit-on en ETF ?</h3>'+
    '<p>Avec la différence de coût entre les options, et seulement elle. Ton budget logement est le même dans les trois cas : celui de l\'option la plus chère. Chaque mois, les deux autres options dépensent moins et placent l\'écart en ETF. C\'est ce qui rend la comparaison juste : tu ne peux pas à la fois rembourser un crédit et placer ce même argent.</p>'+
    '<p>Exemple avec tes chiffres ('+city+', '+eur(I.s)+' m², premier mois, scénario central) :</p>'+
    '<div class="tw"><table class="detail"><tr><th>Option</th><th>Dépense nette</th><th>Placé en ETF</th></tr>'+ST.map(row).join("")+'</table></div>'+
    '<p>Ici, l\'option la plus chère est <strong>'+SNl[top]+'</strong> : elle fixe le budget à '+eur(budget)+' € par mois. '+
    (top==="rp"?'<strong>Donc, tant que tu rembourses ton crédit, l\'achat n\'investit pas en ETF</strong> : tout ton budget part dans le logement. C\'est le locataire qui place la différence, plus tout l\'apport dès le départ. L\'achat ne commence à placer que lorsque son coût mensuel passe sous celui des autres options, en pratique à la fin du crédit (année '+loanY+'). Avec tes paramètres, l\'achat n\'a que '+kk(rpEtfH)+' d\'ETF après '+H+' ans, mais '+kk(rpEtf30)+' après 30 ans, une fois le crédit remboursé.':'Comme l\'achat coûte ici moins cher que l\'option la plus chère, il place lui aussi la différence chaque mois.')+'</p>'+
    '<p>Ce raisonnement suppose que tu places vraiment l\'argent économisé. Si tu en dépenses une partie, baisse le réglage « Part des économies réellement placée » dans le détail : il est à '+eur(I.disc*100)+' %.</p>';
  const cross=R.out.rp.findIndex((v,j)=>v>=R.out.loc[j]);
  $("exCross").innerHTML=cross===-1?'Avec tes paramètres, en scénario central, la courbe verte ne croise jamais la bleue sur 30 ans : louer + ETF reste devant.':cross===0?'Avec tes paramètres, l\'achat est devant dès la première année.':'Avec tes paramètres, en scénario central, le point mort arrive après <strong>'+(cross+1)+' ans</strong>.';
  const why={c:"Calé sur la recherche : prix des logements proches de l'inflation (Friggit), actions mondiales autour de 6 % net de frais (Jordà et al., ajusté aux valorisations actuelles).",
    o:"Teste un retour à une forte hausse des prix et à des marchés porteurs. C'est le scénario le plus favorable à l'achat à crédit.",
    p:"Teste une période terne : immobilier en léger recul, bourse faible. Utile pour voir ce qui résiste quand rien ne va bien.",
    k:"Teste le risque principal de la location + ETF : une chute brutale des marchés, comme en 2008 (−40 %) ou en 2020.",
    m:"Teste le risque principal de l'achat : les prix français sont 55 % au-dessus de leur tendance longue ; une correction les ramènerait vers les revenus.",
    f:"Teste l'atout caché de l'achat à crédit : avec un taux fixe, ta mensualité ne bouge pas pendant que loyers et prix montent."};
  $("exScen").innerHTML=SCN.map((sc,i)=>{const R2=runs[i],w=rank(R2,H)[0][0];
    return '<div class="scc"><div class="h"><b>'+sc.name+'</b><span class="wn w '+w+'">'+SN[w]+' gagne</span></div><span class="hy">'+sc.desc+'</span><span class="why">'+why[sc.id]+'</span>'+
    '<div class="vals">'+ST.map(s2=>'<span><i class="dot '+SD[s2]+'"></i>'+kk(R2.out[s2][H-1])+'</span>').join("")+'</div>'+
    '<button type="button" class="ghost" data-show="'+i+'">Voir sur la courbe</button></div>';}).join("");
  root.querySelectorAll("#exScen [data-show]").forEach(b=>b.addEventListener("click",()=>{allMode=false;current=+b.dataset.show;showTab("sim");renderAll();save();$("scen").scrollIntoView({behavior:"smooth",block:"start"});}));
}

/* Précision */
function buildPrecision(){
  $("precList").innerHTML=PREC.map(p=>{
    const src=$(p.id);let ctl;
    if(src.tagName==="SELECT")ctl='<div class="inp"><select data-p="'+p.id+'" aria-label="'+p.l+'">'+src.innerHTML+'</select></div>';
    else ctl='<div class="inp"><input data-p="'+p.id+'" type="number" inputmode="decimal" aria-label="'+p.l+'"><span class="u">'+p.u+'</span></div>';
    return '<div class="pr" data-row="'+p.id+'"><span class="ck">✓</span><span class="tx"><b>'+p.l+'</b><small>'+p.h+'</small></span>'+ctl+'<span class="g">+'+p.g+' %</span></div>';
  }).join("");
  root.querySelectorAll("[data-p]").forEach(el=>{
    const id=el.dataset.p;
    el.addEventListener(el.tagName==="SELECT"?"change":"input",()=>{
      if(el.value==="")return;
      $(id).value=el.value;touched[id]=true;if(AUTO.includes(id))manual[id]=true;markReal(id);render();
    });
  });
  // pastille de gain sur chaque champ du détail
  PREC.forEach(p=>{
    const lab=root.querySelector('label[for="'+(REN[p.id]||p.id)+'"]')||root.querySelector('label[for="'+(REN[p.id+"R"]||p.id+"R")+'"]');
    if(lab&&!lab.querySelector(".gain")){const sp=document.createElement("span");sp.className="gain";sp.dataset.g=p.id;lab.appendChild(sp);}
  });
}
function renderPrecision(){
  let score=10;
  PREC.forEach(p=>{
    const d=isDone(p.id);if(d)score+=p.g;
    const row=root.querySelector('[data-row="'+p.id+'"]');if(row)row.classList.toggle("done",d);
    const el=root.querySelector('[data-p="'+p.id+'"]');if(el&&document.activeElement!==el)el.value=$(p.id).value;
    const g=root.querySelector('.gain[data-g="'+p.id+'"]');if(g){g.textContent=d?"✓ précis":"+"+p.g+" % précision";g.classList.toggle("done",d);}
  });
  const q=score<40?"Ordre de grandeur":score<70?"Estimation correcte":score<90?"Simulation précise":"Très précise";
  $("precN").textContent=score+" %";$("precQ").textContent=q;$("precBar").style.width=score+"%";
  const next=PREC.filter(p=>!isDone(p.id)).slice(0,2);
  $("precline").innerHTML='<span class="pill '+(score<40?'warn':'ok')+'">Précision '+score+' %</span><span>'+(next.length?q+'. Ajoute '+next.map(p=>p.l.toLowerCase()+' (+'+p.g+' %)').join(' et ')+'.':'Toutes tes données sont renseignées.')+'</span><button type="button" class="linkbtn" id="goPrec">Améliorer</button>';
  $("goPrec").addEventListener("click",()=>$("precCard").scrollIntoView({behavior:"smooth",block:"start"}));
}

/* Événements */
function setMore(open){$("more").hidden=!open;$("moreBtn").setAttribute("aria-expanded",open?"true":"false");}
$("moreBtn").addEventListener("click",()=>{setMore($("more").hidden);save();});
AUTO.forEach(id=>$(id).addEventListener("input",()=>{manual[id]=true;touched[id]=true;render();}));
root.querySelectorAll(".tag[data-for]").forEach(t=>{
  const reset=()=>{const id=t.dataset.for;if(manual[id]){manual[id]=false;touched[id]=false;render();}};
  t.addEventListener("click",reset);
  t.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();}});
});
FIELDS.forEach(el=>{
  if(AUTO.includes(el.id)||el.id==="zone"||el.id==="zoneL"||el.type==="hidden")return;
  el.addEventListener(el.tagName==="SELECT"||el.type==="checkbox"?"change":"input",()=>{touched[el.id]=true;markReal(el.id);render();});
});
RANGES.forEach(id=>$(id+"R").addEventListener("input",()=>{$(id).value=$(id+"R").value;touched[id]=true;markReal(id);render();}));
$("zone").addEventListener("change",()=>{["prix","loyer","tf","copro","provCopro","agence","fraisA","taux","revente"].forEach(i=>manual[i]=false);render();});
$("zoneL").addEventListener("change",()=>{["prixL","loyerL","tfL","coproL","provCoproL","honoL","terrain","fraisAL"].forEach(i=>manual[i]=false);render();});
$("reset").addEventListener("click",()=>{FIELDS.forEach(e=>{if(e.type==="checkbox")e.checked=DEF[e.id];else e.value=DEF[e.id];});for(const id in manual)delete manual[id];for(const id in touched)delete touched[id];current=0;allMode=false;if(window.Reel)Reel.clearAll("simu");render();});

/* Données réelles : une saisie sur un champ alimenté passe en « scénario » ; la pastille rétablit le réel. */
root.addEventListener("click",e=>{
  const b=e.target.closest("[data-reel-reset]");if(!b||!root.contains(b))return;
  const [m,id]=b.dataset.reelReset.split(":");if(m!=="simu"||!window.Reel)return;
  e.preventDefault();Reel.clear("simu",id);render();
});
const fpPart=root.querySelector('[data-fp="part"]'),fpRec=root.querySelector('[data-fp="rec"]');
fpPart.addEventListener("input",()=>{root.querySelector('[data-fp="partV"]').textContent=fpPart.value+" %";if(window.Reel)Reel.setPref("partPlacements",+fpPart.value);});
fpRec.addEventListener("change",()=>{if(window.Reel)Reel.setPref("inclureARecevoir",fpRec.checked);});

/* Sous-onglets du module (Simulateur, Comment ça marche, La recherche) */
const OFF=96; // hauteur de la barre d'onglets fixe de l'application
function toTop(){const y=root.getBoundingClientRect().top+window.scrollY-OFF;if(window.scrollY>y)window.scrollTo({top:Math.max(0,y)});}
function showTab(t){
  [["sim","simu-t-sim","simu-p-sim"],["ex","simu-t-ex","simu-p-ex"],["th","simu-t-th","simu-p-th"]].forEach(([k,b,p])=>{$(b).setAttribute("aria-selected",k===t?"true":"false");$(p).hidden=k!==t;});
}
$("simu-t-sim").addEventListener("click",()=>showTab("sim"));
$("simu-t-ex").addEventListener("click",()=>{showTab("ex");toTop();});
$("simu-t-th").addEventListener("click",()=>{showTab("th");toTop();});
if(location.hash==="#theorie")showTab("th");
if(location.hash==="#explication")showTab("ex");
root.querySelectorAll(".toc button[data-go]").forEach(b=>b.addEventListener("click",()=>{const t=$(b.dataset.go);if(t)t.scrollIntoView({behavior:"smooth",block:"start"});}));
root.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{showTab(b.dataset.tab);toTop();}));
try{const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){const id=e.target.id;const nav=e.target.closest(".doc").querySelector(".toc");nav.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x.dataset.go===id));}});},{rootMargin:"-20% 0px -70% 0px"});
root.querySelectorAll(".read section[id]").forEach(sec=>io.observe(sec));}catch(e){}

buildPrecision();
load();
return{render,headline,last:()=>last};
}

const api={
  mount(r){root=r;ENG=engine();},
  update(S,visible){SNAP=S;if(!ENG)return;if(visible||!ENG.last()){ENG.render();dirty=false;}else dirty=true;},
  show(){if(ENG){ENG.render();dirty=false;}},
  headline(){return ENG?ENG.headline():"–";}
};
const reg = () => App.register("simu", api); if (window.App) reg(); else (window.__pending = window.__pending || []).push(reg);
})();
