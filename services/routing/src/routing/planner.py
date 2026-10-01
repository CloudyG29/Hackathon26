"""Deterministic multi-priority planner over the rank/leg transit network.

Python twin of ``services/api/src/planner.ts``: same three priorities
(cheapest, fastest, easiest), same missing-data guards, same tie-break rules —
so both engines return identical plans for identical data.

The rules that keep plans logically optimal and rerun-stable:

- Missing data never looks free. ``_as_float`` guards every numeric field, so
  a leg with no minutes is charged ``MISSING_MINUTES_PENALTY_MIN`` instead of
  0.0 (otherwise the leg looks "instant" and wins every fastest search) and a
  leg with no fare is charged ``MISSING_FARE_PENALTY_ZAR`` (otherwise it looks
  free and wins every cheapest search). Explicit zeros in the data stay zero.
- S2 epsilon tie-breaks. Costs are compared with ``COST_EPSILON`` so floating
  point noise cannot flip the winner between reruns; genuine ties fall through
  to structural tie-breaks — fewer legs, then the lexicographically smallest
  rank sequence, then edge ids — which makes the chosen path deterministic.
- Input is accepted in either casing: seed fixtures (``fareZar``,
  ``estimatedMinutes``, ``fromRankId``) or live DB rows (``fare``,
  ``time_mins``, ``from_rank_id``).

Output follows the shared ``PlanLeg`` contract from ``packages/shared``:
options carry camelCase legs with ``fromName``/``toName``, ``path`` ({lat,lng}
points) and ``fareZar`` always present; ``minutes`` and ``mode`` only when the
source data carries them.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

__all__ = ["PLAN_PRIORITIES", "plan_journeys"]

PLAN_PRIORITIES: tuple[str, ...] = ("cheapest", "fastest", "easiest")

# Costs within this distance count as equal — the epsilon that keeps reruns
# deterministic in the face of floating point noise.
COST_EPSILON = 1e-9

# Charged when a leg's minutes are missing so it can never look "instant".
MISSING_MINUTES_PENALTY_MIN = 10_000.0
# Charged when a leg's fare is missing so it can never look free.
MISSING_FARE_PENALTY_ZAR = 10_000.0


def _as_opt_float(value: object) -> float | None:
    """Coerce *value* to float, or None when unusable (missing/null/garbage)."""
    if isinstance(value, bool):  # bool is an int subclass, but is not a cost
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _as_float(value: object, default: float) -> float:
    """Coerce *value* to float, falling back to *default* when unusable.

    The guard: callers must pass a *penalty* as the default, never 0.0 — a
    missing duration would otherwise read as an instant (0-minute) leg and a
    missing fare as a free one. An explicit 0 in the data is still honoured.
    """
    parsed = _as_opt_float(value)
    return default if parsed is None else parsed


def _opt_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _pick(mapping: Mapping[str, object], *keys: str) -> object:
    """Value of the first key present, accepting camelCase and snake_case."""
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


@dataclass(frozen=True)
class _Edge:
    id: str
    from_rank_id: str
    to_rank_id: str
    fare_zar: float  # known fare, or the imputed penalty
    minutes: float | None  # None when the source duration is missing
    mode: str | None
    path: tuple[dict[str, float], ...]  # {lat,lng} points


def _point(point: object) -> dict[str, float] | None:
    """Normalise a path point ({lat,lng} or {latitude,longitude}) to the wire shape."""
    if not isinstance(point, Mapping):
        return None
    lat = _as_opt_float(_pick(point, "lat", "latitude"))
    lng = _as_opt_float(_pick(point, "lng", "longitude"))
    if lat is None or lng is None:
        return None
    return {"lat": lat, "lng": lng}


def _rank_point(rank: Mapping[str, object]) -> dict[str, float] | None:
    """Normalise a rank's position; seed fixtures nest it under ``location``."""
    location = rank.get("location")
    if isinstance(location, Mapping):
        lat = _as_opt_float(location.get("latitude"))
        lng = _as_opt_float(location.get("longitude"))
    else:
        lat = _as_opt_float(_pick(rank, "lat", "latitude"))
        lng = _as_opt_float(_pick(rank, "lng", "longitude"))
    if lat is None or lng is None:
        return None
    return {"lat": lat, "lng": lng}


