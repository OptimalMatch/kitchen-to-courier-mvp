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
   followed.
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
