# Checks

One file per check in the MVP sheet, section 6. Turn each into a test; the build is done when `./checks/run.sh` passes.

1. menu: count equals what was seeded plus what the script wrote
2. platform_orders: count equals what was seeded plus what the script wrote
3. menu_published: count equals what was seeded plus what the script wrote
4. settlements: count equals what was seeded plus what the script wrote
5. couriers: count equals what was seeded plus what the script wrote
6. menu_published: every commit carries menu's signature and the other side verifies it
7. settlements: every commit carries Platform analytics node's signature and the other side verifies it
8. after Create the order document: platform_orders writes the order
9. after Accept in the kitchen: platform_orders writes accepted
10. after Mark ready: platform_orders writes ready
11. after Collect and deliver: platform_orders writes collected, delivered
12. after Edit the menu: menu writes price, availability
13. after Publish, signed: menu_published writes the published rows
14. after Publish the statement, signed: settlements writes one row per order
15. Promised time kept: placed to delivered within the promise, 95% of orders, over the script's run
16. Change live in five minutes: edit to live within 5 minutes, over the script's run
17. Paid within nine days: week close to paid within 9 days, over the script's run
18. Reconciliation and prep-time dashboards: Prep time by restaurant returns rows
19. Reconciliation and prep-time dashboards: Delivery time by hub returns rows
20. Reconciliation and prep-time dashboards: Settlement vs sales returns rows
21. Reconciliation and prep-time dashboards: Orders in flight now returns rows
