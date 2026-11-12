"""Provider metadata mapping + publish-plan pre-flight validation."""

from __future__ import annotations

from typing import Any

from app.services import upload_publisher
from app.services.fill_schedule.youtube_tags import derive_tags_from_title
from app.services.publish_fanvue import validate_fanvue_metadata
from app.services.publish_pinterest import validate_pinterest_metadata


def metadata_for(provider: str, title: str, schedule: dict[str, Any], description: str):
    """Build the provider metadata for a slot's title and schedule.

    The agent-supplied description is the publish copy wherever the
    provider takes one. It is required: a blank description fails loudly
    here, never silently falls back to the title.
    """
    copy = (description or "").strip()
    if not copy:
        raise RuntimeError("slot has no video description: the agent must send one")
    if provider == upload_publisher.YOUTUBE_PROVIDER:
        return upload_publisher.YouTubeMetadata(
            title=title[:100],
            description=copy,
            # Tags come from the title text itself, so they are always in
            # the video's own language. Never empty for a real title; the
            # pre-flight rejects degenerate titles before GPU is spent.
            tags=derive_tags_from_title(title),
            privacy_status="public",
            account_ids=tuple(str(value) for value in schedule.get("youtube_account_ids", [])),
        )
    if provider == upload_publisher.LINKEDIN_PROVIDER:
        return upload_publisher.LinkedInMetadata(
            caption=copy[: upload_publisher.LINKEDIN_CAPTION_MAX_LENGTH],
            account_ids=tuple(str(value) for value in schedule.get("linkedin_account_ids", [])),
        )
    if provider == upload_publisher.THREADS_PROVIDER:
        return upload_publisher.ThreadsMetadata(
            caption=copy[: upload_publisher.THREADS_CAPTION_MAX_LENGTH],
            account_ids=tuple(str(value) for value in schedule.get("threads_account_ids", [])),
        )
    if provider == upload_publisher.FACEBOOK_PROVIDER:
        return upload_publisher.FacebookMetadata(
            caption=copy[: upload_publisher.FACEBOOK_CAPTION_MAX_LENGTH],
            account_ids=tuple(str(value) for value in schedule.get("facebook_account_ids", [])),
        )
    if provider == upload_publisher.PINTEREST_PROVIDER:
        return upload_publisher.PinterestMetadata(
            title=title[: upload_publisher.PINTEREST_TITLE_MAX_LENGTH],
            description=copy[: upload_publisher.PINTEREST_DESCRIPTION_MAX_LENGTH],
            board_id=str(schedule.get("pinterest_board_id") or ""),
            account_ids=tuple(str(value) for value in schedule.get("pinterest_account_ids", [])),
        )
    if provider == upload_publisher.FANVUE_PROVIDER:
        return upload_publisher.FanvueMetadata(
            title=title[: upload_publisher.FANVUE_TITLE_MAX_LENGTH],
            description=copy[: upload_publisher.FANVUE_DESCRIPTION_MAX_LENGTH],
            account_ids=tuple(str(value) for value in schedule.get("fanvue_account_ids", [])),
        )
    if provider == upload_publisher.THREESPEAK_PROVIDER:
        return upload_publisher.ThreespeakMetadata(
            # No documented caption cap on 3Speak: the whole copy is the
            # caption, and the web route takes the title from its first line.
            caption=copy,
            account_ids=tuple(str(value) for value in schedule.get("threespeak_account_ids", [])),
        )
    if provider == upload_publisher.RUMBLE_PROVIDER:
        return upload_publisher.RumbleMetadata(
            title=title[: upload_publisher.RUMBLE_TITLE_MAX_LENGTH],
            description=copy,
            account_ids=tuple(str(value) for value in schedule.get("rumble_account_ids", [])),
        )
    if provider == upload_publisher.INSTAGRAM_PROVIDER:
        return upload_publisher.InstagramMetadata(
            caption=copy[:2200],
            account_ids=tuple(str(value) for value in schedule.get("instagram_account_ids", [])),
        )
    if provider == upload_publisher.BLUESKY_PROVIDER:
        return upload_publisher.BlueskyMetadata(
            caption=upload_publisher.truncate_bluesky_caption(copy),
            account_ids=tuple(str(value) for value in schedule.get("bluesky_account_ids", [])),
        )
    raise RuntimeError(f"unsupported schedule provider: {provider}")


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
    accounts fails every account it names. Faceless schedules pass no
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
                    raise RuntimeError(
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
            # Pinterest is validated here, not in validate_publish_metadata:
            # upload_publisher.py is at the 500-line file-size cap, so
            # its validator takes no new provider parameter. The pre-flight
            # is the only production caller, so this is the whole gate.
            validate_pinterest_metadata(metadata)
        elif isinstance(metadata, upload_publisher.ThreespeakMetadata):
            threespeak = metadata
        elif isinstance(metadata, upload_publisher.RumbleMetadata):
            rumble = metadata
        elif isinstance(metadata, upload_publisher.FanvueMetadata):
            # Fanvue is validated here, not in validate_publish_metadata:
            # upload_publisher.py is at the 500-line file-size cap, so
            # its validator takes no new provider parameter. The pre-flight
            # is the only production caller, so this is the whole gate.
            validate_fanvue_metadata(metadata)
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
