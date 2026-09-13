// learn-road-speeds: what a courier on a bicycle actually does on these
// streets, from the fleet's own trails, in the shape Valhalla takes as
// historical traffic.
//
//   docker compose run --rm tools node bin/learn-road-speeds.mjs [--hours 24]
//
// Nobody sells this. Traffic feeds price car journeys, and a courier filtering
// past a queue is not in them. The couriers know what the streets cost, they
// write a position every five seconds, and the router that draws their routes
// is the one that would use it — so the loop closes without a vendor
// (docs/ARRIVAL-TIMES.md in the courier app).
//
// The output is Valhalla's predicted-traffic CSV: edge_id, freeflow_speed,
// constrained_speed. Its edge ids are GraphIds, valid only for the tile build
// they were matched against, so the CSV belongs to the tiles the router is
// running now and must be rebuilt when they are.
//
// Courier trails are a named worker's movements. This reduces them to speeds
// per road segment, which is the point: the aggregate is what the router needs
// and the trails themselves should not outlive the aggregation.
import { fleet, ready } from "../lib/api.mjs";
import { writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = Number(arg("--hours", 24));
const OUT = arg("--out", "/app/road-speeds.csv");
const GAP_S = 90;        // a longer gap than this starts a new run, not a teleport
const MIN_RUN = 4;       // a run too short to match is not worth asking about
// How much riding an edge needs before its speed is worth believing. Position
// error is roughly fixed — call it 10 m after matching — so the error in a
// speed is that divided by the distance it is measured over: 17% across a 60 m
// street, 5% across 200 m. Below this, the number says more about the fix than
// the road. The first run of this script produced 46 km/h on a 60 m stretch of
// Winetavern Street, which is not a bicycle.
const MIN_METRES = Number(arg("--min-metres", 200));
// A bicycle courier does not sustain more than this; above it the trail is
// being matched to the wrong road, or two fixes are not the same journey.
const MAX_KMH = Number(arg("--max-kmh", 40));
const F = fleet();
await ready(F.hubs[0].eu);
const hub = await F.hubs[0].eu.get1("hubs", process.env.HUB || "hub-1");
const ROUTER = `http://router:8002`;   // inside the compose network

const since = Date.now() - HOURS * 3600 * 1000;
const traces = (await F.hubs[0].eu.find("courier_traces", {}, 0))
  .filter((t) => Date.parse(t.at) >= since);
if (!traces.length) { console.log(`no courier traces in the last ${HOURS}h`); process.exit(0); }

// One courier's trail, in order, split where they stopped reporting.
const byCourier = new Map();
for (const t of traces) {
  if (!byCourier.has(t.courier_id)) byCourier.set(t.courier_id, []);
  byCourier.get(t.courier_id).push(t);
}
const runs = [];
for (const [courier, pts] of byCourier) {
  pts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let run = [];
  for (const p of pts) {
    if (run.length && (Date.parse(p.at) - Date.parse(run[run.length - 1].at)) / 1000 > GAP_S) {
      if (run.length >= MIN_RUN) runs.push({ courier, run });
      run = [];
    }
    run.push(p);
  }
  if (run.length >= MIN_RUN) runs.push({ courier, run });
}
console.log(`${traces.length} traces from ${byCourier.size} courier(s) over ${HOURS}h, in ${runs.length} run(s)`);

const post = async (path, body) => {
  const res = await fetch(ROUTER + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`router ${path}: ${res.status}`);
  return res.json();
};

// edge id -> { metres, seconds, graphSpeed, name }
const seen = new Map();
let matched = 0, refused = 0;
for (const { courier, run } of runs) {
  const t0 = Date.parse(run[0].at) / 1000;
  const shape = run.map((p) => ({ lat: p.lat, lon: p.lon, time: Math.round(Date.parse(p.at) / 1000 - t0) }));
  let r;
  try { r = await post("/trace_attributes", { shape, costing: "bicycle", shape_match: "map_snap" }); }
  catch (e) { console.log(`  ${courier}: ${e.message}`); refused++; continue; }
  if ((r.confidence_score ?? 0) < 0.5) { refused++; continue; }
  matched++;
  const edges = r.edges || [], mp = r.matched_points || [];
  // Between two matched points, the distance actually covered is the part of
  // the first edge left, the whole of any edges crossed, and the part of the
  // last one used. The speed that implies is credited to each of those edges
  // in proportion to how much of the distance was theirs.
  for (let i = 0; i + 1 < mp.length; i++) {
    const a = mp[i], b = mp[i + 1];
    if (a.type !== "matched" || b.type !== "matched") continue;
    const dt = shape[i + 1].time - shape[i].time;
    if (dt <= 0 || dt > GAP_S) continue;
    const ea = a.edge_index, eb = b.edge_index;
    if (ea == null || eb == null || eb < ea) continue;
    const parts = [];
    if (ea === eb) parts.push([ea, Math.abs((b.distance_along_edge ?? 0) - (a.distance_along_edge ?? 0)) * (edges[ea]?.length ?? 0)]);
    else {
      parts.push([ea, (1 - (a.distance_along_edge ?? 0)) * (edges[ea]?.length ?? 0)]);
      for (let k = ea + 1; k < eb; k++) parts.push([k, edges[k]?.length ?? 0]);
      parts.push([eb, (b.distance_along_edge ?? 0) * (edges[eb]?.length ?? 0)]);
    }
    const total = parts.reduce((s, [, km]) => s + km, 0);
    if (total <= 0) continue;
    for (const [idx, km] of parts) {
      const e = edges[idx]; if (!e || km <= 0) continue;
      const cur = seen.get(e.id) || { metres: 0, seconds: 0, graphSpeed: e.speed, name: (e.names || [])[0] || "", cls: e.road_class };
      cur.metres += km * 1000;
      cur.seconds += dt * (km / total);
      seen.set(e.id, cur);
    }
  }
}
console.log(`  matched ${matched} run(s), refused ${refused}`);
if (!seen.size) { console.log("nothing to learn yet"); process.exit(0); }

const rows = [...seen.entries()]
  .map(([id, v]) => ({ id, kmh: (v.metres / 1000) / (v.seconds / 3600), metres: v.metres, graph: v.graphSpeed, name: v.name, cls: v.cls }))
  .sort((a, b) => b.metres - a.metres);
const trusted = rows.filter((r) => r.kmh > 1 && r.kmh < MAX_KMH && r.metres >= MIN_METRES);

// freeflow is the night speed and constrained the day speed. One fleet's worth
// of trails cannot tell them apart yet, so both carry the observation and the
// difference waits for enough data to split by hour rather than being invented.
const csv = ["edge_id,freeflow_speed,constrained_speed",
  ...trusted.map((r) => `${r.id},${Math.round(r.kmh)},${Math.round(r.kmh)}`)].join("\n");
writeFileSync(OUT, csv + "\n");

console.log(`\n  ${rows.length} road segment(s) seen; ${trusted.length} ridden far enough (${MIN_METRES} m) to believe`);
console.log(`  ${trusted.length} written to ${OUT}`);
console.log("  the most-ridden, against what the routing graph assumes:");
for (const r of rows.slice(0, 10)) {
  const d = r.kmh - r.graph;
  const believe = r.metres >= MIN_METRES && r.kmh < MAX_KMH ? "" : "   (too little riding to believe)";
  console.log(`    ${(r.name || r.cls).padEnd(24)} ${r.kmh.toFixed(1).padStart(5)} km/h observed vs ${String(r.graph).padStart(3)} assumed  (${d >= 0 ? "+" : ""}${d.toFixed(1)}, over ${Math.round(r.metres)} m)${believe}`);
}
console.log(`
What is being measured is whatever wrote the traces. A simulated ride reports
the simulator's own speed, not Dublin's; only a phone on a bicycle measures a
bicycle. The pipeline is the same either way.

Feed it to the router with valhalla_add_predicted_traffic -t <folder holding
this CSV>, against the tiles it was matched on. The ids are GraphIds and do
not survive a tile rebuild.`);
