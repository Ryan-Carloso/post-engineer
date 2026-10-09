import warnings
from enum import Enum
from typing import Any, List, Optional, Union
from urllib.parse import urlparse

import pydantic
from pydantic import BaseModel, Field, field_validator, model_validator

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
    video_transition_mode: Optional[VideoTransitionMode] = None
    video_clip_duration: Optional[int] = Field(default=2, ge=1, le=60)
    match_materials_to_script: bool = True
    # Material source selection is fixed engine-side: pexels, pixabay and
    # coverr in per-task shuffled order (random start, then cascading), with
    # a single 1-video output per task. No API or config override exists.
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
    video_script_prompt: str = Field(
        default=config.app.get("default_video_script_prompt", ""),
        max_length=2000,
    )
    custom_system_prompt: str = Field(default="", max_length=8000)


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


class VideoScriptParams:
    """
    {
      "video_subject": "春天的花海",
      "video_language": "",
      "paragraph_number": null,
      "video_script_prompt": "",
      "custom_system_prompt": ""
    }
    """

    video_subject: Optional[str] = "春天的花海"
    video_language: Optional[str] = ""
    paragraph_number: Optional[int] = Field(default=None, ge=1, le=10)
    video_script_prompt: str = Field(default="", max_length=2000)
    custom_system_prompt: str = Field(default="", max_length=8000)


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


class VideoSocialMetadataParams:
    """
    {
      "video_subject": "A day in Shanghai",
      "video_script": "",
      "language": "auto",
      "platform": "tiktok"
    }
    """

    video_subject: Optional[str] = Field(default="A day in Shanghai", max_length=500)
    video_script: Optional[str] = Field(default="", max_length=8000)
    language: Optional[str] = Field(default="auto", max_length=64)
    platform: Optional[str] = Field(default="tiktok", max_length=64)


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


class TaskVideoRequest(VideoParams, BaseModel):
    publish: Optional[publish_models.PublishParams] = None
    # Optional callback fired once when the task reaches a terminal state
    # (completed/failed). Must be http(s); delivery is fire-and-forget.
    webhook_url: Optional[str] = None
    # Web-side correlation id (video_generations.generation_id). Carried
    # through the task row into PostHog events so a generation can be
    # traced end-to-end without a database lookup. Never used as the task
    # id itself — the engine keeps minting its own task ids.
    generation_id: Optional[str] = None

    @field_validator("webhook_url")
    @classmethod
    def _validate_task_webhook_url(cls, value: Optional[str]) -> Optional[str]:
        return _validate_webhook_url(value)


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


class VideoScriptRequest(VideoScriptParams, BaseModel):
    pass


class VideoTermsRequest(VideoTermsParams, BaseModel):
    pass


class VideoSocialMetadataRequest(VideoSocialMetadataParams, BaseModel):
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


class VideoScriptResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "video_script": "春天的花海，是大自然的一幅美丽画卷。在这个季节里，大地复苏，万物生长，花朵争相绽放，形成了一片五彩斑斓的花海..."
                },
            },
        }


class VideoTermsResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {"video_terms": ["sky", "tree"]},
            },
        }


class VideoSocialMetadataResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "title": "A Day in Shanghai You Should Not Miss",
                    "caption": "Save this quick Shanghai inspiration and follow for more short travel ideas.",
                    "hashtags": ["#shorts", "#travel", "#shanghai", "#viral", "#fyp"],
                },
            },
        }


class BgmRetrieveResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "files": [
                        {
                            "name": "output013.mp3",
                            "size": 1891269,
                            "file": "/post-engineer/resource/songs/output013.mp3",
                        }
                    ]
                },
            },
        }


class BgmUploadResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {"file": "/post-engineer/resource/songs/example.mp3"},
            },
        }

class VideoMaterialRetrieveResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "files": [
                        {
                            "name": "example.mp4",
                            "size": 12345678,
                            "file": "/post-engineer/resource/videos/example.mp4",
                        }
                    ]
                },
            },
        }

class VideoMaterialUploadResponse(BaseResponse):
    class Config:
        json_schema_extra = {
            "example": {
                "status": 200,
                "message": "success",
                "body": {
                    "file": "/post-engineer/resource/videos/example.mp4",
                },
            },
        }
