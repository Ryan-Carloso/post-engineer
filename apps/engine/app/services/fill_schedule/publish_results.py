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

from app.services.analytics import scrub_error_text

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
    if accounts == []:
        # A 2xx body with an explicitly empty results list attempted no
        # account: nothing was posted. Record the attempt as failed so
        # the empty body stays diagnosable instead of vanishing.
        return [
            failed_entry(
                provider_name,
                video_path,
                "upload API returned an empty results list",
            )
        ]
    if not isinstance(accounts, list) or not accounts:
        links = {
            field: result[field]
            for field in _LINK_FIELDS
            if isinstance(result, dict) and result.get(field)
        }
        if not links:
            # No results list and no top-level link either: the body
            # names nothing that was posted, so claiming a publish
            # would recreate the published-without-links regression.
            return [
                failed_entry(
                    provider_name,
                    video_path,
                    "upload API returned no per-account results and no link",
                )
            ]
        entry: dict[str, Any] = {
            "provider": provider_name,
            "video": video_name,
            "status": "published",
            **links,
        }
        return [entry]
    entries: list[dict[str, Any]] = []
    for account in accounts:
        if not isinstance(account, dict):
            continue
        if account.get("success") is not True:
            # A failed account inside a 2xx body raises nothing: record
            # it as a failed entry (upstream text scrubbed first — the
            # entry is client-visible via the task state).
            upstream_error = str(
                account.get("error") or "upload API reported account failure"
            )
            failed = failed_entry(
                provider_name,
                video_path,
                scrub_error_text(upstream_error, max_chars=500),
            )
            if account.get("accountId"):
                failed["accountId"] = account["accountId"]
            entries.append(failed)
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
    if not entries:
        # A non-empty results list with no successful account (missing
        # or renamed success flag, non-dict items) posted nothing, but
        # the attempt must not vanish: record it as a failed entry so
        # the failure stays diagnosable on the task state.
        return [
            failed_entry(
                provider_name,
                video_path,
                "upload API returned no successful account result",
            )
        ]
    return entries


def failed_entry(provider_name: str, video_path: str, error: str) -> dict[str, Any]:
    """A failed-publish entry; the web resolver skips these for links."""
    return {
        "provider": provider_name,
        "video": os.path.basename(video_path),
        "status": "failed",
        "error": error,
    }


def merge_prior_published(
    existing: Any, new_entries: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """New entries plus prior published entries this attempt did not repost.

    Recording replaces the whole ``publish_results`` key (every state
    backend's update overwrites it), so without merging, a retry would
    erase links an earlier attempt recorded — even though that post is
    live and the recorded link is its only trace. A prior published
    entry survives unless the new entries contain a published entry
    for the same (provider, video): a failed re-attempt never erases
    the link of a post that is already live.
    """
    if not isinstance(existing, list):
        return new_entries
    reposted = {
        (entry.get("provider"), entry.get("video"))
        for entry in new_entries
        if entry.get("status") == "published"
    }
    preserved = [
        entry
        for entry in existing
        if isinstance(entry, dict)
        and entry.get("status") == "published"
        and (entry.get("provider"), entry.get("video")) not in reposted
    ]
    return preserved + new_entries
