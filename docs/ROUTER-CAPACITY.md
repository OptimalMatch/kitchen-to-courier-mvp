# How many couriers can one router serve

Measured against the fleet's own Valhalla on a 32-core machine, using the two
calls the courier app actually makes.

## What the app asks for

| call | when | measured |
|---|---|---|
| `trace_attributes` (map matching) | every 5 s per courier, in GPS mode | 4 ms |
| `route` | once per leg — a pickup, a delivery, the ride back | 7 ms |

Matching dominates by three orders of magnitude: a courier asks for a route
perhaps four times an hour and for a match 720 times.

## The answer

**About 20,000 couriers, and the limit is not the routing.**

| connections | sustained | median | p95 | refused |
|---|---|---|---|---|
| reused, 32 clients | 4,324 matches/s | 6.6 ms | 11 ms | none |
| reused, 64 clients | 3,693 matches/s | 16 ms | 27 ms | none |
| new one per request, 16 clients | 1,353 matches/s | 7.1 ms | 9 ms | 8,507 |
| new one per request, 32 clients | collapsed | — | — | 28,706 |

At one match every five seconds, 4,300 a second is roughly 21,000 couriers.

Android's `HttpURLConnection` pools and reuses connections as long as each
response body is read to the end, which the app does, so real clients sit in
the top rows. The first measurements here did not, and reported a ceiling
five times too low — a load test that opens a socket per request measures the
socket.

## What actually binds

Not Valhalla's work. At `server_threads: 4` the container used 3.5 of 32
cores at 800 matches a second, exactly thread-bound, and raising it to 16
moved the sustained figure only from ~900 to ~1,300 a second while connection
churn stayed in the way. With connections reused the same container did 4,300
a second.

So, in order:

1. **Reuse connections.** Worth more than every other change together.
2. **Threads**, up to about 16 on this box. Past that they wait on the front
   end rather than on the graph.
3. **More routers** behind a load balancer, once one machine is genuinely the
   wall. The tiles are read-only, so a second instance is a copy and nothing
   to coordinate.
4. **Ask less often.** A match every 15 s instead of 5 divides the load by
   three and costs a courier's position a little freshness.

## What this does not cover

- One tile set, in memory, for Ireland. A city per router changes nothing
  here; a continent per router is a different measurement.
- All matches of the same twelve-point trail. Longer trails cost more, and a
  trail crossing more tiles costs more again.
- The load generator and the router shared a machine. Across a network, add
  the network.
