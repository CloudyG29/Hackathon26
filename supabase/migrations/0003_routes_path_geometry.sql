-- Surveyed road geometry for route edges, so the journey map can draw real
-- streets instead of straight lines between rank pins.
--
-- Shape: the mobile wire format, [{ "lat": 1.23, "lng": 4.56 }, ...], seeded
-- from data/seed/legs.json by services/api/src/scripts/seed-db.ts. Nullable -
-- edges without geometry fall back to a straight line in the API.

alter table public.routes
  add column if not exists path jsonb;
