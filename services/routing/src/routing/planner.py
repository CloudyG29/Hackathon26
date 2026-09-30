"""Shortest-path journey planning over the rank/leg graph.

Ranks are graph nodes; legs are directed weighted edges. The caller (the
Express API) supplies a snapshot of the network as plain JSON-serialisable
dicts, so this module never touches the database itself and stays trivially
testable.

Edge weights by priority:

- ``cheapest``          fare in rand.
- ``fastest``           travel time in minutes.
- ``fewest_transfers``  1 per leg, so the path with the fewest changeovers
                        wins; same-hop-count paths are tie-broken by total
                        travel time.

Legs flagged ``blocked`` (their parent taxi route is struck) are excluded
before the search. Parallel legs between the same ordered rank pair collapse
to the best one for the requested priority.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

import networkx as nx

PRIORITIES: tuple[str, ...] = ("cheapest", "fastest", "fewest_transfers")

# Tie-break weight added per minute for fewest_transfers. The per-edge bonus is
# far small enough that a k+1-leg route can never beat a k-leg route (bonus
# sums stay well below 1 across any path), yet far above float64 rounding
# noise at weights ~1.
_HOP_TIEBREAK = 1e-6


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _edge_weight(leg: dict[str, Any], priority: str, total_minutes: float) -> float:
    if priority == "fastest":
        return _as_float(leg.get("minutes"))
    if priority == "fewest_transfers":
        return 1.0 + _HOP_TIEBREAK * _as_float(leg.get("minutes")) / (total_minutes + 1.0)
    return _as_float(leg.get("fareZar"))


def build_graph(legs: Sequence[dict[str, Any]], priority: str) -> nx.DiGraph:
    """Directed graph of unblocked legs, built for one priority.

    Parallel legs between the same ordered rank pair collapse to the best one
    for this priority; ties go to the lower fare, then the stable leg id, so
    the same network snapshot always yields the same journey.
    """
    total_minutes = sum(_as_float(leg.get("minutes")) for leg in legs)
    graph = nx.DiGraph()
    for leg in legs:
        if leg.get("blocked"):
            continue
        source = leg.get("fromRankId")
        target = leg.get("toRankId")
        if not source or not target or source == target:
            continue
        weight = _edge_weight(leg, priority, total_minutes)
        rank_key = (weight, _as_float(leg.get("fareZar")), str(leg.get("legId", "")))
        existing = graph.get_edge_data(source, target)
        if existing is None or rank_key < existing["rankKey"]:
            graph.add_edge(source, target, weight=weight, rankKey=rank_key, leg=leg)
    return graph


def _planned_leg(
    graph: nx.DiGraph, source: str, target: str, names: dict[str, str]
) -> dict[str, Any]:
    leg = graph[source][target]["leg"]
    return {
        "legId": leg.get("legId"),
        "fromRankId": source,
        "fromName": names.get(source, source),
        "toRankId": target,
        "toName": names.get(target, target),
        "path": list(leg.get("path") or []),
        "fareZar": round(_as_float(leg.get("fareZar")), 2),
    }


def plan_journey(request: dict[str, Any]) -> dict[str, Any]:
    """Plan the best journey for one priority from a network snapshot.

    Returns ``{"found": True, "legs": [...], "totalFareZar": ..., "legCount": n}``
    or ``{"found": False, "reason": ..., "detail": ...}``. The caller turns the
    latter into a clean 404/503 — never a partial journey.
    """
    priority = str(request.get("priority") or "cheapest")
    if priority not in PRIORITIES:
        return {
            "found": False,
            "reason": "bad_priority",
            "detail": f"priority must be one of {', '.join(PRIORITIES)}",
        }

    source = str(request.get("fromRankId") or "")
    target = str(request.get("toRankId") or "")
    ranks: Iterable[dict[str, Any]] = request.get("ranks") or []
    names = {
        str(rank.get("rankId")): str(rank.get("name") or rank.get("rankId"))
        for rank in ranks
    }

    if source == target:
        return {"found": True, "legs": [], "totalFareZar": 0.0, "legCount": 0}

    graph = build_graph(request.get("legs") or [], priority)

    if source not in graph or target not in graph:
        return {
            "found": False,
            "reason": "no_path",
            "detail": "rank has no usable legs in the network",
        }

    try:
        nodes = nx.dijkstra_path(graph, source, target, weight="weight")
    except nx.NetworkXNoPath:
        return {
            "found": False,
            "reason": "no_path",
            "detail": "every path is disconnected or blocked",
        }

    legs = [_planned_leg(graph, a, b, names) for a, b in zip(nodes, nodes[1:])]
    return {
        "found": True,
        "legs": legs,
        "totalFareZar": round(sum(leg["fareZar"] for leg in legs), 2),
        "legCount": len(legs),
    }
