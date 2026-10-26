"""Verified stock material selection with thematic SVG fallback.

Stock is verified only when a scorer clears it: the best candidate must
reach the minimum score and beat the runner-up by the margin. Scores are
relative, never probabilities; unscored candidates are never verified.

Fallback order, never using rejected stock or misleading assets:
1. Thematic SVG from the explicit subject-to-asset mapping.
2. Broader-category SVG: semantically compatible, same domain, no
   contradictory entity, no identifiable wrong place.
3. Reused SVG: the most recent compatible background, only when its
   subject matches and it was not already used in the current video.
4. Neutral background: stylized and abstract, implying no specific
   subject (no skyline, no dish, no text, no identifiable place).

SVG selection uses the explicit mapping, never the catalog text search.
Scoring is pluggable through an option (the repo's injection pattern).
The default scorer is lazy ONNX: without onnxruntime and a SigLIP model
it raises VerificationUnavailable, so stock is treated as unverified.
Scoring is fail-closed. Deploy step still owed: onnxruntime, a SigLIP
ONNX model, and frame sampling wired into OnnxClipScorer.score.

This module also owns the aspect/resolution helpers moved out of
material.py, which is grandfathered over the file-size cap: material.py
re-exports them, so existing callers keep working.
"""

from __future__ import annotations

import math
import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence

from loguru import logger

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect
from app.services.analytics import track_event

# A clip is only used when letterboxing it against the target aspect
# stays within this ceiling. Side bars (pillarbox) are always rejected.
MAX_LETTERBOX_BARS = 0.35
MAX_SOURCE_LONG_EDGE = 1920


def _source_resolution_allowed(width: int, height: int) -> bool:
    """Reject 4K source files before downloading them to the CPU worker."""
    return max(width, height) <= MAX_SOURCE_LONG_EDGE


def _ratio_matches(width: int, height: int, aspect: VideoAspect) -> bool:
    """True when letterboxing stays within the bar ceiling. Side bars
    and missing/zero dimensions reject immediately."""
    if width <= 0 or height <= 0:
        return False
    file_ratio = width / height
    target_w, target_h = aspect.to_resolution()
    target_ratio = target_w / target_h
    if file_ratio < target_ratio:
        return False
    return 1 - target_ratio / file_ratio <= MAX_LETTERBOX_BARS


class VerificationUnavailable(Exception):
    """The scorer cannot run (missing dependency or model)."""


# Initial calibrated values, derived from the four known cases on the
# scorer's relative scale: verified Porto scores above the threshold and
# the three known mismatches score below it. The threshold sits between
# the highest mismatch and the verified case; the margin is smaller than
# the verified case's lead over its runner-up. These values are tied to
# the scoring model: recalibrate them when the model changes, using the
# same four cases as the calibration set.
DEFAULT_MIN_SCORE = 0.33
DEFAULT_RUNNER_UP_MARGIN = 0.05

TIER_STOCK_VERIFIED = "stock_verified"
TIER_SVG_THEMATIC = "svg_thematic"
TIER_SVG_BROADER = "svg_broader"
TIER_SVG_REUSED = "svg_reused"
TIER_NEUTRAL = "neutral"
ALL_TIERS = (
    TIER_STOCK_VERIFIED,
    TIER_SVG_THEMATIC,
    TIER_SVG_BROADER,
    TIER_SVG_REUSED,
    TIER_NEUTRAL,
)


@dataclass(frozen=True)
class VerificationConfig:
    """Verification thresholds, read from config with safe defaults."""

    enabled: bool = False
    min_score: float = DEFAULT_MIN_SCORE
    runner_up_margin: float = DEFAULT_RUNNER_UP_MARGIN


def _config_bool(key: str, default: bool) -> bool:
    value = config.app.get(key, default)
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "off", "")
    return bool(value)


def _config_float(key: str, default: float) -> float:
    try:
        return float(config.app.get(key, default))
    except (TypeError, ValueError):
        logger.warning(f"invalid {key}, using default {default}")
        return default


def verification_config() -> VerificationConfig:
    """Read verification settings from config, never raising on bad values."""
    return VerificationConfig(
        enabled=_config_bool("material_verification_enabled", False),
        min_score=_config_float("material_verification_min_score", DEFAULT_MIN_SCORE),
        runner_up_margin=_config_float(
            "material_verification_runner_up_margin", DEFAULT_RUNNER_UP_MARGIN
        ),
    )


