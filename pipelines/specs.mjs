// The jobs of the build sheet as engine pipelines: a spec is a document
// in the library's "pipelines" collection, run by the node it is pinned
// to (the entrypoint runs `unidatum pipeline serve` there). Registering
// puts the documents; they sync to every node of the library.
//
//   menu-publish        chain-platform-shared, pinned to head-office: menu (co-located chain-ops) -> menu_published table
//   settlement          chain-platform-shared, pinned to analytics: delivered platform_orders -> settlements table
//   curate-timelines    platform-eu, pinned to analytics: platform_orders (co-located shared) -> deliveries_curated table
//   sales-curated       chain-ops, pinned to head-office: sales -> sales_curated table
//   reconcile           chain-ops, pinned to head-office: settlements (co-located shared) enriched with sales -> settlement_mismatches
import { fleet, ready } from "../lib/api.mjs";

const node = (id, type, attrs, x, y) => ({ id, type, x, y, attrs });
const chain = (nodes) => ({ nodes, links: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id })) });
const spec = (name, pin, nodes, extra = {}) => ({ _id: name, kind: "pipeline-spec", ts: Date.now(), spec: { version: 1, name, pin, pinStrict: true, ...chain(nodes.map((n, i) => ({ ...n, x: 80 + i * 200, y: 120 }))), ...extra } });

export const SPECS = {
  "chain-platform-shared": [
    spec("menu-publish", "head-office", [
      node("src", "source", { collection: "menu", library: "/data/chain-ops" }),
      node("pub", "select", { fields: "restaurant_id, item_id, name, price_cents, available" }),
      node("stamp", "set", { pairs: "published_at = {{now}}" }),
      node("out", "target", { collection: "menu_published", kind: "table" }),
    ]),
    spec("settlement", "analytics", [
      node("src", "source", { collection: "platform_orders" }),
      node("done", "filter", { field: "status", op: "==", value: "delivered" }),
      node("gross", "compute", { field: "gross_cents", expr: "CAST(total_cents AS BIGINT)" }),
      node("fee", "compute", { field: "platform_fee_cents", expr: "CAST(round(total_cents * 0.25) AS BIGINT)" }),
      node("net", "compute", { field: "net_cents", expr: "CAST(total_cents - round(total_cents * 0.25) AS BIGINT)" }),
      node("week", "compute", { field: "week", expr: "strftime(date_trunc('week', CAST(delivered_at AS TIMESTAMP)), '%Y-%m-%d')" }),
      node("cust", "mask", { field: "customer_id", strategy: "hash" }),
      node("cour", "mask", { field: "courier_id", strategy: "hash" }),
      node("keep", "select", { fields: "order_id, restaurant_id, hub_id, gross_cents, platform_fee_cents, net_cents, week, delivered_at" }),
      node("stamp", "set", { pairs: "settled_at = {{now}}" }),
      node("out", "target", { collection: "settlements", kind: "table" }),
    ]),
  ],
  "platform-eu": [
    spec("curate-timelines", "analytics", [
      node("src", "source", { collection: "platform_orders", library: "/data/chain-platform-shared" }),
      node("done", "filter", { field: "status", op: "==", value: "delivered" }),
      node("prep", "compute", { field: "prep_s", expr: "date_diff('second', CAST(accepted_at AS TIMESTAMP), CAST(ready_at AS TIMESTAMP))" }),
      node("wait", "compute", { field: "wait_s", expr: "date_diff('second', CAST(ready_at AS TIMESTAMP), CAST(collected_at AS TIMESTAMP))" }),
      node("ride", "compute", { field: "ride_s", expr: "date_diff('second', CAST(collected_at AS TIMESTAMP), CAST(delivered_at AS TIMESTAMP))" }),
      node("total", "compute", { field: "total_s", expr: "date_diff('second', CAST(created_at AS TIMESTAMP), CAST(delivered_at AS TIMESTAMP))" }),
      node("late", "compute", { field: "late", expr: "CAST(delivered_at AS TIMESTAMP) > CAST(promised_at AS TIMESTAMP)" }),
      node("day", "compute", { field: "day", expr: "substr(delivered_at, 1, 10)" }),
      node("keep", "select", { fields: "order_id, restaurant_id, hub_id, courier_id, day, created_at, accepted_at, ready_at, collected_at, delivered_at, prep_s, wait_s, ride_s, total_s, late" }),
      node("out", "target", { collection: "deliveries_curated", kind: "table" }),
    ]),
  ],
  "chain-ops": [
    spec("sales-curated", "head-office", [
      node("src", "source", { collection: "sales" }),
      node("out", "target", { collection: "sales_curated", kind: "table" }),
    ]),
    spec("reconcile", "head-office", [
      node("src", "source", { collection: "settlements", library: "/data/chain-platform-shared", cursorField: "settled_at" }),
      node("till", "enrich", { collection: "sales", key: "order_id", fields: "net_cents", prefix: "sales_", onmiss: "keep" }),
      node("diff", "compute", { field: "mismatch_cents", expr: "net_cents - sales_net_cents" }),
      node("only", "filter", { field: "mismatch_cents", op: "!=", value: "0" }),
      node("keep", "select", { fields: "order_id, restaurant_id, week, net_cents, sales_net_cents, mismatch_cents" }),
      node("out", "target", { collection: "settlement_mismatches", kind: "table" }),
    ]),
  ],
};

// A pin names a node id, not a node name: ask each pinned node for its id
// in that library before registering.
if (process.argv[1] && process.argv[1].endsWith("specs.mjs")) {
  const F = fleet();
  const nodes = { "chain-platform-shared": { "head-office": F.headOffice.shared, analytics: F.analytics.shared }, "platform-eu": { analytics: F.analytics.eu }, "chain-ops": { "head-office": F.headOffice.ops } };
  for (const [lib, specs] of Object.entries(SPECS)) {
    for (const sp of specs) {
      const n = nodes[lib][sp.spec.pin]; await ready(n);
      const id = (await n.get("/api/pipeline/placement")).self?.node_id;
      if (!id) throw new Error(`${n.name}: no node id in its placement view`);
      sp.spec.pinName = sp.spec.pin; sp.spec.pin = id;
    }
    const first = Object.values(nodes[lib])[0];
    await first.put("pipelines", specs);
    console.log(`${lib}: ${specs.map((s) => `${s._id} (pinned to ${s.spec.pinName} ${s.spec.pin.slice(0, 8)}…)`).join(", ")}`);
  }
}
