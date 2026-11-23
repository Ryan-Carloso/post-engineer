"""Script segment models (moved out of app/models/schema.py so that file
stays under the 500-line ratchet; schema.py re-exports only ScriptSegment,
import the other names from this module)."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.script_segments import (
    MAX_IMAGES_MODE_MEDIAS,
    MAX_OVERLAY_BADGE_CHARS,
    MAX_OVERLAY_SUBTITLE_CHARS,
    MAX_OVERLAY_TITLE_CHARS,
)
from app.services.segment_photo_duration import (
    MAX_REQUESTED_PHOTO_SECONDS,
    MIN_REQUESTED_PHOTO_SECONDS,
    duration_error,
)


class SegmentOverlay(BaseModel):
    """Info card painted inside a segment photo's panel: real name, address, price."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=MAX_OVERLAY_TITLE_CHARS)
    subtitle: Optional[str] = Field(default=None, min_length=1, max_length=MAX_OVERLAY_SUBTITLE_CHARS)
    badge: Optional[str] = Field(default=None, min_length=1, max_length=MAX_OVERLAY_BADGE_CHARS)

    @field_validator("title", "subtitle", "badge", mode="before")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> Optional[str]:
        """Measure the trimmed text, like check_script (action: validate) and the TS validators."""
        return value.strip() if isinstance(value, str) else value


class SegmentMedia(BaseModel):
    """Media reference shape for a segment's photo (media (action: upload) uploads it, media (action: check) verifies it)."""

    model_config = ConfigDict(extra="forbid")

    mediaId: Optional[str] = None
    url: Optional[str] = None
    overlay: Optional["SegmentOverlay"] = None
    duration: Optional[float] = Field(
        default=None, ge=MIN_REQUESTED_PHOTO_SECONDS, le=MAX_REQUESTED_PHOTO_SECONDS
    )

    @field_validator("duration", mode="before")
    @classmethod
    def _validate_duration(cls, value: Any) -> Any:
        error = duration_error(value)
        if error is not None:
            raise ValueError(error[0])
        return value


class ScriptSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["hook", "content"]
    text: str
    cta: bool = False
    media: Optional[list[SegmentMedia]] = Field(None, max_length=MAX_IMAGES_MODE_MEDIAS)


MIN_LIPSYNC_PHOTOS = 2
MAX_LIPSYNC_PHOTOS = 5


class LipsyncPhoto(BaseModel):
    """One face photo of the persona for full lip sync: a mediaId (media (action: upload)) or a public image url.

    Full lip sync renders the narration as windows of at most 12s; window i
    shows lipsync_photos[i % len(lipsync_photos)].
    """

    model_config = ConfigDict(extra="forbid")

    mediaId: Optional[str] = Field(default=None, min_length=1, max_length=100)
    url: Optional[str] = Field(default=None, min_length=1, max_length=2048)

    @model_validator(mode="after")
    def _exactly_one_ref(self) -> "LipsyncPhoto":
        if (self.mediaId is None) == (self.url is None):
            raise ValueError("each lipsync photo needs exactly one of mediaId or url")
        return self
