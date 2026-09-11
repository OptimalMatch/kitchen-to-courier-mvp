// The kitchen display of one restaurant: the calls the build sheet lists
// for it, in flow order, against the restaurant's node on the shared
// library (the order reaches it by sync).
//   step 2  /api/doc/find {status: "created", restaurant_id}   new platform orders
//   step 3  /api/doc/put  $set status: accepted, accepted_at   accept (one tap)
//   step 3  /api/doc/put  $set status: ready, ready_at         ready (one tap)
import { fleet, ready, sleep, now, ensureLocal } from "../lib/api.mjs";
const rid = process.env.RESTAURANT || "r1";
const F = fleet();
const r = F.restaurants.find((x) => x.id === rid);
const COOK_MS = Number(process.env.COOK_MS || 15000);
const cooking = new Map();
await ready(r.shared);
console.log(`kitchen display ${rid}: watching ${r.shared.name}`);
for (;;) {
  try {
    await ensureLocal(r.shared, "platform_orders.");
    const fresh = await r.shared.find("platform_orders", { status: "created", restaurant_id: rid }, 20);
    for (const o of fresh) {
      await r.shared.update("platform_orders", { _id: o._id }, { $set: { status: "accepted", accepted_at: now() } });
      cooking.set(o._id, Date.now() + COOK_MS);
      console.log(`${rid}: accepted ${o._id} (${o.items?.length || 0} items)`);
    }
    for (const [id, at] of cooking) {
      if (Date.now() < at) continue;
      await r.shared.update("platform_orders", { _id: id, status: "accepted" }, { $set: { status: "ready", ready_at: now() } });
      cooking.delete(id);
      console.log(`${rid}: ready ${id}`);
    }
  } catch (e) { console.error(`${rid}: ${e.message}`); }
  await sleep(3000);
}
