// The customer's tracking view, as text: the build sheet's step 2 to 5,
// "/api/doc/get order_id (Customer tracks the order)", plus the courier's
// document once the order carries a courier_id — its location is the
// point a customer app would draw on a map. Reads platform-eu and the
// shared library on the hub, as a customer app would through the platform.
//   node sims/track.mjs [order id]     default: the newest live order on hub-1
import { fleet, ready, sleep } from "../lib/api.mjs";
import { compass } from "./hub-verify.mjs";
const hid = process.env.HUB || "hub-1";
const F = fleet();
const h = F.hubs.find((x) => x.id === hid);
await ready(h.shared); await ready(h.eu);
let id = process.argv[2];
if (!id) {
  const live = await h.shared.find("platform_orders", { hub_id: hid, status: { $in: ["created", "accepted", "ready", "collected"] } }, 50);
  live.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  id = live[0]?._id;
  if (!id) { console.log("no live order on " + hid); process.exit(0); }
}
const metres = (a, b) => { const dy = (b[1] - a[1]) * 111320, dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180); return Math.hypot(dx, dy); };
console.log(`tracking ${id} on ${hid}`);
for (;;) {
  const o = await h.shared.get1("platform_orders", id);
  if (!o) { console.log("order not found"); break; }
  let line = `${new Date().toISOString().slice(11, 19)}  ${o.status.padEnd(9)}`;
  if (o.courier_id) {
    const c = await h.eu.get1("couriers", o.courier_id);
    if (c?.location) {
      const to = o.status === "ready" ? o.pickup : o.delivery;
      const [lon, lat] = c.location.coordinates;
      line += `  ${o.courier_id} at ${lat.toFixed(5)}, ${lon.toFixed(5)}${c.heading === undefined ? "" : ` facing ${compass(c.heading)}`} (${((Date.now() - Date.parse(c.updated_at)) / 1000).toFixed(0)}s old)`;
      if (to?.location) line += `  ${Math.round(metres(c.location.coordinates, to.location.coordinates))} m to ${o.status === "ready" ? "the pickup" : "the customer"}`;
    }
  }
  console.log(line);
  if (o.status === "delivered") break;
  await sleep(5000);
}
