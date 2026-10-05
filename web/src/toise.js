/* Ma position : portage de « La toise des revenus » (sources/toise.html) en module de l'App.
   Le moteur de calcul (ENGINE-START … ENGINE-END) est recopié à l'identique ; seuls le câblage DOM,
   la persistance et le branchement sur les données réelles (Reel) changent. */
(function(){
'use strict';
/*ENGINE-START*/
const nf0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dec=(v,d)=>v.toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
function eur(v){if(!isFinite(v))return '∞';const a=Math.abs(v);if(a>=1e6)return (v/1e6).toLocaleString('fr-FR',{maximumFractionDigits:2})+' M€';return nf0.format(a>=10000?Math.round(v/100)*100:Math.round(v))+' €'}
function pctA(x){x=Math.max(0,x);if(x>=10)return nf0.format(Math.round(x))+' %';if(x>=1)return dec(x,1).replace(/,0$/,'')+' %';if(x>=.1)return dec(x,1)+' %';return dec(x,2)+' %'}
function pts(v){return v<.05?'0':v<10?dec(v,1):nf0.format(Math.round(v))}

/* niveaux de vie 2024 (INSEE), €/UC/mois */
const MED=26740/12,DEC=[13970,17700,20980,23880,26740,29880,33680,38780,48580].map(v=>v/12),C95=61220/12;
const RT=[90140/41220,234170/41220,850550/41220];
function nvK(s){const d9=DEC[8];const K=[[.4*MED,4.5],[1074,7.7],[.5*MED,8.8],[DEC[0],10],[.6*MED,15.4],[DEC[1],20],[.7*MED,22.8],[DEC[2],30],[DEC[3],40],[DEC[4],50],[DEC[5],60],[DEC[6],70],[DEC[7],80],[d9,90],[C95,95],[d9*RT[0]*s[0],99],[d9*RT[1]*s[1],99.9],[d9*RT[2]*s[2],99.99]];K.est=15;return K}
const NV=nvK([1,1,1]);const C99=NV[15][0],C999=NV[16][0],C9999=NV[17][0];
const D_NV={K:NV,alt:[nvK([8650/C99,.85,.75]),nvK([9300/C99,1.15,1.25])],neff:39000};
const P11=[10,20,30,40,50,60,70,80,90,95,99],P9=[10,20,30,40,50,60,70,80,90];
function mk(v,P,neff){const K=v.map((x,i)=>[x,P[i]]);K.est=999;return{K,neff}}
/* salaires nets EQTP 2024 (INSEE) */
const SALV={E:[1492,1669,1823,1992,2190,2442,2785,3305,4334,5593,10261],F:[1477,1626,1761,1907,2079,2297,2599,3051,3920,4959,8508],H:[1507,1708,1879,2063,2281,2554,2928,3499,4630,6035,11441]};
const D_SAL={};for(const k in SALV)D_SAL[k]=mk(SALV[k],P11,Infinity);
/* patrimoine début 2024 (INSEE, HVP) */
const PNV=[4600,13200,34100,77900,148100,224200,317400,457900,750400,1151500,2728900];
const D_PN=mk(PNV,P11,8000);
const PB_K=[[2400,5],[6200,10],[10200,15],[16500,20],[25500,25],[40100,30],[65700,35],[112100,40],[161500,45],[205100,50],[243600,55],[283200,60],[322500,65],[381800,70],[441000,75],[530000,80],[652100,85],[857700,90],[1000100,92.5],[1268200,95],[1640700,97],[3020900,99],[4104200,99.5]];PB_K.est=999;
const D_PB={K:PB_K,neff:8000};
const AGE={
  u30:{l:'moins de 30 ans',neff:800,b:[3600,7900,12300,20300,26100,35700,56000,162800,296400],n:[2200,5900,11400,15400,23100,31000,46800,75000,173700]},
  a30:{l:'30 à 39 ans',neff:1300,b:[6200,10200,21200,47800,146200,237000,301800,423100,620100],n:[4200,8500,15700,34700,65700,107100,160700,237200,423800]},
  a40:{l:'40 à 49 ans',neff:1300,b:[7400,16800,40600,127700,215200,292100,390800,543500,850000],n:[4400,11900,29800,75000,130800,197200,270800,401500,623600]},
  a50:{l:'50 à 59 ans',neff:1300,b:[7700,26000,74500,181300,254100,327900,438200,621100,1021900],n:[6200,23000,58200,139300,205900,287700,395600,558000,900600]},
  a60:{l:'60 à 69 ans',neff:1300,b:[4000,20600,54800,153600,245000,330900,441900,624900,1024700],n:[3400,18000,51000,139500,229300,317200,432300,606700,992500]},
  a70:{l:'70 ans ou plus',neff:1300,b:[7800,40900,113600,183800,247600,324400,429400,588600,900500],n:[7800,40900,113600,179600,245600,324100,427500,588500,893800]}};
const NVDEC_NET=[13300,13600,40900,81500,125900,160700,201800,271300,387300,825400];
const GROWTH={rev:{2024:{c:0,lo:0,hi:0},2025:{c:.017,lo:.009,hi:.025},2026:{c:.036,lo:.025,hi:.05}},pat:{2024:{c:0,lo:0,hi:0},2025:{c:.015,lo:-.01,hi:.04},2026:{c:.03,lo:0,hi:.07}}};

const GRIDS={
  fine:{desc:"Synthèse en 10 niveaux : seuils de pauvreté INSEE, classes moyennes du Crédoc, seuil de richesse de l'Observatoire et centiles du haut.",classes:[
    {n:'Grande pauvreté',d:'Moins de 40 % de la médiane',s:'INSEE',hi:.4*MED},
    {n:'Pauvres',d:'40 à 60 % de la médiane',s:'INSEE',hi:.6*MED},
    {n:'Modestes',d:'60 % de la médiane au 3e décile',s:'Observatoire des inégalités',hi:DEC[2]},
    {n:'Classes moyennes inférieures',d:'3e au 6e décile',s:'Crédoc',hi:DEC[5]},
    {n:'Classes moyennes supérieures',d:'6e au 8e décile',s:'Crédoc',hi:DEC[7]},
    {n:'Aisés',d:'8e décile à 2 × la médiane',s:'Observatoire des inégalités',hi:2*MED},
    {n:'Riches',d:'2 × la médiane au top 1 %',s:'Observatoire des inégalités',hi:C99,rich:true},
    {n:'Très riches',d:'Top 1 % au top 0,1 %',s:'INSEE, estimation',hi:C999,rich:true},
    {n:'Ultra-riches',d:'Top 0,1 % au top 0,01 %',s:'INSEE, estimation',hi:C9999,rich:true},
    {n:'Hyper-riches',d:'Top 0,01 %',s:'INSEE, estimation',hi:Infinity,rich:true}]},
  obs:{desc:"Observatoire des inégalités : populaires (30 %), moyennes (50 %), aisées (20 %), dont les riches au-delà de 2 × la médiane.",classes:[
    {n:'Catégories populaires',d:'Les 30 % les plus modestes',s:'Observatoire des inégalités',hi:DEC[2]},
    {n:'Classes moyennes',d:'Du 3e au 8e décile',s:'Observatoire des inégalités',hi:DEC[7]},
    {n:'Catégories aisées',d:'Top 20 %, sous le seuil de richesse',s:'Observatoire des inégalités',hi:2*MED},
    {n:'Riches',d:'Plus de 2 × la médiane',s:'Observatoire des inégalités',hi:Infinity,rich:true}]},
  credoc:{desc:"Crédoc (2008) : six groupes découpés par déciles de niveau de vie, appliqués aux déciles 2024.",classes:[
    {n:'Catégories pauvres',d:'Les 10 % les plus modestes',s:'Crédoc',hi:DEC[0]},
    {n:'Catégories modestes',d:'1er au 3e décile',s:'Crédoc',hi:DEC[2]},
    {n:'Classes moyennes inférieures',d:'3e au 6e décile',s:'Crédoc',hi:DEC[5]},
    {n:'Classes moyennes supérieures',d:'6e au 8e décile',s:'Crédoc',hi:DEC[7]},
    {n:'Catégories aisées',d:'8e au 9e décile',s:'Crédoc',hi:DEC[8]},
    {n:'Hauts revenus',d:'Les 10 % les plus aisés',s:'Crédoc',hi:Infinity}]},
  ocde:{desc:"OCDE (2019) : en pourcentage du revenu médian, avec des classes moyennes de 75 à 200 %.",classes:[
    {n:'Pauvres',d:'Moins de 50 % de la médiane',s:'OCDE',hi:.5*MED},
    {n:'Bas revenus',d:'50 à 75 % de la médiane',s:'OCDE',hi:.75*MED},
    {n:'Classe moyenne inférieure',d:'75 à 100 % de la médiane',s:'OCDE',hi:MED},
    {n:'Classe moyenne intermédiaire',d:'100 à 150 % de la médiane',s:'OCDE',hi:1.5*MED},
    {n:'Classe moyenne supérieure',d:'150 à 200 % de la médiane',s:'OCDE',hi:2*MED},
    {n:'Hauts revenus',d:'Plus de 2 × la médiane',s:'OCDE',hi:Infinity,rich:true}]}
};
const PGRID=[
  {n:'Patrimoine quasi nul',d:'Sous le 1er décile',s:'INSEE',hi:PNV[0]},
  {n:'Petit patrimoine',d:'1er au 3e décile',s:'INSEE',hi:PNV[2]},
  {n:'Patrimoine en constitution',d:'3e décile à la médiane',s:'INSEE',hi:PNV[4]},
  {n:'Patrimoine intermédiaire',d:'Médiane au 8e décile',s:'INSEE',hi:PNV[7]},
  {n:'Patrimoine élevé',d:'8e au 9e décile',s:'INSEE',hi:PNV[8]},
  {n:'Hauts patrimoines',d:'Top 10 % au top 5 %',s:'INSEE',hi:PNV[9],rich:true},
  {n:'Très hauts patrimoines',d:'Top 5 % au top 1 %',s:'INSEE',hi:PNV[10],rich:true},
  {n:'Top 1 % des patrimoines',d:'Plus de 2,73 M€ net',s:'INSEE',hi:Infinity,rich:true}];

/* répartition : interpolation et marges */
function ip(a,pa,b,pb,x,m){
  if(m==='lin'||(m==='c'&&pa<90))return pa+(pb-pa)*(x-a)/(b-a);
  if(m==='log')return pa+(pb-pa)*Math.log(x/a)/Math.log(b/a);
  const sa=Math.log(1-pa/100),sb=Math.log(1-pb/100),t=Math.log(x/a)/Math.log(b/a);return 100*(1-Math.exp(sa+t*(sb-sa)));
}
function cdf(K,x,m){
  m=m||'c';const F=K[0],L=K[K.length-1];
  if(!(x>0)||x<F[0])return{p:F[1]/2,below:true,lo:0,hi:F[1]};
  if(x>L[0])return{p:L[1]+(100-L[1])/2,above:true,lo:L[1],hi:100};
  if(x===L[0])return{p:L[1],i:K.length-1,est:K.length-1>=K.est};
  for(let i=1;i<K.length;i++)if(x<K[i][0]){const[a,pa]=K[i-1],[b,pb]=K[i];return{p:ip(a,pa,b,pb,x,m),est:i>=K.est,i}}
}
function inv(K,p){
  if(p<=K[0][1])return K[0][0];if(p>=K[K.length-1][1])return K[K.length-1][0];
  for(let i=1;i<K.length;i++)if(p<=K[i][1]){const[a,pa]=K[i-1],[b,pb]=K[i];
    if(pa>=90){const t=(Math.log(1-p/100)-Math.log(1-pa/100))/(Math.log(1-pb/100)-Math.log(1-pa/100));return a*Math.exp(t*Math.log(b/a))}
    return a+(b-a)*(p-pa)/(pb-pa)}
}
const pCentral=(D,x)=>x===Infinity?100:x<=0?0:cdf(D.K,x).p;
function sampleH(D,p){return isFinite(D.neff)?1.96*Math.sqrt(Math.max(p*(100-p),0)/D.neff):0}
function assess(D,x,o){
  o=o||{};const g=o.g||{c:0,lo:0,hi:0};const xc=x/(1+g.c);
  const r=cdf(D.K,xc),p=r.p,src=[];
  if(r.below||r.above)src.push({k:'hors',lo:p-r.lo,hi:r.hi-p,edge:r.below?'below':'above',v:r.below?D.K[0][0]:D.K[D.K.length-1][0]});
  else if(r.i!=null&&xc!==D.K[r.i][0]){const ps=['lin','log'].map(m=>cdf(D.K,xc,m).p);src.push({k:'interp',lo:Math.max(0,p-Math.min(...ps)),hi:Math.max(0,Math.max(...ps)-p),a:D.K[r.i-1][0],b:D.K[r.i][0]})}
  const h=sampleH(D,p);src.push({k:'sample',lo:h,hi:h});
  if(D.alt){const ps=D.alt.map(K=>cdf(K,xc).p);const lo=Math.max(0,p-Math.min(...ps)),hi=Math.max(0,Math.max(...ps)-p);if(lo+hi>.001)src.push({k:'tail',lo,hi})}
  if(g.hi!==g.lo){const pa=cdf(D.K,x/(1+g.hi)).p,pb=cdf(D.K,x/(1+g.lo)).p;src.push({k:'time',lo:Math.max(0,p-Math.min(pa,pb)),hi:Math.max(0,Math.max(pa,pb)-p),g})}
  if(o.conv){const pa=cdf(D.K,xc*o.conv[0]).p,pb=cdf(D.K,xc*o.conv[1]).p;src.push({k:'conv',lo:Math.max(0,p-Math.min(pa,pb)),hi:Math.max(0,Math.max(pa,pb)-p)})}
  const lo=clamp(p-Math.hypot(...src.map(s=>s.lo)),0,100),hi=clamp(p+Math.hypot(...src.map(s=>s.hi)),0,100);
  return{p,lo,hi,src,below:!!r.below,above:!!r.above,est:!!r.est,xc};
}
function bandsOf(classes,D){
  const nb=classes.filter(c=>!c.rich).length,nr=classes.length-nb;let lo=0,i=0,j=0;
  return classes.map(c=>{const col=c.rich?'v'+(nr===1?2:Math.round(j++*3/(nr-1))):'r'+(nb===1?4:Math.round(i++*8/(nb-1)));
    const o=Object.assign({},c,{lo,plo:pCentral(D,lo),phi:pCentral(D,c.hi),col});lo=c.hi;return o});
}
function classIndex(B,x){if(!(x>0))return 0;const i=B.findIndex(c=>x<c.hi);return i<0?B.length-1:i}
function straddle(B,a){const w=a.hi-a.lo;if(w<=0)return[];return B.map(c=>({c,s:Math.max(0,Math.min(a.hi,c.phi)-Math.max(a.lo,c.plo))/w})).filter(o=>o.s>=.05)}
function thrPrec(D,v){
  if(!isFinite(v)||v<=0)return null;const p=cdf(D.K,v).p;let lo=v,hi=v;
  const h=sampleH(D,p);if(h>0){const F=D.K[0][1],L=D.K[D.K.length-1][1];lo=Math.min(lo,inv(D.K,clamp(p-h,F,L)));hi=Math.max(hi,inv(D.K,clamp(p+h,F,L)))}
  if(D.alt&&p>95){const xs=D.alt.map(K=>inv(K,p));lo=Math.min(lo,...xs);hi=Math.max(hi,...xs)}
  return{lo,hi};
}

/* impôt sur le revenu : barème des revenus 2024 (DGFiP, brochure 2025) */
const IR={t:[[11497,0],[29315,.11],[83823,.30],[180294,.41],[Infinity,.45]],qf:1791,qfIso:4224,decS:[1964,889],decC:[3249,1470],dt:.4525,abMin:504,abMax:14426,nonDed:1.037};
function bareme(q){let tax=0,prev=0;for(const[lim,r]of IR.t){if(q>prev)tax+=(Math.min(q,lim)-prev)*r;prev=lim}return tax}
function partsOf(couple,kids,iso){let p=(couple?2:1)+(kids<=2?kids*.5:1+(kids-2));if(iso&&kids>0)p+=.5;return p}
function irFromImposable(R,couple,kids,iso){
  const base=couple?2:1,parts=partsOf(couple,kids,iso);if(!(R>0))return{tax:0,parts};
  const tN=parts*bareme(R/parts),t0=base*bareme(R/base),half=Math.round((parts-base)*2);
  const cap=iso&&kids>0?IR.qfIso+Math.max(0,half-2)*IR.qf:half*IR.qf;
  let t=Math.max(tN,t0-cap);
  const[seuil,forf]=couple?IR.decC:IR.decS;
  if(t<seuil)t=Math.max(0,t-(forf-IR.dt*t));
  return{tax:t,parts};
}
function imposable(netAnnual,persons){const I=Math.max(0,netAnnual)*IR.nonDed;let d=Math.min(.1*I,IR.abMax*persons);d=Math.max(d,Math.min(I,IR.abMin*persons));return Math.max(0,I-d)}
function household(h){
  const d=1+(h.g||0),kids=h.k1+h.k2;
  const netA=Math.max(0,h.incM)*12/d,kincA=h.k3>0?Math.max(0,h.kincM||0)*12/d:0,aidA=Math.max(0,h.aidM||0)*12/d;
  const uc=1+.5*(h.ad-1)+.5*h.k2+.3*h.k1+.5*h.k3;
  let parentTax=0,parts=0;
  if(h.ad===1){const r=irFromImposable(imposable(netA,1),false,kids,true);parentTax=r.tax;parts=r.parts}
  else{
    const cShare=netA*2/h.ad,oShare=netA/h.ad;
    if(h.union!=='sep'){const r=irFromImposable(imposable(cShare,2),true,kids,false);parentTax=r.tax;parts=r.parts}
    else{const a=irFromImposable(imposable(cShare/2,1),false,kids,false),b=irFromImposable(imposable(cShare/2,1),false,0,false);parentTax=a.tax+b.tax;parts=a.parts}
    for(let i=2;i<h.ad;i++)parentTax+=irFromImposable(imposable(oShare,1),false,0,false).tax;
  }
  let kidsTax=0;for(let i=0;i<h.k3;i++)kidsTax+=irFromImposable(imposable(kincA/h.k3,1),false,0,false).tax;
  const taxA=(h.taxM>0?h.taxM*12/d:parentTax)+kidsTax;
  const dispA=netA+kincA+aidA-taxA;
  return{uc,d,netA,kincA,aidA,parentTax,kidsTax,taxA,dispA,nv:dispA/12/uc,parts,estimated:!(h.taxM>0)};
}
function incomeFor(h,target){
  if(!isFinite(target))return Infinity;
  if(household(Object.assign({},h,{incM:0})).nv>=target)return 0;
  let lo=0,hi=Math.max(1000,h.incM||1000),k=0;
  while(household(Object.assign({},h,{incM:hi})).nv<target&&k++<60)hi*=2;
  for(let i=0;i<60;i++){const m=(lo+hi)/2;if(household(Object.assign({},h,{incM:m})).nv>=target)hi=m;else lo=m}
  return hi;
}
/* capacité d'emprunt */
const LOAN={rates:{15:3.14,20:3.27,25:3.35},usure:{15:4.57,20:5.29,25:5.29},dti:.35,notaryAncien:.08,notaryPrimo:.075,notaryNeuf:.025,guarantee:.01,dossier:1000,rentShare:.7,ins:{u30:.10,a30:.15,a40:.25,a50:.45,a60:.80,a70:1.20},ageMax:{u30:29,a30:39,a40:49,a50:59,a60:69,a70:79}};
const PTZ={res:{A:[49000,73500,88200,102900,117600,132300,147000,161700],B1:[34500,51750,62100,72450,82800,93150,103500,113850],B2:[31500,47250,56700,66150,75600,85050,94500,103950],C:[28500,42750,51300,59850,68400,76950,85500,94050]},
  op:{A:[150000,225000,270000,315000,360000],B1:[135000,202500,243000,283500,324000],B2:[110000,165000,198000,231000,264000],C:[100000,150000,180000,210000,240000]},
  coef:[1,1.5,1.8,2.1,2.4],tr:{A:[25000,31000,37000,49000],B1:[21500,26000,30000,34500],B2:[18000,22500,27000,31500],C:[15000,19500,24000,28500]},
  quot:{coll:[.5,.4,.4,.2],indiv:[.3,.2,.2,.1]},rep:[[10,15],[8,12],[2,13],[0,10]]};
function annuity(ratePct,years){const i=ratePct/100/12,n=years*12;return i===0?1/n:i/(1-Math.pow(1+i,-n))}
function ptzInfo(o){
  if(!o.primo)return{ok:false,why:'réservé aux personnes qui achètent leur première résidence principale'};
  if(o.bien==='ancien'&&!(o.zone==='B2'||o.zone==='C'))return{ok:false,why:'dans l\'ancien, seulement en zone B2 ou C'};
  if(o.bien==='ancien'&&!o.travaux)return{ok:false,why:'dans l\'ancien, il faut au moins 25 % de travaux'};
  const n=Math.max(1,Math.min(8,o.persons)),n5=Math.min(5,n),res=Math.max(o.rfr,o.cost/9),plaf=PTZ.res[o.zone][n-1];
  if(res>plaf)return{ok:false,why:'revenus retenus ('+eur(res)+') au-dessus du plafond ('+eur(plaf)+')',res,plaf};
  let t=PTZ.tr[o.zone].findIndex(x=>res/PTZ.coef[n5-1]<=x);if(t<0)t=3;
  const quot=(o.bien==='neuf'&&o.type==='indiv'?PTZ.quot.indiv:PTZ.quot.coll)[t],opCap=PTZ.op[o.zone][n5-1];
  const amt=Math.max(0,Math.min(Math.min(o.cost,opCap)*quot,(t===0?1.25:1)*Math.max(0,o.mainLoan)));
  const[diff,remb]=PTZ.rep[t],rembY=Math.max(1,Math.min(remb,o.years-diff));
  return{ok:true,tranche:t+1,amt,diff,rembY,monthly:amt/(rembY*12),quot,opCap,res,plaf};
}
function taeg(C,fees,monthly,n){
  if(!(C>fees)||!(monthly>0))return 0;const net=C-fees;let lo=0,hi=.05;
  for(let k=0;k<80;k++){const r=(lo+hi)/2,pv=r===0?monthly*n:monthly*(1-Math.pow(1+r,-n))/r;if(pv>net)lo=r;else hi=r}
  return (Math.pow(1+(lo+hi)/2,12)-1)*100;
}
function loanPlan(o){
  const R=Math.max(0,o.incM)+LOAN.rentShare*Math.max(0,o.rentM||0),credits=Math.max(0,o.creditsM||0),Mmax=Math.max(0,LOAN.dti*R-credits);
  const a=annuity(o.ratePct,o.years),ins=o.insPct/100/12,g=LOAN.guarantee,dossier=LOAN.dossier,apport=Math.max(0,o.apport);
  const notary=o.bien==='neuf'?LOAN.notaryNeuf:o.primo?LOAN.notaryPrimo:LOAN.notaryAncien;
  let ptz={ok:false,amt:0,monthly:0},C=0,price=0,guar=0;
  const ptzFor=(cost,main)=>o.ptz?ptzInfo(Object.assign({},o.ptz,{cost,mainLoan:main,bien:o.bien,primo:o.primo,years:o.years})):{ok:false,amt:0,monthly:0,why:'non simulé'};
  if(o.price==null){
    let amt=0;
    for(let it=0;it<80;it++){
      const info=amt>0?ptzFor(price,C):null,monthlyPtz=info&&info.ok?amt/(info.rembY*12):0;
      C=R>0?Math.max(0,Mmax-monthlyPtz)/(a+ins):0;guar=C>0?C*g+dossier:0;
      price=Math.max(0,(C+amt+apport-guar)/(1+notary));
      const nx=ptzFor(price,C),target=nx.ok?nx.amt:0;
      if(Math.abs(target-amt)<.5){ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});break}
      amt=amt+(target-amt)*.5;ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});
    }
    if(ptz.amt>0){C=R>0?Math.max(0,Mmax-ptz.monthly)/(a+ins):0;guar=C>0?C*g+dossier:0;price=Math.max(0,(C+ptz.amt+apport-guar)/(1+notary))}
  }else{
    price=Math.max(0,o.price);let amt=0;
    for(let it=0;it<80;it++){
      C=apport+amt>=price*(1+notary)?0:Math.max(0,(price*(1+notary)+dossier-apport-amt)/(1-g));
      const nx=ptzFor(price,C),target=nx.ok?nx.amt:0;
      if(Math.abs(target-amt)<.5){ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});break}
      amt=amt+(target-amt)*.5;ptz=nx.ok?Object.assign(nx,{amt,monthly:amt/(nx.rembY*12)}):Object.assign(nx,{amt:0,monthly:0});
    }
    C=apport+ptz.amt>=price*(1+notary)?0:Math.max(0,(price*(1+notary)+dossier-apport-ptz.amt)/(1-g));
    guar=C>0?C*g+dossier:0;
  }
  const n=o.years*12,mens=C*a,insM=C*ins,monthly=mens+insM+ptz.monthly;
  const dti=R>0?(credits+monthly)/R:Infinity;
  return{R,Mmax,C,mens,insM,monthly,dti,interest:mens*n-C,insTotal:insM*n,notary,notaryEur:price*notary,guar,price,fees:price*notary+guar,
    rav:R-credits-monthly,ptz,taeg:taeg(C,guar,mens+insM,n),usure:LOAN.usure[o.years],total:price*(1+notary)+guar};
}
function amortization(L,o){
  const i=o.ratePct/100/12,n=o.years*12,rows=[];let crd=L.C,cumI=0;
  for(let y=0;y<=o.years;y++){
    let ptzCrd=0;if(L.ptz.amt>0){const p=L.ptz;ptzCrd=y<=p.diff?p.amt:Math.max(0,p.amt-p.monthly*12*(y-p.diff))}
    rows.push({y,crd:Math.max(0,crd),ptz:ptzCrd,interest:cumI});
    for(let m=0;m<12&&y<o.years;m++){const int=crd*i;cumI+=int;crd-=L.mens-int}
  }
  return rows;
}
/*ENGINE-END*/


