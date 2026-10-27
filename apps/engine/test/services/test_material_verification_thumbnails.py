"""Verification scores the preview image, a few candidates per segment, in parallel."""

import threading
from unittest.mock import patch

from app.models.schema import MaterialInfo
from app.services import material_verification as mv
from app.services import siglip_scorer, stock_thumbnails


def _stock(n: int, thumbnail: bool = True):
    return [
        stock_thumbnails.item(
            "pexels", f"https://v/{n_}.mp4", 8, f"https://i/{n_}.jpg" if thumbnail else None
        )
        for n_ in range(n)
    ]


def test_the_preview_image_is_scored_instead_of_the_clip():
    seen = []

    def scorer(target, phrase):
        seen.append(target)
        return 0.5

    mv._score_candidates(_stock(2), "a cat", scorer)
    assert sorted(seen) == ["https://i/0.jpg", "https://i/1.jpg"]


def test_a_candidate_without_a_preview_is_scored_by_its_clip():
    seen = []
    mv._score_candidates(_stock(1, thumbnail=False), "a cat", lambda t, p: seen.append(t) or 0.5)
    assert seen == ["https://v/0.mp4"]


def test_plain_material_info_without_preview_attribute_still_scores():
    seen = []
    item = MaterialInfo(provider="pexels", url="https://v/x.mp4", duration=8)
    mv._score_candidates([item], "a cat", lambda t, p: seen.append(t) or 0.5)
    assert seen == ["https://v/x.mp4"]


def test_only_the_first_candidates_of_a_segment_are_scored():
    seen = []
    lock = threading.Lock()

    def scorer(target, phrase):
        with lock:
            seen.append(target)
        return 0.5

    mv._score_candidates(_stock(30), "a cat", scorer)
    assert mv.MAX_SCORED_PER_SEGMENT == 12
    assert sorted(seen) == sorted(f"https://i/{n}.jpg" for n in range(12))


def test_results_are_ranked_by_score_whatever_the_thread_order():
    scores = {f"https://i/{n}.jpg": n / 10 for n in range(6)}
    scored, failed = mv._score_candidates(_stock(6), "a cat", lambda t, p: scores[t])
    assert [c.url for c, _ in scored] == [f"https://v/{n}.mp4" for n in (5, 4, 3, 2, 1, 0)]
    assert failed is False


def test_candidates_are_scored_in_parallel():
    barrier = threading.Barrier(2, timeout=5)

    def scorer(target, phrase):
        barrier.wait()  # only passes when two candidates run at the same time
        return 0.5

    scored, failed = mv._score_candidates(_stock(2), "a cat", scorer)
    assert len(scored) == 2 and failed is False


def test_a_failing_candidate_does_not_stop_the_others():
    def scorer(target, phrase):
        if target.endswith("/1.jpg"):
            raise RuntimeError("bad image")
        return 0.5

    scored, failed = mv._score_candidates(_stock(3), "a cat", scorer)
    assert len(scored) == 2 and failed is True


def test_the_default_scorer_is_shared_between_segments():
    built = []

    class Fake:
        def __init__(self, path):
            built.append(path)

        def score(self, target, phrase):
            return 0.5

    mv._shared_scorers.clear()
    with patch.object(mv, "SiglipScorer", Fake), patch.object(mv.siglip_model, "ensure_model"), patch.dict(
        mv.config.app, {"material_verification_model_path": "/m/model_q4.onnx"}
    ):
        mv._score_candidates(_stock(2), "one", None)
        mv._score_candidates(_stock(2), "two", None)
    assert built == ["/m/model_q4.onnx"]


def test_the_default_scorer_makes_sure_the_model_is_there():
    ensured = []

    class Fake:
        def __init__(self, path):
            pass

        def score(self, target, phrase):
            return 0.5

    mv._shared_scorers.clear()
    with patch.object(mv, "SiglipScorer", Fake), patch.object(
        mv.siglip_model, "ensure_model", side_effect=lambda p, fetch=None: ensured.append(p)
    ), patch.dict(mv.config.app, {"material_verification_model_path": "/m/model_q4.onnx"}):
        mv._score_candidates(_stock(1), "one", None)
    assert ensured == ["/m/model_q4.onnx"]


def test_a_model_that_cannot_be_fetched_fails_closed():
    mv._shared_scorers.clear()
    with patch.object(
        mv.siglip_model, "ensure_model", side_effect=siglip_scorer.VerificationUnavailable("offline")
    ), patch.dict(mv.config.app, {"material_verification_model_path": "/m/model_q4.onnx"}):
        scored, failed = mv._score_candidates(_stock(2), "one", None)
    assert scored == [] and failed is True
