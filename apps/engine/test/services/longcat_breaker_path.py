"""Shared LongCat breaker marker path for unit tests."""

from __future__ import annotations

import os


def breaker_path(breaker_root: str):
    def _path(root=None):
        base = root if root is not None else breaker_root
        return os.path.join(base, "marker.json")

    return _path
