"""Real SigLIP ONNX scoring for verified stock material.

This module wires the frame sampling and ONNX inference that
material_verification's OnnxClipScorer left unwired: it is a separate
module because material_verification.py is grandfathered over the
file-size cap and may not grow.

Model contract (a single ONNX file, as produced by the Xenova
siglip-base-patch16-224 export):
- Inputs: ``input_ids`` (one text) and ``pixel_values`` (one frame).
- Outputs: ``logits_per_image`` when the export provides it, otherwise
  ``image_embeds`` / ``text_embeds``.
- The score is ``sigmoid(logits_per_image)`` when logits exist: that is
  the model's own match probability, on a 0-1 scale. With embeds only,
  the score is the cosine similarity of the normalized embeddings.
- The tokenizer (``tokenizer.json``) and the image preprocessor config
  (``preprocessor_config.json``) live next to the model file; the model
  path itself comes from config (``material_verification_model_path``).

Scoring is fail-closed: a missing model, tokenizer, ffmpeg, or
onnxruntime raises VerificationUnavailable, and a candidate whose
frames cannot be scored at all raises it too. A scorer that cannot run
must never pass stock footage. A missing or unreadable
preprocessor_config.json does NOT raise: the built-in defaults (mean/std
0.5, size 224) are used, which are only correct for the Xenova SigLIP
export.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
from typing import Callable, List, Optional, Sequence

from loguru import logger


class VerificationUnavailable(Exception):
    """The scorer cannot run (missing dependency or model)."""


# Frames are sampled at this interval, starting at this offset, so the
# first frame is never a black opening frame. The count is capped so one
# candidate never costs more than a few inferences.
_FRAME_START_SECONDS = 1.0
_FRAME_INTERVAL_SECONDS = 3.0
_MAX_FRAMES_PER_CANDIDATE = 4

# Fallback image preprocessing when no preprocessor config sits next to
# the model: the Xenova SigLIP export normalizes with mean/std 0.5.
_DEFAULT_MEAN = (0.5, 0.5, 0.5)
_DEFAULT_STD = (0.5, 0.5, 0.5)
_DEFAULT_IMAGE_SIZE = 224

# Text length and padding for the SigLIP text tower. The export has no
# attention-mask input, so padding tokens are attended: unpadded input
# collapses every logit to about -20 (sigmoid 0.0) and no stock ever
# passes. The tokenizer config next to the model declares
# pad_token="</s>" and model_max_length=64; the fallbacks below only
# cover a model dir without that config file.
_DEFAULT_MAX_TEXT_LENGTH = 64
_DEFAULT_PAD_ID = 1


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def _probe_duration_seconds(video_path: str) -> Optional[float]:
    """Video duration via ffprobe, or None when it cannot be read."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return None
    try:
        duration = float(result.stdout.strip())
    except ValueError:
        return None
    return duration if duration > 0 else None


def _sample_frame_times(duration: Optional[float]) -> List[float]:
    """Frame timestamps for one candidate, capped and never empty."""
    times: List[float] = []
    timestamp = _FRAME_START_SECONDS
    while len(times) < _MAX_FRAMES_PER_CANDIDATE:
        if duration is not None and timestamp >= duration:
            break
        times.append(timestamp)
        timestamp += _FRAME_INTERVAL_SECONDS
    return times or [_FRAME_START_SECONDS]


def _extract_frames(video_path: str, times: Sequence[float], tmp_dir: str) -> List[str]:
    """Extract one PNG per timestamp with ffmpeg, skipping failures."""
    frames: List[str] = []
    for index, timestamp in enumerate(times):
        out_path = os.path.join(tmp_dir, f"frame-{index}.png")
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-ss",
                    str(timestamp),
                    "-i",
                    video_path,
                    "-frames:v",
                    "1",
                    out_path,
                ],
                check=True,
                capture_output=True,
                timeout=60,
            )
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
            logger.warning(f"siglip frame extraction failed at {timestamp}s: {exc}")
            continue
        if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
            frames.append(out_path)
    return frames


