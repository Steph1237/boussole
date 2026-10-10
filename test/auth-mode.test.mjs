// Mode d'authentification sans e-mail (décision du 2026-10-10) : pas de SMTP, comptes anonymes
// « Commencer sans e-mail », inscription sans confirmation, sécurisation du compte anonyme plus tard.
// Contrôles statiques des pages + exécution d'auth.js dans un bac à sable avec un faux client Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const config = read("web/config.js");
const authJs = read("web/src/auth.js");
const landing = read("web/index.html");
const landingJs = read("web/src/landing.js");
const appJs = read("web/src/app.js");
const shell = read("web/src/shell.html");
const compte = read("web/compte.html");
const accountJs = read("web/src/account.js");
const consent = read("web/oauth/consent.html");
const consentJs = read("web/src/consent.js");
const confid = read("web/legal/confidentialite.html");
const toml = read("supabase/config.toml");

// auth.js chargé avec un faux supabase-js : on enregistre les appels à auth.*.
function loadAuth({ emails = false, updateUser } = {}) {
  const calls = [];
  const auth = {
    getSession: async () => ({ data: { session: null } }),
    signInAnonymously: async () => { calls.push(["signInAnonymously"]); return { data: { session: { user: { is_anonymous: true } } }, error: null }; },
    signInWithOtp: async a => { calls.push(["signInWithOtp", a]); return { data: {}, error: null }; },
    updateUser: async a => { calls.push(["updateUser", a]); return updateUser ? updateUser(a) : { data: { user: { email: a.email, is_anonymous: false } }, error: null }; },
    refreshSession: async () => { calls.push(["refreshSession"]); return { data: {}, error: null }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  };
  const window = {
    BOUSSOLE: { supabaseUrl: "https://x.supabase.co", supabaseKey: "k", base: "./", emails },
    location: { search: "", href: "https://ex.org/boussole/index.html" },
    supabase: { createClient: () => ({ auth }) },
  };
  const ctx = { window, location: window.location, URL, console };
  vm.runInNewContext(authJs, ctx);
  return { Auth: window.Auth, calls };
}

test("config : drapeau emails présent et à false (pas de SMTP)", () => {
  assert.match(config, /\bemails:\s*false\b/);
  assert.match(toml, /enable_anonymous_sign_ins\s*=\s*true/);
  assert.match(toml, /enable_confirmations\s*=\s*false/);
  assert.match(toml, /minimum_password_length\s*=\s*8/);
  assert.match(toml, /password_requirements\s*=\s*"letters_digits"/);
});

test("auth.js : signInAnon, isAnonymous, secureAccount, règles de mot de passe", async () => {
  const { Auth, calls } = loadAuth();
  assert.equal(Auth.emails, false);
  await Auth.signInAnon();
  assert.deepEqual(calls.at(-1), ["signInAnonymously"]);
  assert.equal(Auth.isAnonymous({ user: { is_anonymous: true } }), true);
  assert.equal(Auth.isAnonymous({ user: { is_anonymous: false } }), false);
  assert.equal(Auth.isAnonymous(null), false);

  await Auth.secureAccount("a@b.fr", "abcd1234");
  const up = calls.find(c => c[0] === "updateUser");
  assert.equal(JSON.stringify(up[1]), JSON.stringify({ email: "a@b.fr", password: "abcd1234" }));

  assert.match(Auth.passwordProblem("abc12"), /8 caractères/);
  assert.match(Auth.passwordProblem("abcdefgh"), /lettres et des chiffres/);
  assert.match(Auth.passwordProblem("12345678"), /lettres et des chiffres/);
  assert.equal(Auth.passwordProblem("abcd1234"), null);
  assert.match(Auth.weakPasswordText({ code: "weak_password", cause: { reasons: ["characters"] } }), /lettres et des chiffres/);
  assert.match(Auth.weakPasswordText({ message: "Password should be at least 8 characters." }), /8 caractères minimum/);
  assert.equal(Auth.weakPasswordText({ code: "invalid_credentials" }), null);
});

test("auth.js : secureAccount explique en français si le serveur exige une confirmation", async () => {
  const { Auth } = loadAuth({ updateUser: a => ({ data: { user: { email: null, new_email: a.email, is_anonymous: true } }, error: null }) });
  await assert.rejects(Auth.secureAccount("a@b.fr", "abcd1234"), e => e.code === "email_confirmation_required" && /n'envoie pas d'e-mail/.test(e.message));
});

test("accueil : « Commencer sans e-mail » branché sur signInAnon, démo en lien tertiaire", () => {
  assert.match(landing, /<button[^>]*id="anonStart"[^>]*>Commencer sans e-mail<\/button>/);
  assert.ok(landing.includes("Vos données sont enregistrées tout de suite. Ajoutez un e-mail plus tard pour les retrouver sur un autre appareil."));
  assert.match(landing, /data-auth="signup">Créer un compte</);
  assert.match(landing, /data-auth="signin">Se connecter</);
  assert.match(landing, /href="app\.html\?demo">Essayer la démo</);
  assert.ok(landing.includes("8 caractères minimum, avec des lettres et des chiffres"));
  assert.ok(landing.includes("Mot de passe oublié : sans service d'e-mail, la réinitialisation n'est pas encore possible. Écrivez à"));
  assert.match(landingJs, /\$\("anonStart"\)/);
  assert.match(landingJs, /anonBtn\.addEventListener\("click"[\s\S]*?A\.signInAnon\(\)[\s\S]*?goApp\(\)/);
});

test("accueil : aucun lien magique ni « boîte mail » quand emails:false", () => {
  // Bouton masqué par défaut, ne réapparaît que si EMAILS ; écouteur et appel signInMagic seulement sous if (EMAILS).
  assert.match(landing, /<button[^>]*id="authMagic"[^>]*\bhidden\b/);
  assert.match(landingJs, /const EMAILS = B\.emails === true;/);
  assert.match(landingJs, /magic\.hidden = !EMAILS\b/);
  const guard = landingJs.indexOf("if (EMAILS) {\n    magic.addEventListener");
  assert.ok(guard > 0, "écouteur du lien magique sous if (EMAILS)");
  assert.equal(landingJs.indexOf("signInMagic"), landingJs.indexOf("signInMagic", guard), "signInMagic appelé seulement dans la branche EMAILS");
  // Inscription : sans e-mail, on entre directement dans l'app avant tout message « boîte mail ».
  const noMail = landingJs.indexOf("if (!EMAILS) {");
  const box = landingJs.indexOf("Vérifiez votre boîte mail");
  assert.ok(noMail > 0 && box > noMail, "branche sans e-mail avant le message boîte mail");
  assert.match(landingJs.slice(noMail, box), /goApp\(\); return;/);
});

test("app : bandeau #anonBanner pour une session anonyme, lien « Sécuriser mon compte »", () => {
  assert.match(shell, /<div id="anonBanner" class="banner anon"[^>]*hidden>/);
  assert.ok(shell.includes("Compte sans e-mail : vos données sont liées à ce navigateur. Sécurisez votre compte pour les retrouver ailleurs et éviter leur suppression après 90 jours d'inactivité."));
  assert.match(shell, /href="compte\.html#securiser"/);
  assert.match(appJs, /Auth\.session\(\)\.then\(anonAccount/);
  assert.match(appJs, /if \(!demo && window\.Auth/);
  assert.match(appJs, /is_anonymous/);
  assert.match(appJs, /\$\("anonBanner"\)/);
  assert.match(appJs, /sessionStorage/);
  assert.match(appJs, /"Sécuriser mon compte"/);
});

test("compte : section #securiser (secureAccount), changement d'adresse immédiat sans e-mail", () => {
  assert.match(compte, /<section[^>]*id="securiser"[^>]*hidden>/);
  for (const id of ["secEmail", "secPw1", "secPw2", "cardEmail", "cardPw", "emailNote"]) assert.ok(compte.includes(`id="${id}"`), id);
  assert.match(accountJs, /A\.secureAccount\(/);
  assert.match(accountJs, /\$\("securiser"\)\.hidden = !anon/);
  assert.match(accountJs, /\$\("cardEmail"\)\.hidden = anon/);
  assert.match(accountJs, /SUPPRIMER/);
  assert.ok(compte.includes("Le changement est immédiat : aucun e-mail de confirmation n'est envoyé."));
});

test("consentement : mot de passe seul, compte anonyme bloqué", () => {
  assert.match(consent, /<div id="otpBox"[^>]*hidden>/);
  assert.match(consentJs, /\$\("otpBox"\)\.hidden = !EMAILS/);
  assert.match(consentJs, /if \(EMAILS\) \$\("otpBtn"\)\.addEventListener/);
  assert.match(consent, /data-state="anon"/);
  assert.ok(consent.includes("Pour brancher un assistant, ajoutez d'abord un e-mail et un mot de passe à votre compte"));
  assert.ok(consent.includes('href="../compte.html#securiser"'));
  assert.match(consentJs, /if \(isAnon\(session\)\) return show\("anon"\)/);
});

test("confidentialité : comptes anonymes, purge à 90 jours, aucun e-mail envoyé", () => {
  assert.match(confid, /anonyme/);
  assert.match(confid, /90 jours/);
  assert.match(confid, /n'envoie aucun e-mail/);
});
