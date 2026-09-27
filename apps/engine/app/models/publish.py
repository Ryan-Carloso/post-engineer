"""Publish metadata models for task requests (YouTube / Instagram)."""

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


class PublishParams(BaseModel):
    """Optional publish selection for a task (YouTube/Instagram/Bluesky/LinkedIn)."""

    providers: list[Literal["youtube", "instagram", "bluesky", "linkedin"]] = Field(min_length=1)
    youtube: Optional[YouTubePublish] = None
    instagram: Optional[InstagramPublish] = None
    bluesky: Optional["BlueskyPublish"] = None
    linkedin: Optional[LinkedInPublish] = None

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
        return self