const NVTYPE={seul:['personnes seules',24980,'personnes seules ou familles monoparentales de 65 ans ou plus',23970],mono:['familles monoparentales',19040,'personnes seules ou familles monoparentales de 65 ans ou plus',23970],cse:['couples sans enfant',33890,'couples de 65 ans ou plus',28640],cae:['couples avec enfants',27520,'couples de 65 ans ou plus',28640],autre:['autres ménages',23650,'autres ménages de 65 ans ou plus',24780]};
const SAL_MEAN={cadre:['cadres',4629],inter:['professions intermédiaires',2633],empl:['employés',1941],ouv:['ouvriers',2051]};
const PAT_CSP={agri:['agriculteurs',[152700,698000,2282900]],indep:['artisans, commerçants et chefs d\'entreprise',[11200,324800,1805000]],liber:['professions libérales',[42500,560500,2039100]],cadre:['cadres',[22200,279700,1060600]],inter:['professions intermédiaires',[9600,136600,503600]],empl:['employés',[2300,38900,347900]],ouv:['ouvriers',[2200,34900,289000]],r_indep:['retraités anciens indépendants',[41700,314900,1097500]],r_cadre:['retraités anciens cadres',[121300,525200,1663500]],r_inter:['retraités anciennes professions intermédiaires',[35000,320100,772400]],r_empl:['retraités anciens employés ou ouvriers',[3500,140800,458000]],inact:['autres inactifs',[900,7300,300200]]};

