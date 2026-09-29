"""Journey planner behaviour: priorities, blocking, parallel legs, edge cases."""

from __future__ import annotations

from routing.planner import build_graph, plan_journey

RANKS = [
    {"rankId": rank_id, "name": f"Rank {rank_id}", "lat": 0.0, "lng": 0.0}
    for rank_id in ("a", "b", "c", "d")
]

DEFAULT_PATH = [{"lat": -25.0, "lng": 28.0}, {"lat": -25.1, "lng": 28.1}]


def leg(
    leg_id: str,
    source: str,
    target: str,
    fare: float,
    minutes: float,
    blocked: bool = False,
) -> dict:
    return {
        "legId": leg_id,
        "fromRankId": source,
        "toRankId": target,
        "fareZar": fare,
        "minutes": minutes,
        "blocked": blocked,
        "path": DEFAULT_PATH,
    }


def request(legs: list[dict], source: str = "a", target: str = "b", priority: str | None = None) -> dict:
    body: dict = {"fromRankId": source, "toRankId": target, "ranks": RANKS, "legs": legs}
    if priority is not None:
        body["priority"] = priority
    return body


def leg_ids(result: dict) -> list[str]:
    return [planned["legId"] for planned in result["legs"]]


def two_hop_or_direct() -> list[dict]:
    """Direct A-B costs more; A-C-B is cheaper but slower."""
    return [
        leg("ab", "a", "b", fare=12, minutes=30),
        leg("ac", "a", "c", fare=5, minutes=50),
        leg("cb", "c", "b", fare=5, minutes=50),
    ]


def test_cheapest_prefers_lowest_total_fare() -> None:
    result = plan_journey(request(two_hop_or_direct(), priority="cheapest"))
    assert result["found"] is True
    assert leg_ids(result) == ["ac", "cb"]
    assert result["totalFareZar"] == 10
    assert result["legCount"] == 2


def test_fastest_prefers_shortest_total_time() -> None:
    result = plan_journey(request(two_hop_or_direct(), priority="fastest"))
    assert leg_ids(result) == ["ab"]
    assert result["legCount"] == 1


def test_fewest_transfers_prefers_minimum_hops() -> None:
    result = plan_journey(request(two_hop_or_direct(), priority="fewest_transfers"))
    assert leg_ids(result) == ["ab"]


def test_fewest_transfers_tie_breaks_on_minutes() -> None:
    legs = [
        leg("ac", "a", "c", fare=5, minutes=50),
        leg("cb", "c", "b", fare=5, minutes=50),
        leg("ad", "a", "d", fare=5, minutes=20),
        leg("db", "d", "b", fare=5, minutes=20),
    ]
    result = plan_journey(request(legs, priority="fewest_transfers"))
    assert leg_ids(result) == ["ad", "db"]


def test_default_priority_is_cheapest() -> None:
    with_default = plan_journey(request(two_hop_or_direct()))
    explicit = plan_journey(request(two_hop_or_direct(), priority="cheapest"))
    assert leg_ids(with_default) == leg_ids(explicit) == ["ac", "cb"]


def test_blocked_legs_are_excluded() -> None:
    legs = [
        leg("ab", "a", "b", fare=1, minutes=1, blocked=True),
        leg("ac", "a", "c", fare=5, minutes=50),
        leg("cb", "c", "b", fare=5, minutes=50),
    ]
    result = plan_journey(request(legs, priority="cheapest"))
    assert result["found"] is True
    assert leg_ids(result) == ["ac", "cb"]


def test_no_path_when_every_option_is_blocked() -> None:
    legs = [
        leg("ab", "a", "b", fare=1, minutes=1, blocked=True),
        leg("ac", "a", "c", fare=5, minutes=50, blocked=True),
        leg("cb", "c", "b", fare=5, minutes=50, blocked=True),
    ]
    result = plan_journey(request(legs))
    assert result["found"] is False
    assert result["reason"] == "no_path"


def test_no_path_when_ranks_are_disconnected() -> None:
    legs = [leg("ac", "a", "c", fare=5, minutes=50)]
    result = plan_journey(request(legs, source="a", target="b"))
    assert result["found"] is False
    assert result["reason"] == "no_path"


def test_parallel_legs_pick_the_best_per_priority() -> None:
    legs = [
        leg("cheap-slow", "a", "b", fare=8, minutes=40),
        leg("pricey-fast", "a", "b", fare=12, minutes=20),
    ]
    cheapest = plan_journey(request(legs, priority="cheapest"))
    fastest = plan_journey(request(legs, priority="fastest"))
    assert leg_ids(cheapest) == ["cheap-slow"]
    assert leg_ids(fastest) == ["pricey-fast"]


def test_same_rank_is_an_empty_journey() -> None:
    result = plan_journey(request(two_hop_or_direct(), source="a", target="a"))
    assert result == {"found": True, "legs": [], "totalFareZar": 0.0, "legCount": 0}


def test_unknown_priority_is_rejected() -> None:
    result = plan_journey(request(two_hop_or_direct(), priority="easiest"))
    assert result["found"] is False
    assert result["reason"] == "bad_priority"


def test_names_paths_and_rounded_fares_are_passed_through() -> None:
    legs = [
        leg("ac", "a", "c", fare=6.25, minutes=10),
        leg("cb", "c", "b", fare=7.5, minutes=10),
        leg("ab", "a", "b", fare=99, minutes=10),
    ]
    result = plan_journey(request(legs, priority="cheapest"))
    assert leg_ids(result) == ["ac", "cb"]
    assert result["totalFareZar"] == 13.75
    first = result["legs"][0]
    assert first["fromName"] == "Rank a"
    assert first["toName"] == "Rank c"
    assert first["path"] == DEFAULT_PATH


def test_build_graph_skips_self_loops() -> None:
    graph = build_graph([leg("loop", "a", "a", fare=1, minutes=1)], "cheapest")
    assert graph.number_of_edges() == 0
