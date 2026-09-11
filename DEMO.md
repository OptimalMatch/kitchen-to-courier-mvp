# The demo

The MVP sheet's section 5, corrected by what was built. Everything runs on
one machine with docker-compose; the engine's release archive sits in this
folder (see `README.md`).

## Bring it up

```bash
cp .env.example .env                      # pin the release; set the SQL wire's password
docker compose up -d --build              # seven nodes, the SQL wires, Metabase
docker compose run --rm tools node pipelines/specs.mjs   # register the five jobs
docker compose run --rm tools node seed/seed.mjs         # a week of orders, menus, couriers, the till
docker compose run --rm tools node bin/hold.mjs          # every writer holds what it writes
docker compose --profile sims up -d       # three kitchen displays, two dispatchers, two courier apps
docker compose run --rm tools node bin/metabase.mjs      # the dashboards
```

Where things are from the host: the restaurants' nodes on 17480/17481
(r1), 17490/17491 (r2), 17500/17501 (r3), the head office on 17510/17511,
the hubs on 17520/17521 and 17530/17531, the analytics node on
17540/17541. The first port of each pair is the node's own library
(chain-ops or platform-eu), the second the shared library. Each is a web
UI and an HTTP API. Metabase is on 13100 (demo@example.com,
Demo-only-1234); the PostgreSQL wires on 15433 (analytics) and 15434 (head
office), user `demo`.

## Order to doorstep

| step | who | what to run | then look at |
|---|---|---|---|
| 1. Order placed | the customer app | `docker compose run --rm tools node sims/customer.mjs` (ORDERS=3 by default; it tracks the first to the door) | the order in the hub's UI: http://127.0.0.1:17521, collection `platform_orders`, status `created` |
| 2. Create the order document | the hub, a rule | nothing: the customer app writes it through the hub's node on the shared library, signed by the hub | the same document from a restaurant's node, http://127.0.0.1:17481, arrived by sync |
| 3. Fraud and address check | proposed for an agent | a slide: "a new card at a new address: hold; over 150 goes to the risk desk" | |
| 4. Accept in the kitchen | the kitchen | `docker compose logs -f kitchen-display-1` | `accepted_at` on the document, written by the restaurant's node |
| 5. Cooking | the kitchen | wait 15 s (COOK_MS) | the queue: "Orders in flight now" in Metabase |
| 6. Mark ready | the kitchen | the same log | `ready_at` |
| 7. Dispatch a courier | the hub, a rule | `docker compose logs -f dispatch-1` | `courier_id` on the order, `state: assigned` on the courier (http://127.0.0.1:17520, `couriers`), chosen by `$near` |
| 8. Collect and deliver | the courier | `docker compose logs -f courier-app-1` | `collected_at`, then `delivered_at` after 20 s (RIDE_MS) |
| 9. Late or wrong: refund? | proposed for an agent | a slide: "20 minutes late or an item missing: refund the item; over 40 goes to a person" | |
| 10. Delivered | | the customer app's last line | the order's whole timeline on one document |

Check: **Promised time kept**: `deliveries_curated` on the analytics node
(http://127.0.0.1:17540), `late` is false for 95% of orders.

## Menu to platform

| step | who | what to run | then look at |
|---|---|---|---|
| 1. Price or item change | head office | `curl -X POST http://127.0.0.1:17480/api/doc/update -H 'content-type: application/json' -d '{"collection":"menu","filter":{"_id":"r1:it-001"},"update":{"$set":{"price_cents":1250}}}'` | `menu` on the restaurant's node |
| 2. Edit the menu | head office, or the kitchen for availability | the same call with `available: false` | |
| 3. Price change approval | proposed for an agent | a slide: "more than 10% on an item: the head of menu" | |
| 4. Publish, signed | the restaurant node, a rule | nothing: the `menu-publish` pipeline on the head office's shared node runs every 30 s, reading the chain's library by path | `menu_published` on the hub's shared node, http://127.0.0.1:17521, with the new price |
| 5. Verify and show | the hub, a rule | nothing: the hub merged the chain's signed commit and its log says `rejected 0` | http://127.0.0.1:17521/api/log |
| 6. Live on the platform | | | the same row from the customer's side |
| 7. Items out of stock | proposed for an agent's help | a slide | |

Check: **Change live in five minutes**: the checks time it (46 s in the
run this was written from).

## Settle to paid

| step | who | what to run | then look at |
|---|---|---|---|
| 1. Week closes | the analytics node | nothing: the `settlement` pipeline runs every 30 s over delivered orders (weekly in production, see GAPS.md 7) | |
| 2. Compute the settlement | the analytics node, a rule | | `settlements` on the analytics node's shared library, http://127.0.0.1:17541: gross, the 25% fee, net, week, customer and courier hashed |
| 3. Publish the statement, signed | the analytics node, a rule | | the same table on the head office's shared node, http://127.0.0.1:17511 |
| 4. Reconcile by order | the head office node, a rule | the `reconcile` pipeline joins the statement to the chain's own `sales` and keeps the lines that differ | `settlement_mismatches` on http://127.0.0.1:17510 (the seed plants about 2%) |
| 5. Disputed lines | proposed for an agent | a slide | |
| 6. Dispute over the limit | proposed for an agent | a slide: "a line over 50, or a repeat: a person decides" | |
| 7. Pay the chain | the platform's finance, a rule | not built: the bank file is outside the design | |
| 8. Paid | | | |

Check: **Paid within nine days**: the checks compare `settled_at` to
`delivered_at`.

## The dashboards

Metabase, http://127.0.0.1:13100: "Reconciliation and prep-time
dashboards" with the build sheet's four questions, two over the analytics
node's wire, one over the head office's, one over the shared orders.

## The checks

```bash
docker compose run --rm tools node checks/run.mjs
```

Twenty-one checks, one per line of the MVP sheet's section 6; the run
edits a menu price and waits for it to go live, so it takes about a minute.

## Take it down

```bash
docker compose --profile sims --profile tools down -v
```