let root;
const $=id=>root.querySelector('#'+CSS.escape(id));
const NS='http://www.w3.org/2000/svg';
function S(tag,a,p,t){const e=document.createElementNS(NS,tag);for(const k in a)e.setAttribute(k,a[k]);if(t!=null)e.textContent=t;if(p)p.appendChild(e);return e}
const tickP=p=>(p%1===0?nf0.format(p):p.toLocaleString('fr-FR',{maximumFractionDigits:2}))+' %';

/* ---------- état ---------- */
const state={tab:'rev',year:'2026',scale:'dil',inc:5000,incUnit:'nm',lmode:'cap',price:320000,zone:'B1',htype:'coll',travaux:'non',rfr:0,aid:0,taxm:0,union:'joint',ad:2,kids:0,teens:0,k3:0,kinc:0,sal:3000,salUnit:'nm',statut:'nc',csp:'',grid:'fine',apport:30000,credits:0,loyers:0,duree:'25',bien:'ancien',primo:'oui',rateC:0,insC:0,own:425000,patDetail:false,immo:350000,fin:60000,pro:0,res:15000,debt:180000,age:'a30'};
const DEFAULTS=JSON.parse(JSON.stringify(state));
const KEY='toise-fusion-v1';
try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&typeof s==='object')Object.keys(state).forEach(k=>{if(s[k]!==undefined&&typeof s[k]===typeof state[k])state[k]=s[k]})}catch(e){}
const HASH={'#foyer':'rev','#salaire':'sal','#patrimoine':'pat','#emprunt':'loan'};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}};
const NUMK=['ad','kids','teens','k3'];

function hhName(){const a=+state.ad,k=+state.kids+ +state.k3,ks=k?k+' enfant'+(k>1?'s':''):'';
  if(a===1)return k?'Parent seul, '+ks:'Personne seule';if(a===2)return k?'Couple, '+ks:'Couple sans enfant';return a+' adultes'+(k?', '+ks:'')}
function hhType(){const a=+state.ad,k=+state.kids+ +state.k3;if(a===1)return k?'mono':'seul';if(a===2)return k?'cae':'cse';return 'autre'}

/* ---------- conversions de montants ---------- */
const brutRate=()=>state.statut==='cadre'?.75:.78;
function taxMonthlyNominal(hb,incM){if(hb.taxM>0)return hb.taxM;const HH=household(Object.assign({},hb,{incM}));return HH.parentTax/12*HH.d}
function toNetMonthly(v,unit,hb){
  if(unit==='na')return v/12;if(unit==='ba')return v*brutRate()/12;
  if(unit==='am'){if(!(v>0))return 0;let lo=v,hi=v*2+2000;for(let i=0;i<60;i++){const m=(lo+hi)/2;if(m-taxMonthlyNominal(hb,m)<v)lo=m;else hi=m}return hi}
  return v;
}
function fromNetMonthly(m,unit,hb){if(unit==='na')return m*12;if(unit==='ba')return m*12/brutRate();if(unit==='am')return m-taxMonthlyNominal(hb,m);return m}
function salToNet(v,unit){const r=brutRate();return unit==='na'?v/12:unit==='bm'?v*r:unit==='ba'?v*r/12:v}
function salFromNet(m,unit){const r=brutRate();return unit==='na'?m*12:unit==='bm'?m/r:unit==='ba'?m*12/r:m}

/* ---------- calculs ---------- */
function derive(){
  const gR=GROWTH.rev[state.year],gP=GROWTH.pat[state.year];
  const kids=+state.kids,teens=Math.min(+state.teens,kids);
  const hb={aidM:Math.max(0,+state.aid||0),kincM:Math.max(0,+state.kinc||0),taxM:Math.max(0,+state.taxm||0),ad:+state.ad,k1:kids-teens,k2:teens,k3:+state.k3,union:state.union,g:gR.c};
  const h=Object.assign({},hb,{incM:toNetMonthly(Math.max(0,+state.inc||0),state.incUnit,hb)});
  const H=household(h),aF=h.incM>0?assess(D_NV,H.nv*(1+gR.c),{g:gR}):null;
  const B=bandsOf(GRIDS[state.grid].classes,D_NV);
  if(state.tab==='rev')B.forEach(c=>{c.incLo=c.lo>0?incomeFor(h,c.lo):0;c.incHi=incomeFor(h,c.hi)});
  const rate=state.statut==='cadre'?.75:.78,sraw=Math.max(0,+state.sal||0),brut=state.salUnit[0]==='b';
  const sal=salToNet(sraw,state.salUnit),conv=brut?[(rate-.01)/rate,(rate+.01)/rate]:null;
  const aS=sal>0?assess(D_SAL.E,sal,{g:gR,conv}):null,aSF=sal>0?assess(D_SAL.F,sal,{g:gR,conv}):null,aSH=sal>0?assess(D_SAL.H,sal,{g:gR,conv}):null;
  const own=state.patDetail?['immo','fin','pro','res'].reduce((s,k)=>s+Math.max(0,+state[k]||0),0):Math.max(0,+state.own||0);
  const owe=Math.max(0,+state.debt||0),pn=own-owe,hasPat=own>0||owe>0;
  const aPN=hasPat?assess(D_PN,pn,{g:gP}):null,aPB=own>0?assess(D_PB,own,{g:gP}):null;
  const AG=AGE[state.age],DAge=mk(AG.n,P9,AG.neff),aAge=hasPat?assess(DAge,pn,{g:gP}):null;
  const CS=PAT_CSP[state.csp],DCsp=CS?mk(CS[1],[10,50,90],650):null,aCsp=CS&&hasPat?assess(DCsp,pn,{g:gP}):null;
  const D={h,hb,H,gR,gP,aF,B,sal,brut,rate,aS,aSF,aSH,own,owe,pn,aPN,aPB,DAge,aAge,DCsp,aCsp,PB:bandsOf(PGRID,D_PN)};
  D.L=loanPlan(loanInputs(D));
  return D;
}

/* ---------- textes ---------- */
function decimals(a){const s=100-a.p,w=a.hi-a.lo;return s>=10?0:s>=1?(w<1?1:0):(w<.1?2:1)}
function fmtShare(x,d){return (d===0?nf0.format(Math.max(1,Math.round(x))):dec(Math.max(x,Math.pow(10,-d)),d))+' %'}
function rankBig(a,low){
  if(a.below)return{t:pctA(a.hi)+' '+low,small:true};
  if(a.above)return{t:'Top '+pctA(100-a.lo),small:false};
  if(a.p>=50)return{t:'Top '+fmtShare(100-a.p,decimals(a)),small:false};
  return{t:nf0.format(Math.max(1,Math.round(a.p)))+' % '+low,small:true};
}
function tabValue(a,low){if(!a)return '–';if(a.below)return pctA(a.hi)+' '+low;if(a.p>=50||a.above)return 'Top '+(a.above?pctA(100-a.lo):fmtShare(100-a.p,decimals(a)));return nf0.format(Math.max(1,Math.round(a.p)))+' % '+low}
function rankShort(a,low){if(!a)return '';if(a.below)return 'sous le 1er seuil publié';if(a.above)return 'au-delà du dernier seuil';return tabValue(a,low)}
function rangeLine(a){
  if(a.below||a.above)return 'Position au-delà des seuils publiés';
  const f=x=>x>=10?nf0.format(Math.round(x)):x>=1?dec(x,1).replace(/,0$/,''):dec(x,2);
  return 'Marge d\'erreur : rang '+f(a.lo)+' à '+f(a.hi)+' sur 100';
}
function grid100(svg,idx,fill){
  svg.textContent='';
  for(let i=0;i<100;i++){const x=(i%10)*23,y=(9-Math.floor(i/10))*23,me=i===idx;
    S('rect',{x:x+(me?-1:0),y:y+(me?-1:0),width:me?22:20,height:me?22:20,rx:me?6:5,class:me?'g-me':fill(i)},svg)}
}
function setVerdict(id,o){
  const t=$(id),q=r=>t.querySelector('[data-r="'+r+'"]');
  q('eye').textContent=o.eye||'';q('big').textContent=o.big||'–';q('big').classList.toggle('small',!!o.small);
  q('sent').textContent=o.sent||'';q('range').textContent=o.a?rangeLine(o.a):'';
  const ch=q('chip');ch.textContent='';
  if(o.cls){const i=document.createElement('i');i.style.background='var(--'+o.cls.col+')';const b=document.createElement('b');b.textContent=o.cls.n;ch.append(i,b);
    if(o.str&&o.str.length>1){const sp=document.createElement('span');sp.className='straddle';sp.textContent='à la frontière avec '+o.str.filter(x=>x.c.n!==o.cls.n).map(x=>'« '+x.c.n.toLowerCase()+' »').join(' et ');ch.append(sp)}}
  q('next').textContent=o.next||'';q('next').hidden=!o.next;
  const g=t.querySelector('.v-grid');g.hidden=!o.a;
  if(o.a){const idx=o.a.below?Math.max(0,Math.ceil(o.a.hi)-1):o.a.above?99:clamp(Math.floor(o.a.p),0,99);grid100(q('grid'),idx,o.fill);q('cap').textContent=o.cap||''}
}
function eqRows(el,rows){el.textContent='';rows.forEach(r=>{const d=document.createElement('div');d.className='eq-row'+(r.c?' '+r.c:'');const a=document.createElement('span');a.textContent=r.l;d.appendChild(a);if(r.v!=null){const b=document.createElement('b');b.textContent=r.v;d.appendChild(b)}el.appendChild(d)})}
const classFill=B=>i=>{const p=i+.5;const c=B.find(c=>p<c.phi)||B[B.length-1];return 'f-'+c.col};