class SiglipScorer:
    """ONNX SigLIP scorer over sampled video frames.

    Dependencies are injected through the constructor (the repo's options
    pattern) so tests can substitute a stub session, tokenizer, or frame
    sampler without a test-only seam on the production interface.
    """

    def __init__(
        self,
        model_path: str,
        session_factory: Optional[Callable[[str], object]] = None,
        tokenizer_factory: Optional[Callable[[str], object]] = None,
        frame_sampler: Optional[Callable[[str, Sequence[float], str], List[str]]] = None,
    ):
        self._model_path = model_path
        self._session_factory = session_factory or self._default_session_factory
        self._tokenizer_factory = tokenizer_factory or self._default_tokenizer_factory
        self._frame_sampler = frame_sampler or _extract_frames
        self._session: Optional[object] = None
        self._tokenizer: Optional[object] = None
        self._mean, self._std, self._size = self._load_preprocessor()

    @staticmethod
    def _default_session_factory(model_path: str) -> object:
        try:
            import onnxruntime
        except ImportError as exc:
            raise VerificationUnavailable(
                "onnxruntime is not installed; install onnxruntime and "
                "download a SigLIP ONNX model to enable stock verification"
            ) from exc
        return onnxruntime.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )

    @staticmethod
    def _default_tokenizer_factory(tokenizer_path: str) -> object:
        try:
            from tokenizers import Tokenizer
        except ImportError as exc:
            raise VerificationUnavailable(
                "tokenizers is not installed; install tokenizers and "
                "download a SigLIP ONNX model to enable stock verification"
            ) from exc
        return Tokenizer.from_file(tokenizer_path)

    def _load_preprocessor(self) -> tuple:
        """Image mean/std/size from the config next to the model."""
        model_dir = os.path.dirname(os.path.abspath(self._model_path))
        config_path = os.path.join(model_dir, "preprocessor_config.json")
        if not os.path.isfile(config_path):
            return _DEFAULT_MEAN, _DEFAULT_STD, _DEFAULT_IMAGE_SIZE
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
            mean = tuple(float(value) for value in raw["image_mean"])
            std = tuple(float(value) for value in raw["image_std"])
            size = raw["size"]
            image_size = int(size["width"] if isinstance(size, dict) else size)
            if len(mean) != 3 or len(std) != 3 or image_size <= 0:
                raise ValueError("bad preprocessor config")
            return mean, std, image_size
        except (ValueError, KeyError, TypeError, OSError) as exc:
            logger.warning(f"siglip preprocessor config unreadable: {exc}")
            return _DEFAULT_MEAN, _DEFAULT_STD, _DEFAULT_IMAGE_SIZE

    def _session_or_raise(self) -> object:
        if self._session is None:
            if not self._model_path or not os.path.isfile(self._model_path):
                raise VerificationUnavailable(
                    "material_verification_model_path is not set or missing; "
                    "download a SigLIP ONNX model to enable stock verification"
                )
            self._session = self._session_factory(self._model_path)
        return self._session

    def _tokenizer_or_raise(self) -> object:
        if self._tokenizer is None:
            model_dir = os.path.dirname(os.path.abspath(self._model_path))
            tokenizer_path = os.path.join(model_dir, "tokenizer.json")
            if not os.path.isfile(tokenizer_path):
                raise VerificationUnavailable(
                    "tokenizer.json is missing next to the SigLIP model; "
                    "download a SigLIP ONNX model to enable stock verification"
                )
            self._tokenizer = self._tokenizer_factory(tokenizer_path)
        return self._tokenizer

    def _text_config(self, tokenizer: object) -> tuple:
        """(max_length, pad_id) for the text tower, from the tokenizer.

        The tokenizer config next to the model is authoritative when
        present (pad_token + model_max_length). Without it, the pad
        token's own id is used, falling back to the SigLIP default 1.
        """
        model_dir = os.path.dirname(os.path.abspath(self._model_path))
        max_length = _DEFAULT_MAX_TEXT_LENGTH
        pad_token = None
        config_path = os.path.join(model_dir, "tokenizer_config.json")
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if isinstance(raw.get("model_max_length"), int):
                max_length = raw["model_max_length"]
            if isinstance(raw.get("pad_token"), str):
                pad_token = raw["pad_token"]
        except (OSError, ValueError):
            pass
        token_to_id = getattr(tokenizer, "token_to_id", None)
        if callable(token_to_id):
            for candidate in ([pad_token] if pad_token else []) + ["</s>", "<pad>"]:
                try:
                    found = token_to_id(candidate)
                except Exception:  # noqa: BLE001 - any tokenizer failure falls back
                    found = None
                if isinstance(found, int):
                    return max_length, found
        pad_id = getattr(tokenizer, "pad_token_id", None)
        if isinstance(pad_id, int):
            return max_length, pad_id
        return max_length, _DEFAULT_PAD_ID

    def _encode_text(self, tokenizer: object, phrase: str) -> List[int]:
        """Lowercased token ids, padded (or truncated) to the max length."""
        max_length, pad_id = self._text_config(tokenizer)
        token_ids = tokenizer.encode(phrase.lower()).ids  # type: ignore[attr-defined]
        if not token_ids:
            raise VerificationUnavailable("phrase produced no tokens")
        return (list(token_ids)[:max_length] + [pad_id] * max_length)[:max_length]

    def _image_array(self, frame_path: str) -> object:
        """One frame as a normalized NCHW float array for the model."""
        import numpy as np
        from PIL import Image

        with Image.open(frame_path) as image:
            resized = image.convert("RGB").resize(
                (self._size, self._size), Image.BICUBIC
            )
            array = np.asarray(resized, dtype=np.float32) / 255.0
        mean = np.asarray(self._mean, dtype=np.float32)
        std = np.asarray(self._std, dtype=np.float32)
        normalized = (array - mean) / std
        return np.transpose(normalized, (2, 0, 1))[None, :].astype(np.float32)

    def _score_frame(self, session: object, token_ids: Sequence[int], frame_path: str) -> float:
        """Score one frame: sigmoid logit when present, else cosine."""
        import numpy as np

        inputs = {
            "input_ids": np.array([list(token_ids)], dtype=np.int64),
            "pixel_values": self._image_array(frame_path),
        }
        outputs = session.run(None, inputs)  # type: ignore[attr-defined]
        names = [output.name for output in session.get_outputs()]  # type: ignore[attr-defined]
        if "logits_per_image" in names:
            logit = float(np.asarray(outputs[names.index("logits_per_image")]).flat[0])
            return _sigmoid(logit)
        if "image_embeds" in names and "text_embeds" in names:
            image = np.asarray(outputs[names.index("image_embeds")])[0]
            text = np.asarray(outputs[names.index("text_embeds")])[0]
            image_norm = float(np.linalg.norm(image))
            text_norm = float(np.linalg.norm(text))
            if image_norm == 0 or text_norm == 0:
                raise ValueError("zero-norm embedding")
            return float(np.dot(image, text) / (image_norm * text_norm))
        raise ValueError("model outputs neither logits nor embeds")

    def _local_video_path(self, candidate_url: str, tmp_dir: str) -> str:
        """A local file for the candidate: the file itself, or a download.

        Catalog SVG relative paths are never stock: they must not reach
        the stock downloader (which rejects non-http URLs). The caller
        filters provider="svg" items out of stock scoring; this guard is
        the second line of defence for a stray SVG path.
        """
        if os.path.isfile(candidate_url):
            return candidate_url
        if candidate_url.lower().endswith(".svg"):
            raise VerificationUnavailable(
                "catalog SVG material is not scored as stock footage"
            )
        from app.services import video_download

        # Reuse the engine stock cache first: the material pipeline usually
        # already downloaded this clip, and re-downloading it into a fresh
        # temp dir on every score wastes a download per candidate. The
        # temp-dir download stays as the fallback for uncached candidates.
        path = video_download.save_video(candidate_url)
        if not path:
            path = video_download.save_video(candidate_url, save_dir=tmp_dir)
        if not path or not os.path.isfile(path):
            raise VerificationUnavailable(
                "candidate clip could not be downloaded for scoring"
            )
        return path

    def score(self, candidate_url: str, phrase: str) -> float:
        """Best frame score for a candidate clip, or VerificationUnavailable."""
        session = self._session_or_raise()
        tokenizer = self._tokenizer_or_raise()
        token_ids = self._encode_text(tokenizer, phrase)
        with tempfile.TemporaryDirectory() as tmp_dir:
            video_path = self._local_video_path(candidate_url, tmp_dir)
            times = _sample_frame_times(_probe_duration_seconds(video_path))
            frames = self._frame_sampler(video_path, times, tmp_dir)
            if not frames:
                raise VerificationUnavailable("no frames could be sampled")
            scores: List[float] = []
            for frame_path in frames:
                try:
                    scores.append(self._score_frame(session, token_ids, frame_path))
                except (ValueError, RuntimeError) as exc:
                    logger.warning(f"siglip frame scoring failed: {exc}")
            if not scores:
                raise VerificationUnavailable("no frame scored successfully")
            return max(scores)
