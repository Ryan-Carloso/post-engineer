import warnings
from enum import Enum
from typing import Any, List, Literal, Optional, Union
from urllib.parse import urlparse

import pydantic
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import config
from app.models import publish as publish_models

# Ignore specific Pydantic warnings
warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    message="Field name.*shadows an attribute in parent.*",
)


class VideoConcatMode(str, Enum):
    random = "random"
    sequential = "sequential"


class VideoTransitionMode(str, Enum):
    none = None
    shuffle = "Shuffle"
    fade_in = "FadeIn"
    fade_out = "FadeOut"
    slide_in = "SlideIn"
    slide_out = "SlideOut"


class LipSyncQuality(str, Enum):
    ok = "ok"
    very_good = "very-good"


class VideoLayout(str, Enum):
    """How the persona is composed with the video material during the hook."""

    standard = "standard"
    react = "react"

    @classmethod
    def values(cls) -> list[str]:
        return [item.value for item in cls]


class VideoAspect(str, Enum):
    landscape = "16:9"
    portrait = "9:16"
    square = "1:1"

    def to_resolution(self):
        if self == VideoAspect.landscape:
            return 1920, 1080
        elif self == VideoAspect.portrait:
            return 1080, 1920
        elif self == VideoAspect.square:
            return 1080, 1080
        raise ValueError(f"unsupported video aspect: {self}")


class _Config:
    arbitrary_types_allowed = True


@pydantic.dataclasses.dataclass(config=_Config)
class MaterialInfo:
    provider: str = "pexels"
    url: str = ""
    duration: int = 0


class PersonaParams(BaseModel):
    """Inline persona in the job (stateless): refs resolved by the caller.

    At most one visual identity (photo_url OR avatar_url — a person in
    faceless mode may have zero) and exactly one voice (voice_id OR
    voice_audio_url).
    """

    id: str = Field(default="", max_length=100)
    name: str = Field(default="", max_length=100)
    photo_url: Optional[str] = Field(default=None, max_length=2048)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)
    voice_id: Optional[str] = Field(default=None, max_length=200)
    voice_audio_url: Optional[str] = Field(default=None, max_length=2048)
    niche: str = Field(default="", max_length=300)
    speaking_style: str = Field(default="", max_length=500)
    audience: str = Field(default="", max_length=300)
    language: str = Field(default="pt-BR", max_length=32)

    @model_validator(mode="after")
    def _check_exclusive_fields(self):
        visuals = [self.photo_url, self.avatar_url]
        voices = [self.voice_id, self.voice_audio_url]
        if sum(v is not None for v in visuals) > 1:
            raise ValueError("at most one of photo_url or avatar_url is required")
        if sum(v is not None for v in voices) != 1:
            raise ValueError("exactly one of voice_id or voice_audio_url is required")
        return self

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Ana",
                "photo_url": "https://supabase.test/signed/foto.png",
                "voice_id": "calm",
            }
        }


