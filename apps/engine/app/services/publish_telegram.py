"""Telegram publish contract for the internal upload API.

Wire contract (multipart/form-data, ``POST /api/upload-content``):
``provider=telegram``, ``video`` (file), ``caption``, repeated
``telegramAccountIds`` fields (Telegram chat ids).

A Telegram account is one destination chat — a channel or a
group/supergroup — reached through the user's own @BotFather bot. Both
kinds take the same Bot API ``sendVideo`` call, so the engine sends the
same fields for either; the web handler (``lib/upload/telegram-handler.ts``)
resolves the bot token per chat. The Bot API caps a caption at 1024
characters (``TELEGRAM_CAPTION_MAX_LENGTH`` in ``apps/web/lib/telegram.ts``,
pinned by ``test_publish_telegram.py``).

Kept out of ``upload_publisher`` (which re-exports these names) so that
module stays under the file-size cap; it owns only the Telegram types,
validation and multipart fields.
"""

from __future__ import annotations

from dataclasses import dataclass

TELEGRAM_PROVIDER: str = "telegram"
TELEGRAM_CAPTION_MAX_LENGTH: int = 1024


@dataclass
class TelegramMetadata:
    """Fields required by the internal route for a Telegram post."""

    caption: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


def validate_telegram_metadata(telegram: TelegramMetadata | None) -> None:
    """Raise ValueError when the Telegram metadata violates the route contract."""
    if telegram is None:
        raise ValueError("telegram provider requires telegram metadata")
    if not telegram.account_ids:
        raise ValueError("telegram publish requires at least one account id")
    if not telegram.caption.strip():
        raise ValueError("telegram publish requires a non-empty caption")
    if len(telegram.caption) > TELEGRAM_CAPTION_MAX_LENGTH:
        raise ValueError(
            "telegram caption exceeds "
            f"{TELEGRAM_CAPTION_MAX_LENGTH} characters"
        )


def telegram_fields(metadata: TelegramMetadata) -> list[tuple[str, str]]:
    """Multipart fields (file excluded) for a Telegram request."""
    return [
        ("provider", TELEGRAM_PROVIDER),
        ("caption", metadata.caption),
        *(("telegramAccountIds", account_id) for account_id in metadata.account_ids),
    ]
