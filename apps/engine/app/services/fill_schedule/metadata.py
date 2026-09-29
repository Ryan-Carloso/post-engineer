"""Provider metadata mapping + publish-plan pre-flight validation."""

from __future__ import annotations

from typing import Any

from app.services import upload_publisher


def metadata_for(provider: str, topic: str, schedule: dict[str, Any]):
    """Build the provider metadata for a slot's topic and schedule."""
    if provider == upload_publisher.YOUTUBE_PROVIDER:
        return upload_publisher.YouTubeMetadata(
            title=topic[:100],
            description=topic,
            tags=(),
            privacy_status="public",
            account_ids=tuple(str(value) for value in schedule.get("youtube_account_ids", [])),
        )
    if provider == upload_publisher.LINKEDIN_PROVIDER:
        return upload_publisher.LinkedInMetadata(
            caption=topic[: upload_publisher.LINKEDIN_CAPTION_MAX_LENGTH],
            account_ids=tuple(str(value) for value in schedule.get("linkedin_account_ids", [])),
        )
    if provider == upload_publisher.INSTAGRAM_PROVIDER:
        return upload_publisher.InstagramMetadata(
            caption=topic[:2200],
            account_ids=tuple(str(value) for value in schedule.get("instagram_account_ids", [])),
        )
    if provider == upload_publisher.BLUESKY_PROVIDER:
        return upload_publisher.BlueskyMetadata(
            caption=upload_publisher.truncate_bluesky_caption(topic),
            account_ids=tuple(str(value) for value in schedule.get("bluesky_account_ids", [])),
        )
    raise RuntimeError(f"unsupported schedule provider: {provider}")


def validate_publish_plan(schedule: dict[str, Any], topic: str) -> None:
    """Pre-flight of the publish plan BEFORE generating the video.

    Validates providers, accounts and caption limits with the real topic;
    any problem fails the slot here, without spending tokens/money
    on a generation that could never be published.
    """
    providers = [str(provider) for provider in schedule.get("providers", [])]
    youtube = None
    instagram = None
    bluesky = None
    linkedin = None
    for provider in providers:
        metadata = metadata_for(provider, topic, schedule)
        if isinstance(metadata, upload_publisher.YouTubeMetadata):
            youtube = metadata
        elif isinstance(metadata, upload_publisher.InstagramMetadata):
            instagram = metadata
        elif isinstance(metadata, upload_publisher.BlueskyMetadata):
            bluesky = metadata
        elif isinstance(metadata, upload_publisher.LinkedInMetadata):
            linkedin = metadata
    upload_publisher.validate_publish_metadata(
        providers, youtube, instagram, bluesky=bluesky, linkedin=linkedin
    )
