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
| Python                  | 3.11+   | `services/routing` (not in the path yet)    |
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

Or open the SQL editor in the Supabase dashboard and paste
`supabase/migrations/0001_init.sql`. The migration enables PostGIS, creates the
`ranks`, `legs` and `fare_snapshots` tables, and adds a `ranks_within()`
function for "nearest rank to me" queries.

### 4. Seed sample data (optional)

`data/seed/ranks.json` and `data/seed/legs.json` hold an illustrative
Johannesburg → Mbombela corridor. They are **invented sample data**, not real
fares. There is no loader yet — insert them by hand or write one.

### 5. Python routing engine (optional, not yet used)

```sh
Set-Location services/routing
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
pytest
```

## Running

Use two terminals from the repository root.

```sh
# Terminal 1 — API on http://localhost:4000
npm run api

# Terminal 2 — Expo dev server
npm run mobile
```

Verify the API is up:

```sh
Invoke-RestMethod http://localhost:4000/health
```

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
data/seed          Illustrative ranks and legs for local development
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
| `npm run typecheck`    | Typecheck every workspace                     |

## API surface

| Endpoint            | Status      | Notes                                        |
| ------------------- | ----------- | -------------------------------------------- |
| `GET /health`       | Implemented | Uptime and which data source is configured   |
| `POST /routes/plan` | Stub        | Validates the request, then returns 501      |

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