def _edge(raw: Mapping[str, object], coords: Mapping[str, dict[str, float]]) -> _Edge | None:
    """Normalise one input leg; None when the leg is blocked ("on strike")."""
    if _pick(raw, "isBlocked", "is_blocked"):
        return None
    from_rank_id = str(_pick(raw, "fromRankId", "from_rank_id") or "")
    to_rank_id = str(_pick(raw, "toRankId", "to_rank_id") or "")
    if not from_rank_id or not to_rank_id:
        return None

    # Imputed defaults: an unknown fare must never look free and an unknown
    # duration must never look instant — see _as_float.
    fare = _as_float(_pick(raw, "fareZar", "fare_zar", "fare"), MISSING_FARE_PENALTY_ZAR)
    minutes = _as_opt_float(_pick(raw, "estimatedMinutes", "estimated_minutes", "time_mins"))

    # Prefer the road-following geometry; fall back to the straight line
    # between the two ranks (omitted when either rank has no coordinates).
    path: tuple[dict[str, float], ...] = ()
    raw_path = raw.get("path")
    if isinstance(raw_path, (list, tuple)) and len(raw_path) >= 2:
        path = tuple(p for p in (_point(item) for item in raw_path) if p is not None)
    if len(path) < 2:
        straight = (coords.get(from_rank_id), coords.get(to_rank_id))
        path = tuple(p for p in straight if p is not None)

    return _Edge(
        id=str(raw.get("id", "")),
        from_rank_id=from_rank_id,
        to_rank_id=to_rank_id,
        fare_zar=fare,
        minutes=minutes,
        mode=_opt_str(raw.get("mode")),
        path=path,
    )


def _round2(value: float) -> float:
    return round(value, 2)


def _clean_number(value: float) -> float | int:
    """Emit whole numbers as ints so JSON shows ``60``, not ``60.0``."""
    rounded = round(value, 2)
    return int(rounded) if rounded.is_integer() else rounded


def _planned_leg(edge: _Edge, names: Mapping[str, str]) -> dict[str, object]:
    """Build the shared ``PlanLeg`` wire shape for one hop of a plan.

    ``fromName``/``toName`` fall back to the rank id, so the breakdown list
    always has a label. ``minutes`` and ``mode`` are optional in the contract,
    so they are only populated when known — the mobile app can show per-leg
    durations without the engine inventing values for legs whose data is
    missing.
    """
    leg: dict[str, object] = {
        "fromRankId": edge.from_rank_id,
        "fromName": names.get(edge.from_rank_id, edge.from_rank_id),
        "toRankId": edge.to_rank_id,
        "toName": names.get(edge.to_rank_id, edge.to_rank_id),
        "path": list(edge.path),
        "fareZar": _round2(edge.fare_zar),
    }
    if edge.minutes is not None:
        leg["minutes"] = _clean_number(edge.minutes)
    if edge.mode is not None:
        leg["mode"] = edge.mode
    return leg


_Cost = tuple[float, float]


def _cost_of(edge: _Edge, priority: str) -> _Cost:
    minutes = MISSING_MINUTES_PENALTY_MIN if edge.minutes is None else edge.minutes
    if priority == "cheapest":
        return (edge.fare_zar, minutes)
    if priority == "fastest":
        return (minutes, edge.fare_zar)
    return (1.0, minutes)  # easiest: fewest legs, then minutes


def _cost_less(a: _Cost, b: _Cost) -> bool:
    """Strictly less, componentwise, with the epsilon absorbing float noise."""
    if abs(a[0] - b[0]) > COST_EPSILON:
        return a[0] < b[0]
    if abs(a[1] - b[1]) > COST_EPSILON:
        return a[1] < b[1]
    return False


def _cost_equal(a: _Cost, b: _Cost) -> bool:
    return abs(a[0] - b[0]) <= COST_EPSILON and abs(a[1] - b[1]) <= COST_EPSILON


def _tie_key(
    edge_path: Sequence[_Edge], rank_path: Sequence[str]
) -> tuple[int, tuple[str, ...], tuple[str, ...]]:
    """Structural tie-break: fewer legs, then rank sequence, then edge ids."""
    return (len(edge_path), tuple(rank_path), tuple(edge.id for edge in edge_path))