# Deterministic subject identification: phrases are normalized (accents
# stripped, punctuation removed) and matched against an explicit ordered
# table. "Porto Alegre" is checked before any Porto subject so a
# Brazilian shop is never identified as a Porto subject.
_SUBJECT_PATTERNS = (
    ("porto alegre", "porto_alegre"),
    ("tripas", "tripas_dish"),
    ("bolhao", "bolhao_market"),
    ("ribeira", "ribeira"),
    ("tasca", "tasca"),
    ("bacalhau", "bacalhau_dish"),
)

_SUBJECT_BROADER = {
    "tripas_dish": "porto_food",
    "bacalhau_dish": "porto_food",
    "tasca": "porto_food",
    "bolhao_market": "porto_market",
    "ribeira": "porto_places",
    "porto_alegre": None,
}


def _normalize_text(text: str) -> str:
    stripped = "".join(
        char
        for char in unicodedata.normalize("NFKD", text.lower())
        if not unicodedata.combining(char)
    )
    return re.sub(r"[^a-z0-9]+", " ", stripped).strip()


def identify_subject(phrase: str) -> Optional[str]:
    """Identify a phrase's subject deterministically, or None when unknown."""
    normalized = f" {_normalize_text(phrase)} "
    for pattern, subject in _SUBJECT_PATTERNS:
        if f" {pattern} " in normalized:
            return subject
    return None


def phrase_at(
    timestamp: float, phrases: Sequence[tuple[str, float, float]]
) -> Optional[str]:
    """The phrase active at a timestamp, from (text, start, end) phrases."""
    if not phrases:
        return None
    for text, start, end in phrases:
        if start <= timestamp < end:
            return text
    if timestamp < phrases[0][1]:
        return phrases[0][0]
    return phrases[-1][0]


@dataclass(frozen=True)
class SvgAssetRef:
    """One SVG asset, identified by its catalog id, never by a search term."""

    asset_id: str
    subject: str
    broader_category: str
    relative_path: str


@dataclass
class SegmentDecision:
    """The material chosen for one script segment."""

    tier: str
    phrase: str
    stock_url: Optional[str] = None
    svg_asset_id: Optional[str] = None
    svg_relative_path: Optional[str] = None
    svg_asset: Optional[SvgAssetRef] = None
    fallback_reason: Optional[str] = None
    subject: Optional[str] = None


# A scorer maps a candidate URL and a phrase to a relative similarity
# score, or None when the candidate cannot be scored. It must never
# return a probability; the threshold and margin are calibrated on its
# own scale.
Scorer = Callable[[str, str], Optional[float]]


class OnnxClipScorer:
    """Lazy CLIP/SigLIP ONNX scorer. Raises VerificationUnavailable
    until onnxruntime and a SigLIP model are installed: a scorer that
    cannot run must never pass stock footage."""

    def score(self, candidate_url: str, phrase: str) -> float:
        try:
            import onnxruntime  # noqa: F401 - availability probe only
        except ImportError as exc:
            raise VerificationUnavailable(
                "onnxruntime is not installed; install onnxruntime and "
                "download a SigLIP ONNX model to enable stock verification"
            ) from exc
        model_path = str(config.app.get("material_verification_model_path", "")).strip()
        if not model_path or not os.path.isfile(model_path):
            raise VerificationUnavailable(
                "material_verification_model_path is not set or missing; "
                "download a SigLIP ONNX model to enable stock verification"
            )
        # Frame sampling and ONNX inference are not wired yet: raising
        # here keeps verification fail-closed instead of passing stock
        # on an unimplemented scorer.
        raise VerificationUnavailable(
            "SigLIP frame scoring is not wired yet; wire frame sampling "
            "into OnnxClipScorer.score before enabling verification"
        )


def _score_candidates(
    candidates: Sequence[MaterialInfo], phrase: str, scorer: Optional[Scorer]
) -> tuple[List[tuple[MaterialInfo, float]], bool]:
    """Score candidates, highest first, tie-broken by URL. Returns
    (scored candidates, scorer_failed); unscored footage is unverified."""
    active_scorer = scorer if scorer is not None else OnnxClipScorer().score
    scored: List[tuple[MaterialInfo, float]] = []
    scorer_failed = False
    for candidate in candidates:
        try:
            score = active_scorer(candidate.url, phrase)
        except VerificationUnavailable:
            scorer_failed = True
            continue
        except Exception as exc:  # noqa: BLE001 - scorer must not break selection
            logger.warning(f"material scorer failed for candidate: {exc}")
            scorer_failed = True
            continue
        if score is None or not math.isfinite(score):
            continue
        scored.append((candidate, float(score)))
    scored.sort(key=lambda pair: (-pair[1], pair[0].url))
    return scored, scorer_failed


