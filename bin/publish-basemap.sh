#!/bin/sh
# publish-basemap: put the courier app's basemap into the library the chain and
# the platform already share, so every courier's node replicates it the way it
# replicates orders.
#
#   bin/publish-basemap.sh path/to/dublin.pmtiles
#
# There is no map server in this picture and nothing to be down. A courier's
# phone holds the map because it holds the library. Build the archive with
# tools/build-basemap.sh in OptimalMatch/unidatum-courier-android.
set -eu
FILE="${1:?usage: bin/publish-basemap.sh path/to/dublin.pmtiles}"
[ -f "$FILE" ] || { echo "$FILE does not exist" >&2; exit 1; }
cd "$(dirname "$0")/.."
NAME=$(basename "$FILE")
docker compose cp "$FILE" "hub-1:/tmp/$NAME"
docker compose exec -T hub-1 sh -c "cd /data/chain-platform-shared && unidatum add /tmp/$NAME && rm -f /tmp/$NAME"
echo "published $NAME into chain-platform-shared; courier nodes will replicate it"
