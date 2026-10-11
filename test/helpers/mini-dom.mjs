// Mini-DOM factice partagé par les tests de composants (ui.test.mjs) et de vues (journal-view.test.mjs).
/* ============================================================ mini-DOM factice ============================================================
   Juste ce qu'utilise ui.js : analyse d'un HTML bien formé, sélecteurs simples (balise, #id, .classe, [attr], [attr="v"], [attr^="v"],
   listes séparées par des virgules), closest, événements qui remontent jusqu'au document, focus et activeElement, inert, hidden. */
export function miniDom() {
  const VIDES = new Set(["input", "br", "img", "hr", "meta", "link", "path", "circle", "rect", "line", "polyline"]);
  const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const ecoute = (cible, type, f, cap) => { (cible.ls[type] ||= []).push({ f, cap: !!(cap && (cap === true || cap.capture)) }); };
  const retire = (cible, type, f, cap) => {
    const c = !!(cap && (cap === true || cap.capture));
    cible.ls[type] = (cible.ls[type] || []).filter(x => !(x.f === f && x.cap === c));
  };
  class Ev {
    constructor(type, init) { Object.assign(this, { type, defaultPrevented: false, arret: false }, init || {}); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.arret = true; }
  }
  function correspond(el, sel) {
    return sel.split(",").some(s => {
      const m = /^([a-zA-Z][\w-]*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/.exec(s.trim());
      if (!m) throw new Error("sélecteur non géré par le mini-DOM : " + s);
      if (m[1] && el.localName !== m[1].toLowerCase()) return false;
      return (m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []).every(p => {
        if (p[0] === "#") return el.getAttribute("id") === p.slice(1);
        if (p[0] === ".") return el.classList.contains(p.slice(1));
        const a = /^\[([\w-]+)(?:(\^?=)"?([^"]*)"?)?\]$/.exec(p);
        if (!el.hasAttribute(a[1])) return false;
        if (!a[2]) return true;
        const v = el.getAttribute(a[1]);
        return a[2] === "=" ? v === a[3] : v.startsWith(a[3]);
      });
    });
  }
  class El {
    constructor(tag) { this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.ls = {}; this.inert = false; this.focusCount = 0; }
    get nodeType() { return 1; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
    setAttribute(n, v) { this.attrs.set(n, String(v)); }
    removeAttribute(n) { this.attrs.delete(n); }
    hasAttribute(n) { return this.attrs.has(n); }
    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this.getAttribute("class") || ""; }
    set className(v) { this.setAttribute("class", v); }
    get classList() {
      const el = this, lire = () => el.className.split(/\s+/).filter(Boolean);
      return {
        contains: c => lire().includes(c),
        add: (...cs) => el.className = [...new Set(lire().concat(cs))].join(" "),
        remove: (...cs) => el.className = lire().filter(x => !cs.includes(x)).join(" "),
        toggle: (c, f) => { const on = f == null ? !lire().includes(c) : f; on ? el.classList.add(c) : el.classList.remove(c); return on; },
      };
    }
    /* dataset : attributs data-* (camelCase ↔ kebab-case), en lecture, écriture et suppression. */
    get dataset() {
      const el = this, nom = k => "data-" + String(k).replace(/[A-Z]/g, c => "-" + c.toLowerCase());
      return new Proxy({}, {
        get: (t, k) => (typeof k === "string" && el.hasAttribute(nom(k)) ? el.getAttribute(nom(k)) : undefined),
        set: (t, k, v) => { el.setAttribute(nom(k), v); return true; },
        deleteProperty: (t, k) => { el.removeAttribute(nom(k)); return true; },
        has: (t, k) => el.hasAttribute(nom(k)),
      });
    }
    get hidden() { return this.hasAttribute("hidden"); }
    set hidden(v) { v ? this.setAttribute("hidden", "") : this.removeAttribute("hidden"); }
    get type() { return this.getAttribute("type") || ""; }
    get value() { return this._value != null ? this._value : this.getAttribute("value") || ""; }
    set value(v) { this._value = String(v); }
    get textContent() { return this.childNodes.map(n => (n.nodeType === 3 ? n.text : n.textContent)).join(""); }
    set textContent(v) { this.childNodes.forEach(n => n.parentNode = null); this.childNodes = [{ nodeType: 3, text: String(v), parentNode: this }]; }
    get innerHTML() { return this._html || ""; }
    set innerHTML(html) { this.childNodes.forEach(n => n.parentNode = null); this.childNodes = []; this._html = String(html); analyser(String(html), this); }
    appendChild(n) { if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter(x => x !== n); n.parentNode = this; this.childNodes.push(n); return n; }
    remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter(x => x !== this); this.parentNode = null; }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    descendants() { return this.children.flatMap(c => [c].concat(c.descendants())); }
    querySelectorAll(sel) { return this.descendants().filter(e => correspond(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    matches(sel) { return correspond(this, sel); }
    closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (correspond(x, sel)) return x; return null; }
    addEventListener(t, f, c) { ecoute(this, t, f, c); }
    removeEventListener(t, f, c) { retire(this, t, f, c); }
    dispatchEvent(e) {
      e.target = this;
      const chemin = []; for (let x = this; x; x = x.parentNode) chemin.push(x);
      if (this.isConnected) chemin.push(doc);
      for (const n of chemin.slice().reverse()) for (const l of (n.ls[e.type] || []).filter(l => l.cap)) { e.currentTarget = n; l.f.call(n, e); }
      for (const n of chemin) { for (const l of (n.ls[e.type] || []).filter(l => !l.cap)) { e.currentTarget = n; l.f.call(n, e); } if (e.arret) break; }
      return !e.defaultPrevented;
    }
    get isConnected() { for (let x = this; x; x = x.parentNode) if (x === doc.body) return true; return false; }
    focus() {
      if (!this.isConnected) return; // comme un navigateur : un élément détaché ne prend pas le focus
      for (let x = this; x; x = x.parentNode) if (x.inert) return; // un élément inerte ne prend pas le focus
      doc.activeElement = this; this.focusCount++;
      this.dispatchEvent(new Ev("focusin"));
    }
    click() { this.dispatchEvent(new Ev("click")); }
  }
  function analyser(html, parent) {
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)>|([^<]+)/g;
    let cur = parent, m;
    while ((m = re.exec(html))) {
      if (m[5] != null) { cur.childNodes.push({ nodeType: 3, text: decode(m[5]), parentNode: cur }); continue; }
      if (!m[2]) continue;
      const tag = m[2].toLowerCase();
      if (m[1]) { let n = cur; while (n && n !== parent && n.localName !== tag) n = n.parentNode; if (n && n !== parent) cur = n.parentNode; continue; }
      const el = new El(tag);
      for (const a of m[3].matchAll(/([^\s=\/]+)(?:="([^"]*)"|='([^']*)')?/g)) el.attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? ""));
      cur.appendChild(el);
      if (!m[4] && !VIDES.has(tag)) cur = el;
    }
  }
  const doc = {
    ls: {}, activeElement: null,
    createElement: t => new El(t),
    addEventListener(t, f, c) { ecoute(doc, t, f, c); },
    removeEventListener(t, f, c) { retire(doc, t, f, c); },
  };
  doc.documentElement = new El("html");
  doc.body = doc.documentElement.appendChild(new El("body"));
  doc.activeElement = doc.body;
  const touche = (el, key, extra) => { const e = new Ev("keydown", Object.assign({ key }, extra)); el.dispatchEvent(e); return e; };
  const changer = el => el.dispatchEvent(new Ev("change"));
  return { doc, Ev, touche, changer };
}

