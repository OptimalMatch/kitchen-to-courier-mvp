#!/bin/sh
# The demo from nothing: DEMO.md's "Bring it up", in order, with the waits
# the pipelines need. Idempotent: run it again after `docker compose down -v`.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
docker compose up -d --build
echo "--- nodes up; waiting for them to sync"; sleep 30
docker compose run --rm tools node pipelines/specs.mjs
docker compose run --rm tools node seed/seed.mjs
docker compose run --rm tools node bin/hold.mjs
docker compose --profile sims up -d
echo "--- pipelines land every 30 s; waiting for the first passes"; sleep 90
docker compose run --rm tools node bin/hold.mjs
docker compose run --rm tools node bin/metabase.mjs
echo "--- learning the promised time from the seeded history"
docker compose run --rm tools node bin/learn-promise.mjs
echo "--- placing three live orders"
docker compose run --rm tools node sims/customer.mjs
echo "--- the checks"
docker compose run --rm tools node checks/run.mjs
