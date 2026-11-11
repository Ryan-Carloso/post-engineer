"""Publish metadata models for task requests (YouTube / Instagram / Bluesky / LinkedIn / Threads / Facebook / Pinterest / 3Speak / Rumble / Fanvue)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class YouTubePublish(BaseModel):
    """YouTube publish fields required by the internal upload API."""

    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    tags: list[str] = Field(min_length=1)
    privacy_status: Literal["public", "private", "unlisted"] = "public"
    account_ids: list[str] = Field(min_length=1)


class InstagramPublish(BaseModel):
    """Instagram publish fields required by the internal upload API."""

    caption: str = Field(min_length=1, max_length=2200)
    account_ids: list[str] = Field(min_length=1)


class BlueskyPublish(BaseModel):
    """Bluesky publish fields required by the internal upload API."""

    caption: str = Field(min_length=1, max_length=300)
    account_ids: list[str] = Field(min_length=1)


class LinkedInPublish(BaseModel):
    """LinkedIn publish fields required by the internal upload API."""

    caption: str = Field(min_length=1)
    account_ids: list[str] = Field(min_length=1)


class ThreadsPublish(BaseModel):
    """Threads publish fields required by the internal upload API."""

    caption: str = Field(min_length=1, max_length=500)
    account_ids: list[str] = Field(min_length=1)


class FacebookPublish(BaseModel):
    """Facebook Page publish fields required by the internal upload API."""

    caption: str = Field(min_length=1, max_length=63206)
    account_ids: list[str] = Field(min_length=1)


class PinterestPublish(BaseModel):
    """Pinterest publish fields required by the internal upload API."""

    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=800)
    board_id: str = Field(min_length=1)
    account_ids: list[str] = Field(min_length=1)


class ThreespeakPublish(BaseModel):
    """3Speak publish fields required by the internal upload API.

    No caption cap: 3Speak has no documented one, so only non-empty is
    enforced (the web route requires a caption too).
    """

    caption: str = Field(min_length=1)
    account_ids: list[str] = Field(min_length=1)


class RumblePublish(BaseModel):
    """Rumble publish fields required by the internal upload API."""

    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1)
    account_ids: list[str] = Field(min_length=1)


class FanvuePublish(BaseModel):
    """Fanvue publish fields required by the internal upload API."""

    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=800)
    account_ids: list[str] = Field(min_length=1)


class PublishParams(BaseModel):
    """Optional publish selection for a task (YouTube/Instagram/Bluesky/LinkedIn/Threads/Facebook/Pinterest/3Speak/Rumble/Fanvue)."""

    providers: list[
        Literal["youtube", "instagram", "bluesky", "linkedin", "threads", "facebook", "pinterest", "3speak", "rumble", "fanvue"]
    ] = Field(min_length=1)
    youtube: Optional[YouTubePublish] = None
    instagram: Optional[InstagramPublish] = None
    bluesky: Optional["BlueskyPublish"] = None
    linkedin: Optional[LinkedInPublish] = None
    threads: Optional[ThreadsPublish] = None
    facebook: Optional[FacebookPublish] = None
    pinterest: Optional[PinterestPublish] = None
    threespeak: Optional[ThreespeakPublish] = None
    rumble: Optional[RumblePublish] = None
    fanvue: Optional[FanvuePublish] = None

    @model_validator(mode="after")
    def check_provider_metadata(self) -> "PublishParams":
        if "youtube" in self.providers and self.youtube is None:
            raise ValueError("youtube provider requires youtube metadata")
        if "instagram" in self.providers and self.instagram is None:
            raise ValueError("instagram provider requires instagram metadata")
        if "bluesky" in self.providers and self.bluesky is None:
            raise ValueError("bluesky provider requires bluesky metadata")
        if "linkedin" in self.providers and self.linkedin is None:
            raise ValueError("linkedin provider requires linkedin metadata")
        if "threads" in self.providers and self.threads is None:
            raise ValueError("threads provider requires threads metadata")
        if "facebook" in self.providers and self.facebook is None:
            raise ValueError("facebook provider requires facebook metadata")
        if "pinterest" in self.providers and self.pinterest is None:
            raise ValueError("pinterest provider requires pinterest metadata")
        if "3speak" in self.providers and self.threespeak is None:
            raise ValueError("3speak provider requires 3speak metadata")
        if "rumble" in self.providers and self.rumble is None:
            raise ValueError("rumble provider requires rumble metadata")
        if "fanvue" in self.providers and self.fanvue is None:
            raise ValueError("fanvue provider requires fanvue metadata")
        return self
