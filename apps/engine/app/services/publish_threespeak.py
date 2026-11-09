"""3Speak (Hive) publish contract for the internal upload API.

Wire contract (multipart/form-data, ``POST /api/upload-content``):
``provider=3speak``, ``video`` (file), ``caption``, repeated
``threespeakAccountIds`` fields (Hive usernames).

Kept out of ``upload_publisher`` (which re-exports these names) so that
module stays under the file-size cap; it owns only the 3Speak types,
validation and multipart fields.
"""

from __future__ import annotations

from dataclasses import dataclass

THREESPEAK_PROVIDER: str = "3speak"
# 3Speak has no documented caption cap (the web draft scorer
# lib/draft-scoring.ts pins the same: no case in its publish check), so
# the caption is sent whole; the web route still requires it non-empty.


@dataclass
class ThreespeakMetadata:
    """Fields required by the internal route for a 3Speak upload."""

    caption: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


def validate_threespeak_metadata(threespeak: ThreespeakMetadata | None) -> None:
    """Raise ValueError when the 3Speak metadata violates the route contract."""
    if threespeak is None:
        raise ValueError("3speak provider requires 3speak metadata")
    if not threespeak.account_ids:
        raise ValueError("3speak publish requires at least one account id")
    if not threespeak.caption.strip():
        raise ValueError("3speak publish requires a non-empty caption")


def threespeak_fields(metadata: ThreespeakMetadata) -> list[tuple[str, str]]:
    """Multipart fields (file excluded) for a 3Speak request."""
    return [
        ("provider", THREESPEAK_PROVIDER),
        ("caption", metadata.caption),
        *(("threespeakAccountIds", account_id) for account_id in metadata.account_ids),
    ]
