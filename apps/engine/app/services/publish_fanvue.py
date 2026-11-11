"""Fanvue publish contract for the internal upload API.

Wire contract (multipart/form-data, ``POST /api/upload-content``):
``provider=fanvue``, ``video`` (file), ``title``, ``description``,
repeated ``fanvueAccountIds`` fields (Fanvue account ids).

The web handler publishes subscribers-only (``isSubscribersOnly: true``,
the 18+ paywall rule) — the engine does NOT set that; it only passes
title, description and account ids. There is no board concept for Fanvue.

Kept out of ``upload_publisher`` (which re-exports these names) so that
module stays under the file-size cap; it owns only the Fanvue types,
validation and multipart fields.
"""

from __future__ import annotations

from dataclasses import dataclass

FANVUE_PROVIDER: str = "fanvue"
# Fanvue title/description ceilings, mirroring the Pinterest contract
# (publish_pinterest.py); the web handler pins the same values.
FANVUE_TITLE_MAX_LENGTH: int = 100
FANVUE_DESCRIPTION_MAX_LENGTH: int = 800


@dataclass
class FanvueMetadata:
    """Fields required by the internal route for a Fanvue video post."""

    title: str
    description: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


def validate_fanvue_metadata(fanvue: FanvueMetadata | None) -> None:
    """Raise ValueError when the Fanvue metadata violates the route contract."""
    if fanvue is None:
        raise ValueError("fanvue provider requires fanvue metadata")
    if not fanvue.account_ids:
        raise ValueError("fanvue publish requires at least one account id")
    if not fanvue.title.strip():
        raise ValueError("fanvue publish requires a non-empty title")
    if len(fanvue.title) > FANVUE_TITLE_MAX_LENGTH:
        raise ValueError(
            "fanvue title exceeds "
            f"{FANVUE_TITLE_MAX_LENGTH} characters"
        )
    if not fanvue.description.strip():
        raise ValueError("fanvue publish requires a non-empty description")
    if len(fanvue.description) > FANVUE_DESCRIPTION_MAX_LENGTH:
        raise ValueError(
            "fanvue description exceeds "
            f"{FANVUE_DESCRIPTION_MAX_LENGTH} characters"
        )


def fanvue_fields(metadata: FanvueMetadata) -> list[tuple[str, str]]:
    """Multipart fields (file excluded) for a Fanvue request."""
    return [
        ("provider", FANVUE_PROVIDER),
        ("title", metadata.title),
        ("description", metadata.description),
        *(("fanvueAccountIds", account_id) for account_id in metadata.account_ids),
    ]
