"""Rumble publish contract for the internal upload API.

Wire contract (multipart/form-data, ``POST /api/upload-content``):
``provider=rumble``, ``video`` (file), ``title``, ``description``,
``license_type`` (``0`` = Personal Use), repeated ``rumbleAccountIds``
fields (Rumble channel ids).

The Simple Upload API (``POST https://rumble.com/api/simple-upload.php``)
is the only programmatic surface Rumble offers: one multipart endpoint
gated by a manually issued 40-character ``access_token`` (email
``bd@rumble.com`` — no OAuth, no self-service signup, no sandbox). There
is no read API (no video metadata, stats or analytics endpoint), no
webhook, and no token rotation: a leaked token is revoked only by
emailing Rumble. The channel id rides per account (the connected
account's ``provider_account_id``), so it is not part of these shared
fields — the web handler adds it per account, like the Facebook Page id.

``license_type`` stays ``0`` (Personal Use / not for sale) by design:
the other documented value (``6`` = Rumble Only) locks the video into
an exclusivity license that cannot be changed after upload.

Kept out of ``upload_publisher`` (which re-exports these names) so that
module stays under the file-size cap; it owns only the Rumble types,
validation and multipart fields.
"""

from __future__ import annotations

from dataclasses import dataclass

RUMBLE_PROVIDER: str = "rumble"
# Rumble upload form ceiling; lib/rumble.ts pins the same value. The web
# draft scorer does not enforce it — the ceiling lives at the publish
# boundary (lib/rumble.ts, this module, and the upload handler).
RUMBLE_TITLE_MAX_LENGTH: int = 100
# Personal Use / not for sale. The only other documented value (6 = Rumble
# Only) is deliberately never sent: it locks the video into exclusivity.
RUMBLE_LICENSE_TYPE: int = 0


@dataclass
class RumbleMetadata:
    """Fields required by the internal route for a Rumble upload."""

    title: str
    description: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


def validate_rumble_metadata(rumble: RumbleMetadata | None) -> None:
    """Raise ValueError when the Rumble metadata violates the route contract."""
    if rumble is None:
        raise ValueError("rumble provider requires rumble metadata")
    if not rumble.account_ids:
        raise ValueError("rumble publish requires at least one account id")
    if not rumble.title.strip():
        raise ValueError("rumble publish requires a non-empty title")
    if len(rumble.title) > RUMBLE_TITLE_MAX_LENGTH:
        raise ValueError(
            "rumble title exceeds "
            f"{RUMBLE_TITLE_MAX_LENGTH} characters"
        )
    if not rumble.description.strip():
        raise ValueError("rumble publish requires a non-empty description")


def rumble_fields(metadata: RumbleMetadata) -> list[tuple[str, str]]:
    """Multipart fields (file excluded) for a Rumble request."""
    return [
        ("provider", RUMBLE_PROVIDER),
        ("title", metadata.title),
        ("description", metadata.description),
        ("license_type", str(RUMBLE_LICENSE_TYPE)),
        *(("rumbleAccountIds", account_id) for account_id in metadata.account_ids),
    ]
