"""Verified stock material selection for broll mode.

Stock is verified only when a scorer clears it: the best candidate must
reach the minimum score and beat the runner-up by the margin. Scores are
relative, never probabilities; unscored candidates are never verified.

A segment with no verified stock is dropped: broll mode is stock only,
so a rejected clip is never replaced by a catalog SVG, a neutral
background, or the rejected clip itself. The remaining verified clips
fill the timeline; when none is left the download fails like any other
empty stock search. Svg mode never runs verification (catalog only).

Scoring is pluggable through an option (the repo's injection pattern).
The default scorer is lazy ONNX (see siglip_scorer): without onnxruntime,
a SigLIP model, and its tokenizer it raises VerificationUnavailable, so
stock is treated as unverified. Scoring is fail-closed.

This module also owns the aspect/resolution helpers moved out of
material.py, which is grandfathered over the file-size cap: material.py
re-exports them, so existing callers keep working.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence

from loguru import logger

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect
from app.services import state as sm
from app.services.analytics import track_event
from app.services.neutral_background import (  # noqa: F401 - re-export for callers
    render_neutral_clip,
    render_neutral_png,
)
from app.services.siglip_scorer import (  # noqa: F401 - re-export for callers
    SiglipScorer,
    VerificationUnavailable,
)

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


# Threshold and margin, calibrated on the padded SigLIP scorer
# (Xenova siglip-base-patch16-224, model_q4.onnx) against real Pixabay
# candidates: 9 matched phrases scored 0.0006-0.2852, all 9 rotated
# mismatches scored 0.0000. The minimum sits above the mismatch floor
# and below every genuine match except the weakest (rain, 0.0006, which
# correctly falls back); the margin is half the minimum, so a top score
# must clear the runner-up by more than a near-tie. Pexels could not be
# measured from this sandbox (60s read timeout), so these values are
# Pixabay-measured, not Pexels-measured.
DEFAULT_MIN_SCORE = 0.01
DEFAULT_RUNNER_UP_MARGIN = 0.005

TIER_STOCK_VERIFIED = "stock_verified"
TIER_DROPPED = "dropped"
ALL_TIERS = (TIER_STOCK_VERIFIED, TIER_DROPPED)


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


@dataclass
class SegmentDecision:
    """The material chosen for one script segment."""

    tier: str
    phrase: str
    stock_url: Optional[str] = None
    drop_reason: Optional[str] = None


# A scorer maps a candidate URL and a phrase to a relative similarity
# score, or None when the candidate cannot be scored. It must never
# return a probability; the threshold and margin are calibrated on its
# own scale.
Scorer = Callable[[str, str], Optional[float]]


class OnnxClipScorer:
    """Lazy CLIP/SigLIP ONNX scorer, wired through SiglipScorer.

    The scorer is constructed per verification call and loads the model
    and tokenizer lazily on first use; a scorer that cannot run raises
    VerificationUnavailable and must never pass stock footage. The
    model path comes from config (material_verification_model_path);
    the tokenizer and preprocessor config sit next to the model file.
    """

    def __init__(self) -> None:
        self._delegate: Optional[SiglipScorer] = None

    def score(self, candidate_url: str, phrase: str) -> float:
        if self._delegate is None:
            model_path = str(config.app.get("material_verification_model_path", "")).strip()
            self._delegate = SiglipScorer(model_path)
        return self._delegate.score(candidate_url, phrase)


def _score_candidates(
    candidates: Sequence[MaterialInfo], phrase: str, scorer: Optional[Scorer]
) -> tuple[List[tuple[MaterialInfo, float]], bool]:
    """Score stock candidates, highest first, tie-broken by URL.

    Catalog SVG and neutral items are not stock and are never scored:
    scoring them would route a non-http path through the stock
    downloader. Returns (scored, failed).
    """
    active_scorer = scorer if scorer is not None else OnnxClipScorer().score
    stock = [c for c in candidates if c.provider not in ("svg", "neutral")]
    scored: List[tuple[MaterialInfo, float]] = []
    scorer_failed = False
    for candidate in stock:
        try:
            score = active_scorer(candidate.url, phrase)
        except VerificationUnavailable:
            scorer_failed = True
            continue
        except Exception as exc:  # noqa: BLE001 - scorer must not break selection
            logger.warning(
                f"material scorer failed for candidate: {type(exc).__name__}"
            )
            scorer_failed = True
            continue
        if score is None or not math.isfinite(score):
            continue
        scored.append((candidate, float(score)))
    scored.sort(key=lambda pair: (-pair[1], pair[0].url))
    return scored, scorer_failed


def select_for_segment(
    phrase: str,
    candidates: Sequence[MaterialInfo],
    scorer: Optional[Scorer] = None,
    config: Optional[VerificationConfig] = None,
) -> SegmentDecision:
    """Choose verified stock for one segment, or drop the segment."""
    cfg = config or verification_config()

    def drop(reason: str) -> SegmentDecision:
        return SegmentDecision(tier=TIER_DROPPED, phrase=phrase, drop_reason=reason)

    stock = [c for c in candidates if c.provider not in ("svg", "neutral")]
    if not stock:
        decision = drop("no_candidates")
    else:
        scored, scorer_failed = _score_candidates(candidates, phrase, scorer)
        if scorer_failed and not scored:
            decision = drop("scorer_unavailable")
        elif not scored:
            decision = drop("score_below_threshold")
        else:
            top, top_score = scored[0]
            second_score = scored[1][1] if len(scored) > 1 else None
            if top_score < cfg.min_score:
                decision = drop("score_below_threshold")
            elif second_score is not None and top_score - second_score < cfg.runner_up_margin:
                decision = drop("runner_up_margin_too_small")
            else:
                decision = SegmentDecision(
                    tier=TIER_STOCK_VERIFIED, phrase=phrase, stock_url=top.url
                )
    # Log the tier and the drop reason only, never the phrase, the
    # candidate URL, or a local path: logs stay scrubbed by design.
    logger.info(
        f"material verification: tier={decision.tier} reason={decision.drop_reason}"
    )
    return decision


def verified_script_order_groups(groups, task_id, scorer):
    """Apply verification to script-order groups, one pick per kept phrase."""
    selected, decisions = apply_verification(groups, scorer=scorer)
    emit_material_fallback_summary(task_id, decisions)
    kept = [d for d in decisions if d.tier == TIER_STOCK_VERIFIED]
    return [(decision.phrase, [item]) for decision, item in zip(kept, selected)]


def apply_verification(
    groups: Sequence[tuple[str, Sequence[MaterialInfo]]],
    scorer: Optional[Scorer] = None,
    config: Optional[VerificationConfig] = None,
) -> tuple[List[MaterialInfo], List[SegmentDecision]]:
    """Apply verification to groups, in order: verified stock is kept,
    every other segment is dropped. Disabled verification passes
    candidates through unchanged, preserving existing behavior."""
    cfg = config or verification_config()
    if not cfg.enabled:
        flattened: List[MaterialInfo] = []
        for _phrase, candidates in groups:
            flattened.extend(candidates)
        return flattened, []
    selected: List[MaterialInfo] = []
    decisions: List[SegmentDecision] = []
    for phrase, candidates in groups:
        decision = select_for_segment(
            phrase=phrase, candidates=candidates, scorer=scorer, config=cfg
        )
        if decision.tier == TIER_STOCK_VERIFIED:
            match = next(
                (item for item in candidates if item.url == decision.stock_url), None
            )
            if match is None:
                decision = SegmentDecision(
                    tier=TIER_DROPPED, phrase=phrase, drop_reason="verified_url_missing"
                )
            else:
                selected.append(match)
        decisions.append(decision)
    return selected, decisions


def summarize_decisions(decisions: Sequence[SegmentDecision]) -> dict:
    """Counts per tier, with every tier present even at zero."""
    summary = {tier: 0 for tier in ALL_TIERS}
    for decision in decisions:
        if decision.tier in summary:
            summary[decision.tier] += 1
    return summary


def _task_owner_id(task_id: str) -> str:
    """Owner id from the task row, "" when absent, unknown, or unreadable.

    Tracking degrades, the pipeline continues — same contract as
    _task_tracking_context in task.py.
    """
    try:
        row = sm.state.get_task(task_id) or {}
    except Exception:
        return ""
    raw = row.get("user_id")
    return raw if isinstance(raw, str) and raw != "unknown" else ""


def emit_material_fallback_summary(
    task_id: str, decisions: Sequence[SegmentDecision]
) -> None:
    """Emit one aggregate PostHog event per video generation: counts per
    tier plus task id, and the owner's user_id when the task row carries
    one, no free text, phrases, URLs, or paths. The user_id keeps the
    event attributed to the real person instead of the engine
    pseudo-person."""
    properties = {"task_id": task_id, **summarize_decisions(decisions)}
    owner_id = _task_owner_id(task_id)
    if owner_id:
        properties["user_id"] = owner_id
    track_event("material_fallback_summary", properties)
