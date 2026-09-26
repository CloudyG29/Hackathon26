"""Smoke test so pytest collects something before the engine exists."""

import routing


def test_package_imports() -> None:
    assert routing is not None
