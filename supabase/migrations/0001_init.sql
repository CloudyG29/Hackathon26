-- Initial schema: ranks, legs, fare history, and the spatial lookup the app needs.
--
-- Apply to a hosted project with `supabase db push`, or paste into the
-- Supabase SQL editor. Requires the PostGIS extension.

create extension if not exists postgis;

-- Ranks: anywhere a commuter boards, alights or changes vehicle.
create table if not exists public.ranks (
  id                 text primary key,
  name               text not null,
  area               text,
  location           geography(point, 4326) not null,
  modes              text[] not null default '{}',
  landmark_notes     text,
  landmark_photo_url text,
  facilities         text[] not null default '{}',
  updated_at         timestamptz not null default now()
);

create index if not exists ranks_location_idx on public.ranks using gist (location);

-- Legs: one hop between two ranks. Directed, because fares are not symmetric.
create table if not exists public.legs (
  id                text primary key,
  mode              text not null check (
                      mode in (
                        'long_distance_taxi',
                        'mini_bus_taxi',
                        'local_bus',
                        'metro_train',
                        'walk'
                      )
                    ),
  from_rank_id      text not null references public.ranks (id) on delete cascade,
  to_rank_id        text not null references public.ranks (id) on delete cascade,
  fare_zar          numeric(10, 2) not null check (fare_zar >= 0),
  estimated_minutes integer not null check (estimated_minutes > 0),
  distance_km       numeric(10, 2) check (distance_km > 0),
  reliability       numeric(3, 2) check (reliability >= 0 and reliability <= 1),
  departs_when_full boolean not null default false,
  path              geography(linestring, 4326),
  updated_at        timestamptz not null default now()
);

create index if not exists legs_from_rank_idx on public.legs (from_rank_id);
create index if not exists legs_to_rank_idx on public.legs (to_rank_id);

-- Observed fares over time, so the app can flag "this fare went up last week".
create table if not exists public.fare_snapshots (
  id          bigint generated always as identity primary key,
  leg_id      text not null references public.legs (id) on delete cascade,
  fare_zar    numeric(10, 2) not null check (fare_zar >= 0),
  observed_at timestamptz not null default now(),
  source      text
);

create index if not exists fare_snapshots_leg_idx
  on public.fare_snapshots (leg_id, observed_at desc);

-- Ranks within a radius of a point, nearest first.
-- Powers "which rank is closest to me right now?" without a round-trip per rank.
create or replace function public.ranks_within(
  lat           double precision,
  lng           double precision,
  radius_meters integer default 500
)
returns table (
  id              text,
  name            text,
  area            text,
  modes           text[],
  landmark_notes  text,
  distance_meters double precision
)
language sql
stable
as $$
  select r.id,
         r.name,
         r.area,
         r.modes,
         r.landmark_notes,
         st_distance(r.location, st_point(lng, lat)::geography) as distance_meters
  from public.ranks r
  where st_dwithin(r.location, st_point(lng, lat)::geography, radius_meters)
  order by distance_meters;
$$;

-- Ranks and legs are public reference data: anyone may read, and only the
-- service role (which bypasses RLS) may write.
alter table public.ranks enable row level security;
alter table public.legs enable row level security;
alter table public.fare_snapshots enable row level security;

drop policy if exists "ranks are publicly readable" on public.ranks;
create policy "ranks are publicly readable"
  on public.ranks for select
  using (true);

drop policy if exists "legs are publicly readable" on public.legs;
create policy "legs are publicly readable"
  on public.legs for select
  using (true);
