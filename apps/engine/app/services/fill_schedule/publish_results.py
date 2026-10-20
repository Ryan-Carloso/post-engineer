"""Flatten upload-API responses into task-state ``publish_results``.

The web builds a published post's links from the engine task state's
``publish_results`` (apps/web/lib/post-detail.ts -> publish-links.ts):
one entry per (provider, video), link fields (``videoUrl`` /
``permalink`` / ``postId``) at top level. The upload API instead answers
per account, so a successful publish must be flattened before it is
recorded — see ``entries_for_result``.
"""

from __future__ import annotations

import os
from typing import Any

# Link fields the web resolver reads at entry top level: a provider
# hands back at most one of them per account.
_LINK_FIELDS = ("videoUrl", "permalink", "postId")


def entries_for_result(
    provider_name: str, video_path: str, result: Any
) -> list[dict[str, Any]]:
    """Successful-publish entries for one publish_video response.

    Each successful account in the response's ``results`` list becomes
    one entry; a response without a results list (top-level link
    fields) becomes a single entry carrying whatever it has.
    """
    video_name = os.path.basename(video_path)
    accounts = result.get("results") if isinstance(result, dict) else None
    if not isinstance(accounts, list) or not accounts:
        entry: dict[str, Any] = {
            "provider": provider_name,
            "video": video_name,
            "status": "published",
        }
        if isinstance(result, dict):
            for field in _LINK_FIELDS:
                if result.get(field):
                    entry[field] = result[field]
        return [entry]
    entries: list[dict[str, Any]] = []
    for account in accounts:
        if not isinstance(account, dict) or account.get("success") is not True:
            continue
        entry = {
            "provider": provider_name,
            "video": video_name,
            "status": "published",
        }
        if account.get("accountId"):
            entry["accountId"] = account["accountId"]
        for field in _LINK_FIELDS:
            if account.get(field):
                entry[field] = account[field]
        entries.append(entry)
    return entries


def failed_entry(provider_name: str, video_path: str, error: str) -> dict[str, Any]:
    """A failed-publish entry; the web resolver skips these for links."""
    return {
        "provider": provider_name,
        "video": os.path.basename(video_path),
        "status": "failed",
        "error": error,
    }
