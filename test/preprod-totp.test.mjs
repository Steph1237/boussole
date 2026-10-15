// TOTP local (RFC 6238, HMAC-SHA1, pas de 30 s, 6 chiffres) pour enrôler et vérifier les facteurs des comptes fictifs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { codeTotp, base32Decode, secretDepuisUri } from "../scripts/preprod/totp.mjs";

// Secret de la RFC 6238 (annexe B) : ASCII « 12345678901234567890 », en base32 comme le renvoie GoTrue.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32Decode", () => {
  it("décode le secret de la RFC", () => assert.equal(base32Decode(SECRET).toString("ascii"), "12345678901234567890"));
  it("accepte minuscules, espaces et remplissage", () => assert.equal(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq====").toString("ascii"), "12345678901234567890"));
  it("refuse un caractère hors alphabet", () => assert.throws(() => base32Decode("GEZD1"), /base32/));
});

describe("codeTotp : vecteurs de la RFC 6238 (SHA-1), tronqués à 6 chiffres", () => {
  const vecteurs = [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]];
  for (const [t, attendu] of vecteurs) {
    it(`T = ${t} s → ${attendu}`, () => assert.equal(codeTotp(SECRET, t * 1000), attendu));
  }
  it("même code sur toute la fenêtre de 30 s", () => {
    assert.equal(codeTotp(SECRET, 30_000), codeTotp(SECRET, 59_999));
    assert.notEqual(codeTotp(SECRET, 59_999), codeTotp(SECRET, 60_000));
  });
  it("décalage de fenêtre", () => assert.equal(codeTotp(SECRET, 59_000, { fenetre: 1 }), codeTotp(SECRET, 89_000)));
  it("instant par défaut : maintenant", () => assert.match(codeTotp(SECRET), /^\d{6}$/));
});

describe("secretDepuisUri", () => {
  it("extrait le secret d'une URI otpauth://", () => assert.equal(secretDepuisUri(`otpauth://totp/Boussole:x@y.test?secret=${SECRET}&issuer=Boussole`), SECRET));
  it("refuse une URI sans secret", () => assert.throws(() => secretDepuisUri("otpauth://totp/x"), /secret/));
});
