# Gaps

Where the design assumed something the engine (v2.362.0) does differently,
and what this build did about it. The kit's prompt asked for this file.

1. **One node per library.** The design draws a node that joins two
   libraries. The engine runs one node process per library
   (`docs/FRIENDS.md`), so each such node is two processes in one
   container, in sibling directories, and a pipeline that reads the other
   library reads it by path as a co-located library. Nothing lost; more
   processes than cards.
2. **A writer must hold every member.** A document update needs every
   member of the collection local ("needs every member local — fetch N
   missing"). The engine pulls collection members after a sync on a
   best-effort basis, which was not enough for nodes that only read the
   order document for a while and then wrote it. The simulators and the
   checks fetch what is missing before writing (`ensureLocal` in
   `lib/api.mjs`, `bin/hold.mjs` after the seed). A production kitchen
   display would do the same, or the node would run with the collection
   followed. A read hits the same rule when another node has just written
   a member this node does not hold yet, so the client fetches and retries
   once on that answer.
3. **SQL over a collection sees every version.** `SELECT ... FROM
   platform_orders` reads the delta members, one row per document
   version, with the fields in a JSON `doc` column. Queries that want the
   current documents take the latest row per `_id` (`QUALIFY row_number()
   OVER (PARTITION BY _id ORDER BY _ts DESC) = 1`), or use the document
   API's `count`/`find`, which resolve versions. The curated tables the
   pipelines land are plain columns and need neither.
4. **The signer of a version is not exposed over the API.** Every op is
   signed by the node that made it and verified by every node that merges
   it; a node that received an invalid op logs `rejected N`. There is no
   endpoint that names the signer of a table version, so checks 6 and 7
   prove the signature the way the engine does: the other side holds the
   table's versions and its log shows merges with nothing rejected.
5. **Field-level keys.** The design gives the chain's key, the platform's
   key and the courier app's key each a list of fields they sign. The
   engine signs per op with the writing node's key, which gives the same
   guarantee only because each party writes from its own nodes: the
   kitchen's fields from the restaurant's node, the platform's from the
   hub's. The courier app writes through the hub's node in this build, so
   `collected_at` and `delivered_at` carry the platform's signature, not
   the courier's.
6. **Geo dispatch needs the DuckDB spatial extension.** `$near` compiles
   to `ST_Distance_Sphere`, which needs `INSTALL spatial` once; the image
   installs it at build time. Nothing else was needed: the geo query in
   the design works as drawn.
7. **The settlement runs continuously, not weekly.** The engine's pipeline
   daemon runs a pass every interval (30 s here) over new delivered
   orders, so the settlement table grows as orders are delivered instead
   of once a week. The `week` column is there; a weekly cadence is a
   `--every 168h` on the daemon, which a demo cannot wait for.
8. **Simulators in Node.js.** The build sheet's facts say Kotlin and Swift
   for the kitchen display and the apps. The simulators make exactly the
   sheet's calls over the HTTP API in Node.js so the seed, the simulators
   and the checks share one runtime with no dependencies.
9. **Menus of 40 items.** The MVP sheet's generic seed count is 1,000
   documents per store; 333 dishes per restaurant is not a menu. Three
   restaurants get 40 items each. Orders (1,000), couriers (60) and
   sales follow the sheet.
10. **Agents stay proposals.** The fraud hold, the refund gate, the price
    approval, the stock-out queue and the disputed lines are marked
    proposed for an agent in the design and have no agent card, so they
    run as rules or by hand here and appear in `DEMO.md` as the slides
    they would be.
11. **The till.** The design's reconciliation compares the platform's
    statement to the chain's own sales, but nothing in the design writes
    the chain's record of a platform order. The seed writes it for the
    week of history and the kitchen display writes it when it marks an
    order ready: one `sales` document on the chain's library, gross and
    net, which is what a till would do. Without it every live order
    reconciled as a mismatch, which is how the gap was found.
12. **Rounding.** The settlement takes the fee as `round(total * 0.25)`
    in DuckDB and the seed first took the net as `Math.round(total *
    0.75)` in JavaScript; a third of the orders differed by a cent. The
    build sheet says which fields each side sets, not how each side
    rounds; a real settlement agreement would.
13. **A timestamp cursor skips ties.** The reconciliation reads the
    `settlements` table by its `settled_at` cursor. Every row a settlement
    pass lands carries the same `settled_at`, so a reconcile pass that
    stops partway through such a group moves its cursor to the group's
    stamp and the rest of the group is never read: the first manual pass
    of 500 rows over a landing of 988 left about half the planted
    mismatches unfound. The daemon's batch is now 2,000, above any one
    landing in this demo, and `DECISIONS.md` says so; a real deployment
    would give the settlement a row-unique cursor column.
14. **A node seeds only to peers it knows.** Blob bytes are served to
    peers a node has synced with; the head office synced with
    restaurant-1 alone and could never fetch a till member restaurant-2
    wrote ("refusing to seed to unknown peer"). On one private network
    every node runs with `--seed-open` (`DECISIONS.md`, 10).
15. **SQL over a hot collection trails the document API.** `find` and
    `count` resolve the latest version of every document at once;
    `SELECT ... FROM platform_orders` reads the collection's members as
    the SQL view last saw them, so an order the document API already
    shows delivered can still read as in flight over the wire for a
    while. The checks take the in-flight count from the document API;
    the dashboard's panel is a trailing view and says so.
