"""Direct tests for the SigLIP ONNX scorer.

The production scorer is injected through constructor options (the repo's
pattern): tests substitute a stub session, tokenizer, and frame sampler,
so no test downloads a model, a clip, or a real frame. The stub session
returns a fixed logit per frame, keyed by the frame array's mean, so the
best-of-frames rule is exercised deterministically.
"""

import math
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.siglip_scorer import SiglipScorer, VerificationUnavailable


class _StubOutput:
    def __init__(self, name):
        self.name = name


class _StubSession:
    """Fake ONNX session: logit = 10 * mean(pixel_values) - 5."""

    def get_outputs(self):
        return [_StubOutput("logits_per_image")]

    def run(self, _outputs, inputs):
        mean = float(np.asarray(inputs["pixel_values"]).mean())
        logit = 10.0 * mean - 5.0
        return [np.array([[logit]], dtype=np.float32)]


class _StubTokenizer:
    class _Encoding:
        def __init__(self, ids):
            self.ids = ids

    def __init__(self):
        self.seen_texts = []
        self.seen_input_ids = []

    def encode(self, text):
        self.seen_texts.append(text)
        return self._Encoding([1, 2, 3])

    def token_to_id(self, token):
        # Mirrors the real tokenizer config: pad_token is "</s>", id 1.
        return 1 if token == "</s>" else None


class _CapturingSession(_StubSession):
    def __init__(self):
        self.seen_input_ids = []

    def run(self, _outputs, inputs):
        self.seen_input_ids.append(list(inputs["input_ids"][0]))
        return super().run(_outputs, inputs)


def _make_png(path, gray):
    image = Image.new("RGB", (16, 16), (gray, gray, gray))
    image.save(path, format="PNG")


def _make_clip(path):
    with open(path, "wb") as handle:
        handle.write(b"fake clip")


