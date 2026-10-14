/* Crédits du moteur de projection (PROJ, spec § 6.4 et § 8) : annuité, tableau d'amortissement mensuel (taux nominal proportionnel,
   échéance constante, assurance sur le capital initial), durée et taux déduits d'un crédit en cours. La capacité d'emprunt (IMMO1)
   et le code de crédit de la Toise (planPret, ptz, taeg) sont ajoutés dans ce fichier à la tâche 7.
   Pur, sans DOM. Global ProjectionCredit ; copié tel quel dans le connecteur (npm run gen). */
(function (root, factory) {
  const O = typeof module === "object" && module.exports ? require("./projection-outils.js") : root.ProjectionOutils;
  const api = factory(O);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ProjectionCredit = api;
})(typeof self !== "undefined" ? self : this, function (O) {
  "use strict";

  /** Annuité (part du capital emprunté) d'un prêt à taux nominal annuel `tauxPct` sur `annees` ans : i / (1 − (1 + i)^−n), i = taux / 12. */
  function annuite(tauxPct, annees) {
    const i = tauxPct / 100 / 12, n = annees * 12;
    return i === 0 ? 1 / n : i / (1 - Math.pow(1 + i, -n));
  }
  /** Échéance mensuelle (hors assurance) d'un capital sur `dureeMois` mois. */
  function echeance(capital, tauxPct, dureeMois) {
    const i = tauxPct / 100 / 12;
    return i === 0 ? capital / dureeMois : capital * i / (1 - Math.pow(1 + i, -dureeMois));
  }

  /** Tableau d'amortissement mensuel. → [{ mois (1…n), date, interets, capital, assurance, echeance (hors assurance), crd }].
      `debut` = date de la première échéance ; date(k) = debut + (k − 1) mois. */
  function amortissement(p) {
    const C = +p.capital, n = Math.round(+p.duree_mois), i = (+p.taux_pct || 0) / 100 / 12;
    if (!(C > 0) || !(n > 0)) return [];
    const ech = echeance(C, +p.taux_pct || 0, n), ass = C * ((+p.assurance_pct || 0) / 100) / 12;
    const out = [];
    let crd = C;
    for (let k = 1; k <= n; k++) {
      const interets = crd * i, cap = k === n ? crd : ech - interets;
      crd = k === n ? 0 : crd - cap;
      out.push({ mois: k, date: p.debut ? O.ajouterMois(p.debut, k - 1) : null, interets, capital: cap, assurance: ass, echeance: ech, crd: Math.max(0, crd) });
    }
    return out;
  }

  /** Nombre de mensualités `m` restant à payer pour solder `crd` à `tauxPct` (CRD d'aujourd'hui, première échéance dans un mois) ;
      null si la mensualité ne couvre pas les intérêts. */
  function dureeRestante(crd, mensualite, tauxPct) {
    if (!(crd > 0)) return 0;
    if (!(mensualite > 0)) return null;
    const i = tauxPct / 100 / 12;
    if (i === 0) return Math.ceil(crd / mensualite - 1e-9);
    if (mensualite <= crd * i) return null;
    return Math.ceil(-Math.log(1 - crd * i / mensualite) / Math.log(1 + i) - 1e-9);
  }
  /** Taux nominal annuel (%) qui solde `crd` en `n` échéances de `mensualite` (dichotomie) ; null si impossible. */
  function tauxDeduit(crd, mensualite, n) {
    if (!(crd > 0) || !(mensualite > 0) || !(n > 0)) return null;
    if (mensualite * n < crd - 1e-6) return null;
    const pv = i => (i === 0 ? mensualite * n : mensualite * (1 - Math.pow(1 + i, -n)) / i);
    let lo = 0, hi = 0.05; // mensuel (60 % par an)
    if (pv(0) <= crd) return 0;
    for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (pv(m) > crd) lo = m; else hi = m; }
    return ((lo + hi) / 2) * 12 * 100;
  }


  /* ------------------------------------------------------------------ code de crédit de la Toise (Pilotage › Rang), déplacé ici sans changer les calculs
     (spec PROJ § 8.3). Les constantes LOAN viennent des repères datés (constantesPret) ; toise.js appelle ces fonctions. */
  const PTZ={res:{A:[49000,73500,88200,102900,117600,132300,147000,161700],B1:[34500,51750,62100,72450,82800,93150,103500,113850],B2:[31500,47250,56700,66150,75600,85050,94500,103950],C:[28500,42750,51300,59850,68400,76950,85500,94050]},
    op:{A:[150000,225000,270000,315000,360000],B1:[135000,202500,243000,283500,324000],B2:[110000,165000,198000,231000,264000],C:[100000,150000,180000,210000,240000]},
    coef:[1,1.5,1.8,2.1,2.4],tr:{A:[25000,31000,37000,49000],B1:[21500,26000,30000,34500],B2:[18000,22500,27000,31500],C:[15000,19500,24000,28500]},
    quot:{coll:[.5,.4,.4,.2],indiv:[.3,.2,.2,.1]},rep:[[10,15],[8,12],[2,13],[0,10]]};
  function ptzInfo(o,eur){
    eur=eur||(v=>Math.round(v)+' €');
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
  function planPret(o,LOAN,eur){
    const R=Math.max(0,o.incM)+LOAN.rentShare*Math.max(0,o.rentM||0),credits=Math.max(0,o.creditsM||0),Mmax=Math.max(0,LOAN.dti*R-credits);
    const a=annuite(o.ratePct,o.years),ins=o.insPct/100/12,g=LOAN.guarantee,dossier=LOAN.dossier,apport=Math.max(0,o.apport);
    const notary=o.bien==='neuf'?LOAN.notaryNeuf:o.primo?LOAN.notaryPrimo:LOAN.notaryAncien;
    let ptz={ok:false,amt:0,monthly:0},C=0,price=0,guar=0;
    const ptzFor=(cost,main)=>o.ptz?ptzInfo(Object.assign({},o.ptz,{cost,mainLoan:main,bien:o.bien,primo:o.primo,years:o.years}),eur):{ok:false,amt:0,monthly:0,why:'non simulé'};
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
  function amortissementAnnuel(L,o){
    const i=o.ratePct/100/12,n=o.years*12,rows=[];let crd=L.C,cumI=0;
    for(let y=0;y<=o.years;y++){
      let ptzCrd=0;if(L.ptz.amt>0){const p=L.ptz;ptzCrd=y<=p.diff?p.amt:Math.max(0,p.amt-p.monthly*12*(y-p.diff))}
      rows.push({y,crd:Math.max(0,crd),ptz:ptzCrd,interest:cumI});
      for(let m=0;m<12&&y<o.years;m++){const int=crd*i;cumI+=int;crd-=L.mens-int}
    }
    return rows;
  }

  /** Constantes de crédit lues dans les repères (liste ou index) : taux du jour par durée (15, 20, 25 ans), taux d'usure par durée, frais d'acquisition,
      garantie, frais de dossier, pondération des loyers, dates. Une valeur absente vaut null (jamais une valeur de secours). */
  function constantesPret(reperes) {
    const idx = Array.isArray(reperes) ? O.indexReperes(reperes) : reperes || {};
    const v = c => (idx[c] ? +idx[c].valeur : null), pct = c => (idx[c] ? +idx[c].valeur / 100 : null);
    const date = c => (idx[c] ? { effet: idx[c].dateEffet || null, fin: idx[c].dateFin || null, titre: idx[c].sourceTitre || null } : null);
    return {
      rates: { 15: v("taux_credit_immo_15"), 20: v("taux_credit_immo_20"), 25: v("taux_credit_immo_25") },
      usure: { 15: v("taux_usure_10_20"), 20: v("taux_usure_20_plus"), 25: v("taux_usure_20_plus") },
      notaryAncien: pct("frais_acquisition_ancien_pct"), notaryPrimo: pct("frais_acquisition_primo_pct"), notaryNeuf: pct("frais_acquisition_neuf_pct"),
      guarantee: pct("garantie_pct"), dossier: v("frais_dossier"), rentShare: pct("revenus_locatifs_ponderation"),
      sources: { taux: date("taux_credit_immo_25"), usure: date("taux_usure_20_plus") },
    };
  }

  return { annuite, echeance, amortissement, dureeRestante, tauxDeduit, PTZ, ptz: ptzInfo, taeg, planPret, amortissementAnnuel, constantesPret };
});
