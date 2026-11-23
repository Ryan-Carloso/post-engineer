import warnings
from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

from app.config import config
from app.utils.ssrf import UnsafeUrlError, assert_public_url
from app.models import publish as publish_models
from app.models.cta import CtaType
from app.models.segments import MAX_LIPSYNC_PHOTOS, MIN_LIPSYNC_PHOTOS, LipsyncPhoto, ScriptSegment

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


class VideoType(str, Enum):
    """The one video mode (issue #542 follow-up): it replaces the
    faceless / full_lipsync / lipsync_enabled boolean combination.

    full_lipsync: the whole narration renders as talking head; a persona
        with a photo is required. 8 tokens at face quality ok, 15 at
        very_good.
    hook_lipsync: lip sync only on the hook, then the agent's images; a
        persona with a photo is required. 2 tokens ok, 3 very_good.
    faceless: only the agent's images; a persona is optional, and when one
        is present only its voice and niche are used, never its face.
        1 token.
    """

    full_lipsync = "full_lipsync"
    hook_lipsync = "hook_lipsync"
    faceless = "faceless"


VIDEO_TYPE_ERROR_SUFFIX = "use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)"


def unknown_video_type_message(value: object) -> str:
    """Short invalid-video_type error, costs included, under 200 chars."""
    shown = str(value)[:32] if value is not None else ""
    return f"unknown video_type '{shown}'; {VIDEO_TYPE_ERROR_SUFFIX}"


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
      "video_title": "",
      "video_description": "",
      "video_aspect": "landscape 16:9",
      "voice_name": "female-Xiaoxiao",
      "bgm_name": "random",
      "font_name": "BeVietnamPro-Medium",
      "text_color": "#FFFFFF",
      "font_size": 50,
      "stroke_color": "#000000",
      "stroke_width": 1.5
    }
    """

    video_title: str = Field(min_length=1, max_length=100)
    video_description: str = Field(min_length=1, max_length=5000)

    @field_validator("video_title", "video_description", mode="before")
    @classmethod
    def _strip_publish_copy(cls, value: str) -> str:
        """Measure the trimmed text, like the overlay validator below."""
        return value.strip() if isinstance(value, str) else value

    video_type: VideoType

    @field_validator("video_type", mode="before")
    @classmethod
    def _validate_video_type(cls, value: object) -> VideoType:
        """Reject unknown types with the costs included, never coerce."""
        if isinstance(value, VideoType):
            return value
        try:
            return VideoType(value)
        except (ValueError, TypeError):
            raise ValueError(unknown_video_type_message(value)) from None

    video_script: str = Field(default="", max_length=20000)
    video_aspect: Optional[VideoAspect] = VideoAspect.portrait.value
    video_concat_mode: Optional[VideoConcatMode] = VideoConcatMode.random.value
    video_layout: VideoLayout = VideoLayout.standard
    hook_panel: bool = True
    video_transition_mode: Optional[VideoTransitionMode] = None
    video_clip_duration: Optional[int] = Field(default=2, ge=1, le=60)

    custom_audio_file: Optional[str] = None
    video_language: Optional[str] = ""

    persona: Optional[PersonaParams] = None
    lipsync_photos: Optional[list[LipsyncPhoto]] = Field(
        default=None, min_length=MIN_LIPSYNC_PHOTOS, max_length=MAX_LIPSYNC_PHOTOS
    )
    video_quality: LipSyncQuality = LipSyncQuality.ok
    platform_ids: list[str] = Field(default_factory=list)
    voice_name: Optional[str] = Field(default="", max_length=200)
    voice_volume: Optional[float] = Field(default=1.0, ge=0, le=5.0)
    voice_rate: Optional[float] = Field(default=1.0, ge=0.1, le=5.0)
    bgm_volume: Optional[float] = Field(default=0.09, ge=0, le=2.0)
    music_mood: Optional[str] = Field(default=None, max_length=64)

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

    font_size: int = Field(default=config.ui.get("font_size", 50), ge=8, le=300)
    stroke_color: Optional[str] = Field(
        default=config.ui.get("stroke_color", "#000000"),
        max_length=64,
    )
    stroke_width: float = Field(default=config.ui.get("stroke_width", 1.5), ge=0, le=20)
    n_threads: Optional[int] = Field(default=2, ge=1, le=64)
    paragraph_number: Optional[int] = Field(default=None, ge=1, le=10)


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
    font_size: int = Field(default=50, ge=8, le=300)
    stroke_color: Optional[str] = Field(default="#000000", max_length=64)
    stroke_width: float = Field(default=1.5, ge=0, le=20)
    subtitle_enabled: Optional[str] = "true"


class AudioRequest(BaseModel):
    video_script: str = Field(max_length=20000)
    video_language: Optional[str] = Field(default="", max_length=32)
    voice_name: Optional[str] = Field(default="zh-CN-XiaoxiaoNeural-Female", max_length=200)
    voice_volume: Optional[float] = Field(default=1.0, ge=0, le=5.0)
    voice_rate: Optional[float] = Field(default=1.2, ge=0.1, le=5.0)


class BaseResponse(BaseModel):
    status: int = 200
    message: Optional[str] = "success"
    body: Any = None


def _validate_webhook_url(value: Optional[str]) -> Optional[str]:
    """Reject a webhook that is not a public https URL (shape-only: no DNS;
    assert_public_url documents why, and delivery resolves and pins)."""
    if value is None:
        return None
    try:
        assert_public_url(value, what="webhook_url", https_only=True, resolve_host=False)
    except UnsafeUrlError as exc:
        raise ValueError(str(exc)) from exc
    return value


class TaskVideoRequest(VideoParams, BaseModel):
    webhook_url: Optional[str] = None
    segments: Optional[list[ScriptSegment]] = None
    cta_type: Optional[CtaType] = None
    generation_id: Optional[str] = None
    slot_id: Optional[str] = None

    @field_validator("webhook_url")
    @classmethod
    def _validate_task_webhook_url(cls, value: Optional[str]) -> Optional[str]:
        return _validate_webhook_url(value)

    @model_validator(mode="after")
    def _validate_video_type_persona(self) -> "TaskVideoRequest":
        if self.video_type in (VideoType.full_lipsync, VideoType.hook_lipsync) and self.persona is None:
            raise ValueError(f"{self.video_type.value} requires a persona with a photo")
        return self

    @model_validator(mode="after")
    def _validate_lipsync_photos(self) -> "TaskVideoRequest":
        photos = self.lipsync_photos
        if self.video_type != VideoType.full_lipsync:
            if photos is not None:
                raise ValueError("lipsync_photos is only accepted for full_lipsync")
            return self
        if photos is None:
            raise ValueError(
                f"full_lipsync requires lipsync_photos: {MIN_LIPSYNC_PHOTOS}-{MAX_LIPSYNC_PHOTOS} "
                "different face photos of the persona, one per 12s window"
            )
        refs = [(photo.mediaId, photo.url) for photo in photos]
        if len(set(refs)) != len(refs):
            raise ValueError("lipsync_photos must all be different photos")
        return self

    @model_validator(mode="after")
    def _validate_segments_into_script(self) -> "TaskVideoRequest":
        if self.segments is None:
            return self
        from app.services import script_segments

        dumped = [segment.model_dump(exclude_none=True) for segment in self.segments]
        joined = script_segments.segments_to_script(
            dumped,
            video_type=self.video_type,
        )
        max_chars = next((c.max_length for c in TaskVideoRequest.model_fields["video_script"].metadata if hasattr(c, "max_length")), None)
        if max_chars is not None and len(joined) > max_chars:
            raise ValueError(f"segments join to a script longer than video_script allows ({max_chars} characters)")
        if self.video_script and self.video_script != joined:
            raise ValueError("video_script must match the segments script")
        from app.services import cta_validation

        cta_validation.validate_cta_take(dumped, self.cta_type)
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

