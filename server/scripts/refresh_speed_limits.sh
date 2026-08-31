#!/bin/sh
# Download the current OSM extract and reload the posted-limit map (CAR-222).
#
# What the carma-load-speed-limits Container Apps job runs. Kept as a script
# rather than inlined into the job's --args so that changing the extract or the
# steps is a code review, not an `az containerapp job update` nobody sees.
#
# Fails loudly and early: a half-finished refresh that still exits 0 would leave
# the map stale while the workflow reports success, and a stale map is invisible
# from the outside.
set -eu

EXTRACT_URL="${SPEED_LIMIT_EXTRACT_URL:-https://download.geofabrik.de/asia/israel-and-palestine-latest-free.shp.zip}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "downloading $EXTRACT_URL"
curl --fail --silent --show-error --location --retry 3 --retry-delay 10 \
  -o "$WORK_DIR/extract.zip" "$EXTRACT_URL"

# Only the two layers the loader reads. The full extract carries twenty.
echo "unpacking"
cd "$WORK_DIR"
python -c "
import zipfile, sys
wanted = ('gis_osm_roads_free_1', 'gis_osm_places_a_free_1')
with zipfile.ZipFile('extract.zip') as z:
    names = [n for n in z.namelist() if n.rsplit('/', 1)[-1].startswith(wanted)]
    if not any('roads' in n for n in names):
        sys.exit('extract has no roads layer - wrong URL?')
    z.extractall('.', members=names)
"
ROADS=$(find "$WORK_DIR" -name 'gis_osm_roads_free_1.shp' | head -1)
[ -n "$ROADS" ] || { echo "no roads shapefile after unpacking" >&2; exit 1; }

cd /app
echo "loading"
python scripts/load_speed_limits.py "$ROADS"
