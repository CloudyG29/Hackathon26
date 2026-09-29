"""Graph search over the rank/leg transit network.

The planner lives in :mod:`routing.planner`: ranks are graph nodes, legs are
directed weighted edges, and the best journey for a priority is a Dijkstra
shortest path over the unblocked legs (blocked = parent taxi route struck).

:mod:`routing.cli` is the stdin/stdout JSON bridge the Express API spawns per
``POST /routes/plan`` request:

    echo '{"fromRankId": "...", "toRankId": "...", "ranks": [...], "legs": [...]}' \
        | python -m routing.cli
"""

from .planner import PRIORITIES, build_graph, plan_journey

__all__ = ["PRIORITIES", "build_graph", "plan_journey"]
