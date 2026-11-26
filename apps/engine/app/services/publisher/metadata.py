"""Provider metadata mapping + publish-plan pre-flight validation."""

from __future__ import annotations

from typing import Any

from app.services import upload_publisher
from app.services.caption_text import truncate_bluesky_caption
from app.services.publish_facebook import FACEBOOK_CAPTION_MAX_LENGTH
from app.services.publish_rumble import RUMBLE_TITLE_MAX_LENGTH
from app.services.publisher.youtube_tags import derive_tags_from_title
from app.services.publish_fanvue import FANVUE_DESCRIPTION_MAX_LENGTH, FANVUE_TITLE_MAX_LENGTH, validate_fanvue_metadata
from app.services.publish_pinterest import PINTEREST_DESCRIPTION_MAX_LENGTH, PINTEREST_TITLE_MAX_LENGTH, validate_pinterest_metadata
from app.services.publish_telegram import TELEGRAM_CAPTION_MAX_LENGTH, validate_telegram_metadata


class AccountNotBoundError(RuntimeError):
    """A schedule names an account the persona is not bound to (issue #572).

    A dedicated type so the publish stage can tell a binding rejection
    apart from every other publish-plan failure (blank description,
    unsupported provider, caption limits) — the refund reason recorded
    for each must name the real cause.
    """


def _persona_ai_label(schedule: dict[str, Any]) -> bool:
    persona = schedule.get("personas")
    return isinstance(persona, dict) and persona.get("ai_label") is True


def _youtube_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.YouTubeMetadata(
        title=title[:100],
        description=copy,
        tags=derive_tags_from_title(title),
        privacy_status="public",
        account_ids=tuple(str(value) for value in schedule.get("youtube_account_ids", [])),
        ai_label=_persona_ai_label(schedule),
    )


def _linkedin_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.LinkedInMetadata(
        caption=copy[: upload_publisher.LINKEDIN_CAPTION_MAX_LENGTH],
        account_ids=tuple(str(value) for value in schedule.get("linkedin_account_ids", [])),
    )


def _threads_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.ThreadsMetadata(
        caption=copy[: upload_publisher.THREADS_CAPTION_MAX_LENGTH],
        account_ids=tuple(str(value) for value in schedule.get("threads_account_ids", [])),
        ai_label=_persona_ai_label(schedule),
    )


def _facebook_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.FacebookMetadata(
        caption=copy[: FACEBOOK_CAPTION_MAX_LENGTH],
        account_ids=tuple(str(value) for value in schedule.get("facebook_account_ids", [])),
        ai_label=_persona_ai_label(schedule),
    )


def _pinterest_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.PinterestMetadata(
        title=title[: PINTEREST_TITLE_MAX_LENGTH],
        description=copy[: PINTEREST_DESCRIPTION_MAX_LENGTH],
        board_id=str(schedule.get("pinterest_board_id") or ""),
        account_ids=tuple(str(value) for value in schedule.get("pinterest_account_ids", [])),
        ai_label=_persona_ai_label(schedule),
    )


def _fanvue_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.FanvueMetadata(
        title=title[: FANVUE_TITLE_MAX_LENGTH],
        description=copy[: FANVUE_DESCRIPTION_MAX_LENGTH],
        account_ids=tuple(str(value) for value in schedule.get("fanvue_account_ids", [])),
    )


def _telegram_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.TelegramMetadata(
        caption=copy[: TELEGRAM_CAPTION_MAX_LENGTH],
        account_ids=tuple(str(value) for value in schedule.get("telegram_account_ids", [])),
    )


def _threespeak_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.ThreespeakMetadata(
        caption=copy,
        account_ids=tuple(str(value) for value in schedule.get("threespeak_account_ids", [])),
    )


def _rumble_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.RumbleMetadata(
        title=title[: RUMBLE_TITLE_MAX_LENGTH],
        description=copy,
        account_ids=tuple(str(value) for value in schedule.get("rumble_account_ids", [])),
    )


def _instagram_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.InstagramMetadata(
        caption=copy[:2200],
        account_ids=tuple(str(value) for value in schedule.get("instagram_account_ids", [])),
        ai_label=_persona_ai_label(schedule),
    )


def _bluesky_metadata(title: str, schedule: dict[str, Any], copy: str):
    return upload_publisher.BlueskyMetadata(
        caption=truncate_bluesky_caption(copy),
        account_ids=tuple(str(value) for value in schedule.get("bluesky_account_ids", [])),
    )