/* ---------- foyer ---------- */
function renderFoyer(D){
  const{h,H,aF,B}=D;
  eqRows($('eq'),[{l:'Revenus nets avant impôt',v:eur(h.incM)}].concat(state.k3>0?[{l:'+ revenus des enfants autonomes',v:eur(h.kincM)}]:[],
    [{l:(H.estimated?'− impôt sur le revenu estimé':'− impôt sur le revenu payé'),v:eur(H.taxA/12*H.d),c:'minus'}],h.aidM>0?[{l:'+ aides non imposables',v:eur(h.aidM)}]:[],
    [{l:'= revenu disponible',v:eur(H.dispA/12*H.d),c:'total'},{l:'÷ unités de consommation',v:dec(H.uc,1).replace(/,0$/,'')},{l:'= niveau de vie',v:eur(H.nv*H.d)+' / mois',c:'total'}]));
  $('calc-sum').textContent=h.incM>0?'impôt '+eur(H.taxA/12*H.d)+' · niveau de vie '+eur(H.nv*H.d):'';
  const nOpt=(+state.teens>0)+(h.aidM>0)+(+state.k3>0)+(h.taxM>0)+(state.year!=='2026')+(state.union==='sep'&&+state.ad>=2);$('opt-rev-n').textContent=nOpt?'('+nOpt+')':'';
  if(!aF){setVerdict('v-rev',{eye:hhName(),sent:'Indiquez les revenus du foyer pour voir votre position.'});return}
  const ci=classIndex(B,aF.xc),cls=B[ci],nx=B[ci+1],rb=rankBig(aF,'les plus modestes'),need=nx&&isFinite(cls.incHi)?Math.max(0,cls.incHi-h.incM):null;
  setVerdict('v-rev',{eye:hhName(),big:(aF.est?'≈ ':'')+rb.t,small:rb.small,a:aF,cls,str:straddle(B,aF),fill:classFill(B),
    sent:aF.below||aF.above?'Niveau de vie de '+eur(H.nv*H.d)+' par mois.':'Votre niveau de vie ('+eur(H.nv*H.d)+' par mois) dépasse celui de '+nf0.format(Math.round(aF.p))+' % des Français.',
    cap:aF.below||aF.above?'':'Sur 100 Français, vous passez devant '+nf0.format(Math.round(aF.p))+'.',
    next:need!=null?'Encore '+eur(need)+' par mois avant impôt pour passer en « '+nx.n+' ».':'Classe la plus haute de cette définition.'});
}
function ticksLin(max){const st=max<=6000?1000:max<=15000?2500:max<=40000?5000:max<=100000?20000:Math.pow(10,Math.floor(Math.log10(max)));const t=[];for(let v=0;v<=max;v+=st)t.push(v);return t}
function chartW(el,min,max){const w=el&&el.parentElement?el.parentElement.getBoundingClientRect().width:0;return Math.round(clamp(w>10?w:max,min,max))}
function rowsChart(svg,rows,o){
  svg.textContent='';const W=chartW(svg,300,860),nar=W<560,L=12,Rw=nar?0:190,pw=W-L-Rw-(nar?16:24),top=34,rh=nar?76:62;
  svg.setAttribute('viewBox','0 0 '+W+' '+(top+rows.length*rh+4));
  const X=o.log?v=>L+pw*(Math.log10(clamp(v,o.min,o.max))-Math.log10(o.min))/(Math.log10(o.max)-Math.log10(o.min)):v=>L+pw*clamp(v,0,o.max)/o.max;
  o.ticks.forEach((v,k)=>{S('line',{x1:X(v),x2:X(v),y1:top-10,y2:top+rows.length*rh-16,class:'tick'},svg);if(!nar||k%2===0||o.ticks.length<=5)S('text',{x:X(v),y:14,'text-anchor':k===0?'start':'middle',class:'ax'},svg,o.tickFmt(v))});
  rows.forEach((r,i)=>{
    const y=top+i*rh,by=y+16;
    S('text',{x:L,y:y+2,class:'lab'+(r.dim?' dim':'')},svg,r.l);
    if(r.K){const K=r.K,v10=K.find(k=>k[1]===10),v90=K.find(k=>k[1]===90),v50=K.find(k=>k[1]===50);
      S('rect',{x:X(v10[0]),y:by,width:Math.max(2,X(v90[0])-X(v10[0])),height:10,rx:5,class:'sal-hi'},svg);
      S('line',{x1:X(v50[0]),x2:X(v50[0]),y1:by-3,y2:by+13,class:'med'},svg);
      S('text',nar?{x:L,y:by+30,class:'ax'}:{x:X(v50[0]),y:by+26,'text-anchor':'middle',class:'ax'},svg,'médiane '+o.fmt(v50[0]))}
    if(r.med!=null){S('line',{x1:X(r.med),x2:X(r.med),y1:by-3,y2:by+13,class:'med'},svg);S('text',nar?{x:L,y:by+30,class:'ax'}:{x:X(r.med),y:by+26,'text-anchor':'middle',class:'ax'},svg,(r.medLabel||'médiane')+' '+o.fmt(r.med))}
    if(r.v!=null){
      if(r.a&&r.K&&!r.a.below&&!r.a.above){const K=r.K,F=K[0][1],Lp=K[K.length-1][1],xl=X(inv(K,clamp(r.a.lo,F,Lp))),xh=X(inv(K,clamp(r.a.hi,F,Lp)));S('rect',{x:xl,y:by-4,width:Math.max(2,xh-xl),height:18,rx:4,class:'err'},svg)}
      S('circle',{cx:r.v>0?X(r.v):L,cy:by+5,r:6.5,class:'me-fill me-dot'},svg);
      if(nar)S('text',{x:W-2,y:by+31,'text-anchor':'end',class:'rk'},svg,r.right);
      else{S('text',{x:W,y:by+4,'text-anchor':'end',class:'rk'},svg,r.right);if(r.right2)S('text',{x:W,y:by+20,'text-anchor':'end',class:'lab2'},svg,r.right2)}}
  });
}
const pctDiff=r=>(r>=1?'+':'−')+nf0.format(Math.abs(Math.round((r-1)*100)))+' % vs médiane';
function renderCmpFoyer(D){
  const{H,aF}=D;if(!aF){$('cmp-rev').textContent='';$('toise-scen').textContent='';return}
  const nv=H.nv,t=NVTYPE[hhType()],senior=state.age==='a70',med=(senior?t[3]:t[1])/12,mx=Math.max(6000,nv*1.15);
  rowsChart($('cmp-rev'),[
    {l:'Tous les Français',K:NV,a:aF,v:nv,right:rankShort(aF,'les plus modestes'),right2:'vous : '+eur(nv)},
    {l:'Les '+(senior?t[2]:t[0]),med,v:nv,right:pctDiff(nv/med),right2:'seule la médiane est publiée'}
  ],{max:mx,ticks:ticksLin(mx),tickFmt:v=>nf0.format(v)+' €',fmt:eur});
  const sc=$('toise-scen');sc.textContent='';
  const base=D.h,alt=(label,hh)=>{const a=assess(D_NV,household(hh).nv*(1+D.gR.c),{g:D.gR});return{label,t:tabValue(a,'plus modestes'),d:a.p-aF.p}};
  const items=[alt('+10 % de revenus',Object.assign({},base,{incM:base.incM*1.1})),alt('−10 % de revenus',Object.assign({},base,{incM:base.incM*.9})),alt('Un enfant de plus',Object.assign({},base,{k1:base.k1+1}))];
  if(+state.kids+ +state.k3>0)items.push(alt('Les enfants partis',Object.assign({},base,{k1:0,k2:0,k3:0,kincM:0})));
  const hh=document.createElement('p');hh.className='scen-h';hh.textContent='Et si…';sc.appendChild(hh);
  items.forEach(it=>{const d=document.createElement('div');d.className='scen-i';d.innerHTML='<span></span><b></b><em></em>';d.querySelector('span').textContent=it.label;d.querySelector('b').textContent=it.t;const e=d.querySelector('em');e.textContent=(it.d>=0?'▲ ':'▼ ')+pts(Math.abs(it.d))+' rang'+(Math.abs(it.d)>=2?'s':'');e.className=it.d>=0?'up':'down';e.title=(it.d>=0?'+':'−')+pts(Math.abs(it.d))+' rang';sc.appendChild(d)});
}

/* ---------- salaire ---------- */
function renderSalaire(D){
  const{aS,aSF,aSH,sal,brut}=D,K=D_SAL.E.K;
  $('sal-help').textContent={nm:'Net avant impôt, en équivalent temps plein.',na:'Net avant impôt sur l\'année, primes comprises : '+eur(sal)+' par mois.',bm:'Brut mensuel : environ '+eur(sal)+' net avant impôt.',ba:'Brut annuel, primes comprises : environ '+eur(sal)+' net par mois.'}[state.salUnit];
  $('opt-sal-n').textContent=(state.csp&&SAL_MEAN[state.csp]?1:0)+(state.year!=='2026')?'('+((state.csp&&SAL_MEAN[state.csp]?1:0)+(state.year!=='2026'?1:0))+')':'';
  if(!aS){setVerdict('v-sal',{eye:'Votre salaire',sent:'Indiquez votre salaire pour voir votre position.'});$('cmp-sal').textContent='';return}
  const rb=rankBig(aS,'les moins payés');
  setVerdict('v-sal',{eye:eur(sal)+' nets par mois',big:rb.t,small:rb.small,a:aS,fill:i=>i<Math.floor(aS.p)?'g-lo':'g-hi',
    sent:aS.below?'Sous le 1er décile : ces salaires concernent surtout des apprentis et stagiaires.':aS.above?'Au-delà du dernier seuil publié : vous faites partie du 1 % le mieux payé.':'Votre salaire dépasse celui de '+nf0.format(Math.round(aS.p))+' % des salariés du privé.',
    cap:aS.below||aS.above?'':'Sur 100 salariés, vous passez devant '+nf0.format(Math.round(aS.p))+'.',
    next:aS.xc<K[8][0]?'Encore '+eur((K[8][0]-aS.xc)*(1+D.gR.c))+' par mois pour entrer dans le top 10 %.':aS.xc<K[10][0]?'Encore '+eur((K[10][0]-aS.xc)*(1+D.gR.c))+' par mois pour entrer dans le top 1 %.':''});
  const s=aS.xc,rows=[
    {l:'Tous les salariés du privé',K:D_SAL.E.K,a:aS,v:s,right:rankShort(aS,'les moins payés'),right2:'médiane '+eur(K[4][0])},
    {l:'Les femmes',K:D_SAL.F.K,a:aSF,v:s,right:rankShort(aSF,'les moins payées'),right2:'médiane '+eur(D_SAL.F.K[4][0])},
    {l:'Les hommes',K:D_SAL.H.K,a:aSH,v:s,right:rankShort(aSH,'les moins payés'),right2:'médiane '+eur(D_SAL.H.K[4][0])}];
  const sm=SAL_MEAN[state.csp];
  if(sm)rows.push({l:'Les '+sm[0],med:sm[1],medLabel:'moyenne',v:s,right:(s>=sm[1]?'+':'−')+nf0.format(Math.abs(Math.round((s/sm[1]-1)*100)))+' % vs moyenne',right2:'seule la moyenne est publiée'});
  const mx=Math.max(6000,s*1.15);
  rowsChart($('cmp-sal'),rows,{max:mx,ticks:ticksLin(mx),tickFmt:v=>nf0.format(v)+' €',fmt:eur});
  const single=+state.ad===1&&+state.kids+ +state.k3===0&&D.h.incM>0&&Math.abs(D.h.incM-sal)/sal>.15&&D.h.aidM===0;
  $('sal-hint').hidden=!single;
  if(single)$('sal-hint-t').textContent='Dans « Mon foyer », vous vivez seul avec '+eur(D.h.incM)+' par mois : si ce salaire est votre seul revenu, les deux montants devraient être égaux.';
}

/* ---------- patrimoine ---------- */
function renderPatrimoine(D){
  const{own,owe,pn,aPN,aAge,aCsp,aPB,PB,gP}=D;
  $('opt-pat-n').textContent=(state.csp&&PAT_CSP[state.csp]?1:0)+(state.year!=='2026'?1:0)?'('+((state.csp&&PAT_CSP[state.csp]?1:0)+(state.year!=='2026'?1:0))+')':'';
  if(!aPN){setVerdict('v-pat',{eye:'Votre patrimoine',sent:'Indiquez ce que vous possédez et ce que vous devez.'});$('cmp-pat').textContent='';return}
  const ci=classIndex(PB,aPN.xc),cls=PB[ci],nx=PB[ci+1],rb=rankBig(aPN,'les moins dotés');
  setVerdict('v-pat',{eye:'Patrimoine net : '+eur(own)+' − '+eur(owe)+' = '+eur(pn),big:rb.t,small:rb.small,a:aPN,cls,str:straddle(PB,aPN),fill:classFill(PB),
    sent:pn<=0?'Vos crédits dépassent ce que vous possédez, comme pour les 10 % de ménages les moins dotés.':aPN.above?'Au-delà du dernier seuil publié : vous faites partie du 1 % le mieux doté.':'Votre ménage possède plus que '+nf0.format(Math.round(aPN.p))+' % des ménages, crédits déduits.',
    cap:aPN.below||aPN.above?'':'Sur 100 ménages, vous passez devant '+nf0.format(Math.round(aPN.p))+'.',
    next:nx?'Encore '+eur((cls.hi-aPN.xc)*(1+gP.c))+' de patrimoine net pour passer en « '+nx.n+' ».':''});
  const p=aPN.xc,rows=[
    {l:'Tous les ménages',K:D_PN.K,a:aPN,v:p,right:rankShort(aPN,'les moins dotés'),right2:'marge ± '+pts((aPN.hi-aPN.lo)/2)+' pt'},
    {l:'Les ménages de '+AGE[state.age].l,K:D.DAge.K,a:aAge,v:p,right:aAge.above?'top 10 % de votre âge':rankShort(aAge,'les moins dotés'),right2:'marge ± '+pts((aAge.hi-aAge.lo)/2)+' pt'}];
  if(D.DCsp)rows.push({l:'Les ménages de '+PAT_CSP[state.csp][0],K:D.DCsp.K,a:aCsp,v:p,right:aCsp.above?'top 10 % de la catégorie':aCsp.below?'10 % les moins dotés':rankShort(aCsp,'les moins dotés'),right2:'marge ± '+pts((aCsp.hi-aCsp.lo)/2)+' pt'});
  if(aPB)rows.push({l:'Tous les ménages, en brut',K:PB_K,a:aPB,v:own/(1+gP.c),right:rankShort(aPB,'les moins dotés'),right2:'brut '+eur(own)});
  rowsChart($('cmp-pat'),rows,{log:true,min:1e3,max:1e7,ticks:[1e3,1e4,1e5,1e6,1e7],tickFmt:v=>v>=1e6?(v/1e6)+' M€':nf0.format(v/1e3)+' k€',fmt:eur});
}

