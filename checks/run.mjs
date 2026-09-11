// The checks of the MVP sheet, section 6, one function each, over the
// engine's HTTP API. The build is done when they all pass.
//   docker compose run --rm tools node checks/run.mjs        (in the network)
//   FROM_HOST=1 node checks/run.mjs                           (from the host)
import { fleet, ready, ensureLocal, sleep, now } from "../lib/api.mjs";
const F = fleet();
const SEED = { menu: 120, couriers: 60, orders: 1000, delivered: 988 };
const results = [];
const check = async (n, name, fn) => { try { const detail = await fn(); results.push({ n, name, ok: true, detail }); console.log(`ok   ${String(n).padStart(2)}  ${name}${detail ? `  (${detail})` : ""}`); } catch (e) { results.push({ n, name, ok: false, detail: e.message }); console.log(`FAIL ${String(n).padStart(2)}  ${name}: ${e.message}`); } };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sqlN = async (node, q) => Number((await node.sql(q))[0]?.n ?? NaN);
const liveOrders = async () => F.hubs[0].shared.find("platform_orders", { _id: { $regex: "^o-live-" } }, 500);

for (const n of [F.hubs[0].shared, F.hubs[0].eu, F.restaurants[0].ops, F.headOffice.ops, F.headOffice.shared, F.analytics.eu, F.analytics.shared]) await ready(n);
await ensureLocal(F.hubs[0].shared, ""); await ensureLocal(F.headOffice.shared, "");
const live = await liveOrders();
const delivered = await F.hubs[0].shared.count("platform_orders", { status: "delivered" });

