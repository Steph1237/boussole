// BUD1, tâche 8 : note de respect du budget (Budget.score, spec § 7, cas S1 à S15 de test/fixtures/budget-cas.json, calculés à la main) et cible en vigueur
// (§ 7.5, D12). Les attendus viennent de la fixture, jamais du code. Valeurs fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const F = JSON.parse(readFileSync(new URL("./fixtures/budget-cas.json", import.meta.url), "utf8"));
const Budget = require("../web/src/budget.js");
const J = v => JSON.parse(JSON.stringify(v));

/** Mois (forme du § 6.1) construit depuis le « reel » d'un cas de la fixture. */
const moisDe = r => ({ revenus: r.revenus, blocs: { essentiels: r.essentiels, envies: r.envies, epargne: 0 }, a_classer: r.a_classer,
  lisse: r.annuelles ? { annuelles: r.annuelles } : undefined, couverture: r.mois_complet === false ? { mois_complet: false } : {} });

for (const c of F.score.cas) {
  test(`${c.id} · ${c.titre} : ${c.attendu.score === null ? "pas de note (" + c.attendu.raison_absence + ")" : c.attendu.score + " · " + c.attendu.mot}`, () => {
    const { note, ...cible } = c.cible || {};
    const r = Budget.score(moisDe(c.reel), c.cible ? cible : null);
    const a = c.attendu;
    assert.equal(r.score, a.score, c.calcul);
    assert.equal(r.mot, a.mot);
    if (a.score === null) {
      assert.equal(r.raison_absence, a.raison_absence);
      assert.equal(r.termes, null);
      assert.match(r.texte, /^Pas de note/);
      if (a.part_a_classer !== undefined) assert.equal(r.part_a_classer, a.part_a_classer);
      return;
    }
    assert.equal(r.raison_absence, null);
    assert.equal(r.provisoire, a.provisoire);
    if (a.raison_provisoire) assert.equal(r.raison_provisoire, a.raison_provisoire);
    assert.deepEqual(J(r.points), a.points, "points perdus par terme (somme = écart à 100, ligne « arrondi » si besoin)");
    if (a.part_a_classer !== undefined) assert.equal(r.part_a_classer, a.part_a_classer);
    if (a.phrase) { assert.equal(r.phrase, a.phrase); assert.equal(r.ecart_revenus, a.ecart_revenus); assert.match(r.texte, /Tes revenus étaient plus bas de 400 € : ta cible d'épargne du mois baisse d'autant/); }
    if (a.essentiels_lisses !== undefined) { assert.equal(r.essentiels_lisses, a.essentiels_lisses); assert.equal(r.capacite_reelle, a.capacite_reelle); }
    if (a.repere) assert.equal(r.repere, a.repere);
    // les points affichés font l'écart à 100, sauf note bornée à 0
    if (r.score > 0) assert.equal(r.points.epargne + r.points.envies + r.points.essentiels + (r.points.arrondi || 0), 100 - r.score);
    assert.ok(r.texte.startsWith(r.score + " · " + r.mot + "."), r.texte);
  });
}

test("barème : poids 3 / 2 / 1, franchise 1 %, seuils 85 et 60, à classer 15 et 30 %, revenus incomplets 50 % (conventions de la fixture)", () => {
  const b = F.score.bareme;
  assert.deepEqual([Budget.CONVENTIONS.budget_score_poids_epargne, Budget.CONVENTIONS.budget_score_poids_envies, Budget.CONVENTIONS.budget_score_poids_essentiels], [b.poids.epargne, b.poids.envies, b.poids.essentiels]);
  assert.equal(Budget.CONVENTIONS.budget_score_franchise_pct, b.franchise_pct);
  assert.deepEqual([Budget.CONVENTIONS.budget_score_seuil_tenu, Budget.CONVENTIONS.budget_score_seuil_presque], [b.seuils.tenu, b.seuils.presque]);
  assert.deepEqual([Budget.CONVENTIONS.budget_score_a_classer_provisoire_pct, Budget.CONVENTIONS.budget_score_a_classer_sans_note_pct], [b.a_classer.provisoire, b.a_classer.sans_note]);
  assert.equal(Budget.CONVENTIONS.budget_score_revenus_incomplets_pct, b.revenus_incomplets_pct);
  // les valeurs de départ sont celles des repères de la fixture (statut CONV)
  for (const r of F.reperes.filter(x => /^budget_(score|piste|essentiel|annuelle|recurrent|matelas)/.test(x.cle))) assert.equal(Budget.CONVENTIONS[r.cle], r.valeur, r.cle);
});

