// The engine's HTTP API, the calls the build sheet lists, over fetch only.
// A node is a URL such as http://hub-1:7481 (the shared library's node on
// hub-1) or http://127.0.0.1:17521 from the host.
export class Node {
  constructor(url, name = url) { this.url = url.replace(/\/$/, ""); this.name = name; }
  async post(path, body, retried = false) {
    const res = await fetch(this.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok || data.error) {
      // A collection is read or written only when every member is local;
      // a member another node just wrote may not be here yet. Fetch and retry once.
      if (!retried && body && body.collection && /needs every member local/.test(String(data.error || text))) { await ensureCollection(this, body.collection); return this.post(path, body, true); }
      throw new Error(`${this.name} ${path}: ${res.status} ${data.error || text.slice(0, 200)}`);
    }
    return data;
  }
  async get(path) { const res = await fetch(this.url + path); if (!res.ok) throw new Error(`${this.name} ${path}: ${res.status}`); return res.json(); }
  // /api/doc/put: one document or a list; returns the ids.
  async put(collection, docs) { return (await this.post("/api/doc/put", Array.isArray(docs) ? { collection, documents: docs } : { collection, document: docs })).ids || []; }
  // /api/doc/find with the full filter operator set; limit 0 is no limit.
  async find(collection, filter = {}, limit = 0) { const body = { collection, filter }; if (limit) body.limit = limit; return (await this.post("/api/doc/find", body)).documents || []; }
  async get1(collection, id) { return (await this.find(collection, { _id: String(id) }, 1))[0] || null; }
  async count(collection, filter = {}) { return (await this.post("/api/doc/count", { collection, filter })).count || 0; }
  // /api/doc/update: Mongo-style update operators; multi and upsert as options.
  async update(collection, filter, update, opts = {}) { return this.post("/api/doc/update", { collection, filter, update, ...opts }); }
  // /api/sql over the node's tables and collections (a collection's fields live in the doc column as JSON).
  async sql(query) { return (await this.post("/api/sql", { query })).rows || []; }
  async tables() { return this.get("/api/tables"); }
  async status() { return this.get("/api/status"); }
  async peers() { return this.get("/api/peers"); }
}
// Wait until a node answers, for scripts that start with the fleet.
export async function ready(node, tries = 60) {
  for (let i = 0; i < tries; i++) { try { await node.status(); return true; } catch { await new Promise((r) => setTimeout(r, 2000)); } }
  throw new Error(`${node.name} did not answer`);
}
// Fetch every member of ONE collection this node is missing, by asking the
// node to replicate it: the engine walks the collection's manifest, which is
// the only list that is right. Do not filter /api/files by name — a fold
// rewrites members as unidatum-compact-N-M.parquet, and a name filter skips
// exactly those, so a node that has folded retries "needs every member local"
// forever (the kitchen display stalled on one for an hour).
export async function ensureCollection(node, collection) {
  try { await node.post("/api/table/replicate", { table: collection }); } catch { return 0; }
  for (let i = 0; i < 40; i++) {
    const files = await node.get("/api/files");
    if (!files.some((f) => !f.local && f.name && !f.name.includes(".cursors."))) break;
    await sleep(500);
  }
  return 1;
}

// A node writes a collection only when every member is local. The engine
// pulls members after a sync on a best-effort basis; a writer makes sure
// by fetching what is still missing (by hash, from /api/files) first.
// Prefix "" fetches everything the node lacks, which is what the checks want;
// a per-collection caller wants ensureCollection above.
export async function ensureLocal(node, prefix = "") {
  const files = await node.get("/api/files");
  const missing = files.filter((f) => !f.local && f.name && f.name.startsWith(prefix) && !f.name.includes(".cursors."));
  for (const f of missing) { try { await node.post("/api/fetch", { hash: f.hash }); } catch {} }
  if (missing.length) for (let i = 0; i < 20; i++) { const again = (await node.get("/api/files")).filter((f) => !f.local && f.name && f.name.startsWith(prefix) && !f.name.includes(".cursors.")); if (!again.length) break; await sleep(500); }
  return missing.length;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How long to promise a customer, in seconds: what the platform learned from
// its own deliveries (bin/learn-promise.mjs), narrowing from the restaurant
// and hub pairing to the fleet-wide figure, and only then to a flat guess.
// A quoted time nobody learned is a number somebody picked.
export const FLAT_PROMISE_S = 40 * 60;
export async function promiseSeconds(euNode, restaurantId, hubId) {
  try {
    const m = await euNode.get1("promise_model", "promise");
    if (!m) return { seconds: FLAT_PROMISE_S, from: "no model yet" };
    const pair = m.by_pair?.[`${restaurantId}|${hubId}`];
    if (pair) return { seconds: pair, from: `p${Math.round(m.target * 100)} of ${restaurantId} via ${hubId}` };
    const r = m.by_restaurant?.[restaurantId];
    if (r) return { seconds: r, from: `p${Math.round(m.target * 100)} of ${restaurantId}` };
    const h = m.by_hub?.[hubId];
    if (h) return { seconds: h, from: `p${Math.round(m.target * 100)} of ${hubId}` };
    return { seconds: m.fallback_s, from: `p${Math.round(m.target * 100)} fleet-wide` };
  } catch {
    return { seconds: FLAT_PROMISE_S, from: "model unreachable" };
  }
}
export const now = () => new Date().toISOString();
// The fleet, by name, from inside the compose network or from the host.
export function fleet(fromHost = process.env.FROM_HOST === "1") {
  const u = (host, port, hostPort) => new Node(fromHost ? `http://127.0.0.1:${hostPort}` : `http://${host}:${port}`, `${host}:${port}`);
  return {
    restaurants: [1, 2, 3].map((i) => ({ id: `r${i}`, ops: u(`restaurant-${i}`, 7480, 17480 + (i - 1) * 10), shared: u(`restaurant-${i}`, 7481, 17481 + (i - 1) * 10) })),
    headOffice: { ops: u("head-office", 7480, 17510), shared: u("head-office", 7481, 17511) },
    hubs: [1, 2].map((i) => ({ id: `hub-${i}`, eu: u(`hub-${i}`, 7480, 17520 + (i - 1) * 10), shared: u(`hub-${i}`, 7481, 17521 + (i - 1) * 10) })),
    analytics: { eu: u("analytics", 7480, 17540), shared: u("analytics", 7481, 17541) },
  };
}