def _search(
    edges: Sequence[_Edge], origin: str, destination: str, priority: str
) -> list[_Edge] | None:
    """Dijkstra over the directed rank graph with deterministic tie-breaks."""
    adjacency: dict[str, list[_Edge]] = {}
    for edge in edges:
        adjacency.setdefault(edge.from_rank_id, []).append(edge)
    for hops in adjacency.values():
        hops.sort(key=lambda edge: edge.id)  # stable expansion order

    best: dict[str, tuple[_Cost, tuple[int, tuple[str, ...], tuple[str, ...]]]] = {
        origin: ((0.0, 0.0), (0, (origin,), ())),
    }
    settled: set[str] = set()
    frontier: list[tuple[_Cost, tuple[str, ...], list[_Edge]]] = [((0.0, 0.0), (origin,), [])]

    while frontier:
        # Linear scan: rank networks are tiny, and this avoids heap drift.
        best_index = 0
        for i in range(1, len(frontier)):
            cost, rank_path, edge_path = frontier[i]
            best_cost, best_ranks, best_edges = frontier[best_index]
            if _cost_less(cost, best_cost) or (
                not _cost_less(best_cost, cost)
                and _tie_key(edge_path, rank_path) < _tie_key(best_edges, best_ranks)
            ):
                best_index = i
        cost, rank_path, edge_path = frontier.pop(best_index)
        node = rank_path[-1]
        if node in settled:
            continue
        settled.add(node)
        if node == destination:
            return edge_path

        for edge in adjacency.get(node, []):
            if edge.to_rank_id in settled:
                continue
            step = _cost_of(edge, priority)
            new_cost = (cost[0] + step[0], cost[1] + step[1])
            new_rank_path = rank_path + (edge.to_rank_id,)
            new_edge_path = edge_path + [edge]
            new_key = _tie_key(new_edge_path, new_rank_path)
            incumbent = best.get(edge.to_rank_id)
            if incumbent is None or _cost_less(new_cost, incumbent[0]) or (
                _cost_equal(new_cost, incumbent[0]) and new_key < incumbent[1]
            ):
                best[edge.to_rank_id] = (new_cost, new_key)
                frontier.append((new_cost, new_rank_path, new_edge_path))
    return None


def plan_journeys(
    ranks: Iterable[Mapping[str, object]],
    legs: Iterable[Mapping[str, object]],
    from_rank_id: str,
    to_rank_id: str,
    priorities: Sequence[str] = PLAN_PRIORITIES,
) -> dict[str, object]:
    """Search the rank graph and return one option per requested priority.

    Returns the shared plan shape::

        {
            "originRankId": "rank-jhb-noord",
            "destinationRankId": "rank-mbombela",
            "options": [
                {"priority": "cheapest", "legs": [PlanLeg, ...],
                 "totalFareZar": 560.0, "totalMinutes": 330},
            ],
        }

    Raises ValueError when either rank is unknown or no priority finds a path.
    """
    rank_ids: set[str] = set()
    names: dict[str, str] = {}
    coords: dict[str, dict[str, float]] = {}
    for rank in ranks:
        rank_id = str(rank.get("id", ""))
        if not rank_id:
            continue
        rank_ids.add(rank_id)
        name = _opt_str(rank.get("name"))
        if name is not None:
            names[rank_id] = name
        point = _rank_point(rank)
        if point is not None:
            coords[rank_id] = point

    if from_rank_id not in rank_ids:
        raise ValueError(f"Origin rank not found in network: {from_rank_id}")
    if to_rank_id not in rank_ids:
        raise ValueError(f"Destination rank not found in network: {to_rank_id}")

    edges = [edge for edge in (_edge(raw, coords) for raw in legs) if edge is not None]

    # Canonical priority order regardless of how the caller lists them.
    requested = list(priorities) or list(PLAN_PRIORITIES)
    ordered = [priority for priority in PLAN_PRIORITIES if priority in requested]

    options: list[dict[str, object]] = []
    for priority in ordered:
        edge_path = _search(edges, from_rank_id, to_rank_id, priority)
        if edge_path is None:
            continue
        total_minutes: float | int | None = None
        if all(edge.minutes is not None for edge in edge_path):
            total_minutes = _clean_number(sum(edge.minutes for edge in edge_path))
        options.append(
            {
                "priority": priority,
                "legs": [_planned_leg(edge, names) for edge in edge_path],
                "totalFareZar": _round2(sum(edge.fare_zar for edge in edge_path)),
                "totalMinutes": total_minutes,
            }
        )

    if not options:
        raise ValueError("No viable route exists between these ranks.")
    return {
        "originRankId": from_rank_id,
        "destinationRankId": to_rank_id,
        "options": options,
    }
