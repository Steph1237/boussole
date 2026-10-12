(function(){
"use strict";
/* Pilotage › Santé — « Ma situation est-elle saine ? » : bonnes pratiques notées (Pratiques.evaluer, pratiques.js), spec
   docs/superpowers/specs/2026-10-12-cp4-sante-design.md § 3-4.
   En-tête : note globale dans un anneau (role="img"), phrase de synthèse, couverture (« calculée sur 7 critères sur 11 »,
   « provisoire » sous 60 %), date des données (dernière photo ou dernière synchronisation, dateDonnees), « Demander à Claude », puis
   « Ce qui te coûte le plus » : les 3 plus gros points perdus (« N points de ta note globale »), en lignes cliquables qui ouvrent le
   critère. Familles en onglets ARIA (Sécurité, Effort, Allocation, Efficacité) : note, couverture,
   cartes de critère ; poids rappelés une seule fois au-dessus des onglets. Carte : nom, état en mots (bon · à surveiller · à
   travailler · à compléter), jauge horizontale à zones (repere.zones) avec la position de l'utilisateur, mesure en clair, note /20,
   « pourquoi » ; carte « à compléter » grise : ce qui manque et « Compléter avec Claude ». Panneau (UI.panneau), dans l'ordre :
   Ta situation · Pourquoi cette note · Le calcul · Données utilisées (liens vers Patrimoine › Comptes, App.lienCompte) · Pour
   progresser · Ce qui manque · Demander à Claude (expertise adaptée, ClaudePrompts.phrase("expertise", slug)).
   Lien profond : #pilotage/sante?famille=<clé>&critere=<clé> (gardé dans l'URL : PARAMS_DANS_URL, app.js ; lu au show() par
   App.parametres(), puis tenu à jour par history.replaceState quand on change d'onglet ou ouvre un critère).
   Contrat tolérant : les champs du contrat CP4 (mesure, repere, pourquoi, calcul, donnees, ameliorer, manque, source_donnees,
   confiance, statut, points null) sont lus s'ils existent ; sinon repli sur les champs historiques (titre, texte, cible, piste,
   regle, source, details, aCompleter, informatif). Lecture seule, au tutoiement, tout texte des données échappé.
   Fonctions pures exportées (module.exports) : normaliser, ETATS, geometrieJauge, texteJauge, jaugeSvg, carteHtml, couvertureDe,
   verdict, resumeFamille, coutsPrincipaux, enteteHtml, ongletsHtml, panneauHtml, expertiseDe, questionCritere, questionClaude,
   questionPage, phraseCompleter, sectionDe, lienPanneau, hashSante, cibleLien, dateDonnees. */

/* ---------- outils ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const plat=t=>String(t??"").replace(/\s+/g," ").trim();
const num=v=>typeof v==="number"?(isFinite(v)?v:null):(v!=null&&v!==""&&typeof v!=="boolean"&&isFinite(+v)?+v:null);
const NOMBRES=["aucun","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix"];
const nombre=n=>NOMBRES[n]||String(n);
const s_=n=>n>1?"s":"";
function fr(x,dec){
  if(x==null||!isFinite(x)) return "—";
  let s=Math.abs(x).toFixed(dec==null?1:dec);
  if(s.indexOf(".")>=0) s=s.replace(/\.?0+$/,"");
  s=s.replace(".",",").replace(/^(\d+)/,m=>m.replace(/\B(?=(\d{3})+(?!\d))/g," "));
  return (x<0&&s!=="0"?"−":"")+s;
}
const MOIS=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
function dateFr(d){
  const j=typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)?d.split("-").map(Number):null; // jour seul : date locale, sans fuseau
  const x=j?new Date(j[0],j[1]-1,j[2]):d instanceof Date?d:d?new Date(d):null;
  return x&&!isNaN(x)?x.getDate()+(x.getDate()===1?"er":"")+" "+MOIS[x.getMonth()]+" "+x.getFullYear():"";
}
const CHEVRON='<svg class="ui-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>';
const sr=t=>'<span class="ui-sr">'+esc(t)+"</span>";

/* ---------- états ---------- */
/** État d'un critère : mot (jamais la couleur seule), ton (couleur), badge (UI.badge), zone (couleur dite dans le texte de la jauge). */
const ETATS={
  bon:{mot:"bon",ton:"good",badge:"bon",zone:"verte"},
  surveiller:{mot:"à surveiller",ton:"warn",badge:"attention",zone:"orange"},
  travailler:{mot:"à travailler",ton:"crit",badge:"critique",zone:"rouge"},
  a_completer:{mot:"à compléter",ton:"na",badge:"neutre",zone:"grise"},
  info:{mot:"information",ton:"info",badge:"info",zone:"grise"},
};
const ALIAS={good:"bon",warn:"surveiller",crit:"travailler",na:"a_completer",a_surveiller:"surveiller",a_travailler:"travailler",
  acompleter:"a_completer","à compléter":"a_completer","a-completer":"a_completer",informatif:"info",information:"info"};
const statutConnu=s=>{ const k=ALIAS[s]||s; return typeof k==="string"&&ETATS[k]?k:null; };
function statutDe(c){
  if(!c) return "a_completer";
  const s=statutConnu(c.statut);
  if(s) return s;
  if(c.aCompleter) return "a_completer";
  if(c.informatif) return "info";
  const p=num(c.points); if(p==null) return "a_completer";
  const r=p/(num(c.max)||num(c.sur)||20)*20;
  return r>=16?"bon":r>=10?"surveiller":"travailler";
}

/* Valeur d'une donnée utilisée : texte tel quel ; nombre formaté avec son unité (en euros par défaut). */
function valeurDonnee(d){
  const v=d.valeur, u=plat(d.unite);
  if(v==null||v==="") return "";
  if(typeof v!=="number") return plat(v);
  if(!isFinite(v)) return "";
  const unite=u||"€", dec=/€/.test(unite)&&Math.abs(v)>=100?0:2;
  return fr(v,dec)+(unite==="%"?"\u00a0%":" "+unite);
}
/** Critère lu au contrat CP4, avec repli sur les anciens champs. Idempotent. */
function normaliser(c){
  if(c&&c._st) return c;
  c=c||{};
  const statut=statutDe(c), max=num(c.max)||num(c.sur)||20;
  const points=statut==="a_completer"||statut==="info"?null:num(c.points);
  const m=c.mesure&&typeof c.mesure==="object"?c.mesure:null;
  let mesure={valeur:m?num(m.valeur):null,unite:m?plat(m.unite):"",texte:m?plat(m.texte):""};
  if(!m&&statut==="info"&&num(c.valeur)!=null) mesure={valeur:num(c.valeur),unite:"%",texte:fr(num(c.valeur)*100,0)+" %"};
  const r=c.repere&&typeof c.repere==="object"?c.repere:null;
  const zones=(r&&Array.isArray(r.zones)?r.zones:[]).filter(z=>z&&["bon","surveiller","travailler"].includes(statutConnu(z.statut)))
    .map(z=>({jusqua:num(z.jusqua),statut:statutConnu(z.statut)}));
  const liste=v=>(Array.isArray(v)?v:[]).map(x=>plat(typeof x==="string"?x:x&&(x.texte||x.libelle))).filter(Boolean);
  const ameliorer=(Array.isArray(c.ameliorer)?c.ameliorer:[]).map(a=>typeof a==="string"?{action:plat(a),gain_points:null}
    :a&&typeof a==="object"?Object.assign({action:plat(a.action),gain_points:num(a.gain_points)},num(a.gain_note)!=null?{gain_note:num(a.gain_note)}:{}):null).filter(a=>a&&a.action);
  const donnees=(Array.isArray(c.donnees)?c.donnees:[]).filter(d=>d&&typeof d==="object"&&(plat(d.libelle)||d.valeur!=null))
    .map(d=>({libelle:plat(d.libelle),valeur:valeurDonnee(d),lien:d.lien||null,note:plat(d.note)}));
  const tableau=(Array.isArray(c.tableau)?c.tableau:[]).filter(e=>e&&typeof e==="object")
    .map(e=>({libelle:plat(e.libelle||e.groupe),pct:num(e.pct),min:num(e.min),max:num(e.max),ecart:num(e.ecart)})).filter(e=>e.libelle);
  let manque=liste(c.manque);
  if(!manque.length&&statut==="a_completer"&&plat(c.texte)) manque=[plat(c.texte)];
  return {_st:true,cle:String(c.cle??""),famille:String(c.famille??""),nom:plat(c.libelle||c.titre||c.cle),statut,points,max,mesure,
    repere:{texte:plat(r&&r.texte||c.cible),zones},pourquoi:plat(c.pourquoi||(statut==="a_completer"?"":c.texte)),calcul:liste(c.calcul),donnees,ameliorer,manque,
    source_donnees:plat(c.source_donnees),confiance:plat(c.confiance),regle:plat(c.regle),source:plat(c.source),piste:plat(c.piste),
    details:(Array.isArray(c.details)?c.details:[]).filter(d=>d&&d.texte),tableau,lien:typeof c.lien==="string"?c.lien:null,
    expertise:typeof c.expertise==="string"?c.expertise:null,perte:num(c.points_perdus??c.pointsPerdus)};
}

/* ---------- jauge à zones ---------- */
const ZONES_NOTE=[{jusqua:10,statut:"travailler"},{jusqua:16,statut:"surveiller"},{jusqua:null,statut:"bon"}];
const fin=z=>z.jusqua==null?Infinity:z.jusqua;
/** Géométrie de la jauge : { surNote, lo, hi, v, pos (0-1 ou null), actif (statut de la zone de l'utilisateur), segs [{ de, a, statut }] }.
    Zones triées par borne (« jusqu'à », comprise) ; une zone sans borne est ouverte et l'échelle la montre sur 35 % de plus.
    Sans zones : jauge de la note /20 (rouge < 10, orange < 16, vert). null : rien à montrer (pas de note ni de zones). */
function geometrieJauge(c){
  const n=normaliser(c);
  if(n.statut==="a_completer"||n.statut==="info") return null;
  const surNote=!n.repere.zones.length;
  if(surNote&&n.points==null) return null;
  const zones=(surNote?ZONES_NOTE:n.repere.zones).slice().sort((a,b)=>fin(a)-fin(b));
  const v=surNote?n.points/n.max*20:n.mesure.valeur;
  const bornes=zones.map(z=>z.jusqua).filter(x=>x!=null);
  let lo=0,hi=20;
  if(!surNote){
    lo=Math.min(0,bornes.length?bornes[0]:0,v!=null?v:0);
    const der=bornes.length?bornes[bornes.length-1]:null, ouverte=zones[zones.length-1].jusqua==null;
    hi=der==null?(v!=null&&v>lo?lo+(v-lo)*1.5:lo+1):ouverte?der+(der-lo)*0.35:der;
    if(v!=null&&v>hi) hi=v;
    if(!(hi>lo)) hi=lo+1;
  }
  let deb=lo;
  const segs=zones.map((z,i)=>{ const a=i===zones.length-1?hi:Math.min(hi,Math.max(lo,fin(z))); const s={de:deb,a,statut:z.statut}; deb=a; return s; }).filter(s=>s.a>s.de);
  const actif=v==null?null:(zones.find(z=>v<=fin(z))||zones[zones.length-1]).statut;
  return {surNote,lo,hi,v,pos:v==null?null:Math.max(0,Math.min(1,(v-lo)/(hi-lo))),actif,segs};
}
/** Texte équivalent de la jauge : position, zone (couleur et mot), repère. */
function texteJauge(c){
  const n=normaliser(c), g=geometrieJauge(n);
  if(!g) return "";
  const rep=n.repere.texte?" Repère : "+n.repere.texte.replace(/[.\s]+$/,"")+".":"";
  if(g.v==null) return "Position inconnue."+rep;
  const e=ETATS[g.actif];
  const pos=g.surNote?"Note : "+fr(n.points,0)+" sur "+n.max:"Ta position : "+(n.mesure.texte||fr(g.v));
  return pos+", zone "+e.zone+" ("+e.mot+")."+rep;
}
/** Jauge horizontale à zones (SVG) : rôle img et texte équivalent, ou décorative (o.decoratif : carte où mesure et état sont écrits). */
function jaugeSvg(c,o){
  const n=normaliser(c), g=geometrieJauge(n);
  if(!g) return "";
  const W=200,P=4,x=v=>P+(v-g.lo)/(g.hi-g.lo)*(W-2*P), r2=v=>Math.round(v*100)/100;
  const zones=g.segs.map((s,i)=>{
    const x0=x(s.de), x1=x(s.a)-(i<g.segs.length-1?1:0);
    const on=g.v!=null&&s.statut===g.actif&&g.v>=s.de-1e-9&&g.v<=s.a+1e-9;
    return `<rect class="st-z ${s.statut}${on?" on":""}" x="${r2(x0)}" y="7" width="${r2(Math.max(0.5,x1-x0))}" height="8" rx="1.5"/>`;
  }).join("");
  const xp=g.pos==null?null:r2(P+g.pos*(W-2*P));
  const pos=xp==null?"":`<rect class="st-j-halo" x="${r2(xp-2.6)}" y="1" width="5.2" height="20" rx="2"/><rect class="st-j-pos" x="${r2(xp-1.4)}" y="2" width="2.8" height="18" rx="1.4"/>`;
  const svg=`<svg class="st-jauge-svg" viewBox="0 0 ${W} 22" preserveAspectRatio="none" aria-hidden="true" focusable="false">${zones}${pos}</svg>`;
  return o&&o.decoratif?`<span class="st-jauge" aria-hidden="true">${svg}</span>`:`<span class="st-jauge" role="img" aria-label="${esc(texteJauge(n))}">${svg}</span>`;
}

/* ---------- Claude ---------- */
/* Phrases « Compléter avec Claude » (claude-prompts.js : window.ClaudePrompts, ou require sous Node), avec un repli. */
const prompts=()=>(typeof window!=="undefined"&&window&&window.ClaudePrompts)||
  (typeof module==="object"&&module.exports&&typeof require==="function"?require("./claude-prompts.js"):null);
/** Phrase prête pour Claude (section de ClaudePrompts : budget, revenus, protection, risque, objectifs, placements, expertise…). */
function phraseCompleter(section,contexte){
  const P=prompts();
  if(P&&typeof P.phrase==="function") return P.phrase(section,contexte);
  return "Boussole : aide-moi à compléter mon bilan"+(contexte?" ("+plat(contexte)+")":"")+". Commence par demarrer_session, puis utilise les formulaires interactifs Boussole.";
}
/* Section de « Compléter avec Claude » : d'après le critère, sinon d'après la vue où il se complète. */
const SECTION_CRITERE={protection:"protection",endettement:"revenus",frais:"placements"};
const SECTION_ROUTE={"patrimoine/budget":"budget","patrimoine/objectifs":"objectifs","compte/donnees":"revenus","pilotage/risque":"risque","patrimoine/placements":"placements"};
function sectionDe(c){ return (c&&(SECTION_CRITERE[c.cle]||SECTION_ROUTE[c.lien]))||"bilan"; }
const contexteCompleter=n=>"le critère « "+n.nom+" » de mes bonnes pratiques";
/* Expertise adaptée (spec § 4, point 7) : par critère, sinon par famille ; celle fournie par le critère si elle est connue. */
const EXPERTISES={"budget-epargne":"Budget et épargne","allocation-risque":"Allocation et risque","etf-fonds":"ETF et fonds",
  "fiscalite-enveloppes":"Fiscalité et enveloppes","immobilier-credit":"Immobilier et crédit"};
const EXPERTISE_CRITERE={matelas:"budget-epargne",epargne:"budget-epargne",dormant:"budget-epargne",liquidite_objectifs:"budget-epargne",protection:"budget-epargne",
  endettement:"immobilier-credit",apport:"immobilier-credit",adequation:"allocation-risque",concentration:"allocation-risque",geographie:"allocation-risque",
  speculatif:"allocation-risque",devises:"allocation-risque",frais:"etf-fonds",enveloppes:"fiscalite-enveloppes"};
const EXPERTISE_FAMILLE={securite:"budget-epargne",effort:"budget-epargne",allocation:"allocation-risque",efficacite:"etf-fonds"};
function expertiseDe(c){
  if(!c) return "budget-epargne";
  if(c.expertise&&EXPERTISES[c.expertise]) return c.expertise;
  return EXPERTISE_CRITERE[c.cle]||EXPERTISE_FAMILLE[c.famille]||"budget-epargne";
}
/** Question d'un critère, posée après l'activation de l'expertise. */
function questionCritere(c){
  const n=normaliser(c);
  if(n.statut==="a_completer") return "Dans Boussole, le critère « "+n.nom+" » de mes bonnes pratiques est à compléter"+(n.manque.length?" (il manque : "+n.manque.join(", ")+")":"")+". Que dois-je renseigner ?";
  if(n.statut==="info") return "Dans Boussole, l'indicateur « "+n.nom+" » indique : "+(n.mesure.texte||n.pourquoi)+". Qu'est-ce que cela implique pour moi ?";
  return "Dans Boussole, mon critère « "+n.nom+" » est à "+fr(n.points,0)+"/"+n.max+(n.mesure.texte?" ("+n.mesure.texte+")":"")+(n.pourquoi?" : "+n.pourquoi.replace(/[.\s]+$/,""):"")+". Explique-moi le calcul et ce que je pourrais faire.";
}
/** « Demander à Claude » d'un critère : active l'expertise adaptée, puis pose la question du critère. */
function questionClaude(c){
  const n=normaliser(c);
  return phraseCompleter("expertise",expertiseDe(n))+" Ma question : "+questionCritere(n);
}

/* ---------- note, couverture, verdict ---------- */
const comptes=x=>((x&&x.criteres)||[]).map(normaliser).filter(n=>n.statut!=="info");
/** Couverture : { notes, total, part, texte } — critères calculés sur critères comptés (informatifs exclus) ; celle de pratiques.js
    si elle est fournie sous forme { notes, total } (l'ancienne couverture, part du poids des familles, est ignorée). */
function couvertureDe(x){
  const cs=comptes(x);
  let notes=cs.filter(n=>n.statut!=="a_completer").length, total=cs.length;
  const c=x&&x.couverture;
  if(c&&typeof c==="object"){ const a=num(c.notes??c.calcules??c.n), b=num(c.total??c.sur??c.m); if(a!=null&&b!=null&&b>=a){ notes=a; total=b; } }
  const texte=!total?"aucun critère pour le moment":!notes?"pas encore calculée : il manque des données":"calculée sur "+notes+" critère"+s_(notes)+" sur "+total;
  return {notes,total,part:total?notes/total:0,texte};
}
const classeTotal=t=>t>=80?"good":t>=60?"warn":"crit";
const MOT_TOTAL={good:"bon",warn:"à surveiller",crit:"à travailler"};
const aNote=r=>!!(r&&(r.familles||[]).some(f=>f.total!=null));
/** Verdict en une phrase : { note ("78" ou "—"), label (Solide · Correct · À consolider · Provisoire · ""), phrase, ton, provisoire }.
    Seuils 80 et 60 ; provisoire sous 60 % de critères calculés. */
function verdict(r){
  if(!r) return {note:"—",label:"",phrase:"Le score n'est pas disponible dans cette vue.",ton:"",provisoire:false};
  if(!aNote(r)) return {note:"—",label:"",phrase:"Pas encore de note : complète ton budget, ton profil et tes placements avec Claude pour la calculer.",ton:"",provisoire:false};
  const t=Math.round(num(r.total)||0), cov=couvertureDe(r);
  if(cov.part<0.6) return {note:String(t),label:"Provisoire",ton:"",provisoire:true,
    phrase:"Note provisoire, calculée sur une partie de tes critères : complète les données manquantes pour une note fiable."};
  const aT=comptes(r).filter(n=>n.statut==="surveiller"||n.statut==="travailler").length;
  const reste=aT?", avec "+nombre(aT)+" point"+s_(aT)+" à travailler":"";
  const label=t>=80?"Solide":t>=60?"Correct":"À consolider";
  const phrase=t>=80?"Oui, ta situation est solide"+reste+".":t>=60?"Dans l'ensemble, oui : ta situation est correcte"+reste+".":"Pas encore : ta situation est à consolider"+reste+".";
  return {note:String(t),label,phrase,ton:classeTotal(t),provisoire:false};
}
/** Résumé d'une famille : { note, ton, mot, couverture }. */
function resumeFamille(f){
  const t=f&&f.total!=null?Math.round(f.total):null, ton=t==null?"na":classeTotal(t);
  return {note:t==null?"—":String(t),ton,mot:t==null?"à compléter":MOT_TOTAL[ton],couverture:couvertureDe(f)};
}

/* ---------- ce qui te coûte le plus ---------- */
const lesPratiques=()=>(typeof window!=="undefined"&&window&&window.Pratiques)||null;
/* Points perdus sur la note globale : (max − points) ÷ (max × critères notés de la famille) × 100 × poids ÷ poids des familles notées. */
function pertesLocales(r){
  const notees=(r.familles||[]).filter(f=>f&&f.total!=null), poids=notees.reduce((a,f)=>a+(num(f.poids)||0),0), out=[];
  if(!(poids>0)) return out;
  notees.forEach(f=>{
    const cs=(f.criteres||[]).map(normaliser).filter(n=>n.points!=null);
    cs.forEach(n=>out.push({n,points:n.perte!=null?n.perte:(n.max-n.points)/(n.max*cs.length)*100*(num(f.poids)||0)/poids}));
  });
  return out;
}
/** Les `nb` (3) plus gros points perdus : [{ cle, nom, points, action }]. Dans l'ordre : P.coutsPrincipaux(r, nb) (module injecté),
    r.couts (Pratiques.evaluer), window.Pratiques.coutsPrincipaux (P non fourni), sinon calcul local (même règle). */
function coutsPrincipaux(r,P,nb){
  nb=nb||3;
  if(!r) return [];
  const crit=k=>(r.criteres||[]).find(c=>c&&c.cle===k)||null;
  const action=n=>((n.ameliorer.find(a=>a.gain_points>0)||n.ameliorer[0]||{}).action)||n.piste||"";
  const appel=M=>{ if(!M||typeof M.coutsPrincipaux!=="function") return null; try{ const x=M.coutsPrincipaux(r,nb); return Array.isArray(x)?x:null; }catch(e){ return null; } };
  const src=appel(P)||(Array.isArray(r.couts)?r.couts:Array.isArray(r.coutsPrincipaux)?r.coutsPrincipaux:null)||(P===undefined?appel(lesPratiques()):null);
  const liste=src?src.filter(x=>x&&typeof x==="object").map(x=>{
    const n=normaliser(crit(x.cle)||x.critere||x);
    return {cle:String(x.cle||n.cle),nom:plat(x.libelle||x.titre)||n.nom,points:num(x.points_perdus??x.pointsPerdus??x.perte),action:plat(x.action)||action(n)};
  }):pertesLocales(r).map(({n,points})=>({cle:n.cle,nom:n.nom,points,action:action(n)}));
  return liste.filter(x=>x.cle&&x.points>0.05).sort((a,b)=>b.points-a.points).slice(0,nb)
    .map(x=>Object.assign(x,{points:Math.round(x.points*10)/10}));
}

/* ---------- en-tête ---------- */
/** Date des données (AAAA-MM-JJ) : la plus récente entre la dernière photo du patrimoine (snapshots[].date) et la dernière
    synchronisation bancaire (banque.connexions[].derniereSynchro) ; null si aucune. C'est elle que l'en-tête affiche, pas l'heure du
    calcul (refait à chaque émission du store). */
function dateDonnees(S){
  const jour=v=>{
    if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
    if(v.length===10) return v;
    const x=new Date(v);
    if(isNaN(x)) return v.slice(0,10);
    return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0");
  };
  const L=[...((S&&Array.isArray(S.snapshots))?S.snapshots:[]).map(x=>jour(x&&x.date)),
    ...((S&&S.banque&&Array.isArray(S.banque.connexions))?S.banque.connexions:[]).map(c=>jour(c&&c.derniereSynchro))].filter(Boolean).sort();
  return L.length?L[L.length-1]:null;
}
function anneauHtml(v){
  const R=52,C=2*Math.PI*R, pct=v.note==="—"?0:Math.max(0,Math.min(100,+v.note)), ton=v.ton||"na";
  const label=v.note==="—"?"Note globale : pas encore calculée":"Note globale : "+v.note+" sur 100"+(v.label?", "+v.label.toLowerCase():"");
  return `<div class="st-anneau" role="img" aria-label="${esc(label)}"><svg class="st-anneau-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">`+
    `<circle class="st-anneau-fond" cx="60" cy="60" r="${R}"/>`+
    (pct>0?`<circle class="st-anneau-arc ${ton}" cx="60" cy="60" r="${R}" stroke-dasharray="${(C*pct/100).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 60 60)"/>`:"")+
    `</svg><span class="st-anneau-val" aria-hidden="true"><span><span class="st-big num">${esc(v.note)}</span>${v.note==="—"?"":'<span class="st-sur">/100</span>'}</span></span></div>`;
}
const TON_BADGE={good:"bon",warn:"attention",crit:"critique"};
/** En-tête : anneau, verdict, couverture (provisoire), date des données (« données du … »), Claude, puis « Ce qui te coûte le plus »
    (3 lignes → panneau, chacune avec les points de la note globale en jeu). o = { date (dateDonnees), P (module Pratiques ; null : calcul
    local des pertes) }. */
function enteteHtml(r,U,o){
  o=o||{};
  const v=verdict(r), cov=couvertureDe(r), date=dateFr(r&&(r.calcule_le||r.date)||o.date);
  const badge=v.label&&!v.provisoire?`<span class="ui-badge ${TON_BADGE[v.ton]||"neutre"}">${esc(v.label)}</span>`:"";
  const couv=aNote(r)?`<p class="st-couv">${esc(cov.texte.charAt(0).toUpperCase()+cov.texte.slice(1))}${v.provisoire?' <span class="ui-badge attention">provisoire</span>':""}${date?'<span class="st-date"> · données du '+esc(date)+"</span>":""}</p>`:"";
  const claude=r&&U?`<div class="st-claude">${U.demanderAClaude(questionPage(r))}</div>`:"";
  const tete=`<div class="st-tete">${anneauHtml(v)}<div class="st-tete-txt"><p class="st-question">Ma situation est-elle saine ? ${badge}</p>`+
    `<p class="st-verdict ${v.ton}" id="santeVerdict" tabindex="-1">${esc(v.phrase)}</p>${couv}${claude}</div></div>`;
  if(!aNote(r)) return tete;
  const cs=coutsPrincipaux(r,o.P);
  const corps=cs.length?'<ol class="st-couts-liste">'+cs.map(x=>`<li><button type="button" class="st-cout" data-ui-carte="${esc(x.cle)}" data-st-cout="${esc(x.cle)}" aria-haspopup="dialog">`+
      `<span class="st-cout-haut"><span class="st-cout-nom">${esc(x.nom)}</span><span class="st-cout-pts num">${esc(fr(x.points,x.points>=10?0:1))} point${x.points>=2?"s":""} de ta note globale</span></span>`+
      (x.action?`<span class="st-cout-action">${esc(x.action)}</span>`:"")+`<span class="st-cout-ouvrir">${CHEVRON}</span></button></li>`).join("")+"</ol>"
    :'<p class="st-vide">Rien ne te coûte de points pour le moment : tes critères calculés sont tous au maximum.</p>';
  return tete+`<div class="st-couts"><h3 class="st-h3" id="santeCoutsT">Ce qui te coûte le plus</h3>${corps}</div>`;
}

/* ---------- cartes et onglets ---------- */
const noteHtml=n=>n.points==null?"":`<span class="st-note num">${sr("Note : ")}${esc(fr(n.points,0))}<span class="st-sur">/${esc(n.max)}</span></span>`;
/** Carte d'un critère : bouton (data-ui-carte) qui ouvre le panneau ; « Compléter avec Claude » hors du bouton pour une carte grise. */
function carteHtml(c,U){
  const n=normaliser(c), e=ETATS[n.statut], cle=esc(n.cle);
  const tete=`<span class="st-carte-tete"><span class="st-carte-nom">${esc(n.nom)}</span><span class="ui-badge ${e.badge} st-etat">${esc(e.mot)}</span></span>`;
  const btn=`<button type="button" class="st-carte-btn" data-ui-carte="${cle}" data-st-carte="${cle}" aria-haspopup="dialog">`;
  const ouvrirIco=`<span class="st-carte-ouvrir">${CHEVRON}</span>`;
  if(n.statut==="a_completer"){
    const manque=n.manque[0]||"une donnée pour calculer ce critère.";
    return `<div class="st-carte na" data-st-critere="${cle}">${btn}${tete}<span class="st-carte-manque"><span class="st-lbl">Il manque</span> ${esc(manque)}</span>${ouvrirIco}</button>`+
      `<div class="st-carte-actions">${U?U.demanderAClaude(phraseCompleter(sectionDe(n),contexteCompleter(n)),"Compléter avec Claude"):""}</div></div>`;
  }
  const mesure=n.mesure.texte?`<span class="st-mesure">${esc(n.mesure.texte)}</span>`:"";
  const chiffres=mesure||n.points!=null?`<span class="st-carte-chiffres">${mesure}${noteHtml(n)}</span>`:"";
  return `<div class="st-carte ${e.ton}" data-st-critere="${cle}">${btn}${tete}${jaugeSvg(n,{decoratif:true})}${chiffres}`+
    (n.pourquoi?`<span class="st-carte-pourquoi">${esc(n.pourquoi)}</span>`:"")+`${ouvrirIco}</button></div>`;
}
/** Familles en onglets ARIA (role tablist / tab / tabpanel) ; poids rappelés une seule fois ; cartes à compléter en fin d'onglet. */
function ongletsHtml(r,actif,U){
  const fams=(r&&r.familles)||[];
  if(!fams.length) return "";
  const a=fams.some(f=>f.cle===actif)?actif:fams[0].cle;
  const tabs=fams.map(f=>{
    const on=f.cle===a, k=esc(f.cle), rf=resumeFamille(f);
    return `<button type="button" role="tab" class="st-onglet" id="st-tab-${k}" aria-controls="st-pan-${k}" aria-selected="${on}" tabindex="${on?0:-1}" data-st-onglet="${k}">`+
      `<span class="st-onglet-nom">${esc(f.titre)}</span><span class="st-onglet-note num ${rf.ton}">${esc(rf.note)}${rf.note==="—"?sr(" pas de note"):sr(" sur 100")}</span></button>`;
  }).join("");
  const poids=`<p class="st-poids">Poids de chaque famille dans la note globale : ${fams.map(f=>esc(f.titre)+" "+esc(f.poids)+"\u00a0%").join(" · ")}.</p>`;
  const pans=fams.map(f=>{
    const on=f.cle===a, k=esc(f.cle), rf=resumeFamille(f), cs=(f.criteres||[]).map(normaliser);
    const ordre=cs.filter(n=>n.statut!=="a_completer").concat(cs.filter(n=>n.statut==="a_completer"));
    const cartes=ordre.length?`<div class="st-cartes">${ordre.map(n=>carteHtml(n,U)).join("")}</div>`:'<p class="st-vide">Aucun critère pour le moment.</p>';
    return `<div role="tabpanel" class="st-fam" id="st-pan-${k}" aria-labelledby="st-tab-${k}" tabindex="0" data-st-fam="${k}"${on?"":" hidden"}>`+
      `<div class="st-fam-tete"><p class="st-fam-note num ${rf.ton}">${esc(rf.note)}${rf.note==="—"?"":'<span class="st-sur">/100</span>'}</p>`+
      `<p class="st-fam-sous"><span class="ui-badge ${rf.ton==="na"?"neutre":TON_BADGE[rf.ton]}">${esc(rf.mot)}</span> ${esc(rf.couverture.texte)}</p></div>${cartes}</div>`;
  }).join("");
  return `<div class="st-onglets" role="tablist" aria-label="Familles de critères">${tabs}</div>${poids}${pans}`;
}

/* ---------- panneau d'un critère ---------- */
const lienCompteDefaut=()=>(typeof window!=="undefined"&&window&&window.App&&typeof window.App.lienCompte==="function"&&window.App.lienCompte)||
  (typeof module==="object"&&module.exports&&typeof require==="function"?(()=>{ try{ return require("./app.js").lienCompte; }catch(e){ return null; } })():null);
/** href d'une donnée : cible d'une fiche de Patrimoine › Comptes ({ ligne } | { enveloppe, titulaire? } | { courant }) via
    App.lienCompte, ou route interne « espace/sous-vue?… » ; rien d'autre (ni lien externe ni autre schéma). */
function hrefDonnee(l,lienCompte){
  if(!l) return null;
  let route;
  if(typeof l==="object"){ const f=lienCompte||lienCompteDefaut(); route=f?f(l):"patrimoine/comptes"; }
  else route=String(l);
  route=String(route||"").replace(/^#/,"");
  return /^[a-z]+\/[a-z0-9-]+(\?[\w.~%=&-]*)?$/i.test(route)?"#"+route:null;
}
const CONFIANCE={partielle:"données partielles",absente:"données absentes"};
/** Contenu du panneau (HTML échappé), dans l'ordre de la spec ; sections vides omises (sauf Ta situation et Pourquoi cette note).
    o = { lienCompte } (par défaut App.lienCompte). */
function panneauHtml(c,U,o){
  o=o||{};
  const n=normaliser(c), e=ETATS[n.statut];
  const sec=(t,h)=>h?`<section class="st-p-sec"><h3 class="st-p-h">${esc(t)}</h3>${h}</section>`:"";
  // 1. Ta situation : mesure, note, état, jauge.
  let situ;
  if(n.statut==="a_completer") situ=`<div class="st-p-tete">${n.mesure.texte?`<span class="st-p-mesure">${esc(n.mesure.texte)}</span>`:""}<span class="ui-badge neutre">${esc(e.mot)}</span></div>${n.pourquoi?"":'<p class="st-p-txt">Pas encore de note : il manque des données.</p>'}`;
  else situ=`<div class="st-p-tete">${n.mesure.texte?`<span class="st-p-mesure">${esc(n.mesure.texte)}</span>`:""}`+
    (n.points!=null?`<span class="st-p-note num">${sr("Note : ")}${esc(fr(n.points,0))}<span class="st-sur">/${esc(n.max)}</span></span>`:"")+
    `<span class="ui-badge ${e.badge}">${esc(e.mot)}</span></div>`+jaugeSvg(n);
  const meta=[n.source_donnees?"Source : "+n.source_donnees:"",CONFIANCE[n.confiance]||""].filter(Boolean);
  if(meta.length) situ+=`<p class="st-p-meta">${esc(meta.join(" · "))}</p>`;
  // 2. Pourquoi cette note : la raison, les points d'attention, le repère (barème) et sa source.
  const det=n.details.length?'<ul class="st-p-det">'+n.details.map(d=>`<li class="${esc(d.statut||"")}">${esc(d.texte)}</li>`).join("")+"</ul>":"";
  const pourquoi=(n.pourquoi?`<p class="st-p-pourquoi">${esc(n.pourquoi)}</p>`:"")+det+
    (n.repere.texte?`<p class="st-p-repere"><b>Repère</b> ${esc(n.repere.texte)}</p>`:"")+
    (n.source?`<p class="st-p-source">Source du repère : ${esc(n.source)}</p>`:"");
  // 3. Le calcul avec tes chiffres (sinon la règle).
  const pc=v=>v==null?"—":fr(v,1)+"\u00a0%";
  const tableau=n.tableau.length?'<div class="st-p-tab-boite"><table class="st-p-tab"><caption class="ui-sr">Ton allocation par classe, comparée à la fourchette de ton profil</caption>'+
    '<thead><tr><th scope="col">Classe</th><th scope="col">Toi</th><th scope="col">Profil</th><th scope="col">Écart</th></tr></thead><tbody>'+
    n.tableau.map(t=>`<tr><th scope="row">${esc(t.libelle)}</th><td class="num">${esc(pc(t.pct))}</td><td class="num">${t.min==null||t.max==null?"—":esc(fr(t.min,0)+" à "+fr(t.max,0)+"\u00a0%")}</td>`+
      `<td class="num${t.ecart?" hors":""}">${t.ecart==null?"—":t.ecart?esc((t.ecart>0?"+":"")+fr(t.ecart,1)+" pt"+(Math.abs(t.ecart)>=2?"s":"")):"dans la fourchette"}</td></tr>`).join("")+"</tbody></table></div>":"";
  const calcul=tableau+(n.calcul.length?'<ol class="st-p-calcul">'+n.calcul.map(t=>`<li>${esc(t)}</li>`).join("")+"</ol>"
    :n.regle?`<p class="st-p-txt">${esc(n.regle)}</p>`:"");
  // 4. Données utilisées, avec lien vers leur fiche.
  const donnees=n.donnees.length?'<ul class="st-p-donnees">'+n.donnees.map(d=>{
    const h=hrefDonnee(d.lien,o.lienCompte);
    return `<li><span class="st-d-lib">${esc(d.libelle)}${d.note?`<span class="st-d-note">${esc(d.note)}</span>`:""}</span><span class="st-d-val num">${esc(d.valeur)}</span>`+
      (h?`<a class="st-d-lien" href="${esc(h)}">Voir la fiche${sr(" "+d.libelle)}</a>`:"")+"</li>";
  }).join("")+"</ul>":"";
  // 5. Pour progresser : actions et points gagnés (sinon la piste).
  const prog=n.ameliorer.length?'<ul class="st-p-ameliorer">'+n.ameliorer.map(a=>`<li><span>${esc(a.action)}</span>`+
      (a.gain_points!=null&&a.gain_points>0?`<span class="st-gain num">+${esc(fr(a.gain_points,a.gain_points>=10?0:1))} pts</span>`+
        (a.gain_note>0?`<span class="st-gain-note">soit +${esc(fr(a.gain_note,1))} sur la note globale</span>`:""):"")+"</li>").join("")+"</ul>"
    :n.piste&&n.statut!=="a_completer"?`<p class="st-p-txt">${esc(n.piste)}</p>`:"";
  // 6. Ce qui manque.
  const manque=n.manque.length?'<ul class="st-p-manque">'+n.manque.map(t=>`<li>${esc(t)}</li>`).join("")+"</ul>"+
    (n.statut==="a_completer"&&n.piste&&!n.ameliorer.length?`<p class="st-p-txt">${esc(n.piste)}</p>`:""):"";
  // 7. Demander à Claude, avec l'expertise adaptée (« Compléter avec Claude » pour un critère à compléter).
  const slug=expertiseDe(n);
  const claude=U?(n.statut==="a_completer"
    ?`<p class="st-p-txt">Claude te pose les questions dans un formulaire, puis tu valides ses propositions dans Agent › Propositions.</p><div class="st-p-claude">${U.demanderAClaude(phraseCompleter(sectionDe(n),contexteCompleter(n)),"Compléter avec Claude")}</div>`
    :`<p class="st-p-txt">Claude consulte l'expertise « ${esc(EXPERTISES[slug])} » avec tes chiffres et t'explique cette note.</p><div class="st-p-claude">${U.demanderAClaude(questionClaude(n))}</div>`):"";
  return sec("Ta situation",situ)+sec("Pourquoi cette note",pourquoi||'<p class="st-p-txt">Pas d\'explication disponible pour ce critère.</p>')+
    sec("Le calcul",calcul)+sec("Données utilisées",donnees)+sec("Pour progresser",prog)+sec("Ce qui manque",manque)+sec("Demander à Claude",claude);
}

/* ---------- liens ---------- */
const LIEN_LABEL={"patrimoine/budget":"Voir le budget","patrimoine/objectifs":"Voir les objectifs","compte/donnees":"Voir tes données",
  "patrimoine/placements":"Voir les placements","pilotage/risque":"Voir le profil de risque","aujourdhui/vue":"Voir Aujourd'hui","agent/connexion":"Connecter Claude"};
const DESTINATION={"patrimoine/budget":"Patrimoine › Budget","patrimoine/objectifs":"Patrimoine › Objectifs","compte/donnees":"Compte › Données",
  "patrimoine/placements":"Patrimoine › Placements","pilotage/risque":"Pilotage › Risque","aujourdhui/vue":"Aujourd'hui","agent/connexion":"Agent › Connexion"};
/** Lien du pied du panneau, vers la vue concernée ; aucun pour un critère au vert ou informatif. */
function lienPanneau(c){
  const n=normaliser(c), r=n.lien;
  if(!r||!(n.statut==="a_completer"||n.statut==="surveiller"||n.statut==="travailler")) return null;
  return {label:n.statut==="a_completer"?(LIEN_LABEL[r]||"Voir le détail"):"Où agir : "+(DESTINATION[r]||r),href:"#"+r};
}
/** Question de la page. */
function questionPage(r){
  const v=verdict(r);
  if(v.note==="—") return "Aide-moi à compléter mon bilan dans Boussole pour calculer ma note de bonnes pratiques.";
  return "Ma note de bonnes pratiques dans Boussole est de "+v.note+"/100"+(v.provisoire?" (provisoire)":"")+" : explique-la-moi simplement et dis-moi ce que je devrais travailler en premier.";
}
/** Hash du lien profond : #pilotage/sante?famille=<clé>&critere=<clé>. */
function hashSante(famille,critere){
  const p=[];
  if(famille) p.push("famille="+encodeURIComponent(famille));
  if(critere) p.push("critere="+encodeURIComponent(critere));
  return "#pilotage/sante"+(p.length?"?"+p.join("&"):"");
}
/** Cible d'un lien profond : { famille, critere } valides (la famille du critère prime ; sans résultat, une famille connue est gardée). */
const FAMILLES_CLES=["securite","effort","allocation","efficacite"];
function cibleLien(r,p){
  p=p||{};
  const c=r&&p.critere?(r.criteres||[]).find(x=>x&&x.cle===String(p.critere)):null;
  if(c) return {famille:c.famille,critere:c.cle};
  const fams=r&&r.familles?r.familles.map(f=>f.cle):FAMILLES_CLES;
  return {famille:p.famille&&fams.includes(String(p.famille))?String(p.famille):null,critere:null};
}

const PURE={normaliser,ETATS,geometrieJauge,texteJauge,jaugeSvg,carteHtml,couvertureDe,verdict,resumeFamille,coutsPrincipaux,enteteHtml,ongletsHtml,
  panneauHtml,expertiseDe,questionCritere,questionClaude,questionPage,phraseCompleter,sectionDe,lienPanneau,hashSante,cibleLien,dateDonnees};
if(typeof module==="object"&&module.exports){ module.exports=PURE; }
if(typeof document==="undefined") return;

/* ---------- vue ---------- */
let S={scope:"foyer",people:[],positions:[],config:null,profil:null,budget:null,objectifs:[],risque:null,classes:{}};
let root=null,dirty=true,recu=false,last=null,dateDonneesS=null,actif="securite",lien=null,ouvertId=null,retourEl=null,sigPanneau="",sigLien="",corpsPanneau=null;
const sig={tete:"",fam:""};
const $=id=>root.querySelector("#"+id);
const U=()=>window.UI||null;
const DEFAULT_NOMS={p1:"Moi",p2:"Conjoint(e)"};
function nomOf(id){ const p=(S.people||[]).find(x=>x.id===id); return (p&&p.nom)||DEFAULT_NOMS[id]||id; }
function scopeDe(){ return S.scope==="foyer"?"du foyer":window.Calc.deNom(nomOf(S.scope),S.scope==="p2"?2:1); }

function calcule(){
  if(!window.Pratiques||typeof window.Pratiques.evaluer!=="function") return null;
  try{ return window.Pratiques.evaluer({positions:S.positions,profil:S.profil,config:S.config,budget:S.budget,objectifs:S.objectifs,scope:S.scope,risque:S.risque,classes:S.classes,banque:S.banque||null,today:new Date()}); }
  catch(e){ console.error("bonnes pratiques",e); return null; }
}
/* Rien n'est réécrit (ni focus perdu) quand le HTML n'a pas changé. */
const ecrire=(id,cle,h)=>{ if(sig[cle]!==h){ sig[cle]=h; $(id).innerHTML=h; } };
/* URL tenue à jour (sans entrée d'historique) tant que Santé est la vue affichée. */
function majUrl(critere){
  try{
    if(typeof location==="undefined"||typeof history==="undefined"||typeof history.replaceState!=="function") return;
    if(!/^#pilotage\/sante(\?|$)/.test(location.hash||"")) return;
    const h=hashSante(actif,critere);
    if(location.hash!==h) history.replaceState(history.state,"",h);
  }catch(e){ /* URL non modifiable : sans effet */ }
}

function render(){
  const r=last, u=U();
  $("santeTitle").textContent="Bonnes pratiques "+scopeDe();
  if(r&&r.familles&&r.familles.length&&!r.familles.some(f=>f.cle===actif)) actif=r.familles[0].cle;
  /* Date des données (dernière photo, dernière synchronisation) : pas l'heure du calcul, refait à chaque émission du store. */
  ecrire("santeEntete","tete",enteteHtml(r,u,{date:dateDonneesS}));
  $("santeFamSec").hidden=!(r&&u);
  ecrire("santeFamilles","fam",r&&u?ongletsHtml(r,actif,u):"");
  rafraichirPanneau();
}

/* ---------- onglets ---------- */
const onglets=()=>Array.from(root.querySelectorAll('[role="tab"]'));
function choisir(k,focus){
  const u=U();
  if(!last||!last.familles.some(f=>f.cle===k)) return;
  actif=k;
  onglets().forEach(t=>{ const on=t.getAttribute("data-st-onglet")===k; t.setAttribute("aria-selected",String(on)); t.setAttribute("tabindex",on?"0":"-1"); if(on&&focus) t.focus(); });
  Array.from(root.querySelectorAll('[role="tabpanel"]')).forEach(p=>{ p.hidden=p.getAttribute("data-st-fam")!==k; });
  /* Le HTML mémorisé suit l'onglet choisi : le prochain rendu ne réécrit rien s'il n'a pas changé. */
  if(u) sig.fam=ongletsHtml(last,actif,u);
}
function toucheSuivante(key,i,n){
  const u=U();
  if(u&&typeof u.cibleClavier==="function") return u.cibleClavier(key,i,n,false);
  return key==="ArrowRight"?(i+1)%n:key==="ArrowLeft"?(i-1+n)%n:key==="Home"?0:key==="End"?n-1:null;
}

/* ---------- panneau d'un critère ---------- */
const critere=cle=>(last&&last.criteres.find(c=>c.cle===cle))||null;
const carteDe=cle=>root&&cle!=null?root.querySelector('[data-st-carte="'+CSS.escape(String(cle))+'"]'):null;
const optionsPanneau=(c,u)=>({titre:normaliser(c).nom,contenu:panneauHtml(c,u),lien:lienPanneau(c)});
function ouvrir(cle,el){
  const u=U(), c=critere(cle);
  if(!u||!c) return;
  if(c.famille&&c.famille!==actif) choisir(c.famille,false);
  ouvertId=cle; retourEl=el||carteDe(cle);
  const o=optionsPanneau(c,u); sigPanneau=o.contenu+"|"+o.titre; sigLien=JSON.stringify(o.lien);
  corpsPanneau=u.panneau.ouvrir(Object.assign(o,{retour:retourEl,surFermeture:fermeture}));
  majUrl(cle);
}
/* Réécrit le corps d'un panneau ouvert sans voler le focus : focus rendu à l'élément de même rang s'il était dans le corps. */
const FOCALISABLES="a[href],button,summary,input,select,textarea,[tabindex]";
function reecrireCorps(corps,html){
  const a=document.activeElement, dedans=!!a&&a!==corps&&corps.contains(a);
  const i=dedans?Array.from(corps.querySelectorAll(FOCALISABLES)).indexOf(a):-1;
  corps.innerHTML=html;
  if(!dedans) return;
  const f=Array.from(corps.querySelectorAll(FOCALISABLES)), n=f[Math.min(Math.max(i,0),f.length-1)];
  const t=corps.parentNode&&corps.parentNode.querySelector(".ui-panneau-titre");
  if(n) n.focus(); else if(t) t.focus();
}
/* Le store a émis pendant l'ouverture : corps, titre et lien mis à jour s'ils ont changé, sans rouvrir le panneau. */
function rafraichirPanneau(){
  const u=U();
  if(!ouvertId||!u||!u.panneau.ouvert()) return;
  const c=critere(ouvertId);
  if(!c){ u.panneau.fermer({focus:false}); return; }
  const o=optionsPanneau(c,u), s=o.contenu+"|"+o.titre, l=JSON.stringify(o.lien);
  if(s===sigPanneau&&l===sigLien) return;
  if(!corpsPanneau||!corpsPanneau.isConnected){ sigPanneau=s; sigLien=l; corpsPanneau=u.panneau.ouvrir(o); return; }
  if(s!==sigPanneau){
    reecrireCorps(corpsPanneau,o.contenu);
    const pan=corpsPanneau.parentNode, t=pan&&pan.querySelector(".ui-panneau-titre");
    if(t&&t.textContent!==o.titre) t.textContent=o.titre;
  }
  if(l!==sigLien&&typeof u.panneau.remplacer==="function") u.panneau.remplacer({lien:o.lien,pied:null});
  sigPanneau=s; sigLien=l;
}
/* Fermeture : focus rendu à l'élément d'origine ; si la page a été redessinée, à la carte du même critère, sinon au verdict.
   Fermé sans reprise du focus (lien suivi, retour arrière) : l'URL n'est pas touchée. */
function fermeture(o){
  const cle=ouvertId, el=retourEl;
  ouvertId=null; retourEl=null; sigPanneau=""; sigLien=""; corpsPanneau=null;
  if((o&&o.focus===false)||!root) return;
  majUrl(null);
  if(el&&el.isConnected) return;
  const c=carteDe(cle)||(cle!=null?root.querySelector('[data-st-cout="'+CSS.escape(String(cle))+'"]'):null);
  if(c) c.focus(); else { const v=$("santeVerdict"); if(v) v.focus(); }
}
/* Lien profond en attente : appliqué dès que le résultat est là. */
function appliquerLien(){
  if(!lien||!last) return;
  const p=lien; lien=null;
  const t=cibleLien(last,p);
  if(t.famille) choisir(t.famille,false);
  if(t.critere) ouvrir(t.critere,carteDe(t.critere)); else majUrl(null);
}

function mount(r){
  root=r;
  root.addEventListener("click",e=>{
    const t=e.target&&e.target.closest?e.target.closest("[data-st-onglet]"):null;
    if(t&&root.contains(t)){ choisir(t.getAttribute("data-st-onglet"),false); majUrl(null); }
  });
  root.addEventListener("keydown",e=>{
    const t=e.target&&e.target.closest?e.target.closest('[role="tab"]'):null;
    if(!t||!root.contains(t)) return;
    const ts=onglets(), j=toucheSuivante(e.key,ts.indexOf(t),ts.length);
    if(j==null) return;
    e.preventDefault();
    choisir(ts[j].getAttribute("data-st-onglet"),true); majUrl(null);
  });
  const u=U(); if(u) u.brancher(root,{surCarte:(id,el)=>ouvrir(id,el)});
}
function update(snap,visible){
  snap=snap||{};
  S={scope:snap.scope||"foyer",people:snap.people||[],positions:snap.positions||[],config:snap.config,profil:snap.profil||null,budget:snap.budget||null,
    objectifs:snap.objectifs||[],risque:snap.risque||null,classes:snap.classes||{},banque:snap.banque||null};
  last=calcule(); dateDonneesS=dateDonnees(snap); dirty=true; recu=true;
  if(visible){ render(); dirty=false; appliquerLien(); } else lien=null;
}
function show(){
  const p=window.App&&typeof App.parametres==="function"?App.parametres():{};
  if(p&&(p.famille||p.critere)) lien={famille:p.famille||null,critere:p.critere||null};
  /* Avant les premières données : « Chargement… » reste affiché. */
  if(dirty&&recu){ render(); dirty=false; }
  appliquerLien();
}
/* Chiffre clé : « 90/100 », ou « – » tant qu'aucune famille n'est notée. */
function headline(){ return last&&last.familles.some(f=>f.total!=null)?last.total+"/100":"–"; }
const api={mount,update,show,headline};
const reg=()=>App.register("sante",api); if(window.App) reg(); else (window.__pending=window.__pending||[]).push(reg);
})();
