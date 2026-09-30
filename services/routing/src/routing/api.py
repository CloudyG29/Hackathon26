"""HTTP wrapper around :mod:`routing.planner` — the live Python entry point.

Run from ``services/routing`` (with the venv active)::

    uvicorn routing.api:app --reload --port 8000 --app-dir src

``--app-dir src`` puts the package on ``sys.path``; ``main.py`` is only a
deprecated shim for the historical ``uvicorn main:app`` command.

The body accepts both camelCase (seed fixtures) and snake_case (DB rows)::

    POST /plan
    {
      "ranks": [...],
      "legs": [...],
      "fromRankId": "rank-jhb-noord",
      "toRankId": "rank-mbombela",
      "priorities": ["cheapest", "fastest", "easiest"]
    }

Note: the Express API currently plans in-process (services/api/src/planner.ts)
and does not call this service — this server is for querying the Python engine
directly (curl, notebooks, demos).
"""

from typing import Any

from fastapi import Body, FastAPI, HTTPException

from routing.planner import PLAN_PRIORITIES, plan_journeys

app = FastAPI(
    title="TransitGuide routing engine",
    description="Deterministic multi-priority journey planning over ranks and legs.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/plan")
def plan(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Plan journeys between two ranks, one option per requested priority."""
    from_rank_id = str(body.get("fromRankId") or body.get("from_rank_id") or "")
    to_rank_id = str(body.get("toRankId") or body.get("to_rank_id") or "")
    ranks = body.get("ranks") or []
    legs = body.get("legs") or []
    priorities = body.get("priorities") or list(PLAN_PRIORITIES)

    if not from_rank_id or not to_rank_id:
        raise HTTPException(status_code=400, detail="fromRankId and toRankId are required")

    try:
        return plan_journeys(ranks, legs, from_rank_id, to_rank_id, priorities=priorities)
    except ValueError as exc:
        message = str(exc)
        status = 404 if ("not found" in message or "No viable route" in message) else 400
        raise HTTPException(status_code=status, detail=message) from exc
