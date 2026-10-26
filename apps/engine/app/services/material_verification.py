"""Verified stock material selection with R2 catalog SVG fallback.

Stock is verified only when a scorer clears it: the best candidate must
reach the minimum score and beat the runner-up by the margin. Scores are
relative, never probabilities; unscored candidates are never verified.

Fallback order, never using rejected stock or misleading assets:
1. Verified stock (see above).
2. R2 catalog SVG: the catalog is searched with the segment's phrase,
   using the existing catalog search (svg_catalog.search over its SQLite
   index). The first catalog match not already used in this video is
   tier svg_catalog.
3. Next-best catalog match: when the first catalog match was already
   used in this video, the next unused match is tier svg_catalog_alt.
   The same catalog asset is never used twice in one video.
4. Neutral background: stylized and abstract, implying no specific
   subject (no skyline, no dish, no text, no identifiable place).

R2 is the only source of SVG artwork. There is no subject mapping, no
keyword table, and no bundled or local artwork anywhere in this flow:
catalog items carry provider="svg" and are rendered through
svg_material.resolve_material_path by the caller.

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
TIER_SVG_CATALOG = "svg_catalog"
TIER_SVG_CATALOG_ALT = "svg_catalog_alt"
TIER_NEUTRAL = "neutral"
ALL_TIERS = (
    TIER_STOCK_VERIFIED,
    TIER_SVG_CATALOG,
    TIER_SVG_CATALOG_ALT,
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
    for text, start, _end in reversed(phrases):
        if start <= timestamp:
            return text
    return phrases[-1][0]


@dataclass(frozen=True)
class SvgAssetRef:
    """One R2 catalog SVG asset, identified by its catalog id."""

    asset_id: str
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


# A scorer maps a candidate URL and a phrase to a relative similarity
# score, or None when the candidate cannot be scored. It must never
# return a probability; the threshold and margin are calibrated on its
# own scale.
Scorer = Callable[[str, str], Optional[float]]

# A catalog search maps a segment phrase to ranked catalog assets, best
# first. The production search is svg_catalog.search; tests inject a stub.
CatalogSearch = Callable[[str], Sequence[SvgAssetRef]]


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


# Catalog FTS ANDs every token, and no catalog title contains a bare
# article, so a sentence phrase ("a traveler eating local food") would
# match nothing while its content words match. Articles carry no topic
# meaning, so they are stripped before the catalog query. This is generic
# text normalization, not a subject mapping.
_CATALOG_STOPWORDS = frozenset({"a", "an", "the"})


def _catalog_search(phrase: str) -> Sequence[SvgAssetRef]:
    """Production catalog search: ranked R2 catalog assets for a phrase."""
    from app.services import svg_catalog

    if not svg_catalog.is_enabled():
        return []
    query = " ".join(
        token
        for token in phrase.split()
        if token.strip(".,;:!?\"'()[]{}").lower() not in _CATALOG_STOPWORDS
    )
    if not query:
        return []
    return [
        SvgAssetRef(asset_id=asset.asset_id, relative_path=asset.relative_path)
        for asset in svg_catalog.search(query, limit=5)
    ]


def _score_candidates(
    candidates: Sequence[MaterialInfo], phrase: str, scorer: Optional[Scorer]
) -> tuple[List[tuple[MaterialInfo, float]], bool]:
    """Score stock candidates, highest first, tie-broken by URL.

    Catalog SVG and neutral items are not stock and are never scored:
    scoring them would route a catalog relative path through the stock
    downloader, which rejects non-http URLs. Returns (scored, failed).
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
    )


def _fallback_decision(
    phrase: str,
    reason: str,
    catalog_search: Optional[CatalogSearch],
    used_asset_ids: set,
) -> SegmentDecision:
    """First unused catalog match, or neutral when the catalog is empty."""
    search = catalog_search if catalog_search is not None else _catalog_search
    try:
        assets = list(search(phrase))
    except Exception as exc:  # noqa: BLE001 - catalog failure is a neutral, not a crash
        logger.warning(f"material catalog search failed: {exc}")
        assets = []
    for rank, asset in enumerate(assets):
        if asset.asset_id in used_asset_ids:
            continue
        tier = TIER_SVG_CATALOG if rank == 0 else TIER_SVG_CATALOG_ALT
        return _svg_decision(tier, phrase, asset, reason)
    return SegmentDecision(tier=TIER_NEUTRAL, phrase=phrase, fallback_reason=reason)


def select_for_segment(
    phrase: str,
    candidates: Sequence[MaterialInfo],
    scorer: Optional[Scorer] = None,
    config: Optional[VerificationConfig] = None,
    catalog_search: Optional[CatalogSearch] = None,
    used_asset_ids: Optional[set] = None,
) -> SegmentDecision:
    """Choose verified stock or the first catalog/neutral fallback."""
    cfg = config or verification_config()
    used = set(used_asset_ids or set())

    def fallback(reason: str) -> SegmentDecision:
        return _fallback_decision(phrase, reason, catalog_search, used)

    stock = [c for c in candidates if c.provider not in ("svg", "neutral")]
    if not stock:
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
                    tier=TIER_STOCK_VERIFIED, phrase=phrase, stock_url=top.url
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


def neutral_item_for(item: MaterialInfo) -> MaterialInfo:
    """A neutral clip item for a failed stock download, same duration."""
    neutral = MaterialInfo()
    neutral.provider = "neutral"
    neutral.url = ""
    neutral.duration = item.duration
    return neutral


def verified_script_order_groups(
    groups, task_id, scorer, catalog_search: Optional[CatalogSearch] = None
):
    """Apply verification to script-order groups, one pick per phrase."""
    selected, decisions = apply_verification(
        groups, scorer=scorer, catalog_search=catalog_search
    )
    emit_material_fallback_summary(task_id, decisions)
    return [(decision.phrase, [item]) for decision, item in zip(decisions, selected)]


def apply_verification(
    groups: Sequence[tuple[str, Sequence[MaterialInfo]]],
    scorer: Optional[Scorer] = None,
    config: Optional[VerificationConfig] = None,
    catalog_search: Optional[CatalogSearch] = None,
) -> tuple[List[MaterialInfo], List[SegmentDecision]]:
    """Apply verification to groups, in order. Disabled verification passes
    candidates through unchanged, preserving existing behavior."""
    cfg = config or verification_config()
    if not cfg.enabled:
        flattened: List[MaterialInfo] = []
        for _phrase, candidates in groups:
            flattened.extend(candidates)
        return flattened, []
    used: set = set()
    selected: List[MaterialInfo] = []
    decisions: List[SegmentDecision] = []
    for phrase, candidates in groups:
        decision = select_for_segment(
            phrase=phrase,
            candidates=candidates,
            scorer=scorer,
            config=cfg,
            catalog_search=catalog_search,
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
        else:
            item = MaterialInfo()
            item.provider = "neutral"
            item.url = ""
            item.duration = candidates[0].duration if candidates else 5
            selected.append(item)
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
