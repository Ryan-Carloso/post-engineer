"""Publish finished videos through the internal upload API.

CI validation note: this comment line exists to exercise the
`mutation (engine)` per-PR path; it carries no behavior change.

Contract target: ``POST https://post-engineer.com/api/upload-content``
(Next.js route ``apps/web/app/api/upload-content/route.ts``).

Wire contract (multipart/form-data):
- Authentication: ``Authorization: Bearer <MONEYPRINT_API_SECRET>`` (engine).
- YouTube: ``provider=youtube``, ``video`` (file), ``title``, ``description``,
  ``tags`` (single comma-separated string), ``privacyStatus``
  (public|private|unlisted), repeated ``accountIds`` fields.
- Instagram: ``provider=instagram``, ``file`` (file), ``caption``,
  repeated ``igAccountIds`` fields.
- Bluesky: ``provider=bluesky``, ``file`` (file), ``caption``,
  repeated ``accountIds`` fields.
- LinkedIn: ``provider=linkedin``, ``video`` (file), ``caption``,
  repeated ``accountIds`` fields.

This module owns only types, validation and multipart part builders; the HTTP
transport lives in the client function of the same module.
"""

from __future__ import annotations

import io
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

VALID_PRIVACY_STATUSES: tuple[str, ...] = ("public", "private", "unlisted")
INSTAGRAM_CAPTION_MAX_LENGTH: int = 2200
BLUESKY_CAPTION_MAX_GRAPHEMES: int = 300
LINKEDIN_CAPTION_MAX_LENGTH: int = 3000

YOUTUBE_PROVIDER: str = "youtube"
INSTAGRAM_PROVIDER: str = "instagram"
BLUESKY_PROVIDER: str = "bluesky"
LINKEDIN_PROVIDER: str = "linkedin"
VALID_PROVIDERS: tuple[str, ...] = (YOUTUBE_PROVIDER, INSTAGRAM_PROVIDER, BLUESKY_PROVIDER, LINKEDIN_PROVIDER)


@dataclass
class YouTubeMetadata:
    """Fields required by the internal route for a YouTube upload."""

    title: str
    description: str
    tags: tuple[str, ...]
    privacy_status: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.tags = tuple(self.tags)
        self.account_ids = tuple(self.account_ids)


@dataclass
class InstagramMetadata:
    """Fields required by the internal route for an Instagram upload."""

    caption: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


@dataclass
class BlueskyMetadata:
    """Fields required by the internal route for a Bluesky upload."""

    caption: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


@dataclass
class LinkedInMetadata:
    """Fields required by the internal route for a LinkedIn upload."""

    caption: str
    account_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        self.account_ids = tuple(self.account_ids)


@dataclass(frozen=True)
class PublishMetadata:
    """Validated publish request for one task."""

    providers: tuple[str, ...]
    youtube: YouTubeMetadata | None = None
    instagram: InstagramMetadata | None = None
    bluesky: BlueskyMetadata | None = None
    linkedin: LinkedInMetadata | None = None


@dataclass(frozen=True)
class MultipartParts:
    """Multipart pieces for one provider request.

    ``fields`` and ``tags`` hold ``(name, value)`` tuples so repeated field
    names (``accountIds``/``igAccountIds``) stay representable; ``tags`` holds
    the single tags field kept separate only for contract-test readability.
    """

    fields: list[tuple[str, str]] = field(default_factory=list)
    tags: list[tuple[str, str]] = field(default_factory=list)


