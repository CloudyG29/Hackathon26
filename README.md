# TransitGuide

Step-by-step navigation for first-time long-distance public transport commuters.

The app turns an uncertain trip into a predictable one: it tells you which rank
to walk to, where to change vehicles, what each leg costs, how much cash to carry,
and what each transfer point looks like when you get there.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the domain model, the
request flow and the reasoning behind each stack choice.

## Prerequisites

| Tool                    | Version | Needed for                                  |
| ----------------------- | ------- | ------------------------------------------- |
| Node.js                 | 20+ (22 recommended) | app, API, tooling              |
| npm                     | 10+     | workspaces                                  |
| Python                  | 3.11+   | `services/routing` engine, tests, HTTP API  |
| Android Studio + JDK 17 | —       | building the app locally                    |
| Supabase account        | free    | ranks/fares database                        |

## Setup

### 1. Install dependencies

Run once from the repository root. This installs every workspace:

```sh
npm install
```

### 2. Configure environment files

```sh
Copy-Item services/api/.env.example services/api/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

Then fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your Supabase
project's **Settings → API** page. Both files are gitignored — no real keys ever
land in the repository.

### 3. Create the database

Either push the migration with the Supabase CLI:

```sh
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or open the SQL editor in the Supabase dashboard and paste the files from
`supabase/migrations/` in order. They enable PostGIS, create the `ranks`,
`legs`, `fare_snapshots`, `associations`, `routes` and `demand_signals` tables,
add demand-aggregation functions and a `ranks_within()` helper for "nearest
rank to me" queries.

### 4. Seed real data (recommended)

`data/seed/` holds **real Tshwane minibus-taxi data** imported from the CSIR's
public ArcGIS server: 191 ranks, 188 routes, 335 legs and surveyed fares
(December 2018 baseline) across the whole Tshwane study area. Provenance,
field mappings and known limitations are documented in
[data/seed/SOURCES.md](data/seed/SOURCES.md).

To load it into Supabase (after steps 2 and 3):

```sh
npm run import:csir -- --push
```

Without `--push` the command just regenerates the JSON files in `data/seed/`
(needs network access to the CSIR server).

### 5. Python routing engine

The Python planner (`services/routing/src/routing/planner.py`) mirrors
`services/api/src/planner.ts`, and its pytest suite is the contract test for
both engines:

```powershell
Set-Location services\routing
python -m venv venv
.\venv\Scripts\Activate.ps1      # the prompt gains a (venv) prefix
pip install -r requirements.txt  # planner + HTTP wrapper dependencies
pip install pytest               # test runner (not in requirements.txt)
python -m pytest                 # expect: 9 passed
```

