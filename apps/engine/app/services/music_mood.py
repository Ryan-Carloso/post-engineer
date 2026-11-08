"""Background-music mood resolution and reporting (issue #489).

The mood is agent-supplied per request (``VideoParams.music_mood``):

- ``"none"`` — an explicit no-music choice; the catalog is never consulted.
- ``None`` — the default: the first catalogued mood (deterministic, sorted).
- any other value — must name a catalogued mood. The API rejects unknown
  moods with 400 (``validate_music_mood``); if one still reaches the
  pipeline, ``resolve_music_mood`` raises and the task fails loudly at the
  ``music_mood`` stage instead of rendering silent.

A video must never render silent by accident: an empty catalog is an ERROR
(the ``asgi.py`` sink forwards ERROR+ loguru records to PostHog as
``$exception``), never a quiet fallback to no music.
"""

import os
from typing import cast

import toml
from loguru import logger

from app.config import config
from app.models.schema import VideoParams
from app.services.analytics import scrub_error_text
from app.utils import utils

# Explicit no-music choice. The API contract spells it as the literal
# "none"; the constant pins the value inside this module.
MUSIC_MOOD_NONE = "none"


def get_available_music_moods(catalog_file: str | None = None) -> tuple[str, ...]:
    """Return the unique music moods declared by the BGM catalog."""
    configured_catalog = catalog_file or config.bgm.get(
        "catalog_file", os.path.join(utils.root_dir(), "resource", "songs", "catalog.toml")
    )
    resolved_catalog = str(configured_catalog)
    if not os.path.isabs(resolved_catalog):
        resolved_catalog = os.path.join(utils.root_dir(), resolved_catalog)

    try:
        catalog = toml.load(resolved_catalog)
    except (OSError, toml.TomlDecodeError) as exc:
        # Scrubbed: the resolved path is absolute, and the OSError text
        # carries it too — no machine layout in the logs.
        logger.warning(
            scrub_error_text(
                f"failed to load BGM moods: {resolved_catalog}, error: {str(exc)}"
            )
        )
        return ()

    tracks = catalog.get("tracks", [])
    if not isinstance(tracks, list):
        return ()

    moods: set[str] = set()
    for raw_track in tracks:
        if not isinstance(raw_track, dict):
            continue
        track = cast(dict[str, object], raw_track)
        raw_moods = track.get("moods")
        if not isinstance(raw_moods, list):
            continue
        moods.update(
            mood
            for mood in raw_moods
            if isinstance(mood, str) and mood and mood not in {"auto", "none"}
        )
    return tuple(sorted(moods))


def validate_music_mood(music_mood: str | None) -> None:
    """Raise ``ValueError`` for a mood the catalog does not offer.

    ``None`` and ``"none"`` need no catalog. An empty catalog cannot
    validate anything — the render-time resolution reports that as an
    ERROR instead of failing the request.
    """
    if music_mood is None or music_mood == MUSIC_MOOD_NONE:
        return
    moods = get_available_music_moods()
    if moods and music_mood not in moods:
        raise ValueError(
            f"unknown music mood: {music_mood!r}; available moods: {', '.join(moods)}"
        )


def resolve_music_mood(params: VideoParams) -> str:
    """Resolve the effective BGM mood for a video request.

    ``"none"`` passes through untouched, a named mood passes through
    once validated, and an omitted mood defaults to the first catalogued
    mood. An empty catalog is an ERROR and renders without music — loud,
    never silent. An unknown mood with a non-empty catalog raises
    ``ValueError`` so the pipeline fails at the ``music_mood`` stage.
    """
    requested = params.music_mood
    if requested == MUSIC_MOOD_NONE:
        return MUSIC_MOOD_NONE
    moods = get_available_music_moods()
    if requested is not None:
        if requested in moods:
            return requested
        if not moods:
            # Scrubbed: the requested mood is agent-supplied free text and
            # this ERROR is forwarded to PostHog as $exception.
            logger.error(
                scrub_error_text(
                    f"BGM catalog is empty: cannot play requested mood {requested!r}; "
                    "rendering without music"
                )
            )
            return MUSIC_MOOD_NONE
        raise ValueError(
            f"unknown music mood: {requested!r}; available moods: {', '.join(moods)}"
        )
    if not moods:
        # Static message: no free text, no path — nothing to scrub.
        logger.error("BGM catalog is empty: no mood available; rendering without music")
        return MUSIC_MOOD_NONE
    return sorted(moods)[0]


def log_bgm_selection(music_mood: str, catalog: str, selected_file: str) -> None:
    """Log which BGM track was picked for a mood.

    A requested mood with no track in the catalog is an ERROR (forwarded
    to PostHog as ``$exception``); ``"none"`` is an explicit choice and
    logs at INFO only.
    """
    if music_mood == MUSIC_MOOD_NONE:
        logger.info("BGM selection: mood='none' (explicit no-music choice)")
        return
    if not selected_file:
        # Scrubbed: the ERROR is forwarded to PostHog as $exception, and
        # the catalog path is absolute — no machine layout in analytics.
        logger.error(
            scrub_error_text(
                f"BGM selection failed: mood={music_mood!r} has no track in catalog "
                f"{catalog!r}; rendering without music"
            )
        )
        return
    logger.info(
        scrub_error_text(
            f"BGM selection: mood={music_mood!r}, catalog={catalog!r}, selected={selected_file!r}"
        )
    )
