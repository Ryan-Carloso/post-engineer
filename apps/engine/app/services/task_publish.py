"""Publish finished task videos through the internal upload API.

Bridges the task lifecycle (``task.start``) to ``upload_publisher``: converts
schema publish params to client metadata, enforces explicit configuration,
publishes each final video to every selected provider and records results in
the task state.

One provider failing does not cancel the others. Each result is
``status`` ``"published"`` or ``"failed"``. An HTTP 200 whose body reports
``success: false``, or whose per-account ``results`` are all unsuccessful,
is a failed provider — the upstream body stays in the server log, not in
the task error (that string reaches Discord). The task fails only when
every attempted provider failed. An empty result list (nothing was
attempted) is persisted and returned without failing the task. When some
providers publish and others fail, the engine emits
``video_publish_partial_failure`` and a Discord alert naming the failed
providers.

Idempotency: if the task state already carries ``publish_results`` the publish
is skipped, so retries/timeouts never double-post.
"""

from __future__ import annotations

import os
from typing import Any

from loguru import logger

from app.models import const
from app.models.publish import PublishParams
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from app.services import upload_publisher
from app.services import video_storage
from app.services.analytics import track_event
from app.services.notify import partial_publish_msg, send_discord

BASE_URL_ENV: str = "MPT_UPLOAD_API_BASE_URL"
SERVICE_KEY_ENV: str = "MONEYPRINT_API_SECRET"


class PublishFailedError(Exception):
    """Raised when publishing a finished video fails permanently."""


def dispatch_publish_params(body: object) -> dict[str, Any]:
    """update_task() kwargs carrying the persisted publish plan.

    Task params are otherwise in-process only, so a restart would lose
    the publish destination; persisting ``publish_params`` on the task
    row lets the boot orphan triage finish an interrupted publish
    (orphan_requeue.complete_publish_orphan). PublishParams carries
    titles/descriptions/account ids — no secret-shaped fields.
    """
    if isinstance(body, TaskVideoRequest) and body.publish is not None:
        return {"publish_params": body.publish.model_dump(mode="json")}
    return {}


def maybe_publish_finished_videos(
    task_id: str,
    params: TaskVideoRequest,
    video_paths: list[str],
) -> list[dict[str, object]]:
    """Publish finished videos when the task carries publish metadata."""
    if params.publish is None:
        return []
    return publish_videos(task_id=task_id, publish=params.publish, video_paths=video_paths)


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


