"""stdin/stdout bridge for the journey planner, spawned by services/api.

One JSON request object on stdin, one JSON result object on stdout; all
diagnostics go to stderr so stdout stays machine-readable. Exits non-zero only
for a malformed request, so the caller can treat a failed process or
unparseable output as a hard error rather than an empty journey.
"""

from __future__ import annotations

import json
import sys

from .planner import plan_journey


def main() -> int:
    try:
        request = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print(f"invalid JSON request: {error}", file=sys.stderr)
        return 2

    if not isinstance(request, dict):
        print("request must be a JSON object", file=sys.stderr)
        return 2

    json.dump(plan_journey(request), sys.stdout)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