test("repères : une convention de data.reperes remplace la valeur de départ (poids de l'épargne à 1 : S2 passe de 55 à 73)", () => {
  const c = F.score.cas.find(x => x.id === "S2"), { note, ...cible } = c.cible;
  const r = Budget.score(moisDe(c.reel), cible, { reperes: [{ cle: "budget_score_poids_epargne", valeur: 1 }] });
  assert.equal(r.score, 73, "(1 × 360 + 2 × 360) ÷ 4 000 = 0,27");
  assert.equal(Budget.score(moisDe(c.reel), cible, { reperes: { budget_score_seuil_presque: 80 } }).mot, "à revoir", "seuil lu dans les repères (objet cle → valeur)");
});

test("limites : arrondi à 0,5 vers le haut, franchise par terme, note bornée entre 0 et 100, jamais de note sans cible valable", () => {
  const cible = { revenus_ref: 4000, essentiels: 2000, envies: 1000, epargne: 1000 };
  const m = (extra = {}) => ({ revenus: 4000, blocs: { essentiels: 2000, envies: 1000, epargne: 0 }, a_classer: 0, ...extra });
  // exactement la franchise (40 €) : rien à payer ; un euro de plus : 1 € × (3 + 2) ÷ 4 000 → 100 · tenu quand même
  assert.equal(Budget.score(m({ blocs: { essentiels: 2000, envies: 1040, epargne: 0 } }), cible).score, 100);
  assert.equal(Budget.score(m({ blocs: { essentiels: 2000, envies: 1041, epargne: 0 } }), cible).score, 100, "0,025 point arrondi");
  assert.equal(Budget.score(m({ blocs: { essentiels: 2000, envies: 1060, epargne: 0 } }), cible).score, 98);
  assert.equal(Budget.score(m({ blocs: { essentiels: 9000, envies: 9000, epargne: 0 } }), cible).score, 0);
  for (const mauvaise of [null, undefined, {}, { revenus_ref: 0, essentiels: 0, envies: 0, epargne: 0 }, { revenus_ref: 4000, essentiels: 2000 }]) {
    const r = Budget.score(m(), mauvaise);
    assert.equal(r.score, null); assert.equal(r.raison_absence, "sans_cible");
  }
  // cible à la forme de config.budget_cible : { revenus_ref, blocs: { … } }
  assert.equal(Budget.score(m(), { revenus_ref: 4000, blocs: { essentiels: 2000, envies: 1000, epargne: 1000 } }).score, 100);
});

test("pas de note : mois en cours, aucun compte observé, import incomplet, mois sans détail ; provisoire : mois en partie importé", () => {
  const cible = { revenus_ref: 4000, essentiels: 2000, envies: 1000, epargne: 1000 };
  const m = couverture => ({ revenus: 4000, blocs: { essentiels: 2000, envies: 1000, epargne: 0 }, a_classer: 0, couverture });
  for (const [couv, raison] of [[{ mois_complet: false }, "mois_en_cours"], [{ comptes_observes: 0 }, "aucun_compte"], [{ import_incomplet: true }, "import_incomplet"], [{ sans_detail: true }, "sans_detail"]]) {
    const r = Budget.score(m(couv), cible);
    assert.equal(r.score, null, raison); assert.equal(r.raison_absence, raison); assert.match(r.texte, /^Pas de note/);
  }
  const p = Budget.score(m({ en_partie_importe: true }), cible);
  assert.equal(p.score, 100); assert.equal(p.provisoire, true); assert.deepEqual(J(p.raisons_provisoire), ["mois_en_partie_importe"]);
  assert.match(p.texte, /Note provisoire/);
  // à classer : 15 % pile → provisoire, 30 % pile → provisoire, au-delà → pas de note
  const ac = a => Budget.score({ revenus: 4000, blocs: { essentiels: 2000, envies: 1000, epargne: 0 }, a_classer: a }, cible);
  assert.equal(ac(529).provisoire, false); assert.equal(ac(530).provisoire, true);
  assert.equal(ac(1285).score !== null, true); assert.equal(ac(1286).score, null);
});