/* ---------- emprunt ---------- */
const keur=v=>v>=1e6?eur(v):nf0.format(Math.round(v/1000))+' k€';
const r1000=v=>Math.round(v/1000)*1000;
const ptzPersons=()=>+state.ad+ +state.kids+ +state.k3;
function loanInputs(D,over){
  const years=+state.duree,ratePct=state.rateC>0?state.rateC:LOAN.rates[years],insPct=state.insC>0?state.insC:LOAN.ins[state.age];
  const rfrEst=Math.round(D.h.incM*12*IR.nonDed*.9/(1+D.gR.c)*(1-.017));
  const o={incM:D.h.incM,rentM:+state.loyers||0,creditsM:+state.credits||0,apport:+state.apport||0,years,ratePct,insPct,bien:state.bien,primo:state.primo==='oui',
    ptz:{zone:state.zone,type:state.htype,travaux:state.travaux==='oui',rfr:+state.rfr>0?+state.rfr:rfrEst,persons:ptzPersons()},price:state.lmode==='price'?Math.max(0,+state.price||0):null};
  return Object.assign(o,over||{},{rfrEst});
}
function checkItem(ul,status,title,text){const li=document.createElement('li');li.className='ck '+status;li.innerHTML='<span class="ck-i" aria-hidden="true"></span><div><b></b><span></span></div>';li.querySelector('b').textContent=title;li.querySelector('div span').textContent=text;const sr=document.createElement('span');sr.className='sr';sr.textContent=status==='ok'?'Conforme : ':status==='warn'?'À surveiller : ':'Bloquant : ';li.querySelector('div').prepend(sr);ul.appendChild(li)}
function kpis(el,items){el.textContent='';items.forEach(([l,v,sub])=>{const d=document.createElement('div');d.className='kpi';d.innerHTML='<span></span><b></b><em></em>';d.querySelector('span').textContent=l;d.querySelector('b').textContent=v;d.querySelector('em').textContent=sub||'';el.appendChild(d)})}
function renderLoan(D){
  const{h,H}=D,o=loanInputs(D),L=loanPlan(o);D.L=L;
  $('loan-inc').textContent=eur(h.incM)+' / mois';$('loan-hh').textContent=hhName()+' · net avant impôt';
  $('rate-help').textContent='Vide : taux moyen du marché sur '+o.years+' ans ('+dec(LOAN.rates[o.years],2)+' %, août 2026).';
  $('ins-help').textContent='Vide : taux indicatif pour votre âge ('+dec(LOAN.ins[state.age],2)+' %).';
  $('rfr-help').textContent='Vide : estimé à '+eur(o.rfrEst)+' à partir de vos revenus.';
  $('price-q').hidden=state.lmode!=='price';$('type-field').hidden=state.bien!=='neuf';$('trav-field').hidden=state.bien!=='ancien';
  const nOpt=(state.rateC>0)+(state.insC>0)+(+state.loyers>0)+(state.primo==='non')+(+state.rfr>0);$('opt-loan-n').textContent=nOpt?'('+nOpt+')':'';
  const st=$('l-status');
  if(!(h.incM>0)){$('l-kpis').textContent='';$('l-eye').textContent='';st.hidden=true;$('l-big').textContent='–';$('l-sent').textContent='Indiquez les revenus du foyer dans « Mon foyer » pour lancer la simulation.';['l-range','l-next','l-cap'].forEach(i=>$(i).textContent='');$('l-bar').textContent='';$('loan-checks').textContent='';return}
  const bienTxt=o.bien==='neuf'?'neuf':'ancien',ptzOn=L.ptz.ok&&L.ptz.amt>0;
  $('l-eye').textContent=hhName()+' · '+eur(L.R)+' de revenus retenus par mois';
  if(state.lmode==='cap'){
    st.hidden=true;
    const low=loanPlan(Object.assign({},o,{ratePct:o.ratePct+.3})),high=loanPlan(Object.assign({},o,{ratePct:Math.max(.1,o.ratePct-.3)}));
    $('l-big').textContent=L.C>0?'≈ '+eur(r1000(L.C+L.ptz.amt)):'0 €';
    $('l-sent').textContent=L.C>0?'C\'est ce que votre foyer peut emprunter sur '+o.years+' ans'+(ptzOn?', dont un PTZ de '+eur(r1000(L.ptz.amt))+' à 0 %':'')+'.':'Vos crédits en cours atteignent déjà 35 % de vos revenus : la banque ne peut pas prêter davantage, sauf dérogation.';
    kpis($('l-kpis'),L.C>0?[['Mensualité',eur(L.monthly),'assurance comprise'],['Logement visé','≈ '+eur(r1000(L.price)),bienTxt+', frais inclus'],['Reste à vivre',eur(L.rav),'par mois, après crédits']]:[]);
    $('l-range').textContent=L.C>0?'Selon le taux obtenu (±0,3 point) : de '+keur(low.C+low.ptz.amt)+' à '+keur(high.C+high.ptz.amt)+' · taux '+dec(o.ratePct,2)+' %, assurance '+dec(o.insPct,2)+' %':'';
  }else{
    const ok=L.dti<=.35+1e-9,lim=!ok&&L.dti<=.40;
    st.hidden=false;st.className='l-status '+(ok?'ok':lim?'warn':'ko');st.textContent=ok?'Finançable':lim?'Au-delà de la norme : dérogation nécessaire':'Hors des normes bancaires';
    $('l-big').textContent=nf0.format(Math.round(L.dti*100))+' % d\'endettement';$('l-big').classList.add('small');
    let miss='';
    if(!ok){const needR=(o.creditsM+L.monthly)/LOAN.dti,cap=loanPlan(Object.assign({},o,{price:null})),extraApport=Math.max(0,L.C+L.ptz.amt-(cap.C+cap.ptz.amt))*(1-LOAN.guarantee);
      miss=' Pour rester à 35 %, il faudrait '+eur(needR-L.R)+' de revenus en plus par mois, ou environ '+eur(r1000(extraApport))+' d\'apport en plus, ou viser '+eur(r1000(cap.price))+'.'}
    $('l-sent').textContent=ok?'Ce logement à '+eur(o.price)+' entre dans les normes bancaires.':'Pour ce logement à '+eur(o.price)+' :'+miss;
    kpis($('l-kpis'),[['Mensualité',eur(L.monthly),'assurance comprise'],['À emprunter',eur(r1000(L.C+L.ptz.amt)),ptzOn?'dont PTZ '+eur(r1000(L.ptz.amt)):'sur '+o.years+' ans'],['Reste à vivre',eur(L.rav),'par mois, après crédits']]);
    $('l-range').textContent='Taux '+dec(o.ratePct,2)+' %, assurance '+dec(o.insPct,2)+' %, coût total de l\'achat '+eur(L.total);
  }
  if(state.lmode==='cap')$('l-big').classList.remove('small');
  const ravUc=L.rav/H.uc,poor=1337;

  // barre des revenus
  const svg=$('l-bar');svg.textContent='';const x=18,w=64,top=12,hh=206,R=L.R;
  const seg=[[L.mens+L.insM,'me-fill','Prêt immobilier'],[L.ptz.monthly,'f-v1','PTZ'],[o.creditsM,'g-lo','Autres crédits'],[Math.max(0,L.rav),'g-hi','Reste à vivre']];
  const tot=Math.max(R,seg.reduce((s,q)=>s+Math.max(0,q[0]),0));let y=top+hh;const labs=[];
  seg.forEach(([v,cls,l])=>{if(!(v>0))return;const hgt=hh*v/tot;y-=hgt;S('rect',{x,y:y+1,width:w,height:Math.max(1,hgt-2),rx:4,class:cls},svg);labs.push([y+hgt/2,l,v])});
  const y35=top+hh*(1-.35*R/tot);S('line',{x1:x-8,x2:x+w+8,y1:y35,y2:y35,class:'dti'},svg);S('text',{x:x-10,y:y35+4,'text-anchor':'end',class:'ax'},svg,'35 %');
  const ys=relax(labs.map(l=>l[0]),30,top+10,top+hh-10);labs.forEach(([yy,l,v],i)=>{S('text',{x:x+w+12,y:ys[i]-2,class:'lab'},svg,l);S('text',{x:x+w+12,y:ys[i]+13,class:'lab2'},svg,eur(v))});
  $('l-cap').textContent='Vos revenus mensuels : '+eur(R);
  // contrôles bancaires
  const ul=$('loan-checks');ul.textContent='';const endAge=LOAN.ageMax[state.age]+o.years;
  checkItem(ul,L.dti<=.35+1e-9?'ok':L.dti<=.40?'warn':'ko','Taux d\'endettement : '+nf0.format(Math.round(L.dti*100))+' %','Maximum 35 % assurance comprise ; au-delà, seulement par dérogation (20 % des dossiers).');
  checkItem(ul,L.taeg<=L.usure?'ok':'ko','TAEG estimé : '+dec(L.taeg,2)+' %','Taux d\'usure en vigueur pour cette durée : '+dec(L.usure,2)+' % (Banque de France, 3e trimestre 2026).');
  checkItem(ul,o.apport>=L.fees?'ok':'warn','Apport : '+eur(o.apport),o.apport>=L.fees?'Il couvre les frais de notaire et de garantie ('+eur(L.fees)+'), ce que la plupart des banques demandent.':'Il ne couvre pas les frais de notaire et de garantie ('+eur(L.fees)+') : un financement à plus de 100 % est rare.');
  checkItem(ul,ravUc>=poor?'ok':'warn','Reste à vivre : '+eur(ravUc)+' par unité de consommation',ravUc>=poor?'Au-dessus du seuil de pauvreté INSEE (1 337 € par mois).':'Sous le seuil de pauvreté INSEE (1 337 € par mois) : la banque risque de juger le budget trop serré.');
  checkItem(ul,endAge<=70?'ok':endAge<=80?'warn':'ko','Âge en fin de prêt : environ '+endAge+' ans',endAge<=70?'Pas de difficulté particulière pour l\'assurance.':'Au-delà de 70 ans, l\'assurance emprunteur est plus chère et plus difficile à obtenir ; une durée plus courte peut être demandée.');
  checkItem(ul,ptzOn?'ok':'info','PTZ : '+(ptzOn?eur(r1000(L.ptz.amt))+', tranche '+L.ptz.tranche:'non'),ptzOn?'Prêt à 0 % : '+(L.ptz.diff?L.ptz.diff+' ans sans remboursement, puis ':'')+eur(L.ptz.monthly)+' par mois pendant '+L.ptz.rembY+' ans. Zone '+state.zone+', '+ptzPersons()+' personne'+(ptzPersons()>1?'s':'')+'.':'Pas de PTZ : '+(L.ptz.why||'montant nul')+'.');
  // plan de financement
  const pb=$('plan-bar');pb.textContent='';const W=chartW(pb,300,860),bh=34,total=o.apport+L.ptz.amt+L.C;
  if(total>0){const parts=[[o.apport,'g-hi','Apport'],[L.ptz.amt,'f-v1','PTZ'],[L.C,'f-r3','Prêt principal']].filter(q=>q[0]>0);
    let lx=0,ly=4;parts.forEach(([v,cls,l])=>{const g=S('g',{},pb);S('rect',{x:0,y:0,width:12,height:12,rx:3,class:cls},g);const t1=S('text',{x:18,y:10,class:'lab'},g,l+' ');S('tspan',{class:'lab2'},t1,eur(r1000(v))+' · '+nf0.format(Math.round(v/total*100))+' %');
      let w=190;try{w=t1.getComputedTextLength()+18||w}catch(e){}if(lx>0&&lx+w>W){lx=0;ly+=20}g.setAttribute('transform','translate('+lx+','+ly+')');lx+=w+28});
    const by=ly+24;let xx=0;pb.setAttribute('viewBox','0 0 '+W+' '+(by+bh+2));
    parts.forEach(([v,cls])=>{const ww=W*v/total;S('rect',{x:xx+1,y:by,width:Math.max(2,ww-2),height:bh,rx:6,class:cls},pb);xx+=ww});
    $('plan-desc').textContent='Coût total de l\'achat : '+eur(L.total)+' (logement '+eur(r1000(L.price))+', notaire '+eur(L.notaryEur)+', garantie et dossier '+eur(L.guar)+').'}
  eqRows($('loan-eq'),[{l:'Prix du logement',v:eur(r1000(L.price))},{l:'+ frais de notaire ('+dec(L.notary*100,1).replace(/,0$/,'')+' %)',v:eur(L.notaryEur)},{l:'+ garantie et dossier',v:eur(L.guar)},{l:'= coût total',v:eur(L.total),c:'total'},{l:'− apport',v:eur(o.apport),c:'minus'},ptzOn?{l:'− PTZ à 0 %',v:eur(L.ptz.amt),c:'minus'}:null,{l:'= prêt principal',v:eur(L.C),c:'total'}].filter(Boolean));
  eqRows($('loan-cost'),[{l:'Mensualité du prêt principal',v:eur(L.mens)},{l:'+ assurance emprunteur',v:eur(L.insM)},ptzOn?{l:'+ PTZ ('+(L.ptz.diff?'après '+L.ptz.diff+' ans de différé':'dès le début')+')',v:eur(L.ptz.monthly)}:null,{l:'= mensualité totale',v:eur(L.monthly),c:'total'},{l:'Intérêts sur '+o.years+' ans',v:eur(L.interest)},{l:'Assurance sur '+o.years+' ans',v:eur(L.insTotal)},{l:'= coût du crédit',v:eur(L.interest+L.insTotal),c:'total'},{l:'TAEG estimé '+dec(L.taeg,2)+' %, garantie et dossier compris.',c:'note'}].filter(Boolean));
  renderAmort(L,o);
  // durée × taux
  const t=$('loan-heat');t.textContent='';const deltas=[-.5,0,.5],durs=[15,20,25];
  const cells=durs.map(y=>deltas.map(dl=>{const base=state.rateC>0?state.rateC:LOAN.rates[y],r=Math.max(.1,base+dl),P=loanPlan(Object.assign({},o,{years:y,ratePct:r}));return{y,r,P,cur:y===o.years&&dl===0}}));
  const val=c=>state.lmode==='price'?c.P.dti:c.P.C+c.P.ptz.amt;
  const vals=cells.flat().map(val),mx=Math.max(...vals),mn=Math.min(...vals);
  $('heat-desc').textContent=state.lmode==='price'?'Taux d\'endettement pour ce logement. En rouge : au-delà de 35 %. La case encadrée correspond à votre simulation.':'Montant total que vous pouvez emprunter, PTZ compris. La case encadrée correspond à votre simulation.';
  const thead=document.createElement('tr');thead.innerHTML='<th>Durée</th><th class="num">Taux −0,5 pt</th><th class="num">'+(state.rateC>0?'Votre taux':'Taux du marché')+'</th><th class="num">Taux +0,5 pt</th>';t.appendChild(thead);
  cells.forEach((row,i)=>{const tr=document.createElement('tr');const th=document.createElement('td');th.textContent=durs[i]+' ans';tr.appendChild(th);
    row.forEach(c=>{const td=document.createElement('td'),v=val(c);td.className='num heat-c'+(c.cur?' cur':'')+(state.lmode==='price'&&v>.35?' bad':'');const k=mx>mn?(state.lmode==='price'?(mx-v)/(mx-mn):(v-mn)/(mx-mn)):1;td.style.setProperty('--k',(.06+.36*k).toFixed(3));td.innerHTML='<b></b><span></span>';td.querySelector('b').textContent=state.lmode==='price'?nf0.format(Math.round(v*100))+' %':keur(v);td.querySelector('span').textContent=dec(c.r,2)+' %'+(state.lmode==='price'?' · '+eur(c.P.monthly)+'/mois':'');tr.appendChild(td)});
    t.appendChild(tr)});
}
let amortCtx=null;
function renderAmort(L,o){
  const svg=$('amort');svg.textContent='';$('leg-ptz').hidden=!(L.ptz.amt>0);
  const rows=amortization(L,o),W=chartW(svg,300,860),Hh=W<500?240:280,Lm=52,Rm=12,T=14,Bm=34,pw=W-Lm-Rm,ph=Hh-T-Bm;svg.setAttribute('viewBox','0 0 '+W+' '+Hh);
  const ymax=Math.max(1,L.price,L.C+L.ptz.amt)*1.05,X=y=>Lm+pw*y/o.years,Yv=v=>T+ph*(1-v/ymax);
  const st=ymax>600000?200000:ymax>250000?100000:50000;for(let v=0;v<=ymax;v+=st){S('line',{x1:Lm,x2:W-Rm,y1:Yv(v),y2:Yv(v),class:'tick'},svg);S('text',{x:Lm-8,y:Yv(v)+4,'text-anchor':'end',class:'ax'},svg,keur(v))}
  const yStep=W<500?(o.years>15?10:5):5;for(let y=0;y<=o.years;y+=yStep)S('text',{x:X(y),y:Hh-12,'text-anchor':y===0?'start':y===o.years?'end':'middle',class:'ax'},svg,y===0?'achat':'an '+y);
  const top=rows.map(r=>[X(r.y),Yv(r.crd+r.ptz)]),mid=rows.map(r=>[X(r.y),Yv(r.crd)]),base=rows.map(r=>[X(r.y),Yv(0)]);
  const area=(up,dn,cls)=>S('path',{d:'M'+up.map(q=>q.join(',')).join('L')+'L'+dn.slice().reverse().map(q=>q.join(',')).join('L')+'Z',class:cls},svg);
  area(mid,base,'f-r3 area');if(L.ptz.amt>0)area(top,mid,'f-v1 area');
  S('polyline',{points:rows.map(r=>X(r.y)+','+Yv(Math.max(0,L.price-r.crd-r.ptz))).join(' '),class:'own-line'},svg);
  const last=rows[rows.length-1];S('text',{x:X(last.y)-4,y:Yv(L.price)-8,'text-anchor':'end',class:'lab2'},svg,'logement entièrement à vous');
  const hl=S('line',{y1:T,y2:T+ph,class:'hair',visibility:'hidden'},svg);S('rect',{x:Lm,y:T,width:pw,height:ph,fill:'transparent'},svg);
  amortCtx={svg,hl,rows,Lm,pw,W,o,L};
}

