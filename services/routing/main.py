"""Deprecated shim kept so the historical command still boots the engine::

    uvicorn main:app --reload --port 8000    # from services/routing

The live entry point is :mod:`routing.api`; prefer::

    uvicorn routing.api:app --reload --port 8000 --app-dir src

This file only re-exports the app — all logic lives in routing/planner.py.
"""

import sys
from pathlib import Path

# Make the ``routing`` package importable without requiring an editable install.
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from routing.api import app  # noqa: E402

__all__ = ["app"]
