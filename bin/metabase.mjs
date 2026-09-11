// Set Metabase up over its API: the admin, the two PostgreSQL wires (the
// analytics node for the platform's tables, the head office for the
// chain's), and the build sheet's four dashboard queries as saved
// questions on one dashboard. Idempotent enough to run twice.
//   docker compose run --rm tools node bin/metabase.mjs
const MB = process.env.METABASE_URL || (process.env.FROM_HOST === "1" ? "http://127.0.0.1:13100" : "http://metabase:3000");
const ADMIN = { email: process.env.MB_EMAIL || "demo@example.com", password: process.env.MB_PASSWORD || "Demo-only-1234", first_name: "Demo", last_name: "Admin" };
const PG_USER = process.env.SQLD_USER || "demo", PG_PASSWORD = process.env.SQLD_PASSWORD || "demo-only-change-me";
const FROM_HOST = process.env.FROM_HOST === "1";
const DBS = [
  { name: "Platform analytics node (platform-eu)", host: FROM_HOST ? "host.docker.internal" : "analytics", port: FROM_HOST ? 15433 : 5433 },
  { name: "Chain head office node (chain-ops)", host: FROM_HOST ? "host.docker.internal" : "head-office", port: FROM_HOST ? 15434 : 5433 },
  { name: "Hub 1 (chain-platform-shared)", host: FROM_HOST ? "host.docker.internal" : "hub-1", port: FROM_HOST ? 15435 : 5433 },
];
// The build sheet's calls for the dashboards, one question each.
const QUESTIONS = [
  { db: 0, name: "Prep time by restaurant (step 3)", sql: "SELECT restaurant_id, day, round(avg(prep_s) / 60.0, 1) AS prep_minutes, count(*) AS orders FROM deliveries_curated GROUP BY restaurant_id, day ORDER BY day, restaurant_id" },
  { db: 0, name: "Delivery time by hub (step 5)", sql: "SELECT hub_id, strftime(CAST(delivered_at AS TIMESTAMP), '%H') AS hour, round(avg(ride_s) / 60.0, 1) AS ride_minutes, sum(CASE WHEN late THEN 1 ELSE 0 END) AS late, count(*) AS orders FROM deliveries_curated GROUP BY hub_id, hour ORDER BY hub_id, hour" },
  { db: 1, name: "Settlement vs sales (step 7)", sql: "SELECT restaurant_id, count(*) AS disputed_lines, sum(CASE WHEN sales_net_cents IS NULL THEN 1 ELSE 0 END) AS no_till_record, sum(mismatch_cents) AS mismatch_cents FROM settlement_mismatches GROUP BY restaurant_id ORDER BY restaurant_id" },
  { db: 2, name: "Orders in flight now (steps 1 to 4)", sql: "SELECT json_extract_string(doc, '$.status') AS status, count(*) AS n FROM (SELECT * FROM platform_orders WHERE NOT _deleted QUALIFY row_number() OVER (PARTITION BY _id ORDER BY _ts DESC) = 1) WHERE json_extract_string(doc, '$.status') IN ('created', 'accepted', 'ready', 'collected') GROUP BY 1 ORDER BY 1" },
];

let session = null;
async function api(method, path, body) {
  const res = await fetch(MB + path, { method, headers: { "content-type": "application/json", ...(session ? { "X-Metabase-Session": session } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}
async function waitHealthy() { for (let i = 0; i < 90; i++) { try { const h = await api("GET", "/api/health"); if (h.status === "ok") return; } catch {} await new Promise((r) => setTimeout(r, 3000)); } throw new Error("Metabase did not come up"); }

await waitHealthy();
const props = await api("GET", "/api/session/properties");
if (props["setup-token"]) {
  const r = await api("POST", "/api/setup", { token: props["setup-token"], user: { ...ADMIN, site_name: "Kitchen to courier" }, prefs: { site_name: "Kitchen to courier", allow_tracking: false } });
  session = r.id; console.log("set up; admin", ADMIN.email);
} else {
  session = (await api("POST", "/api/session", { username: ADMIN.email, password: ADMIN.password })).id; console.log("signed in as", ADMIN.email);
}
const existing = (await api("GET", "/api/database")).data || [];
const dbIds = [];
for (const d of DBS) {
  let db = existing.find((x) => x.name === d.name);
  if (!db) { db = await api("POST", "/api/database", { engine: "postgres", name: d.name, details: { host: d.host, port: d.port, dbname: "p2pfs", user: PG_USER, password: PG_PASSWORD, ssl: false, "tunnel-enabled": false }, is_full_sync: true }); console.log("database:", d.name, "id", db.id); }
  else console.log("database exists:", d.name, "id", db.id);
  dbIds.push(db.id);
}
const cards = (await api("GET", "/api/card")) || [];
const made = [];
for (const q of QUESTIONS) {
  let card = cards.find((c) => c.name === q.name);
  const dataset_query = { type: "native", native: { query: q.sql }, database: dbIds[q.db] };
  if (!card) { card = await api("POST", "/api/card", { name: q.name, display: "table", visualization_settings: {}, dataset_query }); console.log("question:", q.name); }
  else if (card.dataset_query?.native?.query !== q.sql || card.dataset_query?.database !== dbIds[q.db]) { card = await api("PUT", `/api/card/${card.id}`, { dataset_query }); console.log("question updated:", q.name); }
  made.push(card);
}
const dashboards = (await api("GET", "/api/dashboard")) || [];
let dash = dashboards.find((d) => d.name === "Reconciliation and prep-time dashboards");
if (!dash) {
  dash = await api("POST", "/api/dashboard", { name: "Reconciliation and prep-time dashboards", description: "Both parties, each on their own nodes, over the same signed records." });
  try {
    await api("PUT", `/api/dashboard/${dash.id}`, { dashcards: made.map((c, i) => ({ id: -(i + 1), card_id: c.id, row: Math.floor(i / 2) * 6, col: (i % 2) * 12, size_x: 12, size_y: 6 })) });
    console.log("dashboard:", dash.name, "with", made.length, "questions");
  } catch (e) { console.log("dashboard made; adding cards needs the UI on this Metabase version:", e.message.slice(0, 120)); }
} else console.log("dashboard exists:", dash.name);
console.log(`open ${FROM_HOST ? "http://127.0.0.1:13100" : MB} and sign in as ${ADMIN.email}`);
