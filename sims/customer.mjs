// The customer app: places orders on a hub (the platform creates the
// order document, step 1 of the flow) and tracks one to the door.
//   step 1      /api/doc/put   the order document, status created
//   step 2 to 5 /api/doc/get   order_id   the customer tracks the order
import { fleet, ready, sleep, now } from "../lib/api.mjs";
const F = fleet();
const N = Number(process.env.ORDERS || 3);
const hid = process.env.HUB || "hub-1";
const h = F.hubs.find((x) => x.id === hid);
await ready(h.shared);
const menus = {};
for (const r of F.restaurants) { await ready(r.ops); menus[r.id] = await r.ops.find("menu", { restaurant_id: r.id, available: true }, 200); }
const placed = [];
for (let i = 0; i < N; i++) {
  const r = F.restaurants[i % F.restaurants.length];
  const m = menus[r.id];
  const items = [m[i % m.length], m[(i * 7) % m.length]].map((x) => ({ item_id: x.item_id, qty: 1, price_cents: x.price_cents }));
  const id = `o-live-${Date.now().toString(36)}-${i}`;
  const o = { _id: id, order_id: id, restaurant_id: r.id, hub_id: hid, customer_id: `cust-demo-${i + 1}`, items, total_cents: items.reduce((a, it) => a + it.qty * it.price_cents, 0), status: "created", created_at: now(), promised_at: new Date(Date.now() + 40 * 60000).toISOString() };
  await h.shared.put("platform_orders", o);
  placed.push(id);
  console.log(`placed ${id} at ${r.id} for ${o.total_cents} cents`);
}
// Track the first one until it is delivered (or for two minutes).
const deadline = Date.now() + 120000;
let last = "";
while (Date.now() < deadline) {
  const o = await h.shared.get1("platform_orders", placed[0]);
  const line = o ? `${o.status}${o.courier_id ? " by " + o.courier_id : ""}` : "not yet visible";
  if (line !== last) { console.log(`${placed[0]}: ${line}`); last = line; }
  if (o?.status === "delivered") break;
  await sleep(2000);
}
