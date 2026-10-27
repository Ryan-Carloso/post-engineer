"""A video never fails only because the verifier doubts every segment.

SigLIP scores a whole phrase against a preview image; a local dish or a
street name ("francesinha plate interior") sits below the minimum score for
every candidate, and dropping all of them failed the whole download. When no
segment verifies, each segment keeps its best-scored candidate (ranked by the
verifier, never random) and is counted as unverified. As soon as one segment
verifies, the strict rule applies again: the rest is dropped. A verifier that
cannot run at all still fails closed.
"""

from unittest.mock import patch

from app.models.schema import MaterialInfo
from app.services import material_verification as mv

CFG = mv.VerificationConfig(enabled=True, min_score=0.33, runner_up_margin=0.05)


def _c(url):
    return MaterialInfo(provider="pexels", url=url, duration=8)


def test_all_doubtful_segments_keep_their_best_scored_candidate():
    scores = {"a1": 0.10, "a2": 0.20, "b1": 0.05, "b2": 0.01}
    groups = [("francesinha", [_c("a1"), _c("a2")]), ("street", [_c("b1"), _c("b2")])]
    items, decisions = mv.apply_verification(groups, scorer=lambda u, p: scores[u], config=CFG)
    assert [i.url for i in items] == ["a2", "b1"]
    assert [d.tier for d in decisions] == [mv.TIER_STOCK_UNVERIFIED] * 2
    assert [d.stock_url for d in decisions] == ["a2", "b1"]


def test_a_near_tie_at_the_top_is_kept_when_nothing_verifies():
    groups = [("a dish", [_c("x"), _c("y")])]
    items, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: 0.40 if u == "x" else 0.38, config=CFG
    )
    assert [i.url for i in items] == ["x"]
    assert decisions[0].tier == mv.TIER_STOCK_UNVERIFIED


def test_one_verified_segment_keeps_the_strict_rule_for_the_rest():
    scores = {"good": 0.9, "weak": 0.1}
    groups = [("a", [_c("good")]), ("b", [_c("weak")])]
    items, decisions = mv.apply_verification(groups, scorer=lambda u, p: scores[u], config=CFG)
    assert [i.url for i in items] == ["good"]
    assert [d.tier for d in decisions] == [mv.TIER_STOCK_VERIFIED, mv.TIER_DROPPED]


def test_a_scorer_that_cannot_run_still_fails_closed():
    def broken(url, phrase):
        raise mv.VerificationUnavailable("no model")

    items, decisions = mv.apply_verification([("a", [_c("x")])], scorer=broken, config=CFG)
    assert items == []
    assert [d.tier for d in decisions] == [mv.TIER_DROPPED]


def test_segments_without_candidates_stay_dropped_when_nothing_verifies():
    groups = [("a", [_c("x")]), ("b", [])]
    items, decisions = mv.apply_verification(groups, scorer=lambda u, p: 0.1, config=CFG)
    assert [i.url for i in items] == ["x"]
    assert [d.tier for d in decisions] == [mv.TIER_STOCK_UNVERIFIED, mv.TIER_DROPPED]


def test_summary_counts_the_unverified_tier():
    decisions = [
        mv.SegmentDecision(tier=mv.TIER_STOCK_UNVERIFIED, phrase="a"),
        mv.SegmentDecision(tier=mv.TIER_DROPPED, phrase="b"),
    ]
    assert mv.summarize_decisions(decisions) == {"stock_verified": 0, "stock_unverified": 1, "dropped": 1}


def test_script_order_groups_keep_unverified_segments_in_order():
    groups = [("one", [_c("p"), _c("q")]), ("two", [_c("r")])]
    with patch.dict(mv.config.app, {"material_verification_enabled": True}):
        kept = mv.verified_script_order_groups(
            groups, "t1", lambda u, p: {"p": 0.1, "q": 0.2, "r": 0.1}[u]
        )
    assert [(phrase, [i.url for i in items]) for phrase, items in kept] == [("one", ["q"]), ("two", ["r"])]
