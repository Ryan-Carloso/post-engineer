"""Publish finished task videos through the internal upload API.

Bridges the task lifecycle (``task.start``) to ``upload_publisher``: converts
schema publish params to client metadata, enforces explicit configuration,
publishes each final video to every selected provider and records results in
the task state.

Idempotency: if the task state already carries ``publish_results`` the publish
is skipped, so retries/timeouts never double-post.
"""

from __future__ import annotations

import os

from loguru import logger

from app.models import const
from app.models.publish import PublishParams
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from app.services import upload_publisher

BASE_URL_ENV: str = "MPT_UPLOAD_API_BASE_URL"
SERVICE_KEY_ENV: str = "MONEYPRINT_API_SECRET"


class PublishFailedError(Exception):
    """Raised when publishing a finished video fails permanently."""


def maybe_publish_finished_videos(
    task_id: str,
    params: TaskVideoRequest,
    video_paths: list[str],
) -> list[dict[str, object]]:
    """Publish finished videos when the task carries publish metadata."""
    if params.publish is None:
        return []
    return publish_task_videos(
        task_id=task_id, params=params, video_paths=video_paths
    )


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required for remote publishing")
    return value


def to_client_metadata(
    params: PublishParams | None,
) -> upload_publisher.PublishMetadata | None:
    """Convert schema publish params into client metadata (None passthrough)."""
    if params is None:
        return None
    youtube = None
    instagram = None
    if params.youtube is not None:
        youtube = upload_publisher.YouTubeMetadata(
            title=params.youtube.title,
            description=params.youtube.description,
            tags=params.youtube.tags,
            privacy_status=params.youtube.privacy_status,
            account_ids=params.youtube.account_ids,
        )
    if params.instagram is not None:
        instagram = upload_publisher.InstagramMetadata(
            caption=params.instagram.caption,
            account_ids=params.instagram.account_ids,
        )
    bluesky = None
    if getattr(params, "bluesky", None) is not None:
        bluesky = upload_publisher.BlueskyMetadata(
            caption=params.bluesky.caption,
            account_ids=params.bluesky.account_ids,
        )
    linkedin = None
    if params.linkedin is not None:
        linkedin = upload_publisher.LinkedInMetadata(
            caption=params.linkedin.caption,
            account_ids=params.linkedin.account_ids,
        )
    return upload_publisher.validate_publish_metadata(
        providers=params.providers,
        youtube=youtube,
        instagram=instagram,
        bluesky=bluesky,
        linkedin=linkedin,
    )


def publish_task_videos(
    task_id: str,
    params: TaskVideoRequest,
    video_paths: list[str],
) -> list[dict[str, object]]:
    """Publish each final video to every selected provider.

    Results are recorded in the task state under ``publish_results``.

    Raises:
        PublishFailedError: when the upload API rejects a video. The task state
            is moved to FAILED with the upstream error preserved.
        RuntimeError: when required configuration is missing.
    """
    existing = sm.state.get_task(task_id) or {}
    if existing.get("publish_results") is not None:
        results: list[dict[str, object]] = existing["publish_results"]
        logger.info(f"task {task_id} already published, skipping publish step")
        return results

    metadata = to_client_metadata(params.publish)
    if metadata is None:
        return []

    base_url = _required_env(BASE_URL_ENV)
    api_secret = _required_env(SERVICE_KEY_ENV)
    owner = existing.get("user_id")
    if not isinstance(owner, str) or not owner:
        raise RuntimeError(
            f"task {task_id} has no owner user_id in state; cannot publish"
        )

    sm.state.update_task(
        task_id, state=const.TASK_STATE_PROCESSING, status="publishing"
    )

    results = []
    for provider in metadata.providers:
        provider_metadata = (
            metadata.youtube
            if provider == upload_publisher.YOUTUBE_PROVIDER
            else metadata.instagram
        )
        if provider_metadata is None:  # validated upstream; defensive only
            continue
        for video_path in video_paths:
            with open(video_path, "rb") as video_file:
                video_bytes = video_file.read()
            try:
                result = upload_publisher.publish_video(
                    base_url=base_url,
                    api_secret=api_secret,
                    owner_user_id=owner,
                    metadata=provider_metadata,
                    video_path=os.path.basename(video_path),
                    video_bytes=video_bytes,
                    content_type="video/mp4",
                )
            except upload_publisher.PublishError as exc:
                # Basename only: the full local path would land in the task
                # error and (via start()'s generic handler) in the Discord
                # alert — no need to disclose the server's filesystem layout.
                # The upstream response body likewise stays out of the error
                # string (it reaches Discord); it is logged server-side only.
                error = f"publish failed for {os.path.basename(video_path)}: {exc}"
                logger.error(f"task {task_id}: {error} | upstream response: {exc.response_body}")
                sm.state.update_task(
                    task_id, state=const.TASK_STATE_FAILED, error=error
                )
                raise PublishFailedError(error) from exc
            results.append({"provider": provider, "video": video_path, **result})

    sm.state.update_task(task_id, publish_results=results)
    return results
