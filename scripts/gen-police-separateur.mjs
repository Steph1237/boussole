// Génère « Boussole Sep », une micro-police d'un seul caractère : l'espace fine insécable U+202F, à 0,2 em de large (1/5 d'em, la valeur typographique
// de l'espace fine du français). Public Sans, la police de l'app, donne à U+202F 0,121 em seulement (mesuré dans Chrome, 2026-10-15) : à 32 px, « 193 490 € »
// se lit « 193490 € ». La micro-police, déclarée avec unicode-range: U+202F et placée en tête des piles --f-body / --f-display (theme.css), ne change que
// la largeur de ce caractère : les chiffres restent en Public Sans, Fmt garde U+202F (insécable, correct en français, copiable), aucune balise autour des nombres.
// Dégradation : si la police n'est pas lue, la largeur de Public Sans s'applique, rien ne casse.
// Usage : npm run gen (écrit le bloc de web/src/theme.css entre les marqueurs @genere:separateur) ; test/format.test.mjs échoue si le bloc n'est plus à jour.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = rel => fileURLToPath(new URL("../" + rel, import.meta.url));
export const CIBLE = "web/src/theme.css";
export const DEBUT = "/* @genere:separateur — début (scripts/gen-police-separateur.mjs, npm run gen ; ne pas modifier à la main) */\n";
export const FIN = "/* @genere:separateur — fin */\n";
export const UPM = 1000, LARGEUR = 200, CODE = 0x202f;

const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const somme = b => { const p = pad4(b); let s = 0; for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };
/** Écrit des champs big-endian : écrire("HhI", [..]) avec H = uint16, h = int16, I = uint32, q = int64 (BigInt), B = uint8. */
function ecrire(fmt, vals) {
  const taille = { H: 2, h: 2, I: 4, q: 8, B: 1 };
  const b = Buffer.alloc([...fmt].reduce((a, c) => a + taille[c], 0));
  let o = 0;
  [...fmt].forEach((c, i) => {
    const v = vals[i];
    if (c === "H") b.writeUInt16BE(v & 0xffff, o); else if (c === "h") b.writeInt16BE(v, o); else if (c === "I") b.writeUInt32BE(v >>> 0, o);
    else if (c === "q") b.writeBigInt64BE(BigInt(v), o); else b.writeUInt8(v, o);
    o += taille[c];
  });
  return b;
}
const cat = (...bs) => Buffer.concat(bs);

/** Octets de la police TrueType : deux glyphes (.notdef, U+202F vide), une cmap (3, 1) de format 4, les dix tables exigées par les navigateurs. */
export function police() {
  const pts = [[100, 0], [100, 700], [400, 700], [400, 0]];
  let g0 = cat(ecrire("hhhhhHH", [1, 100, 0, 400, 700, 3, 0]), Buffer.from([1, 1, 1, 1]));
  let px = 0, py = 0;
  const xs = [], ys = [];
  for (const [x, y] of pts) { xs.push(ecrire("h", [x - px])); ys.push(ecrire("h", [y - py])); px = x; py = y; }
  g0 = cat(g0, ...xs, ...ys);
  if (g0.length % 2) g0 = cat(g0, Buffer.alloc(1)); /* loca court : longueurs paires */
  const glyf = g0, loca = ecrire("HHH", [0, glyf.length / 2, glyf.length / 2]);
  const head = ecrire("IIIIHHqqhhhhHHhhh", [0x00010000, 0x00010000, 0, 0x5f0f3cf5, 0, UPM, 0, 0, 0, 0, 400, 700, 0, 8, 2, 0, 0]);
  const hhea = ecrire("IhhhHhhhhhhhhhhhH", [0x00010000, 800, -200, 0, 500, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  const maxp = ecrire("IHHHHHHHHHHHHHH", [0x00010000, 2, 4, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const hmtx = ecrire("HhHh", [500, 100, LARGEUR, 0]);
  const corps4 = cat(ecrire("HH", [CODE, 0xffff]), ecrire("H", [0]), ecrire("HH", [CODE, 0xffff]), ecrire("HH", [(1 - CODE) & 0xffff, 1]), ecrire("HH", [0, 0]));
  const fmt4 = cat(ecrire("HHHHHHH", [4, 14 + corps4.length, 0, 4, 4, 1, 0]), corps4);
  const cmap = cat(ecrire("HHHHI", [0, 1, 3, 1, 12]), fmt4);
  const noms = [[1, "Boussole Sep"], [2, "Regular"], [3, "Boussole Sep 1.0"], [4, "Boussole Sep"], [5, "Version 1.0"], [6, "BoussoleSep"]];
  const enc = s => Buffer.from(s, "utf16le").swap16();
  let recs = Buffer.alloc(0), chaines = Buffer.alloc(0);
  for (const [id, s] of noms) { const b = enc(s); recs = cat(recs, ecrire("HHHHHH", [3, 1, 0x409, id, b.length, chaines.length])); chaines = cat(chaines, b); }
  const name = cat(ecrire("HHH", [0, noms.length, 6 + 12 * noms.length]), recs, chaines);
  const os2 = cat(ecrire("H", [3]), ecrire("h", [500]), ecrire("HHH", [400, 5, 0]), ecrire("hhhhhhhhhh", new Array(10).fill(0)), ecrire("h", [0]), Buffer.alloc(10),
    ecrire("IIII", [0, 0, 0, 0]), Buffer.from("NONE"), ecrire("HHH", [0x40, CODE, CODE]), ecrire("hhhHH", [800, -200, 0, 800, 200]), ecrire("II", [1, 0]), ecrire("hhHHH", [0, 0, 0, 0x20, 0]));
  const post = ecrire("IIhhIIIII", [0x00030000, 0, -100, 50, 0, 0, 0, 0, 0]);
  const tables = { "OS/2": os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const n = tags.length, es = Math.floor(Math.log2(n)), sr = 16 * 2 ** es, rs = n * 16 - sr;
  let off = 12 + 16 * n, dir = Buffer.alloc(0), data = Buffer.alloc(0), posHead = 0;
  for (const t of tags) {
    const b = tables[t];
    if (t === "head") posHead = off + data.length;
    dir = cat(dir, Buffer.from(t), ecrire("III", [somme(b), off + data.length, b.length]));
    data = cat(data, pad4(b));
  }
  const font = cat(ecrire("IHHHH", [0x00010000, n, sr, es, rs]), dir, data);
  font.writeUInt32BE((0xb1b0afba - somme(font)) >>> 0, posHead + 8);
  return font;
}
/** Bloc CSS de theme.css (marqueurs compris). */
export function bloc() {
  return DEBUT +
    "@font-face{font-family:\"Boussole Sep\";src:url(data:font/ttf;base64," + police().toString("base64") + ") format(\"truetype\");unicode-range:U+202F;font-display:block}\n" + FIN;
}
export function generer(css) {
  const a = css.indexOf(DEBUT), b = css.indexOf(FIN);
  if (a < 0 || b < a) throw new Error(CIBLE + " : marqueurs @genere:separateur introuvables");
  return css.slice(0, a) + bloc() + css.slice(b + FIN.length);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = readFileSync(racine(CIBLE), "utf8"), neuf = generer(css);
  if (neuf !== css) writeFileSync(racine(CIBLE), neuf);
  console.log("écrit : " + CIBLE + " (bloc @genere:separateur)");
}
