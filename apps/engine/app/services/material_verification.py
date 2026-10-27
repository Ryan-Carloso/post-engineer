"""Verified stock material selection for broll mode.

Stock is verified only when a scorer clears it: the best candidate must
reach the minimum score and beat the runner-up by the margin. Scores are
relative, never probabilities; unscored candidates are never verified.

A segment with no verified stock is dropped when another segment
verifies: broll mode is stock only, so a rejected clip is never
replaced by a catalog SVG, a neutral background, or the rejected clip
itself. When no segment verifies at all, scored segments keep their
best-scored clips as an unverified fallback instead of failing the
download; only segments the scorer never scored (no candidates, scorer
unavailable) stay dropped. Svg mode never runs verification (catalog only).

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
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence

from loguru import logger

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect
from app.services import siglip_model
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
# No segment verified: each keeps its best-scored candidate instead of failing the video.
TIER_STOCK_UNVERIFIED = "stock_unverified"
TIER_DROPPED = "dropped"
ALL_TIERS = (TIER_STOCK_VERIFIED, TIER_STOCK_UNVERIFIED, TIER_DROPPED)
KEPT_TIERS = (TIER_STOCK_VERIFIED, TIER_STOCK_UNVERIFIED)


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
    # Best-scored candidate of a segment that scored but did not verify.
    best_url: Optional[str] = None
    # All scored candidates, best first: the alternative pool a segment
    # keeps when nothing verifies (capped by MAX_KEPT_UNVERIFIED).
    ranked_urls: tuple[str, ...] = ()


# A scorer maps a candidate URL and a phrase to a relative similarity
# score, or None when the candidate cannot be scored. It must never
# return a probability; the threshold and margin are calibrated on its
# own scale.
Scorer = Callable[[str, str], Optional[float]]


# Preview images are tiny, so scoring is bounded by candidate count and run
# in parallel: about 8 candidates per segment, 4 at a time.
MAX_SCORED_PER_SEGMENT = 12
SCORE_WORKERS = 4

# Alternatives a segment keeps when nothing verifies: enough for the
# round-robin in material.py to rotate through distinct clips instead of
# repeating the single best one, few enough to not blow the token budget.
MAX_KEPT_UNVERIFIED = 3
# A verified segment offers more clips, but only those that clear min_score.
MAX_KEPT_VERIFIED = 5

_shared_scorers: dict = {}
_shared_lock = threading.Lock()


def _shared_scorer(model_path: str) -> SiglipScorer:
    """One scorer per model path: the ONNX session is loaded once, not per segment."""
    with _shared_lock:
        scorer = _shared_scorers.get(model_path)
        if scorer is None:
            siglip_model.ensure_model(model_path)
            scorer = SiglipScorer(model_path)
            scorer.warm()
            _shared_scorers[model_path] = scorer
        return scorer


class OnnxClipScorer:
    """Lazy CLIP/SigLIP ONNX scorer, wired through SiglipScorer.

    The model files are fetched on first use (siglip_model) and the session
    is shared by every segment of the process. A scorer that cannot run
    raises VerificationUnavailable and must never pass stock footage. The
    model path comes from config (material_verification_model_path).
    """

    def score(self, candidate_url: str, phrase: str) -> float:
        model_path = str(config.app.get("material_verification_model_path", "")).strip()
        return _shared_scorer(model_path).score(candidate_url, phrase)


def _score_candidates(
    candidates: Sequence[MaterialInfo], phrase: str, scorer: Optional[Scorer]
) -> tuple[List[tuple[MaterialInfo, float]], bool]:
    """Score stock candidates, highest first, tie-broken by URL.

    Catalog SVG and neutral items are not stock and are never scored:
    scoring them would route a non-http path through the stock
    downloader. Only the first MAX_SCORED_PER_SEGMENT candidates are
    scored, by their preview image when they have one. Returns
    (scored, failed).
    """
    if scorer is None:
        model_path = str(config.app.get("material_verification_model_path", "")).strip()
        try:
            _shared_scorer(model_path)
        except VerificationUnavailable:
            return [], True
        active_scorer = OnnxClipScorer().score
    else:
        active_scorer = scorer
    stock = [c for c in candidates if c.provider not in ("svg", "neutral")]

    def attempt(candidate: MaterialInfo) -> tuple[Optional[float], bool]:
        target = getattr(candidate, "thumbnail", "") or candidate.url
        try:
            return active_scorer(target, phrase), False
        except VerificationUnavailable:
            return None, True
        except Exception as exc:  # noqa: BLE001 - scorer must not break selection
            logger.warning(
                f"material scorer failed for candidate: {type(exc).__name__}"
            )
            return None, True

    chosen = stock[:MAX_SCORED_PER_SEGMENT]
    with ThreadPoolExecutor(max_workers=SCORE_WORKERS) as pool:
        outcomes = list(pool.map(attempt, chosen))
    scored: List[tuple[MaterialInfo, float]] = []
    scorer_failed = False
    for candidate, (score, failed) in zip(chosen, outcomes):
        scorer_failed = scorer_failed or failed
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

    def drop(
        reason: str, best_url: Optional[str] = None, ranked_urls: tuple[str, ...] = ()
    ) -> SegmentDecision:
        return SegmentDecision(
            tier=TIER_DROPPED,
            phrase=phrase,
            drop_reason=reason,
            best_url=best_url,
            ranked_urls=ranked_urls,
        )

    stock = [c for c in candidates if c.provider not in ("svg", "neutral")]
    if not stock:
        decision = drop("no_candidates")
    else:
        scored, scorer_failed = _score_candidates(candidates, phrase, scorer)
        # Best-first candidate URLs, kept on every scored decision: the
        # unverified fallback pool and the verifier's ranking in one field.
        ranked = tuple(candidate.url for candidate, _score in scored)
        if scorer_failed and not scored:
            decision = drop("scorer_unavailable")
        elif not scored:
            decision = drop("score_below_threshold")
        else:
            top, top_score = scored[0]
            second_score = scored[1][1] if len(scored) > 1 else None
            if top_score < cfg.min_score:
                decision = drop("score_below_threshold", top.url, ranked)
            elif second_score is not None and top_score - second_score < cfg.runner_up_margin:
                decision = drop("runner_up_margin_too_small", top.url, ranked)
            else:
                good = tuple(c.url for c, score in scored if score >= cfg.min_score)
                decision = SegmentDecision(
                    tier=TIER_STOCK_VERIFIED, phrase=phrase, stock_url=top.url, ranked_urls=good
                )
    # Log the tier and the drop reason only, never the phrase, the
    # candidate URL, or a local path: logs stay scrubbed by design.
    logger.info(
        f"material verification: tier={decision.tier} reason={decision.drop_reason}"
    )
    return decision


def verified_script_order_groups(groups, task_id, scorer):
    """Apply verification to script-order groups, one decision per phrase.

    Verified phrases keep their single verified pick; a phrase whose
    segments stayed unverified keeps up to MAX_KEPT_UNVERIFIED
    alternatives, best first, for the round-robin loop in material.py.
    """
    _items_per_group, decisions = apply_verification(groups, scorer=scorer)
    emit_material_fallback_summary(task_id, decisions)
    # apply_verification emits exactly one decision per group, in order.
    result: list[tuple[str, list]] = []
    for (_phrase, candidates), decision in zip(groups, decisions):
        if decision.tier not in KEPT_TIERS:
            continue
        if decision.tier == TIER_STOCK_VERIFIED:
            match = next((c for c in candidates if c.url == decision.stock_url), None)
            if match is not None:
                result.append(
                    (
                        decision.phrase,
                        _ranked_pool(decision, candidates, match.url),
                    )
                )
        else:
            urls = decision.ranked_urls
            result.append(
                (
                    decision.phrase,
                    sorted(
                        (c for c in candidates if c.url in urls),
                        key=lambda c: urls.index(c.url),
                    ),
                )
            )
    return result


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
                # The verified pick leads the pool; the top-scored runner-ups
                # follow so the round-robin in material.py rotates distinct
                # scenes instead of repeating one clip for the whole video.
                pool = _ranked_pool(decision, candidates, distinguished=match.url)
                selected.extend(pool)
        decisions.append(decision)
    if not selected:
        selected, decisions = _keep_best_scored(groups, decisions)
    return selected, decisions


def _ranked_pool(
    decision: SegmentDecision,
    candidates: Sequence[MaterialInfo],
    distinguished: Optional[str],
) -> List[MaterialInfo]:
    """Kept candidates for one segment, best first, capped.

    `distinguished` comes first when set (the verified pick); the rest
    follows the verifier's ranking, capped by MAX_KEPT_UNVERIFIED and
    deduped — the same URL never enters the pool twice.
    """
    urls = {c.url for c in candidates}
    head: tuple[str, ...] = ()
    if distinguished is not None and distinguished in urls:
        ranked = tuple(decision.ranked_urls)
        if distinguished in ranked:
            reordered = [distinguished]
            reordered.extend(u for u in ranked if u != distinguished)
            head = tuple(reordered)
        else:
            head = (distinguished,)
    ordered: list[str] = []
    for url in (*head, *decision.ranked_urls):
        if url not in ordered:
            ordered.append(url)
    cap = MAX_KEPT_VERIFIED if decision.tier == TIER_STOCK_VERIFIED else MAX_KEPT_UNVERIFIED
    picked_urls = ordered[:cap]
    first_by_url: dict = {}
    for c in candidates:
        first_by_url.setdefault(c.url, c)
    return [first_by_url[url] for url in picked_urls if url in first_by_url]


def _keep_best_scored(
    groups: Sequence[tuple[str, Sequence[MaterialInfo]]],
    decisions: List[SegmentDecision],
) -> tuple[List[MaterialInfo], List[SegmentDecision]]:
    """When no segment verified, keep each scored segment's best candidates.

    Segments the scorer never scored (no candidates, scorer unavailable)
    stay dropped: a verifier that cannot run still fails closed. Scored
    segments keep up to MAX_KEPT_UNVERIFIED alternatives, best first, so
    the round-robin loop in material.py rotates distinct clips instead of
    repeating the single best one.
    """
    selected: List[MaterialInfo] = []
    kept: List[SegmentDecision] = []
    taken_urls: set[str] = set()
    for (_phrase, candidates), decision in zip(groups, decisions):
        if decision.best_url is None or not decision.ranked_urls:
            kept.append(decision)
            continue
        # Best-first, only candidates this group actually carries; never
        # the same clip in two segments when the pool is shared.
        chosen_urls = tuple(
            url
            for url in decision.ranked_urls
            if url not in taken_urls and any(c.url == url for c in candidates)
        )[:MAX_KEPT_UNVERIFIED]
        if not chosen_urls:
            # Every scored candidate was already taken: nothing new to keep.
            kept.append(decision)
            continue
        matches = sorted(
            (c for c in candidates if c.url in chosen_urls),
            key=lambda c: chosen_urls.index(c.url),
        )
        taken_urls.update(chosen_urls)
        selected.extend(matches)
        kept.append(
            SegmentDecision(
                tier=TIER_STOCK_UNVERIFIED,
                phrase=decision.phrase,
                stock_url=matches[0].url,
                # best_url mirrors the top kept candidate; ranked_urls is
                # the capped pool the round-robin rotates through.
                best_url=matches[0].url,
                ranked_urls=chosen_urls,
            )
        )
    return selected, kept


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
