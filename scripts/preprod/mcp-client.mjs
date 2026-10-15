// Client MCP minimal (JSON-RPC sur HTTP « streamable », réponses JSON) pour les parcours de fumée de la préproduction.
// Le banc (phase 7) utilisera le SDK officiel ; ici, quelques appels suffisent et rien n'est installé en plus.
import { assertLocal } from "./garde.mjs";

export function clientMcp(url, jeton) {
  assertLocal(url);
  let id = 0;
  async function rpc(method, params, { notification = false } = {}) {
    const corps = { jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(notification ? {} : { id: ++id }) };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${jeton}`, "MCP-Protocol-Version": "2025-06-18" },
      body: JSON.stringify(corps),
    });
    const texte = await r.text();
    if (notification) return { status: r.status };
    let json = null;
    try { json = JSON.parse(texte); } catch { /* flux SSE ou erreur HTTP non JSON */ }
    if (!json && texte.startsWith("event:")) { const l = texte.split("\n").find(x => x.startsWith("data:")); if (l) json = JSON.parse(l.slice(5)); }
    return { status: r.status, headers: r.headers, json, texte };
  }
  return {
    rpc,
    async initialiser() {
      const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fumee-preprod", version: "1" } });
      if (r.json?.result) await rpc("notifications/initialized", undefined, { notification: true });
      return r;
    },
    async outils() { const r = await rpc("tools/list", {}); return r.json?.result?.tools ?? []; },
    async appeler(nom, args = {}) {
      const r = await rpc("tools/call", { name: nom, arguments: args });
      const res = r.json?.result;
      const texte = (res?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
      let donnees = null; try { donnees = JSON.parse(texte); } catch { /* texte libre */ }
      return { status: r.status, erreur: !!(res?.isError || r.json?.error), texte: texte || r.json?.error?.message || r.texte, donnees, brut: r.json };
    },
  };
}
