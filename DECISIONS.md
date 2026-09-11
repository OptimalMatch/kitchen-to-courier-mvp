# Decisions

The kit's prompt says to ask the MVP sheet's open questions once before
starting. These are the answers this build runs on, and why.

1. **Release: v2.362.0**, the newest in the engine's `dist/`. The image is
   built from `unidatum-v2.362.0-linux-amd64.tar.gz` placed in this folder
   (`.gitignore` keeps the archive and the binaries out of git). Pin it in
   `.env` as `UNIDATUM_VERSION=v2.362.0`.
2. **Ports.** Inside a container each node keeps the engine's own layout:
   sync port 47800, DHT 47801, HTTP API and web UI 7480 for the first
   library; 47810, 47811, 7481 for the second. `DHT_PORT` in the sheet is
   therefore 47801 (and 47811). Host ports are listed in `DEMO.md`.
3. **One node per library.** The engine's `docs/FRIENDS.md` is explicit: a
   library is one swarm, one `.p2pfs` directory, one node process; a
   machine runs one node per library on different ports. So a design node
   that "joins two libraries" is two engine processes in one container,
   in sibling directories `/data/<library>`. That is what the sheet's third
   question was asking, and the answer moves the two publish jobs out of
   the engine's realtime path: a pipeline may read a co-located library by
   path but cannot stream from it, so each publish job is a scheduled
   pipeline on the node in the shared library, reading the sibling
   directory of the chain's (or platform's) library. If that path proves
   short in this release, the fallback is a client script between the two
   nodes' HTTP APIs, and `GAPS.md` will say so.
4. **Discovery.** No rendezvous and no public DHT on one machine: every
   node starts with `--no-mdns` and a `--bootstrap` pointing at the first
   member of its library, and the entrypoint runs one `unidatum sync` to
   that member after start so the peer is known from the first minute
   (the engine then syncs every 15 s and pushes on every commit).
5. **Scale** as the sheet says: three restaurants, two hubs, one head
   office, one analytics node. Nothing scaled without asking.
6. **Simulators in Node.js**, not Kotlin as the sheet suggests from the
   apps' facts. The demo needs one runtime the seed, the simulators and
   the checks can share, and the engine's HTTP API needs nothing beyond
   `fetch`. The calls are exactly the build sheet's, in flow order; a
   Kotlin client would make the same calls.
7. **Dashboards** in Metabase over the PostgreSQL wire of `unidatum-sqld`,
   as the sheet says.
8. **Agent steps stay proposals.** The design has no agent card, so the
   fraud hold, the refund gate, the price approval, the stock-out queue
   and the disputed lines run as rules or by hand in the demo, and
   `DEMO.md` shows them as the slides they would be.
