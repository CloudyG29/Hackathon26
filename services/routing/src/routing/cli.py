"""stdin/stdout bridge for the journey planner.

One JSON request object on stdin, one JSON result object on stdout; all
diagnostics go to stderr so stdout stays machine-readable. The request body
matches the FastAPI wrapper's ``POST /plan`` (see ``routing.api``):
``{"ranks": [...], "legs": [...], "fromRankId": ..., "toRankId": ...,
"priorities": [...]}``, accepted in camelCase or snake_case.

The Express API plans journeys in-process (``services/api/src/planner.ts``),
so this bridge is for scripts and pipelines that want the Python engine.
Exits non-zero for a malformed request or an unknown rank, so the caller can
treat a failed process or unparseable output as a hard error rather than an
empty journey.
"""

from __future__ import annotations

import json
import sys

from .planner import PLAN_PRIORITIES, plan_journeys


def main() -> int:
    try:
        request = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print(f"invalid JSON request: {error}", file=sys.stderr)
        return 2

    if not isinstance(request, dict):
        print("request must be a JSON object", file=sys.stderr)
        return 2

    from_rank_id = str(request.get("fromRankId") or request.get("from_rank_id") or "")
    to_rank_id = str(request.get("toRankId") or request.get("to_rank_id") or "")
    priorities = request.get("priorities") or list(PLAN_PRIORITIES)
    if not from_rank_id or not to_rank_id or not isinstance(priorities, list):
        print(
            "request needs fromRankId, toRankId and an optional priorities list",
            file=sys.stderr,
        )
        return 2

    try:
        result = plan_journeys(
            request.get("ranks") or [],
            request.get("legs") or [],
            from_rank_id,
            to_rank_id,
            priorities=priorities,
        )
    except ValueError as error:
        print(f"planning failed: {error}", file=sys.stderr)
        return 1

    json.dump(result, sys.stdout)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
