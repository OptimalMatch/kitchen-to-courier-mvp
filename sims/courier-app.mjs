// The courier app of one hub's couriers: the calls the build sheet lists.
//   step 4  /api/doc/find {status: "ready", courier_id: mine}     orders assigned to me
//   step 5  /api/doc/put  $set status: collected, collected_at    collected
//   step 5  /api/doc/put  $set status: delivered, delivered_at    delivered
// One process plays every courier of the hub; a collected order is
// delivered RIDE_MS later.
import { fleet, ready, sleep, now, ensureCollection } from "../lib/api.mjs";
const hid = process.env.HUB || "hub-1";
const RIDE_MS = Number(process.env.RIDE_MS || 20000);
const F = fleet();
const h = F.hubs.find((x) => x.id === hid);
const riding = new Map();
await ready(h.shared); await ready(h.eu);
console.log(`courier app ${hid}: watching ${h.shared.name}`);
for (;;) {
  try {
    await ensureCollection(h.shared, "platform_orders"); await ensureCollection(h.eu, "couriers");
    const assigned = await h.shared.find("platform_orders", { status: "ready", hub_id: hid, courier_id: { $exists: true } }, 20);
    for (const o of assigned) {
      // A real courier app (the Android one, ids app-*) collects its own orders; this process plays only the seeded hub-N-cNN couriers.
      if (!/^hub-\d+-c\d+$/.test(String(o.courier_id))) continue;
      await h.shared.update("platform_orders", { _id: o._id, status: "ready" }, { $set: { status: "collected", collected_at: now() } });
      riding.set(o._id, { at: Date.now() + RIDE_MS, courier: o.courier_id });
      console.log(`${hid}: ${o.courier_id} collected ${o._id}`);
    }
    for (const [id, r] of riding) {
      if (Date.now() < r.at) continue;
      await h.shared.update("platform_orders", { _id: id, status: "collected" }, { $set: { status: "delivered", delivered_at: now() } });
      await h.eu.update("couriers", { _id: r.courier }, { $set: { state: "available", current_order: null, updated_at: now() } });
      riding.delete(id);
      console.log(`${hid}: ${r.courier} delivered ${id}`);
    }
  } catch (e) { console.error(`${hid}: ${e.message}`); }
  await sleep(3000);
}
