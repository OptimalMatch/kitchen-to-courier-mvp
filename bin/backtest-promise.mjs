// backtest-promise: what the learned promise would have done to the deliveries
// it learned from, against the flat forty minutes it replaces.
//
//   docker compose run --rm tools node bin/backtest-promise.mjs
//
// Judged on the pair and never on one alone. A longer promise always improves
// the on-time rate and helps nobody; a shorter one that misses is worse than
// the round number. The question is whether the quote got shorter while the
// rate held.
//
// The arithmetic runs in the query, not here: a SELECT of raw rows comes back
// capped, and a backtest quietly computed over the first few hundred rows is
// a backtest that proves nothing.
import { fleet, ready } from "../lib/api.mjs";
const F = fleet(); await ready(F.analytics.eu); await ready(F.hubs[0].eu);
const m = await F.hubs[0].eu.get1("promise_model", "promise");
if (!m) { console.log("no promise_model yet: run bin/learn-promise.mjs"); process.exit(0); }

const FLAT = 40 * 60;
const quote = (r, h) => m.by_pair?.[`${r}|${h}`] ?? m.by_restaurant?.[r] ?? m.by_hub?.[h] ?? m.fallback_s;
const pairs = await F.analytics.eu.sql("SELECT DISTINCT restaurant_id r, hub_id h FROM deliveries_curated");
const quoted = pairs.map((p) => `WHEN restaurant_id = '${p.r}' AND hub_id = '${p.h}' THEN ${quote(p.r, p.h)}`).join(" ");
const score = async (where) => (await F.analytics.eu.sql(`
  SELECT count(*) AS n,
         sum(CASE WHEN total_s <= ${FLAT} THEN 1 ELSE 0 END) AS ok_flat,
         sum(CASE WHEN total_s <= (CASE ${quoted} ELSE ${m.fallback_s} END) THEN 1 ELSE 0 END) AS ok_model,
         round(avg(CASE ${quoted} ELSE ${m.fallback_s} END)) AS mean_quote
  FROM deliveries_curated ${where}`))[0];
const x = await score("");
// The orders a promise could ever have covered. An order abandoned for five
// days defeats every quote equally, so scoring against them measures the seed
// data rather than the model — but leaving them out silently would flatter it,
// so both are printed.
const y = await score(`WHERE total_s BETWEEN 60 AND ${m.max_plausible_s ?? 4 * 3600}`);
const f = (v) => (v / 60).toFixed(1);
const show = (label, r) => {
  const n = Number(r.n), pc = (v) => ((v / n) * 100).toFixed(1);
  console.log(`${label} (${n} deliveries)`);
  console.log(`  flat 40 min : ${pc(Number(r.ok_flat))}% on time, promised ${f(FLAT)} min`);
  console.log(`  learned     : ${pc(Number(r.ok_model))}% on time, promised ${f(Number(r.mean_quote))} min on average`);
  console.log(`  difference  : ${f(FLAT - Number(r.mean_quote))} min shorter, ${(((Number(r.ok_model) - Number(r.ok_flat)) / n) * 100).toFixed(1)} points of on-time`);
};
console.log(`quoting the p${Math.round(m.target * 100)}, learned from ${m.learned_from} deliveries\n`);
show("against every delivery", x);
console.log("");
show("against the deliveries any promise could have covered", y);
console.log(`
In-sample: these are the deliveries the percentile was computed from, so the
rate lands on the target by construction. Out of sample it will be a little
worse, and a production model would hold a test set back.`);