def publish_videos(
    task_id: str,
    publish: PublishParams,
    video_paths: list[str],
) -> list[dict[str, object]]:
    """Publish finished videos with explicit publish params.

    Takes the plan persisted at dispatch (task params are otherwise
    in-process only) so the boot orphan triage can finish a publish
    interrupted by a restart.

    Results are recorded in the task state under ``publish_results`` —
    one entry per (provider, video) with ``status`` ``"published"`` or
    ``"failed"``. A provider failure is recorded, not fatal: the loop
    continues with the remaining providers, so one provider being down
    never cancels the others. Application-level failures (HTTP 200 with
    ``success: false``, or a non-empty ``results`` list in which every
    account failed) are failed entries too.

    An empty ``results`` list means nothing was attempted. It is stored
    and returned; it does not fail the task.

    Raises:
        PublishFailedError: when at least one provider was attempted and
            every one of them failed. The task state is moved to FAILED.
            The error names each provider and keeps the basename only —
            no local path and no upstream body. Partial success (at least
            one provider published) returns normally after a partial-failure
            alert that lists the providers that failed.
        RuntimeError: when required configuration is missing.
    """
    existing = sm.state.get_task(task_id) or {}
    if existing.get("publish_results") is not None:
        prior_results = existing["publish_results"]
        logger.info(f"task {task_id} already published, skipping publish step")
        return prior_results

    metadata = to_client_metadata(publish)
    if metadata is None:
        return []

    base_url = _required_env(BASE_URL_ENV)
    api_secret = _required_env(SERVICE_KEY_ENV)
    owner = existing.get("user_id")
    if not isinstance(owner, str) or not owner:
        raise RuntimeError(
            f"task {task_id} has no owner user_id in state; cannot publish"
        )

    # Resilient write: losing the publishing marker is harmless, but the
    # FAILED and publish_results writes below must not be silently lost
    # (a lost publish_results defeats the already-published idempotency
    # check above and re-publishes).
    sm.persist_state_update(
        sm.state, task_id, state=const.TASK_STATE_PROCESSING, status="publishing"
    )

    results: list[dict[str, object]] = []
    object_path = existing.get("video_storage_path")
    if not isinstance(object_path, str) or not object_path:
        raise RuntimeError(f"task {task_id} has no verified R2 video archive")
    video_bytes = video_storage.read_final_video_r2(object_path)
    provider_metadata_by_name = {
        upload_publisher.YOUTUBE_PROVIDER: metadata.youtube,
        upload_publisher.INSTAGRAM_PROVIDER: metadata.instagram,
        upload_publisher.BLUESKY_PROVIDER: metadata.bluesky,
        upload_publisher.LINKEDIN_PROVIDER: metadata.linkedin,
    }
    for provider in metadata.providers:
        provider_metadata = provider_metadata_by_name.get(provider)
        if provider_metadata is None:  # validated upstream; defensive only
            continue
        for video_path in video_paths:
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
                # One provider failing must not cancel the others: record
                # the failure and keep going. Basename only: the full local
                # path would land in the task error and (via start()'s
                # generic handler) in the Discord alert — no need to
                # disclose the server's filesystem layout. The upstream
                # response body likewise stays out of the error string (it
                # reaches Discord); it is logged server-side only.
                # The provider name is part of the error so an all-fail
                # aggregate can say which provider each failure belongs to.
                video_name = os.path.basename(video_path)
                error = f"{provider}: publish failed for {video_name}: {exc}"
                logger.error(
                    f"task {task_id}: {error} | upstream response: {exc.response_body}"
                )
                results.append(
                    {
                        "provider": provider,
                        "video": video_name,
                        "status": "failed",
                        "error": error,
                    }
                )
                continue
            # Spread the upstream body first so a provider/status/video
            # field in the response cannot overwrite the engine's values.
            results.append(
                {
                    **result,
                    "provider": provider,
                    "video": video_path,
                    "status": "published",
                }
            )

    published = _providers_with_status(results, "published")
    failed = _providers_with_status(results, "failed")

    # Nothing attempted (no videos, or every provider skipped): the
    # pre-change contract persisted [] and returned. An empty list is
    # not "every provider failed".
    if not results:
        sm.persist_state_update(sm.state, task_id, publish_results=results)
        return results

    # Only when every attempted provider failed does the task itself fail.
    if not published:
        failures = "; ".join(str(entry.get("error", "unknown")) for entry in results)
        error = f"publish failed for all providers: {failures}"
        sm.persist_state_update(
            sm.state, task_id, state=const.TASK_STATE_FAILED, error=error
        )
        raise PublishFailedError(error)

    # Partial success is a success: the task completes and the per-provider
    # results let the UI show which providers published and which failed.
    # Persist first so a telemetry hiccup cannot drop the idempotency
    # marker and cause a retry to post again.
    sm.persist_state_update(sm.state, task_id, publish_results=results)
    if failed:
        _emit_partial_publish_failure(task_id, owner, failed, published)
    return results


def _providers_with_status(results: list[dict[str, object]], status: str) -> list[str]:
    """Provider names with ``status``, first-seen order, duplicates dropped."""
    seen: list[str] = []
    for entry in results:
        if entry.get("status") != status:
            continue
        provider = entry.get("provider")
        if not isinstance(provider, str) or not provider or provider in seen:
            continue
        seen.append(provider)
    return seen


def _emit_partial_publish_failure(
    task_id: str,
    owner: str,
    failed_providers: list[str],
    published_providers: list[str],
) -> None:
    """Alert that some providers failed while others published.

    Provider names only. The task completed, so this is not
    ``video_generation_failed`` and it does not mark the task FAILED.
    ``track_event`` and ``send_discord`` never raise.
    """
    track_event(
        "video_publish_partial_failure",
        {
            "task_id": task_id,
            "user_id": owner,
            "failed_providers": failed_providers,
            "published_providers": published_providers,
        },
    )
    send_discord(partial_publish_msg(task_id, failed_providers))
