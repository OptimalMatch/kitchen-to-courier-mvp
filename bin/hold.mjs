// Make every node hold what it writes or reads whole: the restaurants and
// hubs the orders, the hubs the couriers, the head office the menu and the
// shared tables it reconciles. Run after the seed, or any time a node
// answers "needs every member local".
import { fleet, ready, ensureLocal } from "../lib/api.mjs";
const F = fleet();
const jobs = [
  ...F.restaurants.map((r) => [r.shared, "platform_orders."]),
  ...F.restaurants.map((r) => [r.ops, "menu."]),
  ...F.hubs.map((h) => [h.shared, "platform_orders."]),
  ...F.hubs.map((h) => [h.eu, "couriers."]),
  [F.headOffice.ops, "menu."], [F.headOffice.ops, "sales."], [F.headOffice.shared, ""], [F.analytics.shared, ""], [F.analytics.eu, ""],
];
for (const [n, prefix] of jobs) { await ready(n); const k = await ensureLocal(n, prefix); console.log(`${n.name}: ${prefix || "everything"} ${k ? `fetched ${k} member(s)` : "already local"}`); }
