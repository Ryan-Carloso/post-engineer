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

    def encode(self, text):
        return self._Encoding([1, 2, 3])


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
