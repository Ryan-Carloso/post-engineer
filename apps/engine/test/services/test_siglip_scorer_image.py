"""SiglipScorer on a preview image: one inference, no video, no ffmpeg."""

from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image

from app.services import siglip_scorer
from app.services.siglip_scorer import SiglipScorer, VerificationUnavailable


class _Out:
    name = "logits_per_image"


class _StubSession:
    def get_outputs(self):
        return [_Out()]

    def run(self, _outputs, inputs):
        logit = 10.0 * float(np.asarray(inputs["pixel_values"]).mean()) - 5.0
        return [np.array([[logit]], dtype=np.float32)]


class _StubTokenizer:
    class _Enc:
        ids = [1, 2, 3]

    def encode(self, text):
        return self._Enc()

    def token_to_id(self, token):
        return 1 if token == "</s>" else None


@pytest.fixture
def model(tmp_path):
    path = tmp_path / "model_q4.onnx"
    path.write_bytes(b"x")
    (tmp_path / "tokenizer.json").write_text("{}")
    return str(path)


def _scorer(model, **kwargs):
    return SiglipScorer(
        model,
        session_factory=lambda _p: _StubSession(),
        tokenizer_factory=lambda _p: _StubTokenizer(),
        frame_sampler=kwargs.get("frame_sampler", lambda *_a: pytest.fail("a preview image needs no frames")),
    )


def _write_image(path, value=200):
    Image.fromarray(np.full((8, 8, 3), value, dtype=np.uint8)).save(path, format="JPEG")


def test_a_local_image_is_scored_without_video_tools(model, tmp_path):
    image = tmp_path / "preview.jpg"
    _write_image(image)
    with patch.object(siglip_scorer, "_probe_duration_seconds", side_effect=AssertionError("ffprobe")):
        assert 0.0 < _scorer(model).score(str(image), "a cat") < 1.0


def test_an_image_url_is_downloaded_through_the_ssrf_guard(model):
    calls = []

    def fake_download(url, dest, **kwargs):
        calls.append((url, kwargs))
        _write_image(dest)
        return dest

    with patch.object(siglip_scorer.ssrf, "download_public_file", side_effect=fake_download):
        score = _scorer(model).score("https://images.pexels.com/videos/1/a.jpg?auto=compress", "a cat")
    assert 0.0 < score < 1.0
    url, kwargs = calls[0]
    assert url.startswith("https://images.pexels.com/")
    assert kwargs["allowed_content_types"] == ("image/",)
    assert kwargs["max_bytes"] == siglip_scorer.MAX_PREVIEW_BYTES


@pytest.mark.parametrize("ref", ["https://c/x.jpg", "https://c/x.JPEG?w=1", "https://c/x.png", "https://c/x.webp"])
def test_image_references_are_recognised(ref):
    assert siglip_scorer.is_image_ref(ref) is True


@pytest.mark.parametrize("ref", ["https://c/clip.mp4", "https://c/download?token=a.jpg", "https://c/x.svg", ""])
def test_video_references_are_not_images(ref):
    assert siglip_scorer.is_image_ref(ref) is False


def test_a_refused_download_is_unavailable_and_hides_the_url(model):
    with patch.object(siglip_scorer.ssrf, "download_public_file", side_effect=OSError("secret-host")):
        with pytest.raises(VerificationUnavailable) as caught:
            _scorer(model).score("https://secret-host/x.jpg", "a cat")
    assert "secret-host" not in str(caught.value)


def test_a_broken_image_is_unavailable(model, tmp_path):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"not an image")
    with pytest.raises(VerificationUnavailable):
        _scorer(model).score(str(bad), "a cat")
