"""Per-persona CTA intent (issue #639): the persona stores an intent, never wording."""

from enum import Enum


class CtaType(str, Enum):
    """The seven CTA intents a persona can carry.

    follow/comment/share/save carry no facts; link/buy carry a URL;
    other carries a free-text instruction. The wording is written per
    video by the agent from the video's topic, never stored.
    """

    follow = "follow"
    comment = "comment"
    share = "share"
    save = "save"
    link = "link"
    buy = "buy"
    other = "other"

    @classmethod
    def values(cls) -> list[str]:
        return [item.value for item in cls]