// Counts: what was seeded plus what the script wrote.
await check(1, "menu: count equals what was seeded plus what the script wrote", async () => { const c = await F.restaurants[0].ops.count("menu"); expect(c === SEED.menu, `${c} documents, seeded ${SEED.menu}`); return `${c}`; });
await check(2, "platform_orders: count equals what was seeded plus what the script wrote", async () => { const c = await F.hubs[0].shared.count("platform_orders"); expect(c === SEED.orders + live.length, `${c} documents, seeded ${SEED.orders} + ${live.length} live`); return `${c} = ${SEED.orders} + ${live.length}`; });
await check(3, "menu_published: count equals what was seeded plus what the script wrote", async () => { const c = await sqlN(F.headOffice.shared, "SELECT count(DISTINCT restaurant_id || ':' || item_id) AS n FROM menu_published"); expect(c === SEED.menu, `${c} published items, menu has ${SEED.menu}`); return `${c} items published`; });
await check(4, "settlements: count equals what was seeded plus what the script wrote", async () => { const c = await sqlN(F.analytics.shared, "SELECT count(DISTINCT order_id) AS n FROM settlements"); expect(c === delivered, `${c} settled, ${delivered} delivered`); return `${c} = delivered orders`; });
await check(5, "couriers: count equals what was seeded plus what the script wrote", async () => { const c = await F.hubs[0].eu.count("couriers"); expect(c === SEED.couriers, `${c}, seeded ${SEED.couriers}`); return `${c}`; });
// Signatures: the other side holds the table's versions and its log shows nothing rejected.
const verified = async (node, table, who) => { const files = await node.get("/api/files"); const heads = files.filter((f) => f.name === `${table}.table` && f.head); expect(heads.length > 0, `${node.name} has no version of ${table}`); const log = (await node.get("/api/log")).lines || []; const bad = log.filter((l) => /rejected [1-9]/.test(l.text)); expect(bad.length === 0, `${node.name} rejected ops: ${bad[0]?.text}`); const merged = log.filter((l) => /merged \d+ op\(s\), rejected 0/.test(l.text)).length; return `${who} verified ${merged} merges, none rejected; ${heads.length} head version(s) of ${table}`; };
await check(6, "menu_published: every commit carries the chain's signature and the platform verifies it", () => verified(F.hubs[0].shared, "menu_published", "hub-1"));
await check(7, "settlements: every commit carries the platform's signature and the chain verifies it", () => verified(F.headOffice.shared, "settlements", "head-office"));
// The port writes along a live order: pick the newest delivered live order.
const done = live.filter((o) => o.status === "delivered").sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
const need = (o, f) => { expect(o, "no live order has been delivered yet: run sims/customer.mjs with the simulators up"); expect(o[f], `${o?._id} has no ${f}`); return `${o._id}: ${f} ${o[f]}`; };
await check(8, "after Create the order document: platform_orders writes the order", () => need(done, "created_at"));
await check(9, "after Accept in the kitchen: platform_orders writes accepted", () => need(done, "accepted_at"));
await check(10, "after Mark ready: platform_orders writes ready", () => need(done, "ready_at"));
await check(11, "after Collect and deliver: platform_orders writes collected, delivered", () => { need(done, "collected_at"); return need(done, "delivered_at"); });
// The menu: an edit lands on the document and is published, signed, within five minutes.
const item = (await F.restaurants[0].ops.find("menu", { restaurant_id: "r1" }, 1))[0];
const newPrice = (item.price_cents === 999 ? 1099 : 999);
const t0 = Date.now();
await F.restaurants[0].ops.update("menu", { _id: item._id }, { $set: { price_cents: newPrice, available: true } });
await check(12, "after Edit the menu: menu writes price, availability", async () => { const m = await F.restaurants[0].ops.get1("menu", item._id); expect(m.price_cents === newPrice && m.available === true, `menu still ${m.price_cents}`); return `${item._id} now ${newPrice}`; });
let publishedAt = null;
await check(13, "after Publish, signed: menu_published writes the published rows", async () => { for (let i = 0; i < 60; i++) { await ensureLocal(F.hubs[0].shared, ""); const rows = await F.hubs[0].shared.sql(`SELECT price_cents FROM menu_published WHERE restaurant_id = 'r1' AND item_id = '${item.item_id}' ORDER BY published_at DESC LIMIT 1`); if (rows[0] && Number(rows[0].price_cents) === newPrice) { publishedAt = Date.now(); return `hub-1 reads ${newPrice} after ${((publishedAt - t0) / 1000).toFixed(0)} s`; } await sleep(5000); } throw new Error("the new price did not reach the platform in five minutes"); });
await check(14, "after Publish the statement, signed: settlements writes one row per order", async () => { const c = await sqlN(F.headOffice.shared, "SELECT count(DISTINCT order_id) AS n FROM settlements"); expect(c === delivered, `${c} rows at the head office, ${delivered} delivered`); return `${c} rows read at the head office`; });
// Service levels over the run.
await check(15, "Promised time kept: placed to delivered within the promise, 95% of orders", async () => { const rows = await F.analytics.eu.sql("SELECT sum(CASE WHEN late THEN 0 ELSE 1 END) AS ok, count(*) AS n FROM deliveries_curated"); const ok = Number(rows[0].ok), n = Number(rows[0].n); expect(n > 0 && ok / n >= 0.95, `${ok} of ${n} on time`); return `${((100 * ok) / n).toFixed(1)}% of ${n} on time`; });
await check(16, "Change live in five minutes: edit to live within 5 minutes", async () => { expect(publishedAt, "the price change never went live"); const s = (publishedAt - t0) / 1000; expect(s <= 300, `${s.toFixed(0)} s`); return `${s.toFixed(0)} s`; });
await check(17, "Paid within nine days: week close to paid within 9 days", async () => { const rows = await F.analytics.shared.sql("SELECT max(date_diff('day', CAST(delivered_at AS TIMESTAMP), to_timestamp(settled_at / 1000))) AS n FROM settlements"); const d = Number(rows[0].n); expect(d <= 9, `${d} days`); return `at most ${d} day(s) from delivery to the statement`; });
// The dashboards' queries return rows.
await check(18, "Reconciliation and prep-time dashboards: Prep time by restaurant returns rows", async () => { const r = await F.analytics.eu.sql("SELECT restaurant_id, round(avg(prep_s) / 60.0, 1) AS prep_minutes FROM deliveries_curated GROUP BY restaurant_id"); expect(r.length > 0, "no rows"); return r.map((x) => `${x.restaurant_id} ${x.prep_minutes} min`).join(", "); });
await check(19, "Reconciliation and prep-time dashboards: Delivery time by hub returns rows", async () => { const r = await F.analytics.eu.sql("SELECT hub_id, round(avg(ride_s) / 60.0, 1) AS ride_minutes FROM deliveries_curated GROUP BY hub_id"); expect(r.length > 0, "no rows"); return r.map((x) => `${x.hub_id} ${x.ride_minutes} min`).join(", "); });
await check(20, "Reconciliation and prep-time dashboards: Settlement vs sales returns rows", async () => { const r = await F.headOffice.ops.sql("SELECT restaurant_id, count(*) AS mismatches FROM settlement_mismatches GROUP BY restaurant_id"); expect(r.length > 0, "no mismatches found (the seed plants about 2%)"); return r.map((x) => `${x.restaurant_id} ${x.mismatches}`).join(", "); });
await check(21, "Reconciliation and prep-time dashboards: Orders in flight now returns rows", async () => { const r = await F.hubs[0].shared.sql("SELECT json_extract_string(doc, '$.status') AS status, count(*) AS n FROM (SELECT * FROM platform_orders WHERE NOT _deleted QUALIFY row_number() OVER (PARTITION BY _id ORDER BY _ts DESC) = 1) WHERE json_extract_string(doc, '$.status') IN ('created', 'accepted', 'ready', 'collected') GROUP BY 1 ORDER BY 1"); return r.length ? r.map((x) => `${x.status} ${x.n}`).join(", ") : "none in flight"; });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks pass${failed.length ? `; failed: ${failed.map((f) => f.n).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