def validate_publish_metadata(
    providers: list[str] | tuple[str, ...],
    youtube: YouTubeMetadata | None,
    instagram: InstagramMetadata | None,
    bluesky: BlueskyMetadata | None = None,
    linkedin: LinkedInMetadata | None = None,
) -> PublishMetadata:
    """Validate provider selection and per-provider metadata.

    Raises:
        ValueError: when providers are unknown/empty, a selected provider has
            no metadata, or provider metadata violates the internal contract.
    """
    if not providers:
        raise ValueError("at least one publish provider is required")
    for provider in providers:
        if provider not in VALID_PROVIDERS:
            raise ValueError(f"unsupported publish provider: {provider}")

    if YOUTUBE_PROVIDER in providers:
        if youtube is None:
            raise ValueError("youtube provider requires youtube metadata")
        if not youtube.account_ids:
            raise ValueError("youtube publish requires at least one account id")
        if youtube.privacy_status not in VALID_PRIVACY_STATUSES:
            raise ValueError(
                "invalid youtube privacy status. "
                f'Use {"|".join(VALID_PRIVACY_STATUSES)}'
            )
    if INSTAGRAM_PROVIDER in providers:
        if instagram is None:
            raise ValueError("instagram provider requires instagram metadata")
        if not instagram.account_ids:
            raise ValueError("instagram publish requires at least one account id")
        if len(instagram.caption) > INSTAGRAM_CAPTION_MAX_LENGTH:
            raise ValueError(
                "instagram caption exceeds "
                f"{INSTAGRAM_CAPTION_MAX_LENGTH} characters"
            )
    if BLUESKY_PROVIDER in providers:
        if bluesky is None:
            raise ValueError("bluesky provider requires bluesky metadata")
        if not bluesky.account_ids:
            raise ValueError("bluesky publish requires at least one account id")
        if _count_graphemes(bluesky.caption) > BLUESKY_CAPTION_MAX_GRAPHEMES:
            raise ValueError("bluesky caption exceeds 300 graphemes")
    if LINKEDIN_PROVIDER in providers:
        if linkedin is None:
            raise ValueError("linkedin provider requires linkedin metadata")
        if not linkedin.account_ids:
            raise ValueError("linkedin publish requires at least one account id")
        if len(linkedin.caption) > LINKEDIN_CAPTION_MAX_LENGTH:
            raise ValueError(
                "linkedin caption exceeds "
                f"{LINKEDIN_CAPTION_MAX_LENGTH} characters"
            )

    return PublishMetadata(
        providers=tuple(providers),
        youtube=youtube,
        instagram=instagram,
        bluesky=bluesky,
        linkedin=linkedin,
    )


def build_youtube_parts(metadata: YouTubeMetadata) -> MultipartParts:
    """Build the multipart fields (file excluded) for a YouTube request."""
    return MultipartParts(
        fields=[
            ("provider", YOUTUBE_PROVIDER),
            ("title", metadata.title),
            ("description", metadata.description),
            ("privacyStatus", metadata.privacy_status),
            *(("accountIds", account_id) for account_id in metadata.account_ids),
        ],
        tags=[("tags", ",".join(metadata.tags))],
    )


def build_instagram_parts(metadata: InstagramMetadata) -> MultipartParts:
    """Build the multipart fields (file excluded) for an Instagram request."""
    return MultipartParts(
        fields=[
            ("provider", INSTAGRAM_PROVIDER),
            ("caption", metadata.caption),
            *(("igAccountIds", account_id) for account_id in metadata.account_ids),
        ],
    )


def build_bluesky_parts(metadata: BlueskyMetadata) -> MultipartParts:
    """Build the multipart fields (file excluded) for a Bluesky request."""
    return MultipartParts(
        fields=[
            ("provider", BLUESKY_PROVIDER),
            ("caption", metadata.caption),
            *(("did", account_id) for account_id in metadata.account_ids),
        ],
    )


def build_linkedin_parts(metadata: LinkedInMetadata) -> MultipartParts:
    """Build the multipart fields (file excluded) for a LinkedIn request."""
    return MultipartParts(
        fields=[
            ("provider", LINKEDIN_PROVIDER),
            ("caption", metadata.caption),
            *(("linkedinAccountIds", account_id) for account_id in metadata.account_ids),
        ],
    )


def _count_graphemes(text: str) -> int:
    """Count user-perceived characters (emoji ZWJ sequences count as one)."""
    import unicodedata
    count = 0
    previous_combining = False
    for char in text:
        if unicodedata.combining(char) or char == "\u200d":
            previous_combining = True
            continue
        if previous_combining:
            previous_combining = False
            continue
        count += 1
    return count


def truncate_bluesky_caption(caption: str) -> str:
    """Truncate a caption to 300 graphemes with an ellipsis, never breaking emoji."""
    if _count_graphemes(caption) <= BLUESKY_CAPTION_MAX_GRAPHEMES:
        return caption
    result: list[str] = []
    count = 0
    import unicodedata
    for char in caption:
        if count == BLUESKY_CAPTION_MAX_GRAPHEMES - 1:
            break
        if unicodedata.combining(char) or char == "\u200d":
            if result:
                result[-1] += char
            continue
        result.append(char)
        count += 1
    return "".join(result) + "…"