class TestSiglipScorer(unittest.TestCase):
    def test_sigmoid_logit_path_scores_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            frame = os.path.join(tmp, "frame.png")
            _make_png(frame, 255)
            clip = os.path.join(tmp, "clip.mp4")
            _make_clip(clip)
            _make_clip(os.path.join(tmp, "model.onnx"))
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            scorer = SiglipScorer(
                os.path.join(tmp, "model.onnx"),
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
                frame_sampler=lambda _video, _times, _dir: [frame],
            )
            # White frame: mean after (x-0.5)/0.5 normalization is 1.0,
            # logit 5.0, sigmoid ~0.993.
            score = scorer.score(clip, "a waterfall")
            self.assertAlmostEqual(score, 1.0 / (1.0 + math.exp(-5.0)), places=4)

    def test_text_is_lowercased_and_padded_to_64_with_pad_id(self):
        """SigLIP has no attention mask, so unpadded ids collapse to
        logit ~-20 and no stock ever passes. This pins the fix: lowercase
        text, ids padded to exactly 64 with the pad id (1). Removing the
        padding must fail this test (mutation-verified by hand: a stub
        session that records input_ids sees the unpadded list)."""
        with tempfile.TemporaryDirectory() as tmp:
            frame = os.path.join(tmp, "frame.png")
            _make_png(frame, 255)
            clip = os.path.join(tmp, "clip.mp4")
            _make_clip(clip)
            _make_clip(os.path.join(tmp, "model.onnx"))
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            tokenizer = _StubTokenizer()
            session = _CapturingSession()
            scorer = SiglipScorer(
                os.path.join(tmp, "model.onnx"),
                session_factory=lambda _path: session,
                tokenizer_factory=lambda _path: tokenizer,
                frame_sampler=lambda _video, _times, _dir: [frame],
            )
            scorer.score(clip, "A Glass of Red Wine")
            self.assertEqual(tokenizer.seen_texts, ["a glass of red wine"])
            self.assertEqual(len(session.seen_input_ids), 1)
            input_ids = session.seen_input_ids[0]
            self.assertEqual(len(input_ids), 64)
            self.assertEqual(input_ids[:3], [1, 2, 3])
            self.assertEqual(input_ids[3:], [1] * 61)

    def test_scoring_reuses_engine_cache_before_temp_download(self):
        """The scorer must ask the stock cache first (no save_dir), not
        re-download every candidate into a fresh temp dir. A tmp-only
        scorer still scores, so this pins the call arguments, not just
        the score."""
        import unittest.mock as mock

        with tempfile.TemporaryDirectory() as tmp:
            frame = os.path.join(tmp, "frame.png")
            _make_png(frame, 255)
            clip = os.path.join(tmp, "clip.mp4")
            _make_clip(clip)
            _make_clip(os.path.join(tmp, "model.onnx"))
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            scorer = SiglipScorer(
                os.path.join(tmp, "model.onnx"),
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
                frame_sampler=lambda _video, _times, _dir: [frame],
            )
            from app.services import video_download

            calls = []

            def fake_save_video(url, save_dir=""):
                calls.append(save_dir)
                return clip

            with mock.patch.object(
                video_download, "save_video", side_effect=fake_save_video
            ):
                scorer.score("https://cdn.example/clip.mp4", "a waterfall")
            # First call: default cache dir (no explicit save_dir).
            self.assertEqual(calls[0], "")
            self.assertEqual(len(calls), 1)

    def test_svg_path_is_never_sent_to_stock_downloader(self):
        with tempfile.TemporaryDirectory() as tmp:
            _make_clip(os.path.join(tmp, "model.onnx"))
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            scorer = SiglipScorer(
                os.path.join(tmp, "model.onnx"),
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
            )
            with self.assertRaises(VerificationUnavailable):
                scorer.score("catalog/traveler-eating-local-food.svg", "food")

    def test_best_frame_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            dark = os.path.join(tmp, "dark.png")
            bright = os.path.join(tmp, "bright.png")
            _make_png(dark, 0)
            _make_png(bright, 255)
            clip = os.path.join(tmp, "clip.mp4")
            _make_clip(clip)
            _make_clip(os.path.join(tmp, "model.onnx"))
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            scorer = SiglipScorer(
                os.path.join(tmp, "model.onnx"),
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
                frame_sampler=lambda _video, _times, _dir: [dark, bright],
            )
            score = scorer.score(clip, "a waterfall")
            self.assertAlmostEqual(score, 1.0 / (1.0 + math.exp(-5.0)), places=4)

    def test_missing_model_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            scorer = SiglipScorer(
                os.path.join(tmp, "no-such-model.onnx"),
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
            )
            with self.assertRaises(VerificationUnavailable):
                scorer.score(os.path.join(tmp, "clip.mp4"), "a waterfall")

    def test_missing_tokenizer_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = os.path.join(tmp, "model.onnx")
            with open(model, "wb") as handle:
                handle.write(b"fake")
            scorer = SiglipScorer(
                model,
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
            )
            with self.assertRaises(VerificationUnavailable):
                scorer.score(os.path.join(tmp, "clip.mp4"), "a waterfall")

    def test_no_frames_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = os.path.join(tmp, "model.onnx")
            with open(model, "wb") as handle:
                handle.write(b"fake")
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            clip = os.path.join(tmp, "clip.mp4")
            _make_clip(clip)
            scorer = SiglipScorer(
                model,
                session_factory=lambda _path: _StubSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
                frame_sampler=lambda _video, _times, _dir: [],
            )
            with self.assertRaises(VerificationUnavailable):
                scorer.score(clip, "a waterfall")

    def test_cosine_fallback_without_logits(self):
        class _CosineSession:
            def get_outputs(self):
                return [_StubOutput("image_embeds"), _StubOutput("text_embeds")]

            def run(self, _outputs, _inputs):
                image = np.array([[1.0, 0.0]], dtype=np.float32)
                text = np.array([[1.0, 0.0]], dtype=np.float32)
                return [image, text]

        with tempfile.TemporaryDirectory() as tmp:
            frame = os.path.join(tmp, "frame.png")
            _make_png(frame, 128)
            clip = os.path.join(tmp, "clip.mp4")
            _make_clip(clip)
            _make_clip(os.path.join(tmp, "model.onnx"))
            with open(os.path.join(tmp, "tokenizer.json"), "w") as handle:
                handle.write("{}")
            scorer = SiglipScorer(
                os.path.join(tmp, "model.onnx"),
                session_factory=lambda _path: _CosineSession(),
                tokenizer_factory=lambda _path: _StubTokenizer(),
                frame_sampler=lambda _video, _times, _dir: [frame],
            )
            self.assertAlmostEqual(scorer.score(clip, "a waterfall"), 1.0)


if __name__ == "__main__":
    unittest.main()
