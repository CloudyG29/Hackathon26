-- Marshal-managed taxi routes, associations, and demand signals.
--
-- Additive on top of 0001: ranks and legs keep their shape, and legs gain an
-- optional parent route. The marshal-facing entity is the taxi ROUTE ("the
-- Soshanguve taxi is off today"), so the strike toggle lives there; legs
-- inherit blocked state through route_id. Demand is stored as raw signals and
-- aggregated at read time, so future features can re-slice it however they
-- need without a migration.
--
-- Apply together with 0001 via `supabase db push`.

-- Taxi associations: real operators (from the CSIR route/facility surveys).
create table if not exists public.associations (
  id         text primary key,
  name       text not null unique,
  updated_at timestamptz not null default now()
);

-- Taxi routes: a named service between two ranks, operated by one association.
-- Each route has two directed legs (out/return) created by the importer.
create table if not exists public.routes (
  id             text primary key,
  label          text not null,
  association_id text references public.associations (id) on delete set null,
  category       text not null check (category in ('short', 'medium', 'long')),
  mode           text not null check (
                   mode in (
                     'long_distance_taxi',
                     'mini_bus_taxi',
                     'local_bus',
                     'metro_train',
                     'walk'
                   )
                 ),
  seats          integer check (seats > 0),
  -- Strike toggle. When true, both of this route's legs are excluded from
  -- journey planning.
  is_blocked     boolean not null default false,
  blocked_reason text,
  blocked_at     timestamptz,
  source_note    text,
  updated_at     timestamptz not null default now()
);

create index if not exists routes_association_idx on public.routes (association_id);

-- Legs attach to their parent route and record travel direction.
alter table public.legs
  add column if not exists route_id text references public.routes (id) on delete cascade;

alter table public.legs
  add column if not exists direction text check (direction in ('out', 'return'));

create index if not exists legs_route_idx on public.legs (route_id);

-- Ranks gain a formality flag (from the facility survey's typefacili).
alter table public.ranks
  add column if not exists kind text check (kind in ('formal', 'informal'));

-- Demand: one row per "I want to travel" signal. Raw on purpose — aggregation
-- happens at read time (see route_demand()/rank_demand() below).
create table if not exists public.demand_signals (
  id         bigint generated always as identity primary key,
  route_id   text references public.routes (id) on delete cascade,
  rank_id    text references public.ranks (id) on delete cascade,
  direction  text check (direction in ('out', 'return')),
  passengers integer not null default 1 check (passengers > 0),
  signal_at  timestamptz not null default now(),
  source     text not null default 'commuter_app',
  check (route_id is not null or rank_id is not null)
);

create index if not exists demand_signals_route_idx
  on public.demand_signals (route_id, signal_at desc);

create index if not exists demand_signals_rank_idx
  on public.demand_signals (rank_id, signal_at desc);

-- Demand per route over the last N hours, busiest first. Backs GET /demand.
create or replace function public.route_demand(hours integer default 24)
returns table (
  route_id    text,
  label       text,
  association text,
  is_blocked  boolean,
  signals     bigint,
  passengers  bigint
)
language sql
stable
as $$
  select r.id,
         r.label,
         a.name,
         r.is_blocked,
         count(ds.id),
         coalesce(sum(ds.passengers), 0)
  from public.routes r
  left join public.associations a on a.id = r.association_id
  left join public.demand_signals ds
    on ds.route_id = r.id
   and ds.signal_at > now() - make_interval(hours => hours)
  group by r.id, r.label, a.name, r.is_blocked
  order by coalesce(sum(ds.passengers), 0) desc, count(ds.id) desc, r.label;
$$;

-- Demand per rank over the last N hours, busiest first.
create or replace function public.rank_demand(hours integer default 24)
returns table (
  rank_id    text,
  rank_name  text,
  signals    bigint,
  passengers bigint
)
language sql
stable
as $$
  select r.id,
         r.name,
         count(ds.id),
         coalesce(sum(ds.passengers), 0)
  from public.ranks r
  left join public.demand_signals ds
    on ds.rank_id = r.id
   and ds.signal_at > now() - make_interval(hours => hours)
  group by r.id, r.name
  order by coalesce(sum(ds.passengers), 0) desc, r.name;
$$;

-- New reference data follows the 0001 convention: public reads, writes only
-- through the service role (which bypasses RLS).
alter table public.associations enable row level security;
alter table public.routes enable row level security;
alter table public.demand_signals enable row level security;

drop policy if exists "associations are publicly readable" on public.associations;
create policy "associations are publicly readable"
  on public.associations for select
  using (true);

drop policy if exists "routes are publicly readable" on public.routes;
create policy "routes are publicly readable"
  on public.routes for select
  using (true);

drop policy if exists "demand signals are publicly readable" on public.demand_signals;
create policy "demand signals are publicly readable"
  on public.demand_signals for select
  using (true);