class VideoParams(BaseModel):
    """
    {
      "video_subject": "",
      "video_aspect": "landscape 16:9",
      "voice_name": "female-Xiaoxiao",
      "bgm_name": "random",
      "font_name": "BeVietnamPro-Medium",
      "text_color": "#FFFFFF",
      "font_size": 60,
      "stroke_color": "#000000",
      "stroke_width": 1.5
    }
    """

    video_subject: str = Field(max_length=500)
    video_script: str = Field(default="", max_length=20000)  # Script used to generate the video
    video_terms: Optional[str | list] = None  # Keywords used to generate the video
    video_aspect: Optional[VideoAspect] = VideoAspect.portrait.value
    video_concat_mode: Optional[VideoConcatMode] = VideoConcatMode.random.value
    # How the persona meets the video material during the hook. "standard"
    # fills the frame with the avatar; "react" splits the frame in half
    # (avatar on top, the post's material below: stock or drawings). Per-request only, never config.toml: an editorial choice
    # per post, not a site-wide rendering default. The default is the enum's
    # own first member so a caller that omits the field gets the behaviour
    # every pre-existing video already had.
    video_layout: VideoLayout = VideoLayout.standard
    video_transition_mode: Optional[VideoTransitionMode] = None
    video_clip_duration: Optional[int] = Field(default=2, ge=1, le=60)
    match_materials_to_script: bool = True
    # Material choice, per request only (like video_layout, never
    # config.toml), for posts with or without a face: "broll" is stock
    # only, "svg" is only the R2 SVG catalog; the two never mix. The web
    # sends it on every post; a caller omitting it gets "broll".
    faceless_material: Literal["broll", "svg"] = "broll"
    video_materials: Optional[List[MaterialInfo]] = (
        None  # Materials used to generate the video
    )
    
    custom_audio_file: Optional[str] = None  # Custom audio file path, will ignore TTS and can still use Whisper subtitles
    video_language: Optional[str] = ""  # auto detect

    persona: Optional[PersonaParams] = None  # Inline persona (stateless, caller-resolved refs)
    lipsync_enabled: bool = config.app.get("persona_lipsync_enabled", True)  # False = persona voice only, no lip-sync intro
    # Hook/modal pacing is product-fixed in app/services/task.py
    # (PERSONA_HOOK_* / FACE_FILL_* constants) — intentionally NOT
    # config-driven: the values were validated against GPU intro cost and
    # lipsync quality windows, and tunable knobs reopen those failure modes.
    video_quality: LipSyncQuality = LipSyncQuality.ok
    platform_ids: list[str] = Field(default_factory=list)
    voice_name: Optional[str] = Field(default="", max_length=200)
    voice_volume: Optional[float] = Field(default=1.0, ge=0, le=5.0)
    voice_rate: Optional[float] = Field(default=1.0, ge=0.1, le=5.0)
    bgm_volume: Optional[float] = Field(default=0.2, ge=0, le=2.0)

    subtitle_enabled: Optional[bool] = True
    subtitle_position: Optional[str] = Field(
        default=config.ui.get("subtitle_position", "bottom"),
        max_length=64,
    )
    custom_position: float = config.ui.get("custom_position", 70.0)
    font_name: Optional[str] = Field(
        default=config.ui.get("font_name", "BeVietnamPro-Medium.ttf"),
        max_length=200,
    )
    text_fore_color: Optional[str] = Field(
        default=config.ui.get("text_fore_color", "#FFFFFF"),
        max_length=64,
    )
    text_background_color: Union[bool, str] = config.ui.get("text_background_color", True)
    rounded_subtitle_background: bool = config.ui.get("rounded_subtitle_background", False)

    font_size: int = Field(default=config.ui.get("font_size", 60), ge=8, le=300)
    stroke_color: Optional[str] = Field(
        default=config.ui.get("stroke_color", "#000000"),
        max_length=64,
    )
    stroke_width: float = Field(default=config.ui.get("stroke_width", 1.5), ge=0, le=20)
    n_threads: Optional[int] = Field(default=2, ge=1, le=64)
    paragraph_number: Optional[int] = Field(default=None, ge=1, le=10)
    # Phase 5-5: the /scripts controller is deleted, so no script prompt
    # fields remain anywhere in the request models — scripts come from
    # segments only.
    # The persona's call to action ("" = generic); 200 mirrors migration 024.
    video_cta: str = Field(default="", max_length=200)


class SubtitleRequest(BaseModel):
    video_script: str = Field(max_length=20000)
    video_language: Optional[str] = Field(default="", max_length=32)
    voice_name: Optional[str] = Field(default="en-US-GuyNeural", max_length=200)
    voice_volume: Optional[float] = Field(default=1.0, ge=0, le=5.0)
    voice_rate: Optional[float] = Field(default=1.2, ge=0.1, le=5.0)
    subtitle_position: Optional[str] = Field(
        default=config.ui.get("subtitle_position", "bottom"),
        max_length=64,
    )
    font_name: Optional[str] = Field(default="BeVietnamPro-Medium.ttf", max_length=200)
    text_fore_color: Optional[str] = Field(default="#FFFFFF", max_length=64)
    text_background_color: Union[bool, str] = True
    rounded_subtitle_background: bool = False
    font_size: int = Field(default=60, ge=8, le=300)
    stroke_color: Optional[str] = Field(default="#000000", max_length=64)
    stroke_width: float = Field(default=1.5, ge=0, le=20)
    subtitle_enabled: Optional[str] = "true"


class AudioRequest(BaseModel):
    video_script: str = Field(max_length=20000)
    video_language: Optional[str] = Field(default="", max_length=32)
    voice_name: Optional[str] = Field(default="zh-CN-XiaoxiaoNeural-Female", max_length=200)
    voice_volume: Optional[float] = Field(default=1.0, ge=0, le=5.0)
    voice_rate: Optional[float] = Field(default=1.2, ge=0.1, le=5.0)


class VideoTermsParams(BaseModel):
    """
    {
      "video_subject": "",
      "video_script": "",
      "amount": 5,
      "match_materials_to_script": false
    }
    """

    video_subject: Optional[str] = "春天的花海"
    video_script: Optional[str] = (
        "春天的花海，如诗如画般展现在眼前。万物复苏的季节里，大地披上了一袭绚丽多彩的盛装。金黄的迎春、粉嫩的樱花、洁白的梨花、艳丽的郁金香……"
    )
    amount: Optional[int] = Field(default=5, ge=1, le=50)
    match_materials_to_script: bool = False


class BaseResponse(BaseModel):
    status: int = 200
    message: Optional[str] = "success"
    body: Any = None