def _svg_decision(
    tier: str, phrase: str, asset: SvgAssetRef, reason: str
) -> SegmentDecision:
    return SegmentDecision(
        tier=tier,
        phrase=phrase,
        svg_asset_id=asset.asset_id,
        svg_relative_path=asset.relative_path,
        svg_asset=asset,
        fallback_reason=reason,
        subject=asset.subject,
    )


def _fallback_decision(
    phrase: str,
    subject: Optional[str],
    reason: str,
    subject_to_asset: dict,
    previous_asset: Optional[SvgAssetRef],
    used_asset_ids: set,
) -> SegmentDecision:
    broader = _SUBJECT_BROADER.get(subject) if subject else None
    if subject is not None:
        thematic = subject_to_asset.get(subject)
        if thematic is not None and thematic.asset_id not in used_asset_ids:
            return _svg_decision(TIER_SVG_THEMATIC, phrase, thematic, reason)
    if broader is not None:
        broader_asset = subject_to_asset.get(broader)
        if broader_asset is not None and broader_asset.asset_id not in used_asset_ids:
            return _svg_decision(TIER_SVG_BROADER, phrase, broader_asset, reason)
    if (
        previous_asset is not None
        and previous_asset.asset_id not in used_asset_ids
        and (
            previous_asset.subject == subject
            or previous_asset.broader_category == broader
        )
    ):
        return _svg_decision(TIER_SVG_REUSED, phrase, previous_asset, reason)
    return SegmentDecision(
        tier=TIER_NEUTRAL, phrase=phrase, fallback_reason=reason, subject=None
    )


def select_for_segment(
    phrase: str,
    candidates: Sequence[MaterialInfo],
    scorer: Optional[Scorer] = None,
    config: Optional[VerificationConfig] = None,
    subject_to_asset: Optional[dict] = None,
    previous_asset: Optional[SvgAssetRef] = None,
    used_asset_ids: Optional[set] = None,
) -> SegmentDecision:
    """Choose verified stock or the first fallback. Mapping is a dict lookup."""
    cfg = config or verification_config()
    mapping = subject_to_asset or {}
    used = set(used_asset_ids or set())
    subject = identify_subject(phrase)

    def fallback(reason: str) -> SegmentDecision:
        return _fallback_decision(phrase, subject, reason, mapping, previous_asset, used)

    if not candidates:
        decision = fallback("no_candidates")
    else:
        scored, scorer_failed = _score_candidates(candidates, phrase, scorer)
        if scorer_failed and not scored:
            decision = fallback("scorer_unavailable")
        elif not scored:
            decision = fallback("score_below_threshold")
        else:
            top, top_score = scored[0]
            second_score = scored[1][1] if len(scored) > 1 else None
            if top_score < cfg.min_score:
                decision = fallback("score_below_threshold")
            elif second_score is not None and top_score - second_score < cfg.runner_up_margin:
                decision = fallback("runner_up_margin_too_small")
            else:
                decision = SegmentDecision(
                    tier=TIER_STOCK_VERIFIED, phrase=phrase, stock_url=top.url, subject=subject
                )
    # Log the fallback reason and the selected asset, never the phrase,
    # the candidate URL, or a local path: logs stay scrubbed by design.
    selected = decision.svg_asset_id or (
        "stock" if decision.tier == TIER_STOCK_VERIFIED else "neutral"
    )
    logger.info(
        f"material verification: tier={decision.tier} "
        f"reason={decision.fallback_reason} asset={selected}"
    )
    return decision