test("lexique : aucun mot de série, de record ni de félicitation, tutoiement, jamais de reproche (spec § 7.4)", () => {
  const textes = [];
  for (const c of F.score.cas) { const { note, ...cible } = c.cible || {}; textes.push(Budget.score(moisDe(c.reel), c.cible ? cible : null).texte); }
  const cible = { revenus_ref: 4000, essentiels: 2000, envies: 1000, epargne: 1000 };
  textes.push(Budget.score({ revenus: 0, blocs: { essentiels: 0, envies: 0, epargne: 0 }, a_classer: 0, couverture: { sans_detail: true } }, cible).texte);
  assert.ok(textes.length >= 16);
  for (const t of textes) {
    assert.doesNotMatch(t, /série|serie|record|d'affilée|d'affilee|trophée|trophee|bravo|félicit|felicit|streak|badge|défi|defi/i, t);
    assert.doesNotMatch(t, /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu, t);
    assert.doesNotMatch(t, /trop dépens|gaspill|excessi|craquer|tu devrais|mauvaise habitude|raté/i, t);
  }
  // les exemples de la spec
  const s3 = F.score.cas.find(x => x.id === "S3");
  const { note, ...c3 } = s3.cible;
  assert.equal(Budget.score(moisDe(s3.reel), c3).texte, "84 · presque. Tes essentiels ont dépassé de 200 € (−4 points) et ton épargne est 200 € sous ta cible (−12 points).");
  assert.equal(Budget.score(moisDe(F.score.cas.find(x => x.id === "S5").reel), c3).texte,
    "100 · tenu. Tes revenus étaient plus bas de 400 € : ta cible d'épargne du mois baisse d'autant, et tu as tenu tes dépenses.");
});

test("déterminisme : mêmes entrées, mêmes sorties ; les entrées ne sont jamais modifiées", () => {
  const c = F.score.cas.find(x => x.id === "S13"), { note, ...cible } = c.cible, m = moisDe(c.reel);
  const avant = [J(m), J(cible)];
  const a = Budget.score(m, cible), b = Budget.score(m, cible);
  assert.deepEqual(J(a), J(b));
  assert.deepEqual([J(m), J(cible)], avant);
});

/* ---------------------------------------------------------------- cible en vigueur (§ 7.5, D12) */
test("cibleEnVigueur : une cible validée en septembre (proposée le 20/09) s'applique en octobre ; septembre garde celle de juin (fixture)", () => {
  const ce = F.score.cible_en_vigueur;
  const config = { budget_cible: { historique: J(ce.historique) } };
  for (const [mois, attendu] of Object.entries(ce.attendu)) {
    const c = Budget.cibleEnVigueur(config, "foyer", mois);
    assert.equal(c ? c.valide_du : null, attendu, mois + " : " + ce.calcul);
  }
  // l'historique des notes utilise la cible en vigueur à chaque mois : les montants suivent
  assert.equal(Budget.cibleEnVigueur(config, "foyer", "2026-09").blocs.envies, 1000);
  assert.equal(Budget.cibleEnVigueur(config, "foyer", "2026-10").blocs.envies, 900);
  // config.budget_cible ou son contenu directement ; un mois en date complète est accepté
  assert.equal(Budget.cibleEnVigueur(config.budget_cible, "foyer", "2026-11-14").valide_du, "2026-10");
});

test("cibleEnVigueur : périmètres séparés, perimetres.<p> comme repli, rien sans cible ou sans mois valable", () => {
  const cible = (valide_du, envies) => ({ valide_du, revenus_ref: 4000, blocs: { essentiels: 2000, envies, epargne: 2000 - envies } });
  const bc = { perimetres: { foyer: cible("2026-10", 900), p1: cible("2026-09", 400) }, historique: [{ perimetre: "foyer", valide_du: "2026-06", cible: cible("2026-06", 1000) }] };
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, "foyer", "2026-08").blocs.envies, 1000);
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, "foyer", "2026-10").blocs.envies, 900, "la cible courante n'est pas dans l'historique : elle compte quand même");
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, "p1", "2026-09").blocs.envies, 400);
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, "p1", "2026-08"), null);
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, "p2", "2026-10"), null);
  for (const v of [null, undefined, {}, { budget_cible: null }, { budget_cible: { historique: [] } }]) assert.equal(Budget.cibleEnVigueur(v, "foyer", "2026-10"), null);
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, "foyer", "demain"), null);
  assert.equal(Budget.cibleEnVigueur({ budget_cible: bc }, undefined, "2026-10").valide_du, "2026-10", "périmètre par défaut : le foyer");
});
