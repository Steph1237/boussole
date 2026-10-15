/* Calculs patrimoniaux purs, partagés par tous les onglets. Aucun accès au DOM. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  const n = v => (isFinite(+v) ? +v : 0);
  const pos = v => Math.max(0, n(v));

  /* ---------- positions du Pilotage ---------- */
  function val(p) {
    if (p.mode === "market" && p.qty != null && p.price != null) return p.qty * p.price;
    return n(p.value);
  }
  const counted = p => p.status !== "à recevoir" && p.status !== "clôturé";
  const inScope = (p, scope) => scope === "foyer" || p.owner === scope;
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  function financier(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p)), val);
  }
  function poche(positions, scope, bloc) {
    return sum((positions || []).filter(p => inScope(p, scope) && counted(p) && p.bloc === bloc), val);
  }
  function aRecevoir(positions, scope) {
    return sum((positions || []).filter(p => inScope(p, scope) && p.status === "à recevoir"), val);
  }

  /* ---------- classes d'actifs et liquidité ---------- */
  const sansAccent = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  /* Poche (libellé libre) → classe d'actifs. Table par défaut, surchargeable par l'utilisateur. */
  const CLASSES = {
    monde: "actions", europe: "actions", asie: "actions", "nasdaq 2x": "actions", nasdaq: "actions", "convictions tech": "actions", convictions: "actions",
    actions: "actions", "etats-unis": "actions", usa: "actions", emergents: "actions", "small caps": "actions",
    obligations: "obligations", oblig: "obligations",
    scpi: "immobilier", immobilier: "immobilier", sci: "immobilier", opci: "immobilier",
    epargne: "monetaire", livrets: "monetaire", monetaire: "monetaire", cash: "monetaire", liquidites: "monetaire",
    "comptes courants": "monetaire", "compte courant": "monetaire",
    protection: "fonds_euros", "fonds euros": "fonds_euros", "fonds euro": "fonds_euros",
    or: "or", "metaux precieux": "or", crypto: "crypto", cryptos: "crypto",
  };
  const CLASSES_LABELS = { actions: "Actions", obligations: "Obligations", immobilier: "Immobilier", monetaire: "Monétaire et livrets", fonds_euros: "Fonds euros", or: "Or", crypto: "Crypto", autres: "Autres" };
  function classe(bloc, surcharge) {
    if (surcharge && bloc in surcharge) return surcharge[bloc];
    return CLASSES[sansAccent(bloc)] || "autres";
  }
  /* Enveloppe → délai pour récupérer l'argent : immediate, jours (titres cotés), semaines (assurance-vie), bloque (PER, immobilier).
     « compte » non suivi de « titres » (un compte-titres se vend en quelques jours) ; « PERin » bloqué. Même règle que liquidite() du connecteur. */
  const LIQUIDITE_LABELS = { immediate: "Disponible tout de suite", jours: "Sous quelques jours", semaines: "Sous quelques semaines", bloque: "Bloqué ou peu liquide" };
  function liquidite(envelope) {
    const e = sansAccent(envelope);
    if (/\bper\b|\bperin\b|perco|pee|retraite|scpi|immobilier/.test(e)) return "bloque";
    if (/livret|ldds|lep|\bcomptes?\b(?![- ]?titres?)|cash|especes|courant/.test(e)) return "immediate";
    if (/\bav\b|assurance|vie|capitalisation/.test(e)) return "semaines";
    return "jours";
  }
  function grouper(positions, scope, cle) {
    const out = {};
    (positions || []).filter(p => inScope(p, scope) && counted(p)).forEach(p => { const k = cle(p); out[k] = (out[k] || 0) + val(p); });
    return out;
  }

  /* ---------- familles de comptes (spec 2026-10-12-cp1, § 1) ---------- */
  /* Chaque ligne appartient à une famille, déduite de son enveloppe et de son bloc :
     - courant : bloc ou enveloppe « Compte(s) courant(s) » (bloc créé par la synchronisation bancaire) ou « Compte joint » ;
     - investissement : enveloppe PEA, PEA-PME, compte-titres (CTO), assurance-vie (AV), capitalisation, PER (PERin, PERP, PERCO,
       PERCOL, PERECO), Madelin, PEE / épargne salariale, « Plan d'épargne en actions / retraite / entreprise / avenir » en toutes
       lettres, crypto (Binance), SCPI / OPCI / SCI — l'enveloppe d'investissement prime sur la poche (un fonds
       monétaire dans un compte-titres reste de l'investissement) ;
     - epargne : enveloppe livret (Livret A, LDDS, LEP, CEL, PEL, CSL), compte à terme, compte épargne, monétaire, cash, espèces ;
     - repli (enveloppe muette, ex. « Banque ») : la classe de la poche (Calc.classe, surcharge comprise) ; monétaire → epargne,
       tout le reste → investissement.
     Les dettes ne sont pas des lignes : elles viennent des biens (capital restant dû) et des crédits du profil (Calc.dettes).
     Même fonction dans le connecteur (supabase/functions/mcp/index.ts, famille), parité testée sur une liste de libellés. */
  const FAMILLES_LABELS = { courant: "Comptes courants", epargne: "Épargne disponible", investissement: "Investissement", dettes: "Dettes" };
  const RE_COURANT = /\bcomptes? courants?\b|\bcomptes? joints?\b/;
  const RE_INVEST = /\bpea\b|\bcto\b|\bcomptes?[- ]?titres?\b|assurance.?vie|\bav\b|capitalisation|\bper\b|\bperin\b|\bperp\b|\bperco\b|\bpercol\b|\bpereco\b|\bpee\b|\bmadelin\b|plans? (d.)?epargne (en actions|(pour la )?retraite|(d.)?entreprise|avenir)|epargne salariale|crypto|binance|\bscpi\b|\bopci\b|\bsci\b/;
  const RE_EPARGNE = /livret|\bldds\b|\blep\b|\bcel\b|\bpel\b|\bcsl\b|compte a terme|epargne|monetaire|\bcash\b|especes/;
  function famille(position, surcharge) {
    const p = position || {}, env = sansAccent(p.envelope), bloc = sansAccent(p.bloc);
    if (RE_COURANT.test(bloc) || RE_COURANT.test(env)) return "courant";
    if (RE_INVEST.test(env)) return "investissement";
    if (RE_EPARGNE.test(env)) return "epargne";
    return classe(p.bloc, surcharge) === "monetaire" ? "epargne" : "investissement";
  }
  const estCourant = p => famille(p) === "courant";
  /** Lignes hors comptes courants : base de l'allocation, du risque et de la diversification (le patrimoine net garde tout). */
  const horsCourants = positions => (positions || []).filter(p => p && !estCourant(p));

  const parClasse = (positions, scope, surcharge) => grouper(horsCourants(positions), scope, p => classe(p.bloc, surcharge));
  const parLiquidite = (positions, scope) => grouper(positions, scope, p => liquidite(p.envelope));

  /* ---------- profil ---------- */
  /* Quote-part d'un bien : part_p1 (0-100) appartient à la personne 1, le complément à la personne 2. */
  function part(scope, partP1) {
    const s = Math.min(100, Math.max(0, partP1 == null ? 50 : n(partP1))) / 100;
    return scope === "foyer" ? 1 : scope === "p1" ? s : 1 - s;
  }
  function partCredit(scope, owner) {
    if (scope === "foyer") return 1;
    if (owner === "commun") return 0.5;
    return owner === scope ? 1 : 0;
  }
  const biens = pr => (pr && Array.isArray(pr.biens) ? pr.biens : []);
  const credits = pr => (pr && Array.isArray(pr.credits) ? pr.credits : []);
  const scopePeople = scope => (scope === "foyer" ? ["p1", "p2"] : [scope]);

  function immobilier(profil, scope) {
    return sum(biens(profil), b => pos(b.valeur) * part(scope, b.part_p1));
  }
  function dettes(profil, scope) {
    return sum(biens(profil), b => pos(b.crd) * part(scope, b.part_p1)) +
      sum(credits(profil), c => pos(c.crd) * partCredit(scope, c.owner));
  }
  /** Crédits en cours du foyer (avant partage par personne), UNE définition pour Patrimoine › Immobilier et crédits, Compte › Données et la
      protection du bilan : les prêts rattachés aux biens (reste dû ou mensualité positifs), puis chaque crédit déclaré (auto, consommation,
      travaux). → [{ kind: "pret" | "credit", nom, crd, mensualite }]. Leur somme est Calc.dettes / Calc.mensualites du foyer. */
  function creditsEnCours(profil) {
    const out = [];
    biens(profil).forEach(b => { if (b && (pos(b.crd) > 0 || pos(b.mensualite) > 0)) out.push({ kind: "pret", nom: String(b.nom || "").trim() || "Bien", crd: pos(b.crd), mensualite: pos(b.mensualite) }); });
    credits(profil).forEach(c => { if (c) out.push({ kind: "credit", nom: String(c.nom || "").trim() || "Crédit", crd: pos(c.crd), mensualite: pos(c.mensualite) }); });
    return out;
  }
  function mensualites(profil, scope) {
    return sum(biens(profil), b => pos(b.mensualite) * part(scope, b.part_p1)) +
      sum(credits(profil), c => pos(c.mensualite) * partCredit(scope, c.owner));
  }
  function autresActifs(profil, scope) {
    const a = (profil && profil.autres) || {};
    return scopePeople(scope).reduce((o, k) => {
      o.usage += pos(a[k] && a[k].usage);
      o.entreprise += pos(a[k] && a[k].entreprise);
      return o;
    }, { usage: 0, entreprise: 0 });
  }
  function patrimoine(positions, profil, scope) {
    const f = financier(positions, scope), i = immobilier(profil, scope), a = autresActifs(profil, scope), d = dettes(profil, scope);
    const brut = f + i + a.usage + a.entreprise;
    return { financier: f, immobilier: i, usage: a.usage, entreprise: a.entreprise, dettes: d, brut, net: brut - d };
  }

  /* Taux brut → net de la toise : 0,75 cadre, 0,78 non-cadre. */
  const brutRate = statut => (statut === "cadre" ? 0.75 : 0.78);
  function salaireNetMensuel(p) {
    if (!p) return 0;
    const v = pos(p.salaire), r = brutRate(p.statut);
    switch (p.salaireUnite) {
      case "na": return v / 12;
      case "bm": return v * r;
      case "ba": return v * r / 12;
      default: return v;
    }
  }
  function revenusFoyer(profil, scope) {
    const ps = (profil && profil.personnes) || {};
    const sal = sum(scopePeople(scope), k => salaireNetMensuel(ps[k]) + pos(ps[k] && ps[k].autresRevenus));
    return sal + sum(biens(profil), b => pos(b.loyer) * part(scope, b.part_p1));
  }

  /* Matelas de précaution (config.cushion) : { mode: "amount", min, max } ou { mode: "months", months, depenses }
     (cible = months × depenses, sans plafond). Ancienne forme sans mode = montant. null si non défini. */
  function matelas(config) {
    const c = config && config.cushion;
    if (!c || typeof c !== "object") return null;
    if (c.mode === "months") return { mode: "months", min: pos(c.months) * pos(c.depenses), max: null, months: pos(c.months), depenses: pos(c.depenses) };
    return { mode: "amount", min: pos(c.min), max: c.max == null || c.max === "" ? null : pos(c.max) };
  }

  /* ---------- budget réel (banques connectées, spec cp1 § 5) ---------- */
  /* banque = S.banque { actif?, comptes, mois } (ou la même forme lue en SQL par le connecteur : doublon_de, compte_id).
     Comptes courants suivis : type « courant », non ignorés, pas en double, actifs. */
  const doublonDe = c => (c.doublonDe !== undefined ? c.doublonDe : c.doublon_de);
  function comptesCourants(banque) {
    const L = banque && Array.isArray(banque.comptes) ? banque.comptes : [];
    return L.filter(c => c && c.type === "courant" && c.ignore !== true && doublonDe(c) == null && c.actif !== false);
  }
  /* Compte d'une ligne de banque_mois : compteId (store) ou compte_id (SQL) ; 0 (valeur par défaut de la migration 0025) = totaux par
     utilisateur, comme une ligne sans compte. */
  const idCompte = r => { const v = r.compteId != null ? r.compteId : r.compte_id; return v == null || v === "" || +v === 0 ? null : v; };
  const moisIso = d => { const s = d instanceof Date ? d.toISOString() : String(d == null ? "" : d); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null; };
  const lignesMois = banque => (banque && Array.isArray(banque.mois) ? banque.mois : []).filter(Boolean);
  /** Mois (AAAA-MM) détaillés par compte : au moins une ligne porte un compte. */
  const moisDetailles = banque => new Set(lignesMois(banque).filter(r => idCompte(r) != null).map(r => moisIso(r.mois)));
  /** Lignes de banque_mois des comptes courants, mois par mois : un mois détaillé par compte (compteId / compte_id) ne garde que les
      lignes des comptes courants suivis (ses éventuels totaux agrégés sont écartés) ; un mois sans détail (totaux par utilisateur, BQ1)
      garde ses lignes telles quelles. */
  function moisCourants(banque) {
    const L = lignesMois(banque), det = moisDetailles(banque);
    if (!det.size) return L;
    const ids = new Set(comptesCourants(banque).map(c => String(c.id)));
    return L.filter(r => (det.has(moisIso(r.mois)) ? idCompte(r) != null && ids.has(String(idCompte(r))) : true));
  }
  const RE_INTERNE = /^virements?[_ ]internes?$|^interne$/;

  /* ---------- série fusionnée des mois bancaires (HIS2, spec 2026-10-16-his2-historique-design.md § 6.1) ---------- */
  const liste = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const cleCompte = v => (v == null || v === "" ? null : String(v));
  const compteBanqueDe = hc => { const v = hc.banqueCompteId !== undefined ? hc.banqueCompteId : hc.banque_compte_id; return v == null || v === "" || +v === 0 ? null : v; };
  const compteImporteDe = r => (r.compteId != null ? r.compteId : r.compte_id);
  const importDe = r => (r.importId !== undefined ? r.importId : r.import_id);
  /** Ligne de totaux d'un mois importé, dans la forme d'une ligne de banque_mois (mois au 1er du mois, compte, catégorie large, sous-catégorie). */
  const ligneImportee = (r, mois, compte) => ({ mois: mois + "-01", compte_id: compte, categorie: r.categorie, sous_categorie: r.sous_categorie == null ? "" : r.sous_categorie,
    entrees: n(r.entrees), sorties: n(r.sorties), nombre: n(r.nombre) });
  /** Série des mois bancaires par compte et par mois, UNE fonction pour la synchronisation (Powens) et les relevés importés (HIS2) : jamais deux fois
      le même euro. Consommée par budgetReel (donc la projection et la santé), par le connecteur et par l'écran de couverture.
      banque = S.banque { comptes, mois } ; historique = { comptes, releves, banqueMois } (historique_comptes, historique_releves,
      historique_banque_mois ; champs en snake_case de la base ou en camelCase du store) ; auj = date du jour (les mois importés après le mois en
      cours sont ignorés). Règles : un compte importé rattaché à un compte Powens (banque_compte_id) prend Powens pour un mois que banque_mois
      couvre, sauf le premier mois du compte dans banque_mois (réputé entamé : la synchronisation a commencé en cours de mois) où l'import l'emporte ;
      un compte importé non rattaché : l'import ; un compte Powens sans import : Powens pour tous ses mois, premier mois compris. Une carte à débit
      différé importée compte si le courant importé du même établissement et du même titulaire porte ce mois-là une ligne « releve_carte » (hors budget),
      ou si aucun courant de cet établissement et de ce titulaire n'est importé ce mois-là ; sinon elle est écartée (son relevé, compté sur le courant, ne
      doit pas l'être deux fois).
      → [{ compte, mois: "AAAA-MM", source: "powens" | "import" | null, type?, categories: [lignes de banque_mois], releve?, import_id?, ecarte? }], triée par
      mois puis par compte (en texte). compte = banque_compte_id si le compte importé est rattaché ou si c'est un compte Powens (null pour des
      totaux sans compte), sinon "h:" + id du compte importé ; releve = en-tête du mois importé { complet, solde_debut, solde_fin, total_entrees,
      total_sorties, nombre } ; ecarte = [{ source, import_id?, raison }] avec raison couvert_par_powens | premier_mois | carte_comptee_sur_courant
      (ce qui a été mis de côté reste visible dans la couverture). Même calcul dans le connecteur (parité testée). */
  function moisBancaires(banque, historique, auj) {
    const courant = moisIso(auj == null ? new Date() : auj);
    const H = historique || {};
    const hComptes = liste(H.comptes), hReleves = liste(H.releves), hLignes = liste(H.banqueMois);
    // Powens : lignes par (compte, mois) et premier mois de chaque compte
    const powens = new Map(), premier = {};
    lignesMois(banque).forEach(r => {
      const m = moisIso(r.mois);
      if (!m) return;
      const c = idCompte(r), k = cleCompte(c) + "|" + m;
      if (!powens.has(k)) powens.set(k, { compte: c, mois: m, lignes: [] });
      powens.get(k).lignes.push(r);
      if (c != null && (premier[String(c)] === undefined || m < premier[String(c)])) premier[String(c)] = m;
    });
    // Relevés importés : lignes par (compte importé, mois)
    const compteH = new Map(hComptes.map(c => [String(c.id), c]));
    const lignesH = new Map();
    hLignes.forEach(r => {
      const m = moisIso(r.mois), c = cleCompte(compteImporteDe(r));
      if (!m || c == null) return;
      const k = c + "|" + m;
      if (!lignesH.has(k)) lignesH.set(k, []);
      lignesH.get(k).push(r);
    });
    const importes = hReleves.map(r => ({ r, hc: compteH.get(String(compteImporteDe(r))), mois: moisIso(r.mois) }))
      .filter(x => x.hc && x.mois && (!courant || x.mois <= courant));
    const courants = (hc, mois) => importes.filter(x => x.mois === mois && x.hc.type === "courant" && x.hc.etablissement === hc.etablissement && x.hc.titulaire === hc.titulaire);
    const aReleveCarte = x => (lignesH.get(String(x.hc.id) + "|" + x.mois) || []).some(l => l.sous_categorie === "releve_carte");
    const sortie = [], prises = new Set();
    importes.forEach(x => {
      const { r, hc, mois } = x, rattache = compteBanqueDe(hc), compte = rattache != null ? rattache : "h:" + hc.id;
      const lignes = (lignesH.get(String(hc.id) + "|" + mois) || []).map(l => ligneImportee(l, mois, compte));
      const releve = { complet: r.complet !== false, solde_debut: r.solde_debut == null ? null : n(r.solde_debut), solde_fin: r.solde_fin == null ? null : n(r.solde_fin),
        total_entrees: n(r.total_entrees), total_sorties: n(r.total_sorties), nombre: n(r.nombre) };
      const imp = importDe(r), base = { compte, mois, type: hc.type, categories: lignes, releve };
      if (imp != null) base.import_id = imp;
      const kp = cleCompte(rattache) + "|" + mois, p = rattache != null ? powens.get(kp) : null;
      if (p) {
        prises.add(kp);
        if (mois === premier[String(rattache)]) { sortie.push({ ...base, source: "import", ecarte: [{ source: "powens", raison: "premier_mois" }] }); return; }
        const e = { source: "import", raison: "couvert_par_powens" };
        if (imp != null) e.import_id = imp;
        sortie.push({ compte, mois, source: "powens", type: hc.type, categories: p.lignes, ecarte: [e] });
        return;
      }
      if (hc.type === "carte_differe") {
        const cc = courants(hc, mois);
        if (cc.length && !cc.some(aReleveCarte)) {
          const e = { source: "import", raison: "carte_comptee_sur_courant" };
          if (imp != null) e.import_id = imp;
          sortie.push({ compte, mois, source: null, type: hc.type, categories: [], ecarte: [e] });
          return;
        }
      }
      sortie.push({ ...base, source: "import" });
    });
    powens.forEach((p, k) => { if (!prises.has(k)) sortie.push({ compte: p.compte, mois: p.mois, source: "powens", categories: p.lignes }); });
    return sortie.sort((a, b) => (a.mois < b.mois ? -1 : a.mois > b.mois ? 1 : String(a.compte) < String(b.compte) ? -1 : String(a.compte) > String(b.compte) ? 1 : 0));
  }
  /** Lignes des relevés importés qui comptent au budget : source « import », mois complet, compte courant ou joint (une carte à débit différé
      déjà décidée par moisBancaires). Les livrets et autres comptes importés ne servent qu'à la couverture. */
  const importeAuBudget = e => e.source === "import" && e.releve && e.releve.complet !== false && (e.type === "courant" || e.type === "joint" || e.type === "carte_differe");
  /** Budget réel moyen des nb (3) derniers mois complets (mois en cours exclu), comptes courants seulement :
      revenus = entrées − sorties de « revenus » ; épargne = sorties − entrées de « epargne » (virements vers l'épargne et
      l'investissement) ; dépenses = sorties − entrées de toutes les autres catégories ; virements internes exclus.
      tauxEpargne = « Épargne versée » : versements d'épargne et d'investissement ÷ revenus (moyennes de la période ; même chiffre que lire_banque, banque.ts). « Capacité d'épargne » réelle
      (spec cp4 § 1.2, critère « Capacité d'épargne » de Santé) : capacite = revenus − dépenses, tauxCapacite = capacite ÷ revenus (l'épargne
      versée en est une partie, affichée à part). parCompte : vrai si chaque mois retenu est détaillé par compte
      (chiffres des seuls comptes courants) ; faux sinon (totaux de tous les comptes connectés : libellé « tous comptes connectés »).
      historique (facultatif, HIS2) : relevés importés { comptes, releves, banqueMois } ; le calcul porte alors sur la série de moisBancaires
      (Powens et import, jamais les deux pour le même compte et le même mois) ; sans lui, comportement inchangé. Un mois importé non complet n'y entre jamais.
      → { n, du, au, revenus, depenses, epargne, tauxEpargne, capacite, tauxCapacite, parCompte } ou null (interrupteur éteint et aucun relevé importé,
      aucun mois complet). Même calcul dans le connecteur (budgetReel, index.ts). */
  function budgetReel(banque, auj, nb, historique) {
    const actif = !!banque && banque.actif !== false;
    const utileH = !!historique && (liste(historique.releves).length > 0);
    if (!actif && !utileH) return null;
    const b = actif ? banque : { mois: [], comptes: [] };
    const k = Number.isInteger(nb) && nb > 0 ? nb : 3;
    const courant = moisIso(auj == null ? new Date() : auj);
    let L0 = moisCourants(b), importees = [];
    if (utileH) {
      const serie = moisBancaires(b, historique, auj);
      const remplaces = new Set(serie.filter(e => e.source !== "powens" && (e.ecarte || []).some(x => x.source === "powens")).map(e => cleCompte(e.compte) + "|" + e.mois));
      L0 = L0.filter(r => !remplaces.has(cleCompte(idCompte(r)) + "|" + moisIso(r.mois)));
      importees = serie.filter(importeAuBudget);
      importees.forEach(e => e.categories.forEach(l => L0.push(l)));
    }
    const L = L0.filter(r => moisIso(r.mois) && moisIso(r.mois) < courant && !RE_INTERNE.test(sansAccent(r.categorie)));
    const retenus = [...new Set(L.map(r => moisIso(r.mois)))].sort().slice(-k);
    if (!retenus.length) return null;
    let rev = 0, dep = 0, ep = 0;
    L.filter(r => retenus.includes(moisIso(r.mois))).forEach(r => {
      const e = n(r.entrees), s = n(r.sorties), c = sansAccent(r.categorie);
      if (c === "revenus") rev += e - s; else if (c === "epargne") ep += s - e; else dep += s - e;
    });
    const det = moisDetailles(b);
    importees.forEach(e => det.add(e.mois));
    const m = retenus.length, revenus = pos(rev) / m, depenses = pos(dep) / m, epargne = pos(ep) / m;
    return { n: m, du: retenus[0] + "-01", au: retenus[m - 1] + "-01", revenus, depenses, epargne, tauxEpargne: revenus > 0 ? epargne / revenus : null,
      capacite: revenus - depenses, tauxCapacite: revenus > 0 ? (revenus - depenses) / revenus : null, parCompte: retenus.every(x => det.has(x)) };
  }
  /** Période d'un budget réel en clair (spec cp4 § 1) : « juillet à septembre 2026 », « novembre 2025 à janvier 2026 », « septembre 2026 ».
      r = { du, au } (AAAA-MM-JJ) ; "" si r est absent. Même fonction dans le connecteur (periodeReel, index.ts). */
  const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function periodeReel(r) {
    const a = r && moisIso(r.du), b = r && moisIso(r.au);
    if (!a || !b) return "";
    const nom = m => MOIS_FR[+m.slice(5, 7) - 1], an = m => m.slice(0, 4);
    if (a === b) return nom(b) + " " + an(b);
    return an(a) === an(b) ? nom(a) + " à " + nom(b) + " " + an(b) : nom(a) + " " + an(a) + " à " + nom(b) + " " + an(b);
  }
  /** Dépenses mensuelles du budget prévu (mêmes règles que Plan.budgetTotaux : lignes de dépense × part du périmètre + mensualités
      de crédit, si au moins une ligne de dépense ; sinon les dépenses saisies du matelas en mois ; sinon 0). */
  function depensesPrevues(budget, profil, config, scope) {
    const sc = scope || "foyer";
    const L = Array.isArray(budget) ? budget : budget && Array.isArray(budget.lignes) ? budget.lignes : [];
    const lignes = sum(L.filter(l => l && l.type === "depense"), l =>
      (l.frequence === "an" ? pos(l.montant) / 12 : pos(l.montant)) * partCredit(sc, l.owner === "p1" || l.owner === "p2" ? l.owner : "commun"));
    if (lignes > 0) return lignes + mensualites(profil, sc);
    const m = matelas(config);
    return m && m.mode === "months" && m.depenses > 0 ? m.depenses : 0;
  }
  /** Dépenses mensuelles de référence : budget réel (foyer seulement : les comptes ne sont pas répartis par personne) s'il existe,
      sinon budget prévu. ctx = { banque, historique (relevés importés, facultatif), budget, profil, config, scope, auj } → { montant, source: "reel" | "prevu", reel? } ou null. */
  function depensesMensuelles(ctx) {
    const c = ctx || {}, sc = c.scope || "foyer";
    const r = sc === "foyer" ? budgetReel(c.banque, c.auj, undefined, c.historique) : null;
    if (r && r.depenses > 0) return { montant: r.depenses, source: "reel", reel: r };
    const p = depensesPrevues(c.budget, c.profil, c.config, sc);
    return p > 0 ? { montant: p, source: "prevu" } : null;
  }

  /* ---------- matelas disponible (spec cp1 § 1) ---------- */
  /** Réserve de fonctionnement laissée sur les comptes courants, en mois de dépenses : config.cushion.reserve_mois (facultatif,
      à côté des formes amount / months), 1 par défaut. */
  function reserveMois(config) {
    const c = config && config.cushion, v = c && typeof c === "object" ? c.reserve_mois : undefined;
    return v !== null && v !== undefined && v !== "" && isFinite(+v) && +v >= 0 ? +v : 1;
  }
  /** Matelas = épargne disponible + max(0, soldes courants − réserve), réserve = reserveMois × dépenses mensuelles.
      opts = { config, depenses } → { epargne, courants, reserveMois, depenses, reserve, courantsAuDela, total }. */
  function matelasDisponible(positions, scope, opts) {
    const o = opts || {}, sc = scope || "foyer";
    const L = (positions || []).filter(p => p && inScope(p, sc) && counted(p));
    const epargne = sum(L.filter(p => famille(p) === "epargne"), val);
    const courants = sum(L.filter(estCourant), val);
    const rm = reserveMois(o.config), depenses = pos(o.depenses), reserve = rm * depenses;
    const courantsAuDela = Math.max(0, courants - reserve);
    return { epargne, courants, reserveMois: rm, depenses, reserve, courantsAuDela, total: epargne + courantsAuDela };
  }

  /* ---------- poches d'une photo (snapshots.by_bloc) ---------- */
  const objetSimple = v => !!v && typeof v === "object" && !Array.isArray(v);
  const nombreOk = v => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && isFinite(+v);
  /** Poches d'une photo du patrimoine, à plat : { poche: valeur } pour un périmètre (foyer | p1 | p2). Lecteur UNIQUE de snapshots.by_bloc, utilisé par
      l'app et par le connecteur (copies générées de ce module) : la fonction nocturne (take_snapshots, migration 0003) l'écrit PAR PERSONNE,
      { p1: { poche: valeur }, p2: { … } } (forme de production) ; l'ancienne forme de la démo et des lignes migrées est à plat, { poche: valeur }.
      Photo en forme de l'app ({ byBloc }) ou ligne SQL ({ by_bloc }). Foyer = somme de toutes les personnes (p1, p2, et « commun » s'il existe) ;
      p1 / p2 = la leur ; une photo à plat ne se découpe pas par personne (null pour p1 / p2). Valeurs non numériques écartées ; la photo n'est
      jamais modifiée. → objet (éventuellement vide) ou null si la photo n'a pas de poches lisibles. */
  function blocsPhoto(photo, perimetre) {
    const bb = photo && (photo.byBloc || photo.by_bloc), scope = perimetre || "foyer";
    if (!objetSimple(bb)) return null;
    const cles = Object.keys(bb);
    if (!cles.length) return null;
    const out = {};
    const ajoute = m => Object.keys(m).forEach(k => { if (nombreOk(m[k])) out[k] = (out[k] || 0) + +m[k]; });
    if (cles.every(k => objetSimple(bb[k]))) {
      if (scope === "foyer") cles.forEach(o => ajoute(bb[o]));
      else if (objetSimple(bb[scope])) ajoute(bb[scope]);
    } else if (scope === "foyer") ajoute(bb);
    else return null;
    return out;
  }

  /* ---------- argent qui dort (spec cp1 § 1) ---------- */
  const SEUIL_DORT = 1.5;
  const moisAvant = (m, k) => { const [y, mo] = m.split("-").map(Number), t = y * 12 + (mo - 1) - k; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); };
  /** Soldes des comptes courants supérieurs à 1,5 mois de dépenses deux mois de suite (foyer).
      Points mesurés, du plus récent au plus ancien : fins des mois complets d'après les photos (dernière photo de chaque mois), sur les
      seules lignes des comptes courants : poches courantes (byBloc : une poche « Comptes courants » ne contient que des comptes courants)
      et enveloppes courantes (byEnvelope, pour les comptes courants reconnus à leur enveloppe, « Compte joint » par exemple, quand
      aucune de leurs lignes n'est dans une poche courante — sans quoi l'enveloppe est laissée de côté plutôt que comptée deux fois) ;
      jamais une enveloppe mixte (« Boursorama » avec un compte courant et un PEA). À défaut de photo deux mois en arrière : solde
      actuel de ces mêmes lignes puis fin du mois précédent. Dépenses : Calc.depensesMensuelles (réel, sinon prévu).
      → { montant (dépassement le plus faible des deux derniers points, arrondi), mois (mois de suite au-dessus du seuil, ≥ 2), solde
      (point le plus récent), seuil, depenses, source } ou null. Pour Aujourd'hui et la revue mensuelle. */
  function argentQuiDort(S, auj) {
    const s = S || {}, jour = auj == null ? new Date() : auj;
    const courants = (s.positions || []).filter(p => p && counted(p) && estCourant(p));
    if (!courants.length) return null;
    const d = depensesMensuelles({ banque: s.banque, historique: s.historique, budget: s.budget, profil: s.profil, config: s.config, scope: "foyer", auj: jour });
    if (!d) return null;
    const seuil = SEUIL_DORT * d.montant, m0 = moisIso(jour);
    const blocCourant = p => RE_COURANT.test(sansAccent(p.bloc));
    const blocs = [...new Set(courants.filter(blocCourant).map(p => p.bloc))];
    const envsMelees = new Set(courants.filter(blocCourant).map(p => p.envelope));
    const envs = [...new Set(courants.filter(p => !blocCourant(p) && p.envelope && !envsMelees.has(p.envelope)).map(p => p.envelope))];
    const mesurees = courants.filter(p => blocs.includes(p.bloc) || envs.includes(p.envelope));
    if (!mesurees.length) return null;
    const parBloc = x => blocsPhoto(x, "foyer"), parEnv = x => x && (x.byEnvelope || x.by_envelope);
    const a = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
    const photos = {};
    (Array.isArray(s.snapshots) ? s.snapshots : []).forEach(x => {
      const m = x && moisIso(x.date);
      if (!m || m >= m0 || !(blocs.some(b => a(parBloc(x), b)) || envs.some(e => a(parEnv(x), e)))) return;
      if (!photos[m] || String(x.date) > String(photos[m].date)) photos[m] = x;
    });
    const solde = x => sum(blocs, b => n((parBloc(x) || {})[b])) + sum(envs, e => n((parEnv(x) || {})[e]));
    const points = [];
    if (photos[moisAvant(m0, 1)] && photos[moisAvant(m0, 2)]) {
      for (let k = 1; photos[moisAvant(m0, k)]; k++) points.push(solde(photos[moisAvant(m0, k)]));
    } else if (photos[moisAvant(m0, 1)]) points.push(sum(mesurees, val), solde(photos[moisAvant(m0, 1)]));
    let mois = 0;
    while (mois < points.length && points[mois] > seuil) mois++;
    if (mois < 2) return null;
    return { montant: Math.round(Math.min(points[0], points[1]) - seuil), mois, solde: points[0], seuil, depenses: d.montant, source: d.source };
  }

  /* ---------- doublons probables (revue CP1) ---------- */
  const TOLERANCE_DOUBLON = 0.03;
  /** Lignes qui recopient probablement le total de leur enveloppe (ex. ligne « PEA DUPONT » créée en validant une proposition « créer
      une ligne » alors que les titres du PEA sont déjà suivis : le PEA compte deux fois). Dans une même enveloppe et un même titulaire,
      une ligne manuelle sans ISIN, comptée, dont la valeur est à ±3 % de la somme des autres lignes comptées (au moins 2 autres).
      → [{ ligne (id), nom, enveloppe, titulaire, valeur, sommeAutres }]. Même règle dans le connecteur (doublonsProbables, index.ts). */
  function doublonsProbables(positions) {
    const L = (positions || []).filter(p => p && counted(p) && String(p.envelope || "").trim());
    const groupes = new Map();
    L.forEach(p => { const k = String(p.envelope).trim() + "|" + (p.owner || ""); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(p); });
    const out = [];
    groupes.forEach(g => {
      if (g.length < 3) return;
      const total = sum(g, val);
      g.forEach(p => {
        if (p.mode === "market" || String(p.isin || "").trim()) return;
        const v = val(p), autres = total - v;
        if (v > 0 && autres > 0 && Math.abs(v - autres) <= TOLERANCE_DOUBLON * autres)
          out.push({ ligne: p.id, nom: p.name || "", enveloppe: String(p.envelope).trim(), titulaire: p.owner || null, valeur: v, sommeAutres: autres });
      });
    });
    return out;
  }

  /* Apport : épargne au-delà du matelas (porté par la personne 1 et le foyer), + part des placements, + « à recevoir » en option. */
  function apportDisponible(positions, config, scope, opts) {
    const o = opts || {};
    const epargne = poche(positions, scope, "Épargne");
    const m = matelas(config);
    const matelas_ = scope === "p2" || !m ? 0 : m.min;
    const libre = Math.max(0, epargne - matelas_);
    const autres = financier(positions, scope) - epargne;
    const placements = Math.max(0, autres) * Math.min(100, Math.max(0, n(o.partPlacements))) / 100;
    const rec = o.inclureARecevoir ? aRecevoir(positions, scope) : 0;
    return { epargne, matelas: matelas_, libre, placements, aRecevoir: rec, total: libre + placements + rec };
  }

  /* ---------- noms et validation (la complétude du bilan est dans bilan-etat.js : une seule fonction) ---------- */
  /* « de Camille », « d'Alex » ; sans prénom (ou prénom par défaut) : « de la personne 1 ». */
  const NOMS_PAR_DEFAUT = ["", "moi", "conjoint", "conjoint(e)", "conjointe"];
  function deNom(nom, rang) {
    const s = String(nom == null ? "" : nom).trim();
    if (NOMS_PAR_DEFAUT.includes(s.toLowerCase())) return "de la personne " + (rang || 1);
    return (/^[aeiouyhàâäéèêëîïôöûüÿæœ]/i.test(s) ? "d'" : "de ") + s;
  }
  function valider(profil) {
    const erreurs = [], avertissements = [];
    biens(profil).forEach(b => {
      const nom = b.nom || "Bien sans nom";
      if (n(b.part_p1) < 0 || n(b.part_p1) > 100) erreurs.push(nom + " : la quote-part doit être comprise entre 0 et 100 %.");
      ["valeur", "crd", "mensualite", "loyer"].forEach(k => { if (n(b[k]) < 0) erreurs.push(nom + " : les montants ne peuvent pas être négatifs."); });
      if (pos(b.crd) > pos(b.valeur) && pos(b.valeur) > 0) avertissements.push(nom + " : le capital restant dû dépasse la valeur du bien.");
    });
    credits(profil).forEach(c => {
      if (n(c.crd) < 0 || n(c.mensualite) < 0) erreurs.push((c.nom || "Crédit sans nom") + " : les montants ne peuvent pas être négatifs.");
    });
    return { erreurs: [...new Set(erreurs)], avertissements };
  }

  /* Calendrier patrimonial (DAT1) : délégation à Calendrier.calendrier (web/src/calendrier.js), la même fonction sous Node. */
  const calendrier = typeof module === "object" && module.exports && typeof require === "function"
    ? require("./calendrier.js").calendrier
    : (data, today, options) => root.Calendrier.calendrier(data, today, options);

  return { calendrier, CLASSES_LABELS, LIQUIDITE_LABELS, FAMILLES_LABELS, classe, liquidite, famille, horsCourants, parClasse, parLiquidite,
    comptesCourants, moisCourants, moisBancaires, budgetReel, periodeReel, doublonsProbables, depensesPrevues, depensesMensuelles, reserveMois, matelasDisponible, argentQuiDort, blocsPhoto,
    val, counted, inScope, financier, poche, aRecevoir, part, partCredit, immobilier, dettes, mensualites, creditsEnCours,
    autresActifs, patrimoine, brutRate, salaireNetMensuel, revenusFoyer, matelas, apportDisponible, deNom, valider };
});