/* ---------- échelles ---------- */
const TT=24,TB=24,TH=660,TPH=TH-TT-TB;
function yFrac(p){if(state.scale==='prop')return p/100;if(p<=90)return .62*p/90;const s=Math.max(100-p,.005);return .62+.38*Math.min(1,(1-Math.log10(s))/(1-Math.log10(.005)))}
const Y=p=>TT+TPH*(1-yFrac(clamp(p,0,100)));
function axis(svg,x1,x2,nar){const ticks=state.scale==='prop'?(nar?[0,20,40,60,80,100]:[0,10,20,30,40,50,60,70,80,90,100]):[0,30,60,90,95,99,99.9,99.99];
  ticks.forEach(p=>{S('line',{x1,x2,y1:Y(p),y2:Y(p),class:'tick'},svg);S('text',{x:x1-5,y:Y(p)+4,'text-anchor':'end',class:'ax'},svg,nar?tickP(p).replace(' %',''):tickP(p))});
  if(state.scale!=='prop'){const y=Y(90);S('path',{d:'M'+(x1-2)+' '+(y+3)+'l8 -5M'+(x1-2)+' '+(y+8)+'l8 -5',class:'brk'},svg)}}
function hatchDef(svg,id){const d=S('defs',{},svg),p=S('pattern',{id,patternUnits:'userSpaceOnUse',width:6,height:6,patternTransform:'rotate(45)'},d);S('line',{x1:0,y1:0,x2:0,y2:6,class:'hatch-l'},p)}
function errMark(svg,x,w,a){
  const y1=Y(a.hi),y2=Y(a.lo);S('rect',{x:x-3,y:y1,width:w+6,height:Math.max(2,y2-y1),class:'err'},svg);[y1,y2].forEach(y=>S('line',{x1:x-7,x2:x+w+7,y1:y,y2:y,class:'err-cap'},svg));
  const y=Y(a.p);S('line',{x1:x-10,x2:x+w+10,y1:y,y2:y,class:'me-line'},svg);const py=clamp(y-10,TT-12,TH-TB-8);
  S('rect',{x:x+w/2-26,y:py,width:52,height:20,rx:10,class:'me-fill'},svg);S('text',{x:x+w/2,y:py+14,'text-anchor':'middle',class:'me-txt'},svg,'Vous');
}
function relax(ys,gap,min,max){const o=ys.map((y,i)=>({y,i})).sort((a,b)=>a.y-b.y),n=o.length;if(!n)return[];
  for(let k=1;k<n;k++)if(o[k].y<o[k-1].y+gap)o[k].y=o[k-1].y+gap;
  if(o[n-1].y>max){o[n-1].y=max;for(let k=n-2;k>=0;k--)if(o[k].y>o[k+1].y-gap)o[k].y=o[k+1].y-gap}
  if(o[0].y<min){o[0].y=min;for(let k=1;k<n;k++)if(o[k].y<o[k-1].y+gap)o[k].y=o[k-1].y+gap}
  const r=[];o.forEach(q=>r[q.i]=q.y);return r}
function classToise(svg,B,a,fmtRange,topP,shareLabel){
  svg.textContent='';const W=chartW(svg,300,560),nar=W<440,cx=nar?44:66,cw=nar?50:84,gap=nar?20:34;svg.setAttribute('viewBox','0 0 '+W+' '+TH);hatchDef(svg,svg.id+'-h');axis(svg,cx-6,cx+cw,nar);if(nar)shareLabel='';
  B.forEach(c=>{const y1=Y(c.phi),y2=Y(c.plo);if(y2-y1<=0)return;const r=S('rect',{x:cx,y:y1+.75,width:cw,height:Math.max(.8,y2-y1-1.5),class:'f-'+c.col},svg);S('title',{},r,c.n+' : '+pctA(c.phi-c.plo)+shareLabel)});
  if(topP<100)S('rect',{x:cx,y:TT,width:cw,height:Math.max(0,Y(topP)-TT),fill:'url(#'+svg.id+'-h)'},svg);
  const want=B.map(c=>(Y(c.phi)+Y(c.plo))/2),ys=relax(want,34,TT+8,TH-TB-14),tx=cx+cw+gap,ui=a?classIndex(B,a.xc):-1;
  B.forEach((c,i)=>{const yl=ys[i],yc=want[i];
    S('path',{d:'M'+(cx+cw+3)+' '+yc+'H'+(cx+cw+gap*.3)+'L'+(cx+cw+gap*.7)+' '+(yl-4)+'H'+(tx-4),class:'leader'},svg);
    const t=S('text',{x:tx,y:yl-1,class:'lab'+(i===ui?' me-name':'')},svg,c.n);
    S('text',{x:tx,y:yl+14,class:'lab2'},svg,fmtRange(c)+' · '+pctA(c.phi-c.plo)+shareLabel);
    if(i===ui){let w=180;try{w=t.getComputedTextLength()||w}catch(e){}S('rect',{x:tx+w+8,y:yl-13,width:38,height:16,rx:8,class:'me-fill'},svg);S('text',{x:tx+w+27,y:yl-1.5,'text-anchor':'middle',class:'me-txt'},svg,'vous')}});
  if(a)errMark(svg,cx,cw,a);
}
function salaryToise(svg,K,a){
  svg.textContent='';const W=chartW(svg,300,560),nar=W<440,cx=nar?44:66,cw=nar?50:84,gap=nar?20:34;svg.setAttribute('viewBox','0 0 '+W+' '+TH);hatchDef(svg,svg.id+'-h');axis(svg,cx-6,cx+cw,nar);const top=K[K.length-1][1];
  S('rect',{x:cx,y:Y(top),width:cw,height:Y(0)-Y(top),class:'sal-hi'},svg);
  if(a){const y=Math.max(Y(a.p),Y(top));if(y<Y(0))S('rect',{x:cx,y,width:cw,height:Y(0)-y,class:'sal-lo'},svg)}
  S('rect',{x:cx,y:TT,width:cw,height:Y(top)-TT,fill:'url(#'+svg.id+'-h)'},svg);
  const tx=cx+cw+gap;if(Y(top)-TT>16)S('text',{x:tx,y:(TT+Y(top))/2+4,class:'ax'},svg,'non publié');
  const ys=relax(K.map(k=>Y(k[1])),16,TT+8,TH-TB);
  K.forEach(([v,p],i)=>{const y=Y(p);S('line',{x1:cx,x2:cx+cw,y1:y,y2:y,class:'sep'},svg);
    S('path',{d:'M'+(cx+cw+3)+' '+y+'H'+(cx+cw+gap*.3)+'L'+(cx+cw+gap*.7)+' '+ys[i]+'H'+(tx-4),class:'leader'},svg);
    S('text',{x:tx,y:ys[i]+4,class:'lab2'},svg,(nar?(p===50?'médiane : ':p<50?nf0.format(p)+' % sous ':'top '+nf0.format(100-p)+' % dès '):(p===50?'la moitié gagne moins de ':p<50?nf0.format(p)+' % gagnent moins de ':'top '+nf0.format(100-p)+' % : plus de '))+eur(v))});
  if(a)errMark(svg,cx,cw,a);
}

/* ---------- marge d'erreur ---------- */
const SRC={
  hors:s=>['Hors des seuils publiés',s.edge==='below'?'En deçà du premier seuil ('+eur(s.v)+').':'Au-delà du dernier seuil ('+eur(s.v)+').'],
  interp:(s,c)=>['Lecture entre deux seuils','Entre '+eur(s.a)+' et '+eur(s.b)+c.unit+'.'],
  sample:(s,c)=>['Taille de l\'échantillon',c.sample],
  tail:()=>['Haut de l\'échelle estimé','Seuils du top 1 % non publiés pour 2024.'],
  time:s=>['Écart de date','Montants '+state.year+' ramenés à 2024 (hausse supposée de '+(s.g.lo>=0?'+':'')+dec(s.g.lo*100,1)+' à +'+dec(s.g.hi*100,1)+' %).'],
  conv:()=>['Conversion brut → net','Cotisations à ±1 point.']
};
function ebBlock(title,a,ctx){
  const box=document.createElement('div');box.className='eb-block';const hh=document.createElement('h3');hh.textContent=title;box.appendChild(hh);
  if(!a){const p=document.createElement('p');p.className='q-h';p.textContent='Aucune saisie.';box.appendChild(p);return box}
  const tl=a.p-a.lo,th=a.hi-a.p,mx=Math.max(1,tl,th,...a.src.map(s=>Math.max(s.lo,s.hi)));
  const add=(label,desc,lo,hi,total)=>{const r=document.createElement('div');r.className='eb-row'+(total?' total':'');
    r.innerHTML='<div class="l"><b></b><span></span></div><div class="eb-bar"><i class="n"></i><i class="p"></i></div><div class="v"></div>';
    r.querySelector('b').textContent=label;r.querySelector('span').textContent=desc;r.querySelector('i.n').style.width=(lo/mx*50)+'%';r.querySelector('i.p').style.width=(hi/mx*50)+'%';
    r.querySelector('.v').textContent=(lo<.05&&hi<.05)?'≈ 0':'−'+pts(lo)+' / +'+pts(hi)+' pt';box.appendChild(r)};
  a.src.forEach(s=>{const[l,d]=SRC[s.k](s,ctx);add(l,d,s.lo,s.hi)});
  add('Marge totale','Rang '+pts(a.p)+' sur 100, entre '+pts(a.lo)+' et '+pts(a.hi)+'.',tl,th,true);
  return box;
}

