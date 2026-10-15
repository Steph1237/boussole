// Graine des comptes fictifs (SEC5) : parties pures (sans pile) et, si la pile locale tourne, parcours réel aal1 / aal2.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { motDePasse, emailDe, FOYERS_DE_BASE, clientsLocaux, compteNeuf } from "../scripts/preprod/graine.mjs";
import { lireFoyer } from "../scripts/preprod/charger-foyer.mjs";
import { hasServiceKey, url } from "./helpers/supabase.mjs";

describe("graine : parties pures", () => {
  it("adresses sur le domaine réservé .test", () => assert.equal(emailDe("jeune-actif"), "jeune-actif@preprod.boussole.test"));
  it("mots de passe : aléatoires, lettres et chiffres, 8 caractères au moins", () => {
    const a = motDePasse(), b = motDePasse();
    assert.notEqual(a, b);
    for (const m of [a, b]) { assert.match(m, /^[A-Za-z0-9]{8,}$/); assert.match(m, /[A-Za-z]/); assert.match(m, /[0-9]/); }
  });
  it("huit foyers de base, dont deux avec double authentification", () => {
    assert.equal(FOYERS_DE_BASE.length, 8);
    assert.deepEqual(FOYERS_DE_BASE.filter(s => lireFoyer(s).mfa).sort(), ["mfa-aal1", "proprietaire-credit"]);
  });
  it("refuse une pile qui n'est pas locale", () => {
    const jwt = c => `x.${Buffer.from(JSON.stringify(c)).toString("base64url")}.y`;
    assert.throws(() => clientsLocaux({ variables: { url: "https://oapcewpqsbbjdlcdeizi.supabase.co", service: jwt({ iss: "supabase-demo" }), publiable: jwt({ iss: "supabase-demo" }) } }), /garde/);
    assert.throws(() => clientsLocaux({ variables: { url: "http://127.0.0.1:54521", service: jwt({ iss: "supabase", ref: "oapcewpqsbbjdlcdeizi" }), publiable: jwt({ iss: "supabase-demo" }) } }), /production/);
  });
});

// Parcours réel : seulement avec la pile locale (npm run preprod:test).
const REEL = hasServiceKey && /127\.0\.0\.1|localhost/.test(url);
describe("graine : comptes réels sur la pile locale", { skip: !REEL && "pile locale non démarrée (npm run preprod:test)" }, () => {
  it("jeton aal2 pour proprietaire-credit, aal1 pour mfa-aal1", async () => {
    const clients = clientsLocaux();
    const a = await compteNeuf("proprietaire-credit", { jeton: "aal2", clients });
    const b = await compteNeuf("mfa-aal1", { clients });
    try { assert.equal(a.aal, "aal2"); assert.equal(b.aal, "aal1"); } finally { await a.supprimer(); await b.supprimer(); }
  });
});