def build_video_file_part(
    fileobj: io.BufferedIOBase | io.BytesIO,
    filename: str,
    content_type: str,
    provider: str,
) -> tuple[str, io.BufferedIOBase | io.BytesIO, str]:
    """Return the file part; field name depends on the provider contract."""
    file_field = "file" if provider == INSTAGRAM_PROVIDER else "video"
    return (file_field, fileobj, content_type)


class PublishError(Exception):
    """Raised when the internal upload API rejects or fails a publish."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        response_body: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        # Upstream response body, for server logs only. Kept OUT of the
        # message: the message reaches Discord alerts (a third-party
        # service) via safe_reason, and the body is remote-controlled
        # text that could echo sensitive data (e.g. an auth page).
        self.response_body = response_body


DEFAULT_UPLOAD_PATH: str = "/api/upload-content"
DEFAULT_MAX_ATTEMPTS: int = 3
DEFAULT_TIMEOUT_SECONDS: int = 600
RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({408, 429, 500, 502, 503, 504})


_PartBuilders = dict[str, tuple[type, Callable[[Any], MultipartParts]]]

_PART_BUILDERS: _PartBuilders = {
    YOUTUBE_PROVIDER: (YouTubeMetadata, build_youtube_parts),
    INSTAGRAM_PROVIDER: (InstagramMetadata, build_instagram_parts),
    BLUESKY_PROVIDER: (BlueskyMetadata, build_bluesky_parts),
    LINKEDIN_PROVIDER: (LinkedInMetadata, build_linkedin_parts),
}


def publish_video(
    base_url: str,
    api_secret: str,
    owner_user_id: str,
    metadata: YouTubeMetadata | InstagramMetadata | BlueskyMetadata | LinkedInMetadata,
    video_path: str,
    video_bytes: bytes,
    content_type: str,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Publish one finished video through the internal upload API.

    Authenticates with the shared API secret and names the task owner via
    the ``userId`` form field — the web route accepts this only for the
    engine identity. Retries only
    transient errors (408/429/5xx) with linear backoff of ``attempt``
    seconds. Client errors (4xx auth/validation) fail immediately. The
    service key is never included in error messages.
    """
    import requests

    parts: MultipartParts | None = None
    provider = ""
    for name, (metadata_type, build_parts) in _PART_BUILDERS.items():
        if isinstance(metadata, metadata_type):
            provider = name
            parts = build_parts(metadata)
            break
    if parts is None:
        raise PublishError(f"unsupported publish metadata: {type(metadata).__name__}")
    parts.fields.append(("userId", owner_user_id))

    file_field, fileobj, file_content_type = build_video_file_part(
        fileobj=io.BytesIO(video_bytes),
        filename=video_path,
        content_type=content_type,
        provider=provider,
    )

    headers: dict[str, str] = {"Authorization": f"Bearer {api_secret}"}

    url = f"{base_url.rstrip('/')}{DEFAULT_UPLOAD_PATH}"
    last_error: PublishError | None = None
    for attempt in range(1, max_attempts + 1):
        fileobj.seek(0)
        files = {file_field: (video_path, fileobj, file_content_type)}
        try:
            response = requests.post(
                url,
                headers=headers,
                data=parts.fields + parts.tags,
                files=files,
                timeout=timeout_seconds,
            )
        except requests.RequestException as exc:
            last_error = PublishError(f"upload request failed: {type(exc).__name__}")
            if attempt < max_attempts:
                sleep(attempt)
                continue
            raise last_error from exc

        if response.status_code < 300:
            try:
                result: dict[str, Any] = response.json()
            except ValueError as exc:
                raise PublishError("upload API returned invalid JSON") from exc
            return result

        last_error = PublishError(
            f"upload API returned HTTP {response.status_code}",
            status_code=response.status_code,
            response_body=response.text[:500],
        )
        if response.status_code in RETRYABLE_STATUS_CODES and attempt < max_attempts:
            sleep(attempt)
            continue
        raise last_error

    raise last_error if last_error else PublishError("upload failed")