def apply_verification(
    groups: Sequence[tuple[str, Sequence[MaterialInfo]]],
    scorer: Optional[Scorer] = None,
    config: Optional[VerificationConfig] = None,
    subject_to_asset: Optional[dict] = None,
) -> tuple[List[MaterialInfo], List[SegmentDecision]]:
    """Apply verification to groups, in order. Disabled verification passes
    candidates through unchanged, preserving existing behavior."""
    cfg = config or verification_config()
    if not cfg.enabled:
        flattened: List[MaterialInfo] = []
        for _phrase, candidates in groups:
            flattened.extend(candidates)
        return flattened, []
    mapping = subject_to_asset or {}
    used: set = set()
    previous_asset: Optional[SvgAssetRef] = None
    selected: List[MaterialInfo] = []
    decisions: List[SegmentDecision] = []
    for phrase, candidates in groups:
        decision = select_for_segment(
            phrase=phrase,
            candidates=candidates,
            scorer=scorer,
            config=cfg,
            subject_to_asset=mapping,
            previous_asset=previous_asset,
            used_asset_ids=used,
        )
        decisions.append(decision)
        if decision.tier == TIER_STOCK_VERIFIED:
            match = next(
                (item for item in candidates if item.url == decision.stock_url), None
            )
            if match is not None:
                selected.append(match)
        elif decision.svg_asset is not None:
            item = MaterialInfo()
            item.provider = "svg"
            item.url = decision.svg_relative_path or ""
            item.duration = candidates[0].duration if candidates else 5
            selected.append(item)
            used.add(decision.svg_asset_id or "")
            previous_asset = decision.svg_asset
        else:
            item = MaterialInfo()
            item.provider = "neutral"
            item.url = ""
            item.duration = candidates[0].duration if candidates else 5
            selected.append(item)
    return selected, decisions


def subject_to_asset_from_config() -> dict:
    """Build the explicit subject-to-asset mapping from config.

    Config value material_subject_to_asset maps a subject key to a catalog
    relative path. The asset id logged is the file name only, never a path.
    """
    raw = config.app.get("material_subject_to_asset", {})
    mapping: dict = {}
    if isinstance(raw, dict):
        for subject, path in raw.items():
            if isinstance(subject, str) and isinstance(path, str) and path:
                mapping[subject] = SvgAssetRef(
                    asset_id=os.path.basename(path),
                    subject=subject,
                    broader_category=_SUBJECT_BROADER.get(subject) or "",
                    relative_path=path,
                )
    return mapping


def summarize_decisions(decisions: Sequence[SegmentDecision]) -> dict:
    """Counts per tier, with every tier present even at zero."""
    summary = {tier: 0 for tier in ALL_TIERS}
    for decision in decisions:
        if decision.tier in summary:
            summary[decision.tier] += 1
    return summary


def emit_material_fallback_summary(
    task_id: str, decisions: Sequence[SegmentDecision]
) -> None:
    """Emit one aggregate PostHog event per video generation: counts per
    tier plus task id only, no free text, phrases, URLs, or paths."""
    track_event(
        "material_fallback_summary", {"task_id": task_id, **summarize_decisions(decisions)}
    )


def render_neutral_png(save_dir: str) -> str:
    """Render an abstract neutral background PNG: gradient plus soft
    circles, implying no place, dish, or person."""
    from PIL import Image, ImageDraw

    width, height = 720, 1280
    from PIL import ImageOps

    gradient = ImageOps.colorize(
        Image.linear_gradient("L").resize((1, height)),
        black=(31, 42, 51),
        white=(58, 74, 86),
    )
    image = gradient.resize((width, height)).convert("RGBA")
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for center_x, center_y, radius, alpha in (
        (180, 320, 220, 28),
        (540, 640, 280, 22),
        (360, 980, 240, 26),
    ):
        draw.ellipse(
            (center_x - radius, center_y - radius, center_x + radius, center_y + radius),
            fill=(255, 255, 255, alpha),
        )
    image = Image.alpha_composite(image, overlay)
    os.makedirs(save_dir, exist_ok=True)
    path = os.path.join(save_dir, "neutral-background.png")
    image.convert("RGB").save(path, format="PNG")
    return path


def render_neutral_clip(
    save_dir: str, clip_duration: int, video_aspect: VideoAspect
) -> str:
    """Turn the neutral background PNG into a video clip, or "" on failure."""
    try:
        from app.services import image_material

        png_path = render_neutral_png(save_dir)
        return image_material.render_image_file_to_mp4(
            png_path, clip_duration=max(1, int(clip_duration))
        )
    except Exception as exc:  # noqa: BLE001 - a failed neutral is a skipped clip
        logger.warning(f"neutral clip render failed: {exc}")
        return ""
