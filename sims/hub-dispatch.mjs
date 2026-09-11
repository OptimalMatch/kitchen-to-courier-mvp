// Dispatch on a hub: the rule the process view marks "a rule, automatic".
// When an order document turns ready, the nearest available courier is
// assigned (a geo query on the platform's couriers collection) and the
// order carries courier_id.
//   step 4  /api/doc/find {status: "ready", courier_id missing}  on the shared library
//           /api/doc/find {state: "available", location $near}    on platform-eu
//           /api/doc/put  $set courier_id                            on the shared library
import { fleet, ready, sleep, now, ensureLocal } from "../lib/api.mjs";
const hid = process.env.HUB || "hub-1";
const F = fleet();
const h = F.hubs.find((x) => x.id === hid);
await ready(h.shared); await ready(h.eu);
console.log(`dispatch ${hid}: watching ${h.shared.name} and ${h.eu.name}`);
for (;;) {
  try {
    await ensureLocal(h.shared, "platform_orders."); await ensureLocal(h.eu, "couriers.");
    const waiting = await h.shared.find("platform_orders", { status: "ready", hub_id: hid, courier_id: { $exists: false } }, 20);
    for (const o of waiting) {
      // The kitchen's location stands in for the pickup point: the hub's centre with a small offset per restaurant.
      const pickup = { type: "Point", coordinates: [-6.26 + (hid === "hub-2" ? 0.06 : -0.06), 53.35] };
      const [c] = await h.eu.find("couriers", { hub_id: hid, state: "available", location: { $near: { $geometry: pickup, $maxDistance: 30000 } } }, 1);
      if (!c) { console.log(`${hid}: no courier free for ${o._id}`); continue; }
      await h.shared.update("platform_orders", { _id: o._id, status: "ready" }, { $set: { courier_id: c._id, dispatched_at: now() } });
      await h.eu.update("couriers", { _id: c._id }, { $set: { state: "assigned", current_order: o._id, updated_at: now() } });
      console.log(`${hid}: ${o._id} -> ${c._id}`);
    }
  } catch (e) { console.error(`${hid}: ${e.message}`); }
  await sleep(3000);
}
