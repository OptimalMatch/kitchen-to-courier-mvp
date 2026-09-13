// The seed: the stores of the build sheet at the MVP sheet's scale, with
// the fields the sheet lists and who sets them. Runs once, from inside
// the compose network (or from the host with FROM_HOST=1).
//
//   menu            chain-ops, one document per item per restaurant, set by head office and the kitchen
//   couriers        platform-eu, one per courier, set by the courier app and dispatch
//   platform_orders the shared library, one per order, a week of history plus a few live ones
//   sales           chain-ops, the chain's own till record of every delivered order (what settlements reconcile against)
import { fleet, ready, now } from "../lib/api.mjs";
import { PICKUPS, delivery } from "../lib/addresses.mjs";

const F = fleet();
const ORDERS = Number(process.env.SEED_ORDERS || 1000);
const ITEMS_PER_RESTAURANT = Number(process.env.SEED_ITEMS || 40);
const COURIERS = Number(process.env.SEED_COURIERS || 60);
const FEE = 0.25;
// Deterministic pseudo-random, so a re-seed gives the same data.
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const iso = (t) => new Date(t).toISOString();

const DISHES = ["Margherita", "Diavola", "Quattro formaggi", "Calzone", "Caesar salad", "Garlic bread", "Tiramisu", "Lasagne", "Carbonara", "Arrabbiata", "Bruschetta", "Panna cotta", "Minestrone", "Risotto", "Gnocchi", "Focaccia", "Caprese", "Affogato", "Espresso", "Limonata"];
const SUPPLIERS = ["Dublin Fresh", "Valley Dairy", "Harbour Fish", "Northside Bakery"];
const CENTRE = [-6.26, 53.35]; // Dublin

async function main() {
  for (const r of F.restaurants) await ready(r.ops);
  await ready(F.hubs[0].eu); await ready(F.hubs[0].shared); await ready(F.headOffice.ops);
  const t0 = Date.now();

  // 1. Menus: prices from head office, availability from the kitchen (both write chain-ops through the restaurant's node).
  const menus = {};
  for (const r of F.restaurants) {
    const docs = [];
    for (let i = 0; i < ITEMS_PER_RESTAURANT; i++) {
      const item_id = `it-${String(i + 1).padStart(3, "0")}`;
      docs.push({ _id: `${r.id}:${item_id}`, restaurant_id: r.id, item_id, name: `${DISHES[i % DISHES.length]}${i >= DISHES.length ? " " + (Math.floor(i / DISHES.length) + 1) : ""}`, price_cents: 450 + Math.floor(rnd() * 26) * 50, available: rnd() > 0.08, prep_notes: pick(["", "nut free on request", "spicy", "vegan option"]), supplier: pick(SUPPLIERS) });
    }
    await r.ops.put("menu", docs); menus[r.id] = docs;
    console.log(`menu: ${docs.length} items on ${r.id}`);
  }

  // 2. Couriers: 30 per hub, near the hub, available or off shift.
  const couriers = [];
  for (const [hi, h] of F.hubs.entries()) {
    for (let i = 0; i < COURIERS / F.hubs.length; i++) {
      const id = `${h.id}-c${String(i + 1).padStart(2, "0")}`;
      couriers.push({ _id: id, courier_id: id, hub_id: h.id, state: rnd() > 0.2 ? "available" : "off", location: { type: "Point", coordinates: [CENTRE[0] + (hi ? 0.06 : -0.06) + (rnd() - 0.5) * 0.08, CENTRE[1] + (rnd() - 0.5) * 0.06] }, current_order: null, updated_at: now() });
    }
  }
  await F.hubs[0].eu.put("couriers", couriers);
  console.log(`couriers: ${couriers.length} on platform-eu`);

  // 3. A week of orders: the platform creates each, the kitchen and the courier set their fields, most are delivered.
  const orders = [], sales = [];
  const week = 7 * 24 * 3600 * 1000;
  for (let i = 0; i < ORDERS; i++) {
    const r = pick(F.restaurants), h = pick(F.hubs);
    const created = t0 - week + Math.floor(rnd() * (week - 3600 * 1000));
    const n = 1 + Math.floor(rnd() * 3);
    const items = Array.from({ length: n }, () => { const m = pick(menus[r.id]); return { item_id: m.item_id, qty: 1 + Math.floor(rnd() * 2), price_cents: m.price_cents }; });
    const total_cents = items.reduce((a, it) => a + it.qty * it.price_cents, 0);
    const accepted = created + 20000 + Math.floor(rnd() * 60000), readyAt = accepted + 8 * 60000 + Math.floor(rnd() * 8 * 60000);
    const collected = readyAt + 2 * 60000 + Math.floor(rnd() * 6 * 60000), delivered = collected + 8 * 60000 + Math.floor(rnd() * 10 * 60000);
    const live = i >= ORDERS - 12; // the last few are still open, for the demo to walk
    const courier = pick(couriers.filter((c) => c.hub_id === h.id));
    const o = { _id: `o-${String(i + 1).padStart(5, "0")}`, order_id: `o-${String(i + 1).padStart(5, "0")}`, restaurant_id: r.id, hub_id: h.id, customer_id: `cust-${1 + Math.floor(rnd() * 400)}`, items, total_cents, status: live ? "created" : "delivered", created_at: iso(created), promised_at: iso(created + 40 * 60000), pickup: PICKUPS[r.id], delivery: delivery(i) };
    if (!live) Object.assign(o, { accepted_at: iso(accepted), ready_at: iso(readyAt), courier_id: courier._id, collected_at: iso(collected), delivered_at: iso(delivered) });
    orders.push(o);
    // The chain's till: the same order, with the platform's fee taken off; a few deliberate mismatches to reconcile.
    if (!live) sales.push({ _id: o._id, order_id: o._id, restaurant_id: r.id, day: o.delivered_at.slice(0, 10), gross_cents: total_cents, net_cents: total_cents - Math.round(total_cents * FEE) + (rnd() < 0.02 ? 100 : 0) });
  }
  for (let i = 0; i < orders.length; i += 200) await F.hubs[0].shared.put("platform_orders", orders.slice(i, i + 200));
  console.log(`platform_orders: ${orders.length} on the shared library (${orders.filter((o) => o.status === "created").length} still open)`);
  for (let i = 0; i < sales.length; i += 200) await F.headOffice.ops.put("sales", sales.slice(i, i + 200));
  console.log(`sales: ${sales.length} on chain-ops (head office)`);
  console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