The Express API plans journeys in-process, so nothing above needs to stay
running for `/routes/plan` to work — the venv is for the test suite and the
optional HTTP wrapper in [Running](#running).

## Running

Use two terminals from the repository root.

```powershell
# Terminal 1 — API on http://localhost:4000
npm run api

# Terminal 2 — Expo dev server
npm run mobile
```

### Sending your first request

With the API up and `services/api/.env` pointing at a Supabase project that
has data, check health first, then plan a journey between two ranks:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

```powershell
$body = @'
{
  "fromRankId": "rank-f40",
  "toRankId": "rank-f45",
  "priority": "cheapest"
}
'@
Invoke-RestMethod http://localhost:4000/routes/plan -Method Post `
  -ContentType 'application/json' -Body $body
```

`rank-f40` and `rank-f45` exist in the team Supabase project — swap in any
two connected rank IDs from your own `ranks` table otherwise. `priority` is
one of `cheapest`, `fastest` or `easiest` (fewest taxi changes) and defaults
to `cheapest`.

The response is the one best journey for the requested priority: an ordered
list of legs with `fromName`/`toName` labels, `fareZar` (always), `minutes`
and `mode` (when known), and a road-following `path` array of `{lat, lng}`
points ready for `react-native-maps`, plus the fare total and leg count:

```json
{
  "legs": [
    { "fromRankId": "rank-f40", "fromName": "…", "toRankId": "rank-soutpan", "toName": "…",
      "fareZar": 25, "minutes": 93, "path": ["~120 road-following points"] },
    { "fromRankId": "rank-soutpan", "fromName": "…", "toRankId": "rank-f45", "toName": "…",
      "fareZar": 25, "minutes": 82, "path": ["~119 points"] }
  ],
  "totalFareZar": 50,
  "legCount": 2
}
```

The two `fromName`/`toName` labels come from the `ranks` table (the rank id
when a name is missing).

Failures come back as `{ "error": "message" }` with status 400 (invalid
body), 404 (unknown rank, or no viable route between the two) or 503
(database not configured).

The mobile app calls this same endpoint. Inside the Android emulator,
`localhost` is the phone itself — point `EXPO_PUBLIC_API_URL` in
`apps/mobile/.env` at `http://10.0.2.2:4000` instead.

### Live rerouting (strike toggle)

Blocked legs are excluded from every fresh plan, so toggling a strike
reroutes the next request — no restart, no cache:

```powershell
$routeId = "<any leg id from the response above>"
Invoke-RestMethod "http://localhost:4000/marshal/$routeId/block" -Method Patch `
  -ContentType 'application/json' -Body '{"is_blocked": true}'

# Re-run the plan request — cheapest now takes the next-best corridor.

Invoke-RestMethod "http://localhost:4000/marshal/$routeId/block" -Method Patch `
  -ContentType 'application/json' -Body '{"is_blocked": false}'
```

### Python engine over HTTP (optional)

The same planner is wrapped as a FastAPI service for querying the engine
directly (curl, notebooks). From `services/routing`, venv active:

```powershell
uvicorn routing.api:app --reload --port 8000 --app-dir src
```

`--app-dir src` puts the `routing` package on the import path; the
historical `uvicorn main:app --reload --port 8000` still works through a
deprecated shim. The engine does not read Supabase — you pass the whole
network in the body, in seed-fixture camelCase or DB snake_case:

```powershell
$engineBody = @'
{
  "fromRankId": "jhb-noord",
  "toRankId": "mbombela",
  "ranks": [
    { "id": "jhb-noord", "location": { "latitude": -26.2027, "longitude": 28.0455 } },
    { "id": "mbombela", "location": { "latitude": -25.4753, "longitude": 30.9694 } }
  ],
  "legs": [
    { "id": "noord-mbombela", "mode": "long_distance_taxi",
      "fromRankId": "jhb-noord", "toRankId": "mbombela",
      "fareZar": 520, "estimatedMinutes": 300 }
  ]
}
'@
Invoke-RestMethod http://localhost:8000/plan -Method Post `
  -ContentType 'application/json' -Body $engineBody
```

The response carries one option per requested priority (all three by
default), each with the same leg shape as `/routes/plan`, and `GET /health`
is available for a quick check.

### Building the app for the device (required for maps)

`react-native-maps` contains native code, so Expo Go will not run it. You need a
development build, once:

```sh
Set-Location apps/mobile
npx expo run:android          # local build; needs Android Studio + JDK 17
```

No local Android toolchain? Build in the cloud instead:

```sh
npx eas-cli@latest build --profile development --platform android
```

After the dev client is installed, `npm run mobile` from the root reconnects to
it and you get fast refresh as usual.

**Google Maps on Android needs an API key.** iOS uses Apple Maps and needs
nothing. To enable Android maps:

1. Enable **Maps SDK for Android** in Google Cloud Console and create an API key.
2. Restrict it to package `com.hackathon26.transitguide` plus your debug SHA-1.
3. Put it in `apps/mobile/.env` as `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...`.
4. Rebuild the dev client — the key is injected at build time by the
   `react-native-maps` config plugin in `apps/mobile/app.config.ts`.

Until then, Android renders a blank grid where the map should be.

## Repository layout

```
apps/mobile        Expo (React Native) app — the user-facing product
packages/shared    Domain types shared by the app and the API (types-only)
services/api       Express REST API — the app's only backend
services/routing   Python graph engine — ranks/legs in, ranked journeys out
data/seed          Real Tshwane taxi data imported from the CSIR ArcGIS server
supabase/          Postgres + PostGIS migrations
docs/              Architecture and product reasoning
```

## Scripts

Run from the repository root:

| Command                | Does                                          |
| ---------------------- | --------------------------------------------- |
| `npm run mobile`       | Start the Expo dev server                     |
| `npm run mobile:android` | Start Expo and open on Android              |
| `npm run api`          | Start the API with reload on change           |
| `npm run import:csir`  | Regenerate `data/seed/` from the CSIR server  |
| `npm run typecheck`    | Typecheck every workspace                     |

## API surface

| Endpoint                   | Status      | Notes                                                |
| -------------------------- | ----------- | ---------------------------------------------------- |
| `GET /health`              | Implemented | Uptime and which data source is configured           |
| `POST /routes/plan`        | Implemented | One best journey per requested priority, per-leg geometry |
| `PATCH /marshal/:id/block` | Implemented | Toggle a strike — the next plan reroutes live        |
| `GET/POST /demand`         | Implemented | Record and aggregate commuter demand signals         |

## Known caveats

**Keep this repo out of OneDrive sync if you can.** `node_modules` and the Metro
bundler cache are tens of thousands of files, and continuous sync causes file
locks, slow installs and confusing build errors. Either move the project
somewhere outside OneDrive, or exclude the folder from syncing.

**`react-native-worklets` version warning.** `expo-modules-core` declares a peer
range ending at `^0.10.0`, while `react-native-reanimated@4.7.0` requires
`0.13.0`. This mismatch ships inside Expo's own dependency graph. Do not
"fix" it by forcing `0.10.x` — that breaks reanimated.

**`expo-maps` is alpha.** It is the Expo-native alternative to
`react-native-maps` and "will frequently experience breaking changes". Revisit it
once it stabilises, not during a hackathon.

**`react` is pinned via `overrides`** in the root `package.json`. Expo Router's
web dependencies pull `react-dom`, which would otherwise hoist a second React
version and break builds. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
