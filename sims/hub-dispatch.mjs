// Dispatch on a hub: the rule the process view marks "a rule, automatic".
// When an order document turns ready, the nearest available courier is
// assigned (a geo query on the platform's couriers collection) and the
// order carries courier_id.
//   step 4  /api/doc/find {status: "ready", courier_id missing}  on the shared library
//           /api/doc/find {state: "available", location $near}    on platform-eu
//           /api/doc/put  $set courier_id                            on the shared library
import { fleet, ready, sleep, now, ensureCollection } from "../lib/api.mjs";
const hid = process.env.HUB || "hub-1";
const F = fleet();
const h = F.hubs.find((x) => x.id === hid);
await ready(h.shared); await ready(h.eu);
// Where this hub is, from the platform's own hubs collection. The couriers wait
// near it and the nearest one to it gets the next order.
const hub = await h.eu.get1("hubs", hid);
const ROUTER = process.env.ROUTER || "http://router:8002";

// The route a courier rides is computed once, here, and written onto the order.
//
// The alternative was every phone asking a router for its own line, and then
// asking again every five seconds to put its position back on a road: 720
// requests an hour each, against four. A courier holding the line it is
// following can project a GPS fix onto it with arithmetic, which needs no
// graph, no engine and no network — and is more accurate than matching against
// the whole network, because it knows which road the courier is meant to be on.
//
// It also arrives before the ride does. The order is already replicated to the
// courier's node, so the line is there whether or not anything answers later.
async function leg(from, to) {
  if (!from || !to) return null;
  try {
    const res = await fetch(`${ROUTER}/route`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ locations: [{ lat: from[1], lon: from[0] }, { lat: to[1], lon: to[0] }], costing: "bicycle" }) });
    if (!res.ok) return null;
    const t = (await res.json()).trip;
    // polyline6, which is what Valhalla returns and what the app decodes.
    return { polyline: t.legs.map((l) => l.shape).join(""), metres: Math.round(t.summary.length * 1000), seconds: Math.round(t.summary.time) };
  } catch (e) { console.error(`${hid}: route: ${e.message}`); return null; }
}
const at = (x) => x?.location?.coordinates;
const HUB_AT = hub?.location ?? { type: "Point", coordinates: [-6.26 + (hid === "hub-2" ? 0.06 : -0.06), 53.35] };
console.log(`dispatch ${hid}: watching ${h.shared.name} and ${h.eu.name}; hub at ${hub?.address ?? "an unnamed point"}`);
for (;;) {
  try {
    await ensureCollection(h.shared, "platform_orders"); await ensureCollection(h.eu, "couriers");
    const waiting = await h.shared.find("platform_orders", { status: "ready", hub_id: hid, courier_id: { $exists: false } }, 20);
    for (const o of waiting) {
      // The nearest available courier to the hub takes the order.
      const [c] = await h.eu.find("couriers", { hub_id: hid, state: "available", location: { $near: { $geometry: HUB_AT, $maxDistance: 30000 } } }, 1);
      if (!c) { console.log(`${hid}: no courier free for ${o._id}`); continue; }
      // Both legs, while we know where the courier is: in to the pickup, and on
      // to the customer. The second never changes; the first is from wherever
      // they were standing when the order was theirs.
      const toPickup = await leg(at(c), at(o.pickup));
      const toCustomer = await leg(at(o.pickup), at(o.delivery));
      await h.shared.update("platform_orders", { _id: o._id, status: "ready" },
        { $set: { courier_id: c._id, dispatched_at: now(), route_to_pickup: toPickup, route_to_customer: toCustomer } });
      await h.eu.update("couriers", { _id: c._id }, { $set: { state: "assigned", current_order: o._id, updated_at: now() } });
      console.log(`${hid}: ${o._id} -> ${c._id}` + (toPickup ? ` (${toPickup.metres} m in, ${toCustomer?.metres ?? "?"} m out)` : " (no route)"));
    }
  } catch (e) { console.error(`${hid}: ${e.message}`); }
  await sleep(3000);
}