_METADATA_BUILDERS: dict[str, Any] = {
    upload_publisher.YOUTUBE_PROVIDER: _youtube_metadata,
    upload_publisher.LINKEDIN_PROVIDER: _linkedin_metadata,
    upload_publisher.THREADS_PROVIDER: _threads_metadata,
    upload_publisher.FACEBOOK_PROVIDER: _facebook_metadata,
    upload_publisher.PINTEREST_PROVIDER: _pinterest_metadata,
    upload_publisher.FANVUE_PROVIDER: _fanvue_metadata,
    upload_publisher.TELEGRAM_PROVIDER: _telegram_metadata,
    upload_publisher.THREESPEAK_PROVIDER: _threespeak_metadata,
    upload_publisher.RUMBLE_PROVIDER: _rumble_metadata,
    upload_publisher.INSTAGRAM_PROVIDER: _instagram_metadata,
    upload_publisher.BLUESKY_PROVIDER: _bluesky_metadata,
}


def metadata_for(provider: str, title: str, schedule: dict[str, Any], description: str):
    """Build the provider metadata for a slot's title and schedule.

    The agent-supplied description is the publish copy wherever the
    provider takes one. It is required: a blank description fails loudly
    here, never silently falls back to the title.
    """
    copy = (description or "").strip()
    if not copy:
        raise RuntimeError("slot has no video description: the agent must send one")
    builder = _METADATA_BUILDERS.get(provider)
    if builder is None:
        raise RuntimeError(f"unsupported schedule provider: {provider}")
    return builder(title, schedule, copy)


def validate_publish_plan(
    schedule: dict[str, Any],
    title: str,
    description: str,
    bound_accounts: dict[str, list[str]] | None = None,
) -> None:
    """Pre-flight of the publish plan BEFORE generating the video.

    Validates providers, accounts and caption limits with the real title;
    any problem fails the slot here, without spending tokens/money
    on a generation that could never be published.

    When bound_accounts is given (a schedule with a persona), every
    account the schedule publishes to must be bound to that persona
    (issue #572). The binding is read at generate time, so an account
    unbound after scheduling fails here instead of publishing to an
    account the persona no longer owns. A persona with zero bound
    accounts fails every account it names. Voiceover schedules pass no
    binding and skip the check.
    """
    providers = [str(provider) for provider in schedule.get("providers", [])]
    youtube = None
    instagram = None
    bluesky = None
    linkedin = None
    threads = None
    facebook = None
    threespeak = None
    rumble = None
    for provider in providers:
        metadata = metadata_for(provider, title, schedule, description)
        if bound_accounts is not None:
            bound = bound_accounts.get(provider, [])
            for account_id in getattr(metadata, "account_ids", ()):
                if str(account_id) not in bound:
                    raise AccountNotBoundError(
                        f"account {account_id} is not bound to persona "
                        f"{schedule.get('persona_id')}: bind it to the persona "
                        "or remove it from the schedule"
                    )
        if isinstance(metadata, upload_publisher.YouTubeMetadata):
            youtube = metadata
        elif isinstance(metadata, upload_publisher.InstagramMetadata):
            instagram = metadata
        elif isinstance(metadata, upload_publisher.BlueskyMetadata):
            bluesky = metadata
        elif isinstance(metadata, upload_publisher.LinkedInMetadata):
            linkedin = metadata
        elif isinstance(metadata, upload_publisher.ThreadsMetadata):
            threads = metadata
        elif isinstance(metadata, upload_publisher.FacebookMetadata):
            facebook = metadata
        elif isinstance(metadata, upload_publisher.PinterestMetadata):
            validate_pinterest_metadata(metadata)
        elif isinstance(metadata, upload_publisher.ThreespeakMetadata):
            threespeak = metadata
        elif isinstance(metadata, upload_publisher.RumbleMetadata):
            rumble = metadata
        elif isinstance(metadata, upload_publisher.FanvueMetadata):
            validate_fanvue_metadata(metadata)
        elif isinstance(metadata, upload_publisher.TelegramMetadata):
            validate_telegram_metadata(metadata)
    upload_publisher.validate_publish_metadata(
        providers,
        youtube,
        instagram,
        bluesky=bluesky,
        linkedin=linkedin,
        threads=threads,
        facebook=facebook,
        threespeak=threespeak,
        rumble=rumble,
    )
