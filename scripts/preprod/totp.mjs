// Code TOTP (RFC 6238 : HMAC-SHA1, pas de 30 s, 6 chiffres), sans dépendance. Sert à enrôler et vérifier la double authentification
// des comptes fictifs de la préproduction : le banc obtient ainsi un jeton aal2 exactement comme un utilisateur.
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Décode une chaîne base32 (RFC 4648) : majuscules ou minuscules, espaces et « = » ignorés. */
export function base32Decode(s) {
  const propre = String(s).replace(/[\s=]/g, "").toUpperCase();
  let bits = 0, valeur = 0;
  const out = [];
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i === -1) throw new Error(`base32 : caractère « ${c} » hors alphabet`);
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((valeur >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Code à 6 chiffres à l'instant `instant` (ms). `fenetre` décale de ±n pas de 30 s (essai d'un code voisin). */
export function codeTotp(secretBase32, instant = Date.now(), { fenetre = 0, chiffres = 6, pas = 30 } = {}) {
  const compteur = Math.floor(instant / 1000 / pas) + fenetre;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** chiffres).padStart(chiffres, "0");
}

/** Secret d'une URI otpauth://totp/…?secret=… (GoTrue renvoie le secret et l'URI à l'enrôlement). */
export function secretDepuisUri(uri) {
  const m = String(uri).match(/[?&]secret=([A-Za-z2-7=]+)/);
  if (!m) throw new Error("URI otpauth sans secret");
  return m[1];
}