/* ---------- tableaux ---------- */
function precStr(v,pr,conv){
  if(!pr)return '—';const cv=conv||(x=>x);const V=cv(v),lo=cv(pr.lo),hi=cv(pr.hi),dl=V-lo,dh=hi-V,m=Math.max(dl,dh);
  if(!(m>0)||m/V<.001)return 'exact';
  if(Math.abs(dl-dh)/m<.35&&m/V<.08){const s=Math.pow(10,Math.floor(Math.log10(m))-1);return '± '+eur(Math.max(1,Math.round(m/s)*s))}
  return '−'+pctA(dl/V*100)+' / +'+pctA(dh/V*100);
}
function fillTable(tb,B,D,ui,rangeFmt,conv){
  tb.textContent='';
  B.forEach((c,i)=>{const tr=document.createElement('tr');if(i===ui)tr.className='me';
    tr.innerHTML='<td><span class="sw"></span><b></b></td><td><span class="d"></span><span class="src"></span></td><td class="num"></td><td class="num"></td><td class="num prec"></td>';
    tr.querySelector('.sw').style.background='var(--'+c.col+')';tr.querySelector('b').textContent=c.n;
    if(i===ui){const y=document.createElement('span');y.className='you';y.textContent='vous';tr.firstChild.appendChild(y)}
    tr.querySelector('.d').textContent=c.d;tr.querySelector('.src').textContent=c.s;
    const n=tr.querySelectorAll('td.num');n[0].textContent=rangeFmt(c);n[1].textContent=pctA(c.phi-c.plo);n[2].textContent=isFinite(c.hi)?precStr(c.hi,thrPrec(D,c.hi),conv):'—';tb.appendChild(tr)});
}
const estMark=v=>v>=C99*.999?'≈ ':'';
const rangeRev=c=>c.lo===0?'moins de '+estMark(c.hi)+eur(c.incHi):c.hi===Infinity?'plus de '+estMark(c.lo)+eur(c.incLo):estMark(c.lo)+eur(c.incLo)+' à '+eur(c.incHi);
const rangePat=c=>c.lo===0?'moins de '+eur(c.hi):c.hi===Infinity?'plus de '+eur(c.lo):eur(c.lo)+' à '+eur(c.hi);

/* ---------- courbe ---------- */
function niceMax(v){for(const x of[5000,6000,8000,10000,12000,15000,20000,25000,30000,40000,50000,75000,100000])if(v<=x)return x;return Math.ceil(v/50000)*50000}
let curveCtx=null;
function renderCurve(D){
  const svg=$('curve');svg.textContent='';const{h,aF,B}=D;
  const W=chartW(svg,300,860),Hc=W<500?290:330,L=46,R=12,Tc=14,Bc=62,pw=W-L-R,ph=Hc-Tc-Bc;svg.setAttribute('viewBox','0 0 '+W+' '+Hc);
  const top=B.find(c=>c.hi>=C99),xmax=niceMax(Math.max(h.incM*1.3,Math.min(top?top.incHi*1.05:0,60000),6000));
  const X=v=>L+clamp(v,0,xmax)/xmax*pw,Yc=p=>Tc+ph*(1-clamp(p,0,100)/100);
  const cp=S('clipPath',{id:'cclip'},S('defs',{},svg));S('rect',{x:L,y:Tc-4,width:pw,height:ph+8},cp);
  for(let p=0;p<=100;p+=20){S('line',{x1:L,x2:W-R,y1:Yc(p),y2:Yc(p),class:'tick'},svg);S('text',{x:L-8,y:Yc(p)+4,'text-anchor':'end',class:'ax'},svg,p+' %')}
  for(let k=0;k<=5;k++){const v=xmax*k/5;S('text',{x:X(v),y:Hc-Bc+18,'text-anchor':k===0?'start':k===5?'end':'middle',class:'ax'},svg,nf0.format(v)+' €')}
  const g=S('g',{'clip-path':'url(#cclip)'},svg),up=[],dn=[],ln=[];
  for(let k=1;k<=240;k++){const x=xmax*k/240,nv=household(Object.assign({},h,{incM:x})).nv,r=cdf(NV,nv);if(r.below||r.above)continue;
    const ps=['lin','log'].map(m=>cdf(NV,nv,m).p),hs=sampleH(D_NV,r.p),pa=D_NV.alt.map(K=>cdf(K,nv).p);
    up.push([X(x),Yc(r.p+Math.hypot(Math.max(0,Math.max(...ps)-r.p),hs,Math.max(0,Math.max(...pa)-r.p)))]);dn.push([X(x),Yc(r.p-Math.hypot(Math.max(0,r.p-Math.min(...ps)),hs,Math.max(0,r.p-Math.min(...pa))))]);ln.push([X(x),Yc(r.p)])}
  if(up.length>1){S('path',{d:'M'+up.map(q=>q.join(',')).join('L')+'L'+dn.slice().reverse().map(q=>q.join(',')).join('L')+'Z',class:'band-f'},g);S('polyline',{points:ln.map(q=>q.join(',')).join(' '),class:'lf'},g)}
  const ry=Hc-Bc+28;
  B.forEach(c=>{const x1=X(c.incLo),x2=X(Math.min(c.incHi,xmax));if(x2-x1<=0)return;const r=S('rect',{x:x1+(c.lo?1:0),y:ry,width:Math.max(.5,x2-x1-(c.lo?1:0)),height:10,class:'f-'+c.col},svg);S('title',{},r,c.n)});
  S('text',{x:L,y:ry+26,class:'ax'},svg,'Classes sociales selon le revenu du foyer');
  if(aF&&h.incM<=xmax){const cx=X(h.incM),cy=Yc(aF.p);S('line',{x1:cx,x2:cx,y1:Yc(aF.hi),y2:Yc(aF.lo),class:'err-cap'},svg);S('circle',{cx,cy,r:6,class:'me-fill me-dot'},svg);S('text',{x:cx+(cx>W-130?-10:10),y:cy+(aF.p>88?18:-9),'text-anchor':cx>W-130?'end':'start',class:'me-lab'},svg,'Vous')}
  const hl=S('line',{x1:0,x2:0,y1:Tc,y2:Hc-Bc,class:'hair',visibility:'hidden'},svg);
  S('rect',{x:L,y:Tc,width:pw,height:ph,fill:'transparent'},svg);curveCtx={svg,hl,L,pw,W,xmax,D};
}

/* ---------- rendu ---------- */
function syncControls(){
  root.querySelectorAll('[data-seg]').forEach(g=>{const k=g.dataset.seg;g.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===String(state[k]))))});
  root.querySelectorAll('[data-num]').forEach(i=>{if(document.activeElement!==i)i.value=nf0.format(Math.round(+state[i.dataset.num]||0))});
  const kids=+state.kids;if(+state.teens>kids)state.teens=kids;
  const tg=$('teens');tg.textContent='';for(let i=0;i<=kids;i++){const b=document.createElement('button');b.type='button';b.textContent=i;b.setAttribute('aria-pressed',String(i===+state.teens));b.addEventListener('click',()=>{state.teens=i;ov('teens');render()});tg.appendChild(b)}
  $('teen-field').hidden=kids===0;$('union-field').hidden=+state.ad<2;$('kinc-field').hidden=+state.k3===0;
  $('inc-unit').value=state.incUnit;$('sal-unit').value=state.salUnit;$('statut-f').hidden=state.incUnit!=='ba';$('statut-q').hidden=state.salUnit[0]!=='b';
  $('inc-help').textContent={nm:'Net avant impôt par mois, tous les adultes réunis : salaires, pensions, revenus d\'indépendant.',na:'Net avant impôt sur l\'année, tous les adultes réunis, primes comprises.',ba:'Brut annuel de tous les adultes, primes comprises : converti en net (environ 22 % de cotisations, 25 % pour les cadres).',am:'Ce qui arrive sur vos comptes chaque mois, après prélèvement de l\'impôt : le net avant impôt en est déduit.'}[state.incUnit];
  $('pat-detail').hidden=!state.patDetail;$('own').readOnly=state.patDetail;$('detail-btn').textContent=state.patDetail?'Saisir un total':'Détailler';
  if(state.patDetail&&document.activeElement!==$('own'))$('own').value=nf0.format(['immo','fin','pro','res'].reduce((s,k)=>s+Math.max(0,+state[k]||0),0));
  root.querySelectorAll('[data-dec]').forEach(i=>{if(document.activeElement!==i)i.value=state[i.dataset.dec]>0?dec(state[i.dataset.dec],2):'';const k=i.dataset.dec;i.placeholder=k==='rateC'?dec(LOAN.rates[+state.duree],2):dec(LOAN.ins[state.age],2)});
  root.querySelectorAll('[data-csp]').forEach(s=>{if([...s.options].some(o=>o.value===state.csp))s.value=state.csp;else s.value=''});
  $('toise-desc').textContent=GRIDS[state.grid].desc+' Montants avant impôt pour : '+hhName().toLowerCase()+'.';
  syncPills();
}
function renderTabs(D){
  root.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===state.tab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1});
  $('toise-p-rev').hidden=state.tab!=='rev';$('toise-p-sal').hidden=state.tab!=='sal';$('toise-p-pat').hidden=state.tab!=='pat';
  $('tv-rev').textContent=headlineCache=foyerTab(D);
  $('tv-sal').textContent=D.aS?tabValue(D.aS,'moins payés'):'–';
  $('tv-pat').textContent=D.aPN?tabValue(D.aPN,'moins dotés'):'–';
  $('tv-loan').textContent=!(D.h.incM>0)?'–':state.lmode==='price'?nf0.format(Math.round(D.L.dti*100))+' % des revenus':(D.L.C>0?'≈ '+keur(D.L.C+D.L.ptz.amt):'0 €');
  $('toise-p-loan').hidden=state.tab!=='loan';
}
function render(){
  dirty=false;syncControls();const D=derive();renderTabs(D);
  window.App&&App.refreshHeadlines&&App.refreshHeadlines();
  if(state.tab==='rev'){
    renderFoyer(D);renderCmpFoyer(D);classToise($('toise-f'),D.B,D.aF,rangeRev,100,' des Français');
    $('sum-table').textContent=GRIDS[state.grid].classes.length+' classes, montants pour votre foyer';
    if($('tbody-rev').closest('details').open){fillTable($('tbody-rev'),D.B,D_NV,D.aF?classIndex(D.B,D.aF.xc):-1,rangeRev,v=>incomeFor(D.h,v));$('table-desc').textContent='Montants nets avant impôt par mois pour : '+hhName().toLowerCase()+', en euros '+state.year+'. La précision est la marge à 95 % sur la borne haute de chaque classe.'}
    if($('curve').closest('details').open)renderCurve(D);
    const e=$('eb-rev');e.textContent='';e.append(ebBlock('Votre foyer',D.aF,{unit:' de niveau de vie',sample:'±0,35 point annoncé par l\'INSEE sur le taux de pauvreté, transposé à votre rang.'}));
    $('sum-eb-rev').textContent=D.aF?'± '+pts((D.aF.hi-D.aF.lo)/2)+' point':'';
  }else if(state.tab==='sal'){
    renderSalaire(D);salaryToise($('toise-s'),D_SAL.E.K,D.aS);
    const e=$('eb-sal');e.textContent='';e.append(ebBlock('Votre salaire',D.aS,{unit:'',sample:'Déclarations de tous les employeurs : pas d\'erreur d\'échantillon.'}));
    $('sum-eb-sal').textContent=D.aS?'± '+pts((D.aS.hi-D.aS.lo)/2)+' point':'';
  }else if(state.tab==='loan'){
    renderLoan(D);
  }else{
    renderPatrimoine(D);classToise($('toise-p'),D.PB,D.aPN,rangePat,99,' des ménages');
    if($('tbody-pat').closest('details').open)fillTable($('tbody-pat'),D.PB,D_PN,D.aPN?classIndex(D.PB,D.aPN.xc):-1,rangePat);
    const e=$('eb-pat');e.textContent='';e.append(ebBlock('Tous les ménages',D.aPN,{unit:'',sample:'Environ 12 000 ménages interrogés.'}),ebBlock('Ménages de votre âge',D.aAge,{unit:'',sample:'Environ '+nf0.format(AGE[state.age].neff)+' ménages équivalents dans votre tranche d\'âge.'}));
    $('sum-eb-pat').textContent=D.aPN?'± '+pts((D.aPN.hi-D.aPN.lo)/2)+' point':'';
  }
  save();
}

