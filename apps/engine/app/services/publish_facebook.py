"""Facebook Pages publish contract for the internal upload API.

Wire contract (multipart/form-data, ``POST /api/upload-content``):
``provider=facebook``, ``video`` (file), ``caption``, repeated
``facebookAccountIds`` fields (Facebook Page ids).

Kept out of ``upload_publisher`` (which re-exports these names) so that
module stays under the file-size cap; it owns only the Facebook types,
validation and multipart fields.
"""

from __future__ import annotations

from dataclasses import dataclass

FACEBOOK_PROVIDER: str = "facebook"
# Facebook's documented feed-post ceiling; the web draft scorer
# (lib/draft-scoring.ts) and lib/facebook.ts pin the same value.
FACEBOOK_CAPTION_MAX_LENGTH: int = 63206


@dataclass
class FacebookMetadata:
    """Fields required by the internal route for a Facebook Page upload."""

    caption: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


def validate_facebook_metadata(facebook: FacebookMetadata | None) -> None:
    """Raise ValueError when the Facebook metadata violates the route contract."""
    if facebook is None:
        raise ValueError("facebook provider requires facebook metadata")
    if not facebook.account_ids:
        raise ValueError("facebook publish requires at least one account id")
    if len(facebook.caption) > FACEBOOK_CAPTION_MAX_LENGTH:
        raise ValueError(
            "facebook caption exceeds "
            f"{FACEBOOK_CAPTION_MAX_LENGTH} characters"
        )


def facebook_fields(metadata: FacebookMetadata) -> list[tuple[str, str]]:
    """Multipart fields (file excluded) for a Facebook request."""
    return [
        ("provider", FACEBOOK_PROVIDER),
        ("caption", metadata.caption),
        *(("facebookAccountIds", account_id) for account_id in metadata.account_ids),
    ]
