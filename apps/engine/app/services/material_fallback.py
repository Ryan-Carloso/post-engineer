"""Resolve one material item to a clip, degrading to neutral on failure.

Both download loops (flat and script-order) share this helper so a failed
render never silently loses a segment when verification is on: verified
stock, catalog SVGs, and face-discarded downloads all degrade to the
neutral clip, which implies no subject. With verification off, failures
keep the old behaviour (empty path, caller skips the item).

A render failure is logged as a warning with the provider and the
exception type only — no URLs, paths, or phrases — so a missing R2 asset
still leaves a trace between the selection log and the neutral clip.
The neutral retry never raises: if its render fails, render_neutral_clip
logs a warning and returns "", and the caller skips the segment.
"""

from __future__ import annotations

from loguru import logger

from app.models.schema import MaterialInfo, VideoAspect
from app.services import material_verification, svg_material


def resolve_with_neutral_fallback(
    item: MaterialInfo,
    material_directory: str,
    max_clip_duration: int,
    exclude_faces: bool | None,
    video_aspect: VideoAspect,
    verification_enabled: bool,
) -> str:
    """Render one item, or its neutral clip when verification is on.

    Returns "" when the item cannot be rendered and no neutral retry
    applies (verification off, or the item already is neutral).
    """
    try:
        saved_video_path = svg_material.resolve_material_path(
            item,
            material_directory,
            max_clip_duration,
            exclude_faces,
            video_aspect,
        )
    except Exception as exc:
        logger.warning(
            f"material render failed for provider={item.provider} "
            f"({type(exc).__name__}), degrading to neutral"
        )
        saved_video_path = ""
    if not saved_video_path and verification_enabled and item.provider != "neutral":
        saved_video_path = svg_material.resolve_material_path(
            material_verification.neutral_item_for(item),
            material_directory,
            max_clip_duration,
            exclude_faces,
            video_aspect,
        )
    return saved_video_path