/* ---------- données réelles (Reel) ---------- */
const MOD='toise';
const MAPPED=new Set(['inc','incUnit','ad','kids','teens','union','age','sal','salUnit','statut','csp','patDetail','fin','immo','pro','res','debt','apport','credits','loyers']);
const UNIT_OF={inc:'incUnit',sal:'salUnit'};
const hasReal={};
let snapS=null,dirty=true,headlineCache=null;
const foyerTab=D=>D.aF?(D.aF.est?'≈ ':'')+tabValue(D.aF,'plus modestes'):'–';
/* Une saisie de l'utilisateur sur un champ alimenté par les données réelles devient un scénario. */
function ov(...ks){const r=window.Reel;if(r)ks.forEach(k=>{if(MAPPED.has(k))r.override(MOD,k)})}
/* Ne jamais écraser le champ en cours de saisie. */
function typing(k){
  const a=document.activeElement;if(!a||!root||!root.contains(a))return false;
  if(a.dataset&&a.dataset.num===k)return true;
  if(k==='patDetail')return a.dataset&&a.dataset.num==='own';
  if(k==='incUnit')return a.id==='inc-unit';if(k==='salUnit')return a.id==='sal-unit';
  if(k==='csp')return a.hasAttribute('data-csp');
  return false;
}
/* Recopie les valeurs réelles dans l'état (idempotent). Sans donnée réelle ni scénario : valeur d'exemple. */
function applyReal(){
  const snap=snapS,Reel=window.Reel;if(!snap||!snap.ready||!Reel)return;
  let V,P;try{V=Reel.values(Object.assign({},snap,{scope:'foyer'}));P=Reel.values(snap)}catch(e){console.error(e);return}
  const set=(k,ok,v)=>{hasReal[k]=!!ok;if(Reel.isOverridden(MOD,k)||typing(k))return;state[k]=ok?v:DEFAULTS[k]};
  const f=V.foyer,num=v=>Math.max(0,Math.round(+v||0)),pat=V.patrimoine;
  set('inc',V.has.revenus,num(V.revenusSansLoyers));set('incUnit',V.has.revenus,'nm');
  set('ad',f.adultes!=null,Math.min(3,Math.max(1,num(f.adultes))));
  set('kids',f.enfants!=null,Math.min(4,num(f.enfants)));
  set('teens',f.enfants14!=null,num(f.enfants14));
  set('union',f.union==='joint'||f.union==='sep',f.union);
  set('age',f.age!=null&&AGE[f.age]!=null,f.age);
  const ps=P.personne,okS=!!P.has.salaire;
  set('sal',okS,num(ps.salaire));
  set('salUnit',okS,['nm','na','bm','ba'].includes(ps.salaireUnite)?ps.salaireUnite:'nm');
  set('statut',okS,ps.statut==='cadre'?'cadre':'nc');
  set('csp',okS,String(ps.csp||''));
  set('patDetail',V.has.positions||V.has.patrimoine,true);
  set('fin',V.has.positions,num(pat.financier));
  set('immo',V.has.patrimoine,num(pat.immobilier));
  set('pro',V.has.patrimoine,num(pat.entreprise));
  set('res',V.has.patrimoine,num(pat.usage));
  set('debt',V.has.patrimoine,num(pat.dettes));
  if(state.patDetail)state.own=['immo','fin','pro','res'].reduce((s,k)=>s+Math.max(0,+state[k]||0),0);
  else if(!Reel.isOverridden(MOD,'patDetail')&&!typing('patDetail'))state.own=DEFAULTS.own;
  set('apport',V.has.positions,num(V.apport.total));
  set('credits',V.has.patrimoine,num(V.mensualites));
  set('loyers',V.has.patrimoine,num(V.loyers));
}
function syncPills(){
  const Reel=window.Reel,on=Reel&&snapS&&snapS.ready;
  root.querySelectorAll('.src-slot').forEach(s=>{const k=s.dataset.key;s.innerHTML=on?Reel.tag(Reel.kind(MOD,k,!!hasReal[k]),MOD,k):''});
}
function profileBox(){
  const b=$('toise-fp');if(!b||!snapS)return;
  b.hidden=!(snapS.dbOk!==false&&snapS.profilLoaded&&!snapS.profil);
}
/* Décalage de la barre d'onglets de l'App (collante) pour les défilements vers les sous-onglets. */
function barOffset(){const a=root.parentElement&&root.parentElement.querySelector('.app-tabs');return a?a.getBoundingClientRect().height+8:0}

/* ---------- interactions ---------- */
function mount(r){
  root=r;
  if(HASH[location.hash])state.tab=HASH[location.hash];
  root.querySelectorAll('[data-seg]').forEach(g=>g.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const k=g.dataset.seg;state[k]=NUMK.includes(k)?Number(b.dataset.v):b.dataset.v;ov(k);render()})));
  $('inc-unit').addEventListener('change',e=>{const D=derive(),m=D.h.incM;state.incUnit=e.target.value;state.inc=Math.round(fromNetMonthly(m,state.incUnit,D.hb));ov('inc','incUnit');render()});
  $('sal-unit').addEventListener('change',e=>{const m=salToNet(+state.sal||0,state.salUnit);state.salUnit=e.target.value;state.sal=Math.round(salFromNet(m,state.salUnit));ov('sal','salUnit');render()});
  root.querySelectorAll('[data-num]').forEach(i=>{
    i.addEventListener('input',()=>{const v=Number(i.value.replace(/[^\d]/g,''));state[i.dataset.num]=isFinite(v)?v:0;ov(i.dataset.num==='own'?'patDetail':i.dataset.num);render()});
    i.addEventListener('blur',()=>{i.value=nf0.format(Math.round(+state[i.dataset.num]||0))});
    i.addEventListener('focus',()=>{i.value=String(Math.round(+state[i.dataset.num]||0));try{i.select()}catch(e){}});
  });
  root.querySelectorAll('[data-csp]').forEach(s=>s.addEventListener('change',()=>{state.csp=s.value;ov('csp');render()}));
  root.querySelectorAll('[data-dec]').forEach(i=>{
    i.addEventListener('input',()=>{const v=parseFloat(i.value.replace(',','.').replace(/[^\d.]/g,''));state[i.dataset.dec]=isFinite(v)&&v>0?Math.min(v,20):0;render()});
    i.addEventListener('blur',()=>{i.value=state[i.dataset.dec]>0?dec(state[i.dataset.dec],2):''});
  });
  root.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.goto;render();window.scrollTo({top:root.querySelector('.tabs').getBoundingClientRect().top+window.scrollY-barOffset(),behavior:'auto'})}));
  $('detail-btn').addEventListener('click',()=>{
    if(!state.patDetail){const sum=['immo','fin','pro','res'].reduce((s,k)=>s+Math.max(0,+state[k]||0),0);if(Math.abs(sum-state.own)>1){state.immo=state.own;state.fin=0;state.pro=0;state.res=0}}
    else state.own=['immo','fin','pro','res'].reduce((s,k)=>s+Math.max(0,+state[k]||0),0);
    state.patDetail=!state.patDetail;ov('patDetail');render()});
  $('sal-hint-b').addEventListener('click',()=>{const D=derive();state.inc=Math.round(fromNetMonthly(D.sal,state.incUnit,D.hb));ov('inc');state.tab='rev';render()});
  root.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.tab;render();const y=root.querySelector('.tabs').getBoundingClientRect().top+window.scrollY-barOffset();if(window.scrollY>y)window.scrollTo({top:y,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}));
  root.querySelector('.tabs').addEventListener('keydown',e=>{const o=['rev','sal','pat','loan'];if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const i=o.indexOf(state.tab);state.tab=o[(i+(e.key==='ArrowRight'?1:3))%4];render();$('toise-tab-'+state.tab).focus()});
  root.querySelectorAll('details.more').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)render()}));
  $('toise-reset').addEventListener('click',e=>{const b=e.currentTarget;if(b.dataset.armed){const tab=state.tab;if(window.Reel)Reel.clearAll(MOD);Object.assign(state,JSON.parse(JSON.stringify(DEFAULTS)),{tab});applyReal();delete b.dataset.armed;b.textContent='Saisies réinitialisées';setTimeout(()=>{b.textContent='Réinitialiser mes saisies'},2500);render()}else{b.dataset.armed='1';b.textContent='Confirmer : tout effacer ?';setTimeout(()=>{if(b.dataset.armed){delete b.dataset.armed;b.textContent='Réinitialiser mes saisies'}},4000)}});
  /* Pastille « scénario ↺ » : revient à la valeur réelle. */
  root.addEventListener('click',e=>{const b=e.target.closest('[data-reel-reset]');if(!b||!root.contains(b)||!window.Reel)return;e.preventDefault();
    const k=b.dataset.reelReset.split(':').pop();Reel.clear(MOD,k);if(UNIT_OF[k])Reel.clear(MOD,UNIT_OF[k]);applyReal();render()});
  $('amort').addEventListener('pointermove',ev=>{
    if(!amortCtx)return;const{svg,hl,rows,Lm,pw,W,o,L}=amortCtx,b=svg.getBoundingClientRect(),vx=(ev.clientX-b.left)*W/b.width,y=Math.round((vx-Lm)/pw*o.years),tip=$('tip2');
    if(y<0||y>o.years){tip.hidden=true;hl.setAttribute('visibility','hidden');return}
    const r=rows[y],xx=Lm+pw*y/o.years;hl.setAttribute('x1',xx);hl.setAttribute('x2',xx);hl.setAttribute('visibility','visible');
    tip.innerHTML='<div><b></b></div><div class="a"></div><div class="c"></div><div class="d"></div>';
    tip.querySelector('b').textContent=y===0?'À l\'achat':'Après '+y+' an'+(y>1?'s':'');
    tip.querySelector('.a').textContent='Reste à rembourser : '+eur(r.crd+r.ptz)+(r.ptz>0?' (dont PTZ '+eur(r.ptz)+')':'');
    tip.querySelector('.c').textContent='Part qui vous appartient : '+eur(Math.max(0,L.price-r.crd-r.ptz));
    tip.querySelector('.d').textContent='Intérêts déjà payés : '+eur(r.interest);
    tip.hidden=false;const wr=$('amort-wrap').getBoundingClientRect();let left=ev.clientX-wr.left+14;if(left+260>wr.width)left=ev.clientX-wr.left-274;tip.style.left=Math.max(0,left)+'px';tip.style.top=Math.max(0,ev.clientY-wr.top-60)+'px';
  });
  $('amort').addEventListener('pointerleave',()=>{$('tip2').hidden=true;if(amortCtx)amortCtx.hl.setAttribute('visibility','hidden')});
  $('curve').addEventListener('pointermove',ev=>{
    if(!curveCtx)return;const{svg,hl,L,pw,W,xmax,D}=curveCtx;const b=svg.getBoundingClientRect(),vx=(ev.clientX-b.left)*W/b.width,v=(vx-L)/pw*xmax,tip=$('toise-tip');
    if(v<=0||v>xmax){hl.setAttribute('visibility','hidden');tip.hidden=true;return}
    hl.setAttribute('x1',vx);hl.setAttribute('x2',vx);hl.setAttribute('visibility','visible');
    const nv=household(Object.assign({},D.h,{incM:v})).nv,f=assess(D_NV,nv*(1+D.gR.c),{g:D.gR}),cl=D.B[classIndex(D.B,nv)];
    tip.innerHTML='<div><b></b> avant impôt / mois</div><div class="a"></div><div class="d" style="color:var(--muted)"></div>';
    tip.querySelector('b').textContent=eur(v);tip.querySelector('.a').textContent=f.below||f.above?'hors des seuils publiés':nf0.format(Math.round(f.p))+' % des Français vivent avec moins (± '+pts((f.hi-f.lo)/2)+')';tip.querySelector('.d').textContent=cl?cl.n:'';
    tip.hidden=false;const wr=$('curve-wrap').getBoundingClientRect();let left=ev.clientX-wr.left+14;if(left+260>wr.width)left=ev.clientX-wr.left-274;
    tip.style.left=Math.max(0,left)+'px';tip.style.top=Math.max(0,ev.clientY-wr.top-44)+'px';
  });
  $('curve').addEventListener('pointerleave',()=>{$('toise-tip').hidden=true;if(curveCtx)curveCtx.hl.setAttribute('visibility','hidden')});
  (function(){let lastW=0,tm=null;if(!window.ResizeObserver)return;new ResizeObserver(()=>{const w=root.clientWidth;if(!w)return;if(Math.abs(w-lastW)<8)return;const first=lastW===0;lastW=w;if(first)return;clearTimeout(tm);tm=setTimeout(()=>{if(!root.hidden)render()},120)}).observe(root)})();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(!root.hidden)render()});
}

const api={
  mount,
  update(S,visible){snapS=S;applyReal();profileBox();headlineCache=null;if(visible)render();else dirty=true},
  show(){render()},
  headline(){if(headlineCache==null){try{headlineCache=foyerTab(derive())}catch(e){return '–'}}return headlineCache},
};
const reg=()=>App.register("toise",api);
if(window.App)reg();else(window.__pending=window.__pending||[]).push(reg);
})();
