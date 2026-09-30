"""Contract tests for the routing planner (routing.planner).

Covers the demo-critical properties:

- optimality per priority (cheapest / fastest / easiest),
- determinism: equal-cost paths resolve identically across reruns,
- missing-data guards: unknown minutes never look "instant", unknown fares
  never look free,
- strikes: blocked legs are excluded and the plan reroutes,
- geometry: the DB path wins; otherwise a straight line between the ranks.
"""

import pytest

from routing.planner import _as_float, plan_journeys

# Sentinel for "key absent" — distinct from an explicit null or zero.
_MISSING = object()


def rank(rank_id: str, lat: float, lng: float) -> dict:
    """Seed-fixture style rank."""
    return {"id": rank_id, "location": {"latitude": lat, "longitude": lng}}


def leg(
    leg_id: str,
    from_rank_id: str,
    to_rank_id: str,
    fare: object = _MISSING,
    minutes: object = _MISSING,
    mode: str = "long_distance_taxi",
    path: list | None = None,
    blocked: bool = False,
) -> dict:
    """Seed-fixture style leg; keys left out entirely simulate missing data."""
    edge: dict = {
        "id": leg_id,
        "mode": mode,
        "fromRankId": from_rank_id,
        "toRankId": to_rank_id,
    }
    if fare is not _MISSING:
        edge["fareZar"] = fare
    if minutes is not _MISSING:
        edge["estimatedMinutes"] = minutes
    if path is not None:
        edge["path"] = path
    if blocked:
        edge["isBlocked"] = True
    return edge


RANKS = [rank("A", -26.0, 28.0), rank("X", -26.1, 28.1), rank("B", -26.2, 28.2)]


def option_by_priority(result: dict, priority: str) -> dict:
    return next(option for option in result["options"] if option["priority"] == priority)


def hop_sequence(option: dict) -> list[str]:
    return [f"{plan_leg['fromRankId']}->{plan_leg['toRankId']}" for plan_leg in option["legs"]]


def test_zero_fare_detour_loses_to_paid_direct_when_fares_are_imputed():
    """A detour whose legs carry no fare data must not beat a paid direct leg:
    imputed fares keep unknown-cost legs from looking free."""
    edges = [
        leg("direct", "A", "B", fare=50, minutes=100),
        leg("detour-a", "A", "X", minutes=50),  # no fare key -> imputed penalty
        leg("detour-b", "X", "B", minutes=50),  # no fare key -> imputed penalty
    ]

    cheapest = option_by_priority(plan_journeys(RANKS, edges, "A", "B"), "cheapest")

    assert hop_sequence(cheapest) == ["A->B"]
    assert cheapest["totalFareZar"] == 50


def test_equal_cost_paths_resolve_deterministically():
    """Two options with identical totals must resolve to the same plan on every
    rerun (and regardless of input order): the tie-break prefers fewer legs."""
    edges = [
        leg("direct", "A", "B", fare=100, minutes=60),
        leg("hop-a", "A", "X", fare=50, minutes=30),
        leg("hop-b", "X", "B", fare=50, minutes=30),
    ]

    first = plan_journeys(RANKS, edges, "A", "B")
    reversed_input = plan_journeys(RANKS, list(reversed(edges)), "A", "B")
    for _ in range(3):
        assert plan_journeys(RANKS, edges, "A", "B") == first

    assert hop_sequence(option_by_priority(first, "cheapest")) == ["A->B"]
    assert hop_sequence(option_by_priority(reversed_input, "cheapest")) == ["A->B"]


def test_epsilon_tolerates_float_noise():
    """A hair-thin cost difference (within COST_EPSILON) must not flip the
    winner between reruns: near-ties fall through to the structural tie-break."""
    edges = [
        leg("direct", "A", "B", fare=100, minutes=60),
        leg("hop-a", "A", "X", fare=50, minutes=30),
        leg("hop-b", "X", "B", fare=50.0000000005, minutes=30),
    ]

    cheapest = option_by_priority(plan_journeys(RANKS, edges, "A", "B"), "cheapest")

    assert hop_sequence(cheapest) == ["A->B"]


def test_missing_minutes_loses_to_known_time_leg():
    """A leg with no duration must not look "instant": on fastest, the known-time
    detour wins, and per-leg minutes/mode are populated for the chosen legs."""
    edges = [
        leg("direct", "A", "B", fare=10),  # no minutes key -> large penalty
        leg("hop-a", "A", "X", fare=10, minutes=30),
        leg("hop-b", "X", "B", fare=10, minutes=30),
    ]

    fastest = option_by_priority(plan_journeys(RANKS, edges, "A", "B"), "fastest")

    assert hop_sequence(fastest) == ["A->X", "X->B"]
    assert fastest["totalMinutes"] == 60
    assert all(plan_leg["minutes"] == 30 for plan_leg in fastest["legs"])
    assert all(plan_leg["mode"] == "long_distance_taxi" for plan_leg in fastest["legs"])


def test_as_float_guard_keeps_explicit_zero_but_penalises_missing():
    assert _as_float(0, default=99.0) == 0.0  # explicit zero is a real zero
    assert _as_float("0", default=99.0) == 0.0
    assert _as_float(None, default=99.0) == 99.0  # missing -> penalty, never 0
    assert _as_float("12.5", default=99.0) == 12.5
    assert _as_float("not-a-number", default=99.0) == 99.0


def test_blocked_leg_reroutes():
    """Toggling a strike in the DB must push the plan onto the next-best path."""
    edges = [
        leg("direct", "A", "B", fare=10, minutes=60, blocked=True),
        leg("hop-a", "A", "X", fare=20, minutes=30),
        leg("hop-b", "X", "B", fare=20, minutes=30),
    ]

    cheapest = option_by_priority(plan_journeys(RANKS, edges, "A", "B"), "cheapest")

    assert hop_sequence(cheapest) == ["A->X", "X->B"]
    assert cheapest["totalFareZar"] == 40


def test_plan_leg_geometry_prefers_db_path_then_straight_line():
    road_path = [
        {"lat": -26.05, "lng": 28.05},
        {"lat": -26.1, "lng": 28.1},
        {"lat": -26.2, "lng": 28.2},
    ]
    with_path = plan_journeys(
        RANKS, [leg("direct", "A", "B", fare=10, minutes=60, path=road_path)], "A", "B"
    )
    planned = option_by_priority(with_path, "fastest")["legs"][0]
    assert planned["path"] == [
        {"latitude": -26.05, "longitude": 28.05},
        {"latitude": -26.1, "longitude": 28.1},
        {"latitude": -26.2, "longitude": 28.2},
    ]

    without_path = plan_journeys(RANKS, [leg("direct", "A", "B", fare=10, minutes=60)], "A", "B")
    fallback = option_by_priority(without_path, "fastest")["legs"][0]
    assert fallback["path"] == [  # straight line between the rank coordinates
        {"latitude": -26.0, "longitude": 28.0},
        {"latitude": -26.2, "longitude": 28.2},
    ]


def test_unknown_rank_raises():
    with pytest.raises(ValueError, match="Origin rank not found"):
        plan_journeys(RANKS, [], "nope", "B")
