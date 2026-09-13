// learn-promise: quote the promised time from what the kitchens and couriers
// actually did, instead of a round number somebody picked.
//
//   docker compose run --rm tools node bin/learn-promise.mjs [--target 0.95]
//
// The customer app promised a flat forty minutes. It was almost never missed,
// which sounds good and is not: a promise that is never wrong is too loose to
// be useful, and it says the same thing about a kitchen having a bad night as
// about one that is quick. The platform already timestamps every span of every
// order — created, accepted, ready, dispatched, collected, delivered — so the
// promise can be the percentile history actually supports.
//
// The model is a document on the platform's own library, the way the hubs and
// their router port are. Whoever quotes a time reads it; nobody carries a copy
// of the number.
//
// Judged on a pair, never on one alone: a SHORTER promise at the SAME on-time
// rate. Quoting a longer time always improves the rate and helps nobody.
import { fleet, ready, now } from "../lib/api.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TARGET = Number(arg("--target", 0.95));   // the on-time rate the promise is meant to hold
const DAYS = Number(arg("--days", 30));          // how far back to learn from
const F = fleet();
await ready(F.analytics.eu); await ready(F.hubs[0].eu);

const q = (s) => F.analytics.eu.sql(s);
// An order that took five days is not a delivery time, it is an order that was
// abandoned and closed later, and a high percentile walks straight into them:
// 12 of these 1,047 ran over four hours and the worst took 134. Quoting the p98
// without this guard put one restaurant-and-hub pairing at 82 hours.
//
// The bound is stated rather than tuned until the number looks right, and the
// count it removes is printed, because a training set quietly filtered is how a
// model becomes confidently wrong.
const SANE_MAX_S = Number(arg("--max-hours", 4)) * 3600;
const SINCE = `CAST(delivered_at AS TIMESTAMP) > now() - INTERVAL ${DAYS} DAY AND total_s BETWEEN 60 AND ${SANE_MAX_S}`;

// The promise covers created to delivered, so that is what is quoted: the
// percentile of the WHOLE journey, per restaurant and hub.
//
// Not the sum of each span's percentile. Percentiles do not add — on this
// fleet the kitchen's p95 plus the ready-to-door p95 comes to 39.1 minutes
// where the journey's own p95 is 37.9, because the slow kitchen and the slow
// ride are rarely the same order. Adding them quotes a time nobody needs and
// hands back the looseness the flat forty minutes had.
const pair = await q(`SELECT restaurant_id AS r, hub_id AS h, count(*) AS n,
                             round(quantile_cont(total_s, ${TARGET})) AS s
                      FROM deliveries_curated WHERE ${SINCE} GROUP BY 1, 2`);
const byRestaurant = await q(`SELECT restaurant_id AS k, count(*) AS n, round(quantile_cont(total_s, ${TARGET})) AS s
                              FROM deliveries_curated WHERE ${SINCE} GROUP BY 1`);
const byHub = await q(`SELECT hub_id AS k, count(*) AS n, round(quantile_cont(total_s, ${TARGET})) AS s
                       FROM deliveries_curated WHERE ${SINCE} GROUP BY 1`);
const all = await q(`SELECT count(*) AS n, round(quantile_cont(total_s, ${TARGET})) AS s,
                            round(quantile_cont(total_s, 0.5)) AS p50
                     FROM deliveries_curated WHERE ${SINCE}`);
const [excl] = await q(`SELECT count(*) AS n FROM deliveries_curated
                        WHERE CAST(delivered_at AS TIMESTAMP) > now() - INTERVAL ${DAYS} DAY
                          AND (total_s < 60 OR total_s > ${SANE_MAX_S})`);
// What the spans cost on their own, for a person reading the model rather than
// for the arithmetic: it says where a slow promise is coming from.
const spans = await q(`SELECT round(quantile_cont(prep_s, ${TARGET})) AS prep,
                              round(quantile_cont(wait_s, ${TARGET})) AS wait,
                              round(quantile_cont(ride_s, ${TARGET})) AS ride
                       FROM deliveries_curated WHERE ${SINCE}`);

if (!all[0]?.n) { console.log("no delivered orders to learn from"); process.exit(0); }

// A pairing with too little history of its own is not trusted with a quote.
const MIN_N = 30;
const model = {
  _id: "promise",
  target: TARGET,
  days: DAYS,
  learned_from: Number(all[0].n),
  excluded_as_implausible: Number(excl.n),
  max_plausible_s: SANE_MAX_S,
  min_observations: MIN_N,
  // Seconds from created to delivered, at the target percentile.
  by_pair: Object.fromEntries(pair.filter((x) => x.n >= MIN_N).map((x) => [`${x.r}|${x.h}`, Number(x.s)])),
  by_restaurant: Object.fromEntries(byRestaurant.filter((x) => x.n >= MIN_N).map((x) => [x.k, Number(x.s)])),
  by_hub: Object.fromEntries(byHub.filter((x) => x.n >= MIN_N).map((x) => [x.k, Number(x.s)])),
  fallback_s: Number(all[0].s),
  median_s: Number(all[0].p50),
  spans_s: { prep: Number(spans[0].prep), wait: Number(spans[0].wait), ride: Number(spans[0].ride) },
  updated_at: now(),
};
await F.hubs[0].eu.put("promise_model", model);

const mins = (s) => (s / 60).toFixed(1);
console.log(`learned from ${model.learned_from} deliveries over ${DAYS} days, quoting the p${Math.round(TARGET * 100)} of created-to-delivered`);
console.log(`  set aside as implausible (under a minute or over ${SANE_MAX_S / 3600} hours): ${model.excluded_as_implausible}`);
console.log(`  median order: ${mins(model.median_s)} min; quoted fleet-wide: ${mins(model.fallback_s)} min`);
console.log(`  the spans at that percentile: kitchen ${mins(model.spans_s.prep)}, wait ${mins(model.spans_s.wait)}, ride ${mins(model.spans_s.ride)} min`);
for (const [k, s2] of Object.entries(model.by_pair)) console.log(`  ${k.replace("|", " via ")}: ${mins(s2)} min`);
console.log(`published promise_model on ${F.hubs[0].eu.name}`);
