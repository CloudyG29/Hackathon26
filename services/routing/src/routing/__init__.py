"""Graph search over the rank/leg transit network.

Not implemented yet. Intended responsibilities:

1. Load ranks and legs from Supabase (or the fixtures in ``data/seed``) into a
   ``networkx`` directed graph: ranks are nodes, legs are edges.
2. Search for candidate journeys between two ranks. Each priority needs a
   different edge weight:
     - cheapest  -> fare_zar
     - fastest   -> estimated_minutes
     - easiest   -> transfer count, then total minutes
     - safest    -> inverse of reliability, weighted by time of day
3. Price each candidate and emit the shared ``RouteOption`` / ``FareBreakdown``
   shapes so the API and the app agree on the payload.
"""

__all__: list[str] = []
