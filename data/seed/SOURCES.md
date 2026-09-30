# Seed data provenance

Everything in this directory is **generated** by
[services/api/src/scripts/import-csir.ts](../../services/api/src/scripts/import-csir.ts).
Do not edit these files by hand — rerun the importer instead:

```sh
npm run import:csir               # regenerate data/seed/*.json
npm run import:csir -- --push     # also upsert rows into Supabase
```

`--push` needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
`services/api/.env`, and the migrations in `supabase/migrations/` applied.
Reruns are safe: tables are upserted by id, and the append-only tables
(`fare_snapshots`, `demand_signals`) are cleared per import source first.
Other flags: `--no-demand` (skip synthetic demand), `--out=<dir>`.

## Sources

Both layers are public, query-only ArcGIS FeatureServer layers published by
the **Council for Scientific and Industrial Research (CSIR), South Africa**.
No authentication is required to read them.

| Layer | URL | Surveyed | Rows |
| --- | --- | --- | --- |
| Tshwane taxi routes | `https://pta-gis-2-web1.csir.co.za/server2/rest/services/Hosted/Tshwane_Taxi_Routes_shp/FeatureServer/0` | December 2018 | 661 tracks |
| Taxi facilities | `https://pta-gis-2-web1.csir.co.za/server2/rest/services/Hosted/TaxiFacilities/FeatureServer/0` | 2021 | 105 facilities |

Geometry is Web Mercator (EPSG:3857) and is converted to WGS84 for the seed
files and the PostGIS `geography` columns.

## What is in each file

| File | Rows (2026-09-26 run) | Content |
| --- | --- | --- |
| `associations.json` | 30 | Taxi associations (`assoc_id` + name) |
| `ranks.json` | 191 | 89 ranks from the facility survey + 102 derived from route endpoints |
| `routes.json` | 188 | One route per surveyed origin/destination pair (85 short, 81 medium, 22 long) |
| `legs.json` | 335 | Directed legs (188 out / 147 return) with fare, distance, geometry |
| `fare-snapshots.json` | 369 | Every distinct surveyed fare per leg, including alternates |
| `demand-demo.json` | 1649 | **Synthetic** demand signals for the demo (see below) |
| `import-report.json` | — | Counts and data-quality issues for the run |

## Field mapping (routes layer)

| CSIR field | Becomes |
| --- | --- |
| `route_id` | Route id (`rt-<id>`; a survey id covering several services is split, see below) |
| `routeleg` (1/2) + label direction | Leg direction (`out`/`return`) |
| `originname` / `destname` | Leg `fromRankId` / `toRankId` (resolved to a rank) and the route label |
| `fare`, `alt_fare1`–`alt_fare4` | Leg `fareZar` (canonical track's fare) + fare snapshots (all distinct values) |
| `category` | Route `category` (`short` / `medium` / `long`) and `mode` (`mini_bus_taxi` / `long_distance_taxi`) |
| `assocname` / `assoc_id` | Route `associationId` |
| `noofseats` | Route `seats` |
| `routelengt` | Leg `distanceKm`; `estimatedMinutes` = distance ÷ assumed speed (65 km/h long-distance, 28 km/h minibus) — the survey has no times |
| `SHAPE` (polyline) | Leg `path` (decimated to ≤220 points, ends kept exact) |
| `surveydate` | Fare snapshot `observedAt` and the route's `sourceNote` |

Facility-layer fields map to rank properties: `fxfaciname` → name,
`typefacili` → `kind` (formal/informal), amenity flags (`abluavaila`,
`actbankatm`, `smallbusin`, `security`, …) → `facilities`, and
marshal/bay/owner/structure fields → `landmarkNotes`.

## How track endpoints become ranks

Surveyed facility coordinates are treated as ground truth over survey name
labels (which are inconsistent). Each track endpoint is resolved in order:

1. Name match against a surveyed facility.
2. Snap to the nearest surveyed facility within 200 m.
3. Cluster onto a previously derived rank within 300 m.
4. Name match against a derived rank, accepted only within 2 km.
5. Otherwise a new rank is derived at the endpoint.

Long-distance routes get extra care: the surveyed tracks are partial and end
at the Tshwane study-area boundary, and several towns' tracks exit through the
same boundary point. The endpoint nearer the facility centroid is the Tshwane
side; the far endpoint is resolved **by name only** into a "town node" rank
whose `landmarkNotes` states that its location is approximate. Tracks are also
sometimes digitised against their labels, so labels are paired with physical
endpoints by an affinity score (name-to-location agreement), not by path
position.

## Known limitations

- **Fares are the December 2018 surveyed baseline.** Marshals correct them
  through the admin tool; corrections must become new `fare_snapshots`, never
  edits to these files.
- **Far-end town nodes are approximate.** Long-distance tracks stop inside the
  study area, so ranks like Marble Hall or Groblersdal sit at the boundary
  exit point, not at the real town rank (each such rank says so in
  `landmarkNotes`).
- **Survey route ids sometimes lump several services** (different destinations
  under one `route_id`). These are split into one route per origin/destination
  pair (`rt-cr0043`, `rt-cr0043-2`, …); 20 such splits across 14 survey ids in
  the current run. One circular surveyed track (a run that returns to its own
  rank) was skipped and is listed in the report.
- **42 routes have only one direction surveyed** (listed in the report).
- **One leg has a zero fare** (`leg-cr0011-out`): the fare is genuinely
  absent in the source survey.
- **16 duplicate facilities** at the same location were merged into the
  first-listed name (listed in the report).
- **`estimatedMinutes` is modelled**, not surveyed (see field mapping above).
- **`demand-demo.json` is synthetic.** There are no real commuters yet; the
  signals (source `demo_seed`) are generated with a fixed seed and peak-hour
  weighting (05–09, 15–18) so the demand display has something to show. Reruns
  produce the same signal structure with timestamps relative to import time.

`import-report.json` records all of these per run, including any leg whose
rank anchor ended up more than 2 km from its path.

## Attribution

Data: Council for Scientific and Industrial Research (CSIR), South Africa —
public ArcGIS services (query-only). Route survey December 2018; facility
survey 2021. This project uses them for a hackathon demo; if you reuse the
data, cite the CSIR as the source.
