```
MVP SHEET: Kitchen to courier: a chain and a platform on one shared library, on one machine with docker-compose

The build sheet says what the system is. This says how to run a demo of it on one machine: one container per node role, the same libraries, stores, jobs and processes, seeded data, a script that walks the processes, and the checks that show it worked.

1. Services
  - restaurant-node-back-off ×3 (Restaurant node, back office, ×600 in the design): image unidatum:$UNIDATUM_VERSION, volume restaurant-node-back-off-data, HTTP API 7480 -> host 7481, serves SQL (--sql), joins chain-ops, chain-platform-shared
  - regional-hub ×2 (Regional hub, ×6 in the design): image unidatum:$UNIDATUM_VERSION, volume regional-hub-data, HTTP API 7480 -> host 7482, serves SQL (--sql), joins platform-eu, chain-platform-shared
  - chain-head-office-node (Chain head office node): image unidatum:$UNIDATUM_VERSION, volume chain-head-office-node-data, HTTP API 7480 -> host 7483, serves SQL (--sql), joins chain-ops, chain-platform-shared
  - platform-analytics-node (Platform analytics node): image unidatum:$UNIDATUM_VERSION, volume platform-analytics-node-data, HTTP API 7480 -> host 7484, serves SQL (--sql), joins platform-eu, chain-platform-shared
  - discovery: no rendezvous on one machine; every other node starts with --bootstrap restaurant-node-back-off-1:$DHT_PORT --no-mdns and finds the rest through restaurant-node-back-off-1's DHT. Keep the design's invite links for the real deployment.
  - sqld (unidatum sql-serve --pg-port 5433): the PostgreSQL wire for the dashboards
  - metabase: the dashboards, on the wire, with the build sheet's queries made in advance
  - kitchen-display-sim (Kitchen display): a script in Kotlin that makes the calls in the build sheet, in flow order
  - courier-and-customer-app-sim (Courier and customer apps): a script in Kotlin that makes the calls in the build sheet, in flow order
  - seed: a one-shot container that loads the data in section 4, then exits

2. Scale for the demo
  - Restaurant node, back office: ×600 in the design, ×3 here
  - Regional hub: ×6 in the design, ×2 here
  - menu: 1 per item in the design; 1,000 documents seeded, for 3 of the ×600
  - platform_orders: 1 per order in the design; 1,000 documents seeded
  - menu_published: 1 per item and restaurant in the design; 10,000 rows seeded
  - settlements: 1 per order in the design; 10,000 rows seeded
  - couriers: 1 per courier in the design; 1,000 documents seeded

3. Libraries
  - chain-ops: restaurant-node-back-off, chain-head-office-node; joined by name on the compose network
  - chain-platform-shared: restaurant-node-back-off, regional-hub, chain-head-office-node, platform-analytics-node; joined by name on the compose network
  - platform-eu: regional-hub, platform-analytics-node; joined by name on the compose network

4. Stores, keys and jobs
  As in the build sheet, sections 3 and 4: the fields, who sets them, the keys and the jobs are the same at this scale.
  - chain-head-office-node holds: sales_curated (SQL table), Reconcile settlements (Pipeline), settlement_mismatches (SQL table)
  - platform-analytics-node holds: Curate order timelines (Pipeline), deliveries_curated (SQL table), Compute the week's settlement (Pipeline)
  Seed data, made by the seed container:
  - menu: 1,000 documents with item_id, name, price_cents, available, prep_notes, supplier
  - platform_orders: 1,000 documents with order_id, restaurant_id, accepted_at, collected_at, courier_id, items, ready_at, delivered_at, status [written as Platform]
  - menu_published: 10,000 rows with restaurant_id, item_id, name, price_cents, available, published_at [written as Chain (×600 restaurants)]
  - settlements: 10,000 rows with order_id, restaurant_id, gross_cents, platform_fee_cents, net_cents, week, settled_at [written as Platform]
  - couriers: 1,000 documents with courier_id, state, location, current_order, updated_at

5. Demo script
  Order to doorstep
    1. Order placed: run courier-and-customer-app-sim order-placed
    2. Create the order document (the hub): watch regional-hub do it (a pipeline or watcher); then look at platform_orders (writes the order)
    3. Fraud and address check: run the agent (Claude Code over MCP), then approve its proposal (proposed: show it as a slide if the agent is not built)
    4. Accept in the kitchen (the kitchen): run kitchen-display-sim accept-in-the-kitchen; then look at platform_orders (writes accepted)
    5. Cooking: show the queue: count platform_orders (about 6 per kitchen at peak in the design)
    6. Mark ready (the kitchen): run kitchen-display-sim mark-ready; then look at platform_orders (writes ready)
    7. Dispatch a courier (the hub): watch regional-hub do it (a pipeline or watcher); then look at couriers
    8. Collect and deliver (the courier): run courier-and-customer-app-sim collect-and-deliver; then look at platform_orders (writes collected, delivered)
    9. Late or wrong: refund?: run the agent (Claude Code over MCP), then approve its proposal (proposed: show it as a slide if the agent is not built); then look at platform_orders
    10. Delivered: the end: look at platform_orders
    check: Promised time kept, placed to delivered within the promise, 95% of orders
  Menu to platform
    1. Price or item change: seed one menu document; then look at menu
    2. Edit the menu (head office, or the kitchen for availabi): write menu by hand (curl); then look at menu (writes price, availability)
    3. Price change approval: run the agent (Claude Code over MCP), then approve its proposal (proposed: show it as a slide if the agent is not built); then look at menu
    4. Publish, signed (the restaurant node): watch restaurant-node-back-off do it (a pipeline or watcher); then look at menu_published (writes the published rows)
    5. Verify and show (the hub): watch regional-hub do it (a pipeline or watcher); then look at menu_published
    6. Live on the platform: the end: look at the record
    7. Items out of stock: run the agent (Claude Code over MCP), then finish by hand (proposed: show it as a slide if the agent is not built)
    check: Change live in five minutes, edit to live within 5 minutes
  Settle to paid
    1. Week closes: seed one platform_orders document; then look at platform_orders
    2. Compute the settlement (the analytics node): watch platform-analytics-node do it (a pipeline or watcher); then look at platform_orders
    3. Publish the statement, signed (the analytics node): watch platform-analytics-node do it (a pipeline or watcher); then look at settlements (writes one row per order)
    4. Reconcile by order (the head office node): watch chain-head-office-node do it (a pipeline or watcher); then look at settlements
    5. Disputed lines: run the agent (Claude Code over MCP) (proposed: show it as a slide if the agent is not built)
    6. Dispute over the limit: run the agent (Claude Code over MCP), then approve its proposal (proposed: show it as a slide if the agent is not built); then look at settlements
    7. Pay the chain (the platform's finance): watch platform-analytics-node do it (a pipeline or watcher); then look at settlements
    8. Paid: the end: look at settlements
    check: Paid within nine days, week close to paid within 9 days

6. Checks
  - menu: count equals what was seeded plus what the script wrote
  - platform_orders: count equals what was seeded plus what the script wrote
  - menu_published: count equals what was seeded plus what the script wrote
  - settlements: count equals what was seeded plus what the script wrote
  - couriers: count equals what was seeded plus what the script wrote
  - menu_published: every commit carries menu's signature and the other side verifies it
  - settlements: every commit carries Platform analytics node's signature and the other side verifies it
  - after Create the order document: platform_orders writes the order
  - after Accept in the kitchen: platform_orders writes accepted
  - after Mark ready: platform_orders writes ready
  - after Collect and deliver: platform_orders writes collected, delivered
  - after Edit the menu: menu writes price, availability
  - after Publish, signed: menu_published writes the published rows
  - after Publish the statement, signed: settlements writes one row per order
  - Promised time kept: placed to delivered within the promise, 95% of orders, over the script's run
  - Change live in five minutes: edit to live within 5 minutes, over the script's run
  - Paid within nine days: week close to paid within 9 days, over the script's run
  - Reconciliation and prep-time dashboards: Prep time by restaurant returns rows
  - Reconciliation and prep-time dashboards: Delivery time by hub returns rows
  - Reconciliation and prep-time dashboards: Settlement vs sales returns rows
  - Reconciliation and prep-time dashboards: Orders in flight now returns rows

7. docker-compose.yml (draft)
  services:
    restaurant-node-back-off-1:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library chain-ops --node-name restaurant-node-back-off-1 || true; unidatum serve --port 7480 --no-mdns --sql --dht-port ${DHT_PORT}"
      volumes: ["restaurant-node-back-off-1-data:/data"]
      ports: ["7481:7480"]
      networks: [demo]
    restaurant-node-back-off-2:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library chain-ops --node-name restaurant-node-back-off-2 || true; unidatum serve --port 7480 --no-mdns --sql --bootstrap restaurant-node-back-off-1:${DHT_PORT}"
      volumes: ["restaurant-node-back-off-2-data:/data"]
      ports: ["7581:7480"]
      networks: [demo]
    restaurant-node-back-off-3:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library chain-ops --node-name restaurant-node-back-off-3 || true; unidatum serve --port 7480 --no-mdns --sql --bootstrap restaurant-node-back-off-1:${DHT_PORT}"
      volumes: ["restaurant-node-back-off-3-data:/data"]
      ports: ["7681:7480"]
      networks: [demo]
    regional-hub-1:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library platform-eu --node-name regional-hub-1 || true; unidatum serve --port 7480 --no-mdns --sql --bootstrap restaurant-node-back-off-1:${DHT_PORT}"
      volumes: ["regional-hub-1-data:/data"]
      ports: ["7482:7480"]
      networks: [demo]
    regional-hub-2:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library platform-eu --node-name regional-hub-2 || true; unidatum serve --port 7480 --no-mdns --sql --bootstrap restaurant-node-back-off-1:${DHT_PORT}"
      volumes: ["regional-hub-2-data:/data"]
      ports: ["7582:7480"]
      networks: [demo]
    chain-head-office-node:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library chain-ops --node-name chain-head-office-node || true; unidatum serve --port 7480 --no-mdns --sql --bootstrap restaurant-node-back-off-1:${DHT_PORT}"
      volumes: ["chain-head-office-node-data:/data"]
      ports: ["7483:7480"]
      networks: [demo]
    platform-analytics-node:
      image: unidatum:${UNIDATUM_VERSION}
      command: sh -c "unidatum init --library platform-eu --node-name platform-analytics-node || true; unidatum serve --port 7480 --no-mdns --sql --bootstrap restaurant-node-back-off-1:${DHT_PORT}"
      volumes: ["platform-analytics-node-data:/data"]
      ports: ["7484:7480"]
      networks: [demo]
    sqld:
      image: unidatum:${UNIDATUM_VERSION}
      command: unidatum sql-serve --pg-port 5433 --flight-port 47820
      depends_on: [restaurant-node-back-off-1]
      ports: ["5433:5433"]
      networks: [demo]
    metabase:
      image: metabase/metabase
      ports: ["3000:3000"]
      networks: [demo]
    kitchen-display-sim:
      build: ./sims/kitchen-display
      depends_on: [restaurant-node-back-off-1]
      networks: [demo]
    courier-and-customer-app-sim:
      build: ./sims/courier-and-customer-app
      depends_on: [restaurant-node-back-off-1]
      networks: [demo]
    seed:
      build: ./seed
      depends_on: [restaurant-node-back-off-1]
      networks: [demo]
  volumes:
    restaurant-node-back-off-1-data: {}
    restaurant-node-back-off-2-data: {}
    restaurant-node-back-off-3-data: {}
    regional-hub-1-data: {}
    regional-hub-2-data: {}
    chain-head-office-node-data: {}
    platform-analytics-node-data: {}
  networks:
    demo: {}

Still to decide for the MVP
  - UNIDATUM_VERSION: the release to pin, and an image built from its linux-amd64 archive
  - DHT_PORT: the port the first node's DHT listens on
  - whether one engine process joins several libraries (Restaurant node, back office, Regional hub, Chain head office node, Platform analytics node); if not, run one container per library and make each publish job a client script between them
```
