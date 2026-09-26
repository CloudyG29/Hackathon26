# Architecture

## What we're building

A step-by-step navigation app for people making a long-distance trip by public
transport for the first time. The product answers four questions before the
commuter leaves home:

1. Which ranks do I go to, and where do I change vehicles?
2. What will it cost, and how much cash must I carry?
3. What does each rank/transfer point actually look like?
4. Which route is cheapest / fastest / easiest at this time of day?

## Repository layout

```
apps/mobile        Expo (React Native) app — the entire user-facing product
packages/shared    Domain types shared by the app and the API (types-only)
services/api       Express REST API — the app's only backend
services/routing   Python graph engine — ranks/legs in, ranked journeys out
data/seed          Illustrative ranks and legs for local development
supabase/          Postgres + PostGIS migrations
docs/              This file
```

## Request flow

```
Expo app  --POST /routes/plan-->  services/api  --query-->  Supabase (ranks, legs)
     ^                                 |
     |                                 v
     |                          services/routing
     |                          networkx graph search:
     |                          cheapest / fastest / easiest / safest
     |                                 |
     +---- PlanRouteResponse ----------+
           (RouteOption[] + FareBreakdown)
```

The app never talks to Supabase directly for routing. All journey logic lives
behind the API so fare rules can change without shipping an app update.

## Domain model

The whole product rests on three ideas, modelled in `packages/shared`:

- **Rank** — anywhere a commuter boards, alights or changes vehicle. Carries
  the landmark notes and photo that make a first-time visit survivable.
- **Leg** — one hop between two ranks. Directed, because fares are not
  symmetric. Holds `fareZar`, `estimatedMinutes`, `reliability` and
  `departsWhenFull`.
- **RouteOption** — a complete journey: legs + transfers + fare total +
  `cashNeededZar`.

`cashNeededZar` is deliberately separate from `totalFareZar`. Taxi operators
rarely carry change, so the amount of cash a commuter must physically prepare is
usually higher than the sum of the fares. This single field is the difference
between the app being useful and being a fare calculator.

## Ranking strategies

Each priority needs a different edge weight over the same graph:

| Priority  | Edge weight                                        |
| --------- | -------------------------------------------------- |
| cheapest  | `fareZar`                                          |
| fastest   | `estimatedMinutes`                                 |
| easiest   | transfer count, then total minutes                 |
| safest    | inverse of `reliability`, weighted by `departAt`   |

A single path rarely wins on every axis, so the API returns one option per
priority with `tags` recording every axis an option satisfies.

## Decisions and their trade-offs

**Monorepo with npm workspaces.** One `npm install`, one git history, and the
request/response types cannot drift because the app and API import the same
definitions. Cost: Expo's Metro bundler needed monorepo awareness — which
SDK 52+ now handles automatically, so `apps/mobile` intentionally has **no**
`metro.config.js`. Do not reintroduce `watchFolders` or
`resolver.disableHierarchicalLookup`; the SDK configures these itself.

**`packages/shared` is types-only.** No runtime imports cross the workspace
boundary, so the bundler never resolves another package's JavaScript. When you
add runtime helpers (fare maths, formatters), the wiring already supports it —
just re-check `npx expo start --clear`.

**Supabase over local Postgres.** PostGIS is pre-enabled and there is no Docker
to babysit on demo day. Cost: the free tier pauses inactive projects, so warm
it up before you present.

**Expo Router with `src/app/`.** Every file in `src/app/` is a screen and
`_layout.tsx` defines navigators. Files are the route table, so no separate
navigation config can drift out of sync.

**React and react-dom are pinned via `overrides`.** Expo Router pulls
`react-dom` through its web dependencies (`@expo/ui`, `@radix-ui/*`). Those
packages declare `peer react: "*"`, so npm hoists the newest React to the repo
root while the app keeps the 19.2.3 that SDK 57 pins — two live copies, which is
exactly the duplicate-React failure mode Expo warns about. The root `overrides`
block forces one version everywhere. When you upgrade Expo, re-check this pin
against what `expo install` expects rather than assuming it still applies.

**`react-native-maps`, not `expo-maps`.** `expo-maps` is still flagged **alpha**
and "will frequently experience breaking changes". `react-native-maps` is the
stable choice and is documented for SDK 57. Cost: Google Maps on Android needs a
key, and the key must be injected at build time via the config plugin in
`apps/mobile/app.config.ts`. iOS needs no key — it uses Apple Maps.

**Python for the graph engine.** `networkx` expresses multi-objective shortest
path far more directly than hand-rolled JS. Cost: a second toolchain, so the
engine is kept out of the request path until it is proven — the API can start on
fixtures and call the engine later.

## Status

Implemented: workspace wiring, domain types, `GET /health`,
`POST /routes/plan` (validates the request, then returns 501), PostGIS schema,
seed fixtures.

Not implemented: graph search, fare calculation, every app screen except the
placeholder home screen, auth, Supabase reads/writes.
