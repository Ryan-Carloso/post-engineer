"""Preview images of stock candidates, the cheap input of the visual verifier.

Pexels, Pixabay and Coverr return a preview image next to every clip.
Scoring that image instead of downloading and decoding the whole clip is
what keeps visual verification at about a minute per video. The image is
optional: a candidate without a usable one is scored by its clip.

Lives in its own module because material.py is grandfathered over the
file-size cap; building the candidate here also shortens its three search
functions.
"""

from dataclasses import dataclass
from typing import Optional

from app.models.schema import MaterialInfo


@dataclass
class StockItem(MaterialInfo):
    """A stock candidate that also remembers its preview image."""

    thumbnail: str = ""


def usable(value: object) -> str:
    """The value when it is an http(s) URL string, else ""."""
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value
    return ""


def item(provider: str, url: str, duration: int, thumbnail: Optional[object] = None) -> StockItem:
    """A stock candidate; a preview that is not an http(s) URL is dropped."""
    return StockItem(provider=provider, url=url, duration=duration, thumbnail=usable(thumbnail))