def _validate_webhook_url(value: Optional[str]) -> Optional[str]:
    """Shared http(s) check for optional webhook callback URLs."""
    if value is None:
        return None
    scheme = urlparse(value).scheme.lower()
    if scheme not in {"http", "https"}:
        raise ValueError("webhook_url must be an http(s) URL")
    return value


class SegmentMedia(BaseModel):
    """Media reference shape for a segment's photo (upload_media uploads it, check_media verifies it)."""

    # Unknown keys are forbidden, not stripped: the unknown-field guard in
    # validate_segments runs on model_dump output, so extra='ignore' would
    # silently drop a key like voice on the request path before the guard
    # ever sees it.
    model_config = ConfigDict(extra="forbid")

    mediaId: Optional[str] = None
    url: Optional[str] = None


class ScriptSegment(BaseModel):
    # Same reason as SegmentMedia: forbid so unknown segment keys fail
    # request validation instead of being dropped before validation.
    model_config = ConfigDict(extra="forbid")

    kind: Literal["hook", "body", "cta"]
    text: str
    media: Optional[SegmentMedia] = None
    terms: Optional[list[str]] = None


class TaskVideoRequest(VideoParams, BaseModel):
    # Optional callback fired once when the task reaches a terminal state
    # (completed/failed). Must be http(s); delivery is fire-and-forget.
    webhook_url: Optional[str] = None
    # Segments contract (MCP first, Phase 1): one call = one video. When
    # present, segments are mechanically validated and joined into
    # video_script before the task is created; a supplied video_script
    # that differs from the joined segments is rejected, never coerced.
    segments: Optional[list[ScriptSegment]] = None
    # Web-side correlation id (video_generations.generation_id). Carried
    # through the task row into PostHog events so a generation can be
    # traced end-to-end without a database lookup. Never used as the task
    # id itself — the engine keeps minting its own task ids.
    generation_id: Optional[str] = None
    slot_id: Optional[str] = None  # Web-side slot id; lets boot orphan triage requeue web tasks.

    @field_validator("webhook_url")
    @classmethod
    def _validate_task_webhook_url(cls, value: Optional[str]) -> Optional[str]:
        return _validate_webhook_url(value)

    @model_validator(mode="after")
    def _validate_segments_into_script(self) -> "TaskVideoRequest":
        if self.segments is None:
            return self
        from app.services import script_segments

        joined = script_segments.segments_to_script(
            [segment.model_dump(exclude_none=True) for segment in self.segments]
        )
        # Pydantic v2 does not re-validate on assignment: enforce the
        # video_script cap from the field metadata, not a hardcoded value.
        max_chars = next((c.max_length for c in TaskVideoRequest.model_fields["video_script"].metadata if hasattr(c, "max_length")), None)
        if max_chars is not None and len(joined) > max_chars:
            raise ValueError(f"segments join to a script longer than video_script allows ({max_chars} characters)")
        if self.video_script and self.video_script != joined:
            raise ValueError("video_script must match the segments script")
        self.video_script = joined
        return self


PublishParams = publish_models.PublishParams
YouTubePublish = publish_models.YouTubePublish
InstagramPublish = publish_models.InstagramPublish


class ContentParams(BaseModel):
    topic: str = Field(min_length=1, max_length=300)
    goal: str = Field(min_length=1, max_length=300)
    platform_ids: list[str] = Field(min_length=1, max_length=20)
    video_quality: LipSyncQuality = LipSyncQuality.ok


class TaskQueryRequest(BaseModel):
    pass


######################################################################################################
######################################################################################################
######################################################################################################
######################################################################################################
class TaskResponse(BaseResponse):
    class TaskResponseBody(BaseModel):
        task_id: str

    body: TaskResponseBody

    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {"task_id": "6c85c8cc-a77a-42b9-bc30-947815aa0558"},
            },
        }


class TaskQueryResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "state": 1,
                    "progress": 100,
                    "videos": [
                        "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/final-1.mp4"
                    ],
                    "combined_videos": [
                        "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/combined-1.mp4"
                    ],
                },
            },
        }


class TaskDeletionResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "state": 1,
                    "progress": 100,
                    "videos": [
                        "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/final-1.mp4"
                    ],
                    "combined_videos": [
                        "http://127.0.0.1:8080/tasks/6c85c8cc-a77a-42b9-bc30-947815aa0558/combined-1.mp4"
                    ],
                },
            },
        }


# Re-exported from app/models/media_responses.py (same envelope fields as
# BaseResponse); moved so this file stays under the 500-line ratchet.
from app.models.media_responses import (  # noqa: E402,F401
    BgmRetrieveResponse,
    BgmUploadResponse,
    VideoMaterialRetrieveResponse,
    VideoMaterialUploadResponse,
)
