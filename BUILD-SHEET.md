```
BUILD SHEET: Kitchen to courier: a chain and a platform on one shared library

1. Nodes
  - Restaurant node, back office ×600: where back office, one per restaurant (The chain's node from the restaurant-chain design. Joins the shared library as well as the chain's own)
      host: Back-office box, machine 4 cores, 16 GB, storage 1 TB SSD, os Linux
      joins library chain-ops via LAN beacon, private DHT as member
      joins library chain-platform-shared via invite link via rendezvous as member
  - Shared library: nodes both parties', library one name, invite links (Nodes from both organisations. Invite links through the rendezvous; every commit signed by whoever made it)
      joins library chain-platform-shared via invite link via rendezvous as both sides member
      member: Head office nodes, where chain HQ, platform HQ
  - Regional hub: nodes 6 per hub, sites 40 hubs (The platform's hub from the food-delivery design. Joins the shared library as well as its own)
      host: Hub machine, machine 8 vCPU, 64 GB, storage 2 TB NVMe, os Linux amd64
      joins library platform-eu via private DHT as member
      joins library chain-platform-shared via invite link via rendezvous as member
  - Chain head office node (Reads settlements from the shared library and the chain's own sales; reconciles by order id)
      host: Head office server, machine 16 cores, 128 GB, storage 8 TB NVMe, os Linux amd64
      joins library chain-ops via private DHT as member, holds the catalog
      joins library chain-platform-shared via invite link via rendezvous as member
      holds: sales_curated (SQL table), rows 1 per order line, partitioned by restaurant, day
      holds: Reconcile settlements (Pipeline), rate weekly, steps join, compare, land
      holds: settlement_mismatches (SQL table), rows a few per week, cadence weekly
  - Platform analytics node (Reads menus and order timelines from the shared library into the platform's own analytics; publishes the week's settlement)
      host: Analytics server, machine 32 cores, 256 GB, storage 16 TB NVMe, os Linux amd64
      joins library platform-eu via private DHT as member, holds the catalog
      joins library chain-platform-shared via invite link via rendezvous as member
      holds: Curate order timelines (Pipeline), rate per minute, steps read, compute, land
      holds: deliveries_curated (SQL table), rows billions per month, partitioned by hub, day
      holds: Compute the week's settlement (Pipeline), rate weekly, steps filter, aggregate, land

2. Libraries
  - chain-ops: joined by Restaurant node, back office, Chain head office node
  - chain-platform-shared: joined by Restaurant node, back office, Shared library, Regional hub, Chain head office node, Platform analytics node
  - platform-eu: joined by Regional hub, Platform analytics node

3. Stores
  - menu ×600: documents 1 per item, merge field-level (Prices from head office, availability from the kitchen; the source of what is published)
      item_id: string, set by head office, index unique
      name: string, set by head office
      price_cents: integer, set by head office, merge last writer
      available: boolean, set by kitchen, merge per field
      prep_notes: string, set by kitchen (Stays in the chain; dropped before publishing)
      supplier: string, set by head office (Stays in the chain)
  - platform_orders: documents 1 per order, merge field-level CRDT (One document per platform order. The platform creates it; the kitchen sets accepted and ready; the courier sets collected. Field-level merge) [owned by Platform]
      order_id: string, set by platform, index unique
      restaurant_id: string, set by platform, index by restaurant
      accepted_at: timestamp, set by kitchen
      collected_at: timestamp, set by courier
      courier_id: string, set by platform dispatch
      items: array of item, qty, price, set by platform
      ready_at: timestamp, set by kitchen, index by ready_at
      delivered_at: timestamp, set by courier
      status: enum, set by platform, kitchen, courier, merge last writer, per field (created, accepted, ready, collected, delivered)
      signed with: Chain's key, held by restaurant node, signs accepted_at, ready_at, verified by platform hub
      signed with: Platform's key, held by regional hub, signs order, status, courier_id, verified by restaurant node
      signed with: Courier app's key, held by courier app, signs collected_at, delivered_at, verified by both nodes
  - menu_published: rows 1 per item and restaurant, cadence every few minutes (Published by the chain every few minutes as a signed commit; the platform verifies and reads it) [owned by Chain (×600 restaurants)]
      restaurant_id: string, set by chain, index partition
      item_id: string, set by chain
      name: string, set by chain
      price_cents: integer, set by chain
      available: boolean, set by chain
      published_at: timestamp, set by publish job
      signed with: Chain's key, held by restaurant node, signs each commit, verified by hub before pricing
      published: cadence every 5 minutes, window changed rows, trigger menu commit
  - settlements: rows 1 per order, cadence weekly (Published weekly by the platform, signed; the chain verifies and reconciles) [owned by Platform]
      order_id: string, set by platform, index unique
      restaurant_id: string, set by platform, index partition
      gross_cents: integer, set by platform
      platform_fee_cents: integer, set by platform
      net_cents: integer, set by platform
      week: date, set by platform, index partition
      settled_at: timestamp, set by settlement job
      signed with: Platform's key, held by platform analytics node, signs each weekly commit, verified by chain head office
      published: cadence weekly, window previous week, trigger clock
  - couriers: documents 1 per courier, indexes geo (Dispatch by geo query when an order document turns ready)
      courier_id: string, set by platform, index unique
      state: enum, set by courier app, dispatch, merge per field (available, assigned, delivering, off)
      location: geo point, set by courier app, index 2dsphere
      current_order: order_id, set by dispatch
      updated_at: timestamp, set by courier app
      signed with: Courier app's key, held by courier app, signs location, state, verified by hub

4. Jobs
  - menu -> menu_published (every few minutes)
      runs: cadence every 5 minutes, window items changed since last run, trigger a commit on menu
      1. filter: price or availability changed
      2. rename: item_id, name, price_cents, available
      3. mask: prep_notes, supplier
      4. land: menu_published in the shared library (1 lanes)
  - Platform analytics node -> settlements (weekly)
      runs: cadence weekly, window previous Monday to Sunday, trigger clock
      1. filter: status = delivered and delivered_at in w
      2. compute: gross, fee = gross × rate, net
      3. mask: customer_id, courier_id
      4. land: settlements in the shared library (1 lanes)

5. Applications
  - Kitchen display ×600: language Kotlin, api find, put (Shows platform orders beside till orders; one tap marks accepted, then ready)
      step 2: /api/doc/find {status: "created", restaurant_id} (New platform orders)
      step 3: /api/doc/put $set status: accepted, accepted_at (Accept)
      step 3: /api/doc/put $set status: ready, ready_at (Ready)
  - Courier and customer apps: language Kotlin, Swift, TypeScript (Track the order document; the courier marks collected)
      step 4: /api/doc/find {status: "ready", $near} (Orders ready near me)
      step 2 to 5: /api/doc/get order_id (Customer tracks the order)
      step 5: /api/doc/put $set status: collected, collected_at (Collected)
      step 5: /api/doc/put $set status: delivered, delivered_at (Delivered)
  - Reconciliation and prep-time dashboards: tool Power BI, wire PostgreSQL (Both parties, each on their own nodes, over the same signed records)
      step 3: PostgreSQL wire, SQL ready_at - accepted_at, by restaurant, d (Prep time by restaurant)
      step 5: PostgreSQL wire, SQL delivered_at - ready_at, by hub, hour (Delivery time by hub)
      step 7: PostgreSQL wire, SQL settlements join sales_curated on order_ (Settlement vs sales)
      step 1 to 4: /api/doc/count {status: {$in: [created, accepted, ready (Orders in flight now)

7. How it flows
  1. Regional hub -> platform_orders: creates
  2. platform_orders -> Restaurant node, back office: to the kitchen
  3. Kitchen display -> platform_orders: accepted, ready
  4. platform_orders -> couriers: ready: dispatch
  5. Courier and customer apps -> platform_orders: collected, delivered
  6. Platform analytics node -> settlements: weekly
  7. settlements -> Chain head office node: reconciles

8. Processes
  - Order to doorstep: owner the platform's operations lead, cases 1.2 million a week, cycle time 34 minutes (Open it: nine steps from an order placed to delivered, across the platform, the kitchen and the courier.)
      - Order placed (Event): source the customer app, rate 1.2 million a week, carries items, address, promised time [runs on Courier and customer apps, Regional hub]
      - Promised time kept (Service level): measure placed to delivered, target within the promise, 95% of orders, on a miss the hub's operations lead is told [runs on Reconciliation and prep-time dashboards] (Every step's time is on the order document.)
      - Kitchen crew (Role): people 4 per restaurant, works in the kitchen display, hours 11 to 23
      - Couriers (Role): people about 30 per hub at peak, works in the courier app, hours shifts, 10 to 24
      - Create the order document (Stage): who the hub, system the shared library, touch time instant [runs on Regional hub, platform_orders] (One platform_orders document per order, signed by the hub.)
      - Fraud and address check (Decision gate): rule a new card at a new address: hold, approver the platform's risk desk, limit over 150 goes to a person [runs on Regional hub]
      - Accept in the kitchen (Stage): who the kitchen, system the kitchen display, touch time 20 seconds [runs on Kitchen display, platform_orders, Restaurant node, back office] (The order reaches the restaurant node by sync and shows beside till orders.)
      - Cooking (Work queue): waiting about 6 per kitchen at peak, wait time 11 minutes, worked by the kitchen [runs on Kitchen display, platform_orders]
      - Mark ready (Stage): who the kitchen, system the kitchen display, touch time 5 seconds [runs on Kitchen display, platform_orders] (One tap; the ready time lands on the order document.)
      - Dispatch a courier (Stage): who the hub, system the couriers collection, by geo query, touch time instant [runs on couriers, platform_orders, Regional hub] (Fires when the order document turns ready.)
      - Collect and deliver (Stage): who the courier, system the courier app, touch time 14 minutes [runs on Courier and customer apps, platform_orders]
      - Late or wrong: refund? (Decision gate): rule 20 minutes late or an item missing: refu, approver the support desk, limit over 40 goes to a person [runs on platform_orders, Courier and customer apps]
      - Delivered (Event): source the order document, carries the time at every step [runs on platform_orders, Platform analytics node, Reconciliation and prep-time dashboards]
        1. Order placed -> Create the order document: order placed
        2. Create the order document -> Fraud and address check: created
        3. Fraud and address check -> Accept in the kitchen: to the kitchen
        4. Accept in the kitchen -> Cooking: accepted
        5. Cooking -> Mark ready: cooked
        6. Mark ready -> Dispatch a courier: ready: dispatch
        7. Dispatch a courier -> Collect and deliver: assigned
        8. Collect and deliver -> Late or wrong: refund?: delivered
        9. Late or wrong: refund? -> Delivered: closed
  - Menu to platform: owner the chain's head of menu, cases about 400 changes a week, cycle time under 5 minutes (Open it: five steps from a price change to live on the platform.)
      - Price or item change (Event): source head office, rate about 400 a week, carries item, price, availability [runs on Chain head office node, menu]
      - Change live in five minutes (Service level): measure edit to live, target 5 minutes, on a miss the chain's IT is paged [runs on Platform analytics node]
      - Items out of stock (Work queue): waiting about 3 per kitchen, wait time until the next delivery, worked by the kitchen [runs on menu, Kitchen display] (An agent could predict the stock-out and pull the item before it sells out.)
      - Edit the menu (Stage): who head office, or the kitchen for availabi, system the menu collection, touch time 2 minutes [runs on menu, Restaurant node, back office] (Prices from head office, availability from the kitchen, on one document per item.)
      - Price change approval (Decision gate): rule more than 10% on an item: the head of me, approver the head of menu, limit a new item goes to the category lead [runs on menu]
      - Publish, signed (Stage): who the restaurant node, system the shared library, touch time every few minutes [runs on Restaurant node, back office, menu_published, Shared library] (Changed items only, public columns only, one signed commit.)
      - Verify and show (Stage): who the hub, system the platform's menu, touch time instant [runs on Regional hub, menu_published] (The hub verifies the chain's signature and reads the rows.)
      - Live on the platform (Event): source the hub, carries the menu as the customer sees it [runs on Regional hub, Courier and customer apps]
        1. Price or item change -> Edit the menu: change
        2. Edit the menu -> Price change approval: edited
        3. Price change approval -> Publish, signed: approved
        4. Publish, signed -> Verify and show: signed commit
        5. Verify and show -> Live on the platform: verified
  - Settle to paid: owner the platform's finance, cases about 600 statements a week, cycle time 9 days (Open it: seven steps from the week closing to the chain paid.)
      - Week closes (Event): source the platform's analytics node, rate weekly, carries every delivered order [runs on Platform analytics node, platform_orders]
      - Chain finance desk (Role): people 3, works in the reconciliation dashboards, hours 9 to 5, weekdays
      - Partner finance (Role): people 5, works in the platform's analytics, hours 9 to 6, weekdays
      - Paid within nine days (Service level): measure week close to paid, target 9 days, on a miss both finance leads are told [runs on Reconciliation and prep-time dashboards]
      - Compute the settlement (Stage): who the analytics node, system the platform's analytics, touch time 40 minutes for every restaurant [runs on Platform analytics node, platform_orders]
      - Publish the statement, signed (Stage): who the analytics node, system the shared library, touch time instant [runs on Platform analytics node, settlements, Shared library] (One row per order; the chain verifies the platform's key.)
      - Reconcile by order (Stage): who the head office node, system the chain's own sales, touch time 20 minutes [runs on Chain head office node, settlements, Reconciliation and prep-time dashboards] (Matched by order id against the till.)
      - Disputed lines (Work queue): waiting about 200 a week, wait time 6 days, worked by the chain's finance desk [runs on settlements, Reconciliation and prep-time dashboards] (An agent could raise and settle the small ones under the limit.)
      - Dispute over the limit (Decision gate): rule a line over 50, or a repeat: a person de, approver the platform's partner finance, limit 50 [runs on settlements]
      - Pay the chain (Stage): who the platform's finance, system the bank file from the statement, touch time 10 minutes [runs on settlements, Platform analytics node]
      - Paid (Event): source the platform's finance, carries amount, disputes settled [runs on settlements, Chain head office node]
        1. Week closes -> Compute the settlement: week closed
        2. Compute the settlement -> Publish the statement, signed: computed
        3. Publish the statement, signed -> Reconcile by order: signed statement
        4. Reconcile by order -> Disputed lines: mismatches
        5. Disputed lines -> Dispute over the limit: disputes
        6. Dispute over the limit -> Pay the chain: settled
        7. Pay the chain -> Paid: paid
  - Partner agreement (Policy): sets refund limits, price bands, settlement t, owned by both partner leads, version 2026-09 [runs on Shared library] (One signed agreement; every gate on both sides reads it.)
  - Promised time, prep time, settlement variance (Process measure): formula delivered minus placed; ready minus acce, target 95% on time; variance under 0.5%, cadence nightly [runs on Reconciliation and prep-time dashboards, Platform analytics node, Chain head office node] (Both parties read the same signed records on their own nodes.)

  Where agents help
    19 steps say who does them: 5 a person; 1 a person, with an agent's help (1 proposed); 4 an agent proposes, a person approves (4 proposed); 1 an agent (1 proposed); 8 a rule, automatic
    - Order to doorstep: Create the order document, a rule, automatic [runs on Regional hub, platform_orders]
    - Order to doorstep: Fraud and address check, an agent proposes, a person approves (proposed) [runs on Regional hub] (name the agent card it runs on)
    - Order to doorstep: Dispatch a courier, a rule, automatic [runs on couriers, platform_orders, Regional hub]
    - Order to doorstep: Late or wrong: refund?, an agent proposes, a person approves (proposed) [runs on platform_orders, Courier and customer apps] (name the agent card it runs on)
    - Menu to platform: Items out of stock, a person, with an agent's help (proposed) [runs on menu, Kitchen display] (name the agent card it runs on)
    - Menu to platform: Price change approval, an agent proposes, a person approves (proposed) [runs on menu] (name the agent card it runs on)
    - Menu to platform: Publish, signed, a rule, automatic [runs on Restaurant node, back office, menu_published, Shared library]
    - Menu to platform: Verify and show, a rule, automatic [runs on Regional hub, menu_published]
    - Settle to paid: Compute the settlement, a rule, automatic [runs on Platform analytics node, platform_orders]
    - Settle to paid: Publish the statement, signed, a rule, automatic [runs on Platform analytics node, settlements, Shared library]
    - Settle to paid: Reconcile by order, a rule, automatic [runs on Chain head office node, settlements, Reconciliation and prep-time dashboards]
    - Settle to paid: Disputed lines, an agent (proposed) [runs on settlements, Reconciliation and prep-time dashboards] (name the agent card it runs on)
    - Settle to paid: Dispute over the limit, an agent proposes, a person approves (proposed) [runs on settlements] (name the agent card it runs on)
    - Settle to paid: Pay the chain, a rule, automatic [runs on settlements, Platform analytics node]

9. Architecture by process
  13 of 13 cards carry a process step
  - Restaurant node, back office (Unidatum node): Order to doorstep (Order, menu and settlement across two companies); Accept in the kitchen (Order to doorstep); Menu to platform (Order, menu and settlement across two companies); Edit the menu (Menu to platform); Publish, signed (Menu to platform)
  - menu (Document collection): Menu to platform (Order, menu and settlement across two companies); Price or item change (Menu to platform); Edit the menu (Menu to platform), writes writes price, availability; Price change approval (Menu to platform); Items out of stock (Menu to platform)
  - Kitchen display (Application): Order to doorstep (Order, menu and settlement across two companies); Accept in the kitchen (Order to doorstep); Cooking (Order to doorstep); Mark ready (Order to doorstep); Items out of stock (Menu to platform)
  - Shared library (Node fleet): Partner agreement (Order, menu and settlement across two companies); Publish, signed (Menu to platform); Publish the statement, signed (Settle to paid)
  - platform_orders (Document collection): Order to doorstep (Order, menu and settlement across two companies); Create the order document (Order to doorstep), writes writes the order; Accept in the kitchen (Order to doorstep), writes writes accepted; Cooking (Order to doorstep); Mark ready (Order to doorstep), writes writes ready; Dispatch a courier (Order to doorstep); Collect and deliver (Order to doorstep), writes writes collected, delivered; Late or wrong: refund? (Order to doorstep); Delivered (Order to doorstep), reads reads the timeline; Settle to paid (Order, menu and settlement across two companies); Week closes (Settle to paid); Compute the settlement (Settle to paid), reads reads delivered orders
  - menu_published (SQL table): Menu to platform (Order, menu and settlement across two companies); Publish, signed (Menu to platform), writes writes the published rows; Verify and show (Menu to platform), reads reads, verifies the signature
  - settlements (SQL table): Settle to paid (Order, menu and settlement across two companies); Publish the statement, signed (Settle to paid), writes writes one row per order; Reconcile by order (Settle to paid), reads reads, verifies; Disputed lines (Settle to paid); Dispute over the limit (Settle to paid); Pay the chain (Settle to paid); Paid (Settle to paid)
  - Regional hub (Node fleet): Order to doorstep (Order, menu and settlement across two companies); Order placed (Order to doorstep); Create the order document (Order to doorstep); Fraud and address check (Order to doorstep); Dispatch a courier (Order to doorstep); Menu to platform (Order, menu and settlement across two companies); Verify and show (Menu to platform); Live on the platform (Menu to platform)
  - couriers (Document collection): Order to doorstep (Order, menu and settlement across two companies); Dispatch a courier (Order to doorstep), reads reads who is near
  - Courier and customer apps (Application): Order to doorstep (Order, menu and settlement across two companies); Order placed (Order to doorstep); Collect and deliver (Order to doorstep); Late or wrong: refund? (Order to doorstep); Live on the platform (Menu to platform)
  - Chain head office node (Unidatum node): Menu to platform (Order, menu and settlement across two companies); Price or item change (Menu to platform); Settle to paid (Order, menu and settlement across two companies); Reconcile by order (Settle to paid); Paid (Settle to paid); Promised time, prep time, settlement variance (Order, menu and settlement across two companies)
  - Platform analytics node (Unidatum node): Delivered (Order to doorstep); Change live in five minutes (Menu to platform); Settle to paid (Order, menu and settlement across two companies); Week closes (Settle to paid); Compute the settlement (Settle to paid); Publish the statement, signed (Settle to paid); Pay the chain (Settle to paid); Promised time, prep time, settlement variance (Order, menu and settlement across two companies)
  - Reconciliation and prep-time dashboards (BI tool): Promised time kept (Order to doorstep); Delivered (Order to doorstep); Settle to paid (Order, menu and settlement across two companies); Reconcile by order (Settle to paid); Disputed lines (Settle to paid); Paid within nine days (Settle to paid); Promised time, prep time, settlement variance (Order, menu and settlement across two companies)

10. Build environment
  Install: unidatum (the engine, one per host); unidatum-sqld (the PostgreSQL wire for the dashboards)
  Hosts:
    - Restaurant node, back office ×600: 4 cores, 16 GB, 1 TB SSD, Linux
    - Regional hub: 8 vCPU, 64 GB, 2 TB NVMe, Linux amd64
    - Chain head office node: 16 cores, 128 GB, 8 TB NVMe, Linux amd64
    - Platform analytics node: 32 cores, 256 GB, 16 TB NVMe, Linux amd64
  Libraries and how nodes find each other:
    - chain-ops: LAN beacon; private DHT
    - chain-platform-shared: invite link via rendezvous
    - platform-eu: private DHT
    invite links need a rendezvous the nodes can reach, and someone to issue the invites
  Keys:
    - Chain's key, held by chain nodes, signs menu_published, kitchen fields, verified by platform nodes
    - Platform's key, held by platform nodes, signs orders, settlements, verified by chain nodes
    - Chain's key, held by restaurant node, signs accepted_at, ready_at, verified by platform hub
    - Platform's key, held by regional hub, signs order, status, courier_id, verified by restaurant node
    - Courier app's key, held by courier app, signs collected_at, delivered_at, verified by both nodes
    - Chain's key, held by restaurant node, signs each commit, verified by hub before pricing
    - Platform's key, held by platform analytics node, signs each weekly commit, verified by chain head office
    - Courier app's key, held by courier app, signs location, state, verified by hub
  Scale to generate test data for:
    - Restaurant node, back office: ×600
    - menu: ×600, 1 per item documents
    - Kitchen display: ×600
    - platform_orders: 1 per order documents
    - menu_published: 1 per item and restaurant rows
    - settlements: 1 per order rows
    - couriers: 1 per courier documents

11. Rules and where they run
  Policy Partner agreement: sets refund limits, price bands, settlement t, owned by both partner leads, version 2026-09 [held in Shared library]
  - Order to doorstep: Create the order document, a rule, automatic -> a pipeline or watcher on Regional hub
  - Order to doorstep: Fraud and address check, an agent proposes, a person approves (proposed) (rule: a new card at a new address: hold; approver: the platform's risk desk; limit: over 150 goes to a person) -> an agent card still to add over MCP; proposals and decisions recorded, the person approves or declines
  - Order to doorstep: Dispatch a courier, a rule, automatic -> a pipeline or watcher on Regional hub
  - Order to doorstep: Late or wrong: refund?, an agent proposes, a person approves (proposed) (rule: 20 minutes late or an item missing: refu; approver: the support desk; limit: over 40 goes to a person) -> an agent card still to add over MCP, working platform_orders, beside Courier and customer apps; proposals and decisions recorded, the person approves or declines
  - Menu to platform: Items out of stock, a person, with an agent's help (proposed) -> an agent card still to add over MCP, working menu, beside Kitchen display
  - Menu to platform: Price change approval, an agent proposes, a person approves (proposed) (rule: more than 10% on an item: the head of me; approver: the head of menu; limit: a new item goes to the category lead) -> an agent card still to add over MCP, working menu; proposals and decisions recorded, the person approves or declines
  - Menu to platform: Publish, signed, a rule, automatic -> a pipeline or watcher on Restaurant node, back office
  - Menu to platform: Verify and show, a rule, automatic -> a pipeline or watcher on Regional hub
  - Settle to paid: Compute the settlement, a rule, automatic -> a pipeline or watcher on Platform analytics node
  - Settle to paid: Publish the statement, signed, a rule, automatic -> a pipeline or watcher on Platform analytics node
  - Settle to paid: Reconcile by order, a rule, automatic -> a pipeline or watcher on Chain head office node
  - Settle to paid: Disputed lines, an agent (proposed) -> an agent card still to add over MCP, working settlements, beside Reconciliation and prep-time dashboards
  - Settle to paid: Dispute over the limit, an agent proposes, a person approves (proposed) (rule: a line over 50, or a repeat: a person de; approver: the platform's partner finance; limit: 50) -> an agent card still to add over MCP, working settlements; proposals and decisions recorded, the person approves or declines
  - Settle to paid: Pay the chain, a rule, automatic -> a pipeline or watcher on Platform analytics node

Still to decide
  - Order to doorstep: the agent card Fraud and address check runs on
  - Order to doorstep: the agent card Late or wrong: refund? runs on
  - Menu to platform: the agent card Items out of stock runs on
  - Menu to platform: the agent card Price change approval runs on
  - Settle to paid: the agent card Disputed lines runs on
  - Settle to paid: the agent card Dispute over the limit runs on
  - the engine version to pin, and where the binaries and data directories live on each host
  - the rendezvous address, and who issues the invite links for each library
  - how each key is generated, stored and rotated
  - a collection where agent proposals and the decisions on them are recorded
```
