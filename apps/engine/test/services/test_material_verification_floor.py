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
    assert [i.url for i in items] == ["a2", "a1", "b1", "b2"]
    assert [d.tier for d in decisions] == [mv.TIER_STOCK_UNVERIFIED] * 2
    assert [d.stock_url for d in decisions] == ["a2", "b1"]


def test_a_near_tie_at_the_top_is_kept_when_nothing_verifies():
    groups = [("a dish", [_c("x"), _c("y")])]
    items, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: 0.40 if u == "x" else 0.38, config=CFG
    )
    assert decisions[0].tier == mv.TIER_STOCK_UNVERIFIED
    assert [i.url for i in items] == ["x", "y"]


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


def test_doubtful_segments_keep_up_to_three_alternatives_best_first():
    # Four doubtful candidates: the cap holds the three best scores,
    # ordered best first, so the round-robin loop can rotate through them
    # instead of repeating one clip.
    scores = {"w1": 0.32, "w2": 0.30, "w3": 0.28, "w4": 0.26}
    groups = [("a dish", [_c("w1"), _c("w2"), _c("w3"), _c("w4")])]
    items, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    assert [i.url for i in items] == ["w1", "w2", "w3"]
    assert [d.tier for d in decisions] == [mv.TIER_STOCK_UNVERIFIED]
    assert [d.stock_url for d in decisions] == ["w1"]


def test_doubtful_segments_keep_exactly_the_cap_when_candidates_allow():
    # Mutation pin: shrinking the cap below 3 must fail this test; a cap
    # larger than the candidate list keeps every scored candidate.
    scores = {"w1": 0.32, "w2": 0.31, "w3": 0.30}
    groups = [("a dish", [_c("w1"), _c("w2"), _c("w3")])]
    items, _ = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    assert [i.url for i in items] == ["w1", "w2", "w3"]


def test_unverified_alternatives_are_ordered_by_score():
    # Score order beats input order: the best candidate is served first
    # on the first round-robin pass.
    scores = {"low": 0.05, "high": 0.31, "mid": 0.20}
    groups = [("a dish", [_c("low"), _c("mid"), _c("high")])]
    items, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    assert [i.url for i in items] == ["high", "mid", "low"]


def test_decisions_carry_the_ranked_candidates_best_first():
    scores = {"a": 0.32, "b": 0.30, "c": 0.10}
    groups = [("a dish", [_c("a"), _c("b"), _c("c")])]
    _, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    assert decisions[0].ranked_urls == ("a", "b", "c")
    assert decisions[0].best_url == "a"


def test_verified_segments_also_keep_scored_alternatives():
    # The verified pick stays first (highest score), and the pool keeps
    # the runner-ups so the round-robin rotates distinct scenes instead
    # of repeating one clip for the whole video.
    scores = {"a": 0.90, "b": 0.80, "c": 0.10}
    groups = [("a dish", [_c("a"), _c("b"), _c("c")])]
    items, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    # An alternate must clear the minimum score too: 0.10 is a different
    # scene (a castle, a cake), so it never rotates in behind a good pick.
    assert [i.url for i in items] == ["a", "b"]
    assert decisions[0].tier == mv.TIER_STOCK_VERIFIED
    assert decisions[0].ranked_urls == ("a", "b")


def test_verified_alternatives_are_capped():
    # Seven candidates, all scoring high: the cap holds five, the verified
    # pick first.
    scores = {u: 0.9 - n * 0.05 for n, u in enumerate("abcdefg")}
    groups = [("a dish", [_c(u) for u in "abcdefg"])]
    items, _ = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    assert mv.MAX_KEPT_VERIFIED == 5
    assert [i.url for i in items] == list("abcde")


def test_verified_still_keeps_exactly_one_alternative():
    # Single-candidate group: the pool holds only the verified pick.
    scores = {"a": 0.90}
    groups = [("a dish", [_c("a")])]
    items, decisions = mv.apply_verification(
        groups, scorer=lambda u, p: scores[u], config=CFG
    )
    assert [i.url for i in items] == ["a"]
    assert decisions[0].tier == mv.TIER_STOCK_VERIFIED
    assert decisions[0].ranked_urls == ("a",)


def test_script_order_groups_keep_unverified_segments_in_order():
    groups = [("one", [_c("p"), _c("q")]), ("two", [_c("r")])]
    with patch.dict(
        mv.config.app,
        {
            "material_verification_enabled": True,
            "material_verification_min_score": 0.33,
            "material_verification_runner_up_margin": 0.05,
        },
    ):
        kept = mv.verified_script_order_groups(
            groups, "t1", lambda u, p: {"p": 0.1, "q": 0.2, "r": 0.1}[u]
        )
    assert [(phrase, [i.url for i in items]) for phrase, items in kept] == [
        ("one", ["q", "p"]),
        ("two", ["r"]),
    ]

