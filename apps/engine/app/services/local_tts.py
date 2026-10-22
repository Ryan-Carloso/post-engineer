"""Local CPU TTS providers: Phonon and Kokoro presets, Chatterbox-Nano clones.

All voice generation runs in-process on CPU — the Modal-hosted
Chatterbox server is retired. Models load lazily on first use (never at
import) and stay resident as singletons:

- Phonon-31m-en via ``ptts`` (GGUF, ~64MB) for ``phonon:<Name>`` ids;
- Kokoro-82M via ``kokoro-onnx`` for ``kokoro:<voice_id>`` ids — the
  ONNX runtime keeps Kokoro off torch (only Nano needs it). The model
  and voices files download once into the Kokoro model dir
  (``[kokoro] model_dir`` / ``KOKORO_MODEL_DIR``) from the kokoro-onnx
  GitHub release;
- Chatterbox-Nano (from the Resemble source: PyPI ``chatterbox-tts``
  0.1.7 has no ``nano`` model) for per-user clones, zero-shot from the
  locally registered reference WAV.

None of these models returns word-level timestamps, so — like the
providers they replace — the subtitle timeline is the full-text
SubMaker estimate. Phonon and Nano have no speed control, so
``voice_rate`` is applied with ffmpeg ``atempo`` in the convert step;
Kokoro takes a native ``speed``.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
import wave
from pathlib import Path

import numpy as np
import requests
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from app.config import config
from app.services.analytics import scrub_secret_values
from app.services.cloned_voices.local_registry import reference_path_for
from app.services.voice_providers import (
    SubMaker,
    TtsResult,
    _preprocess_text_for_tts,
    ensure_file_path_exists,
    populate_legacy_submaker_with_full_text,
)
from app.utils import utils

PHONON_MODEL_ID = "hf://gradium/phonon-31m-en"

_KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_MODEL_URL = f"{_KOKORO_RELEASE}/kokoro-v1.0.onnx"
KOKORO_VOICES_URL = f"{_KOKORO_RELEASE}/voices-v1.0.bin"
KOKORO_SAMPLE_RATE = 24000

# ffmpeg atempo accepts 0.5-2.0 per instance; voice rates in practice
# sit well inside that, so a single clamped instance is enough.
_RATE_MIN = 0.5
_RATE_MAX = 2.0

_phonon_lock = threading.Lock()
_kokoro_lock = threading.Lock()
_nano_lock = threading.Lock()
_phonon_instance = None
_kokoro_instance = None
_nano_instance = None


def _load_phonon():
    global _phonon_instance
    if _phonon_instance is None:
        with _phonon_lock:
            if _phonon_instance is None:
                import ptts

                logger.info("loading Phonon-31m-en (ptts, CPU)")
                _phonon_instance = ptts.TTS(PHONON_MODEL_ID, lang="en", quant="q8")
    return _phonon_instance


def _kokoro_model_dir() -> Path:
    section = config.kokoro or {}
    configured = (section.get("model_dir") or os.getenv("KOKORO_MODEL_DIR") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[2] / "models" / "kokoro"


def _download_kokoro_files(model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    for url, name in ((KOKORO_MODEL_URL, "kokoro-v1.0.onnx"), (KOKORO_VOICES_URL, "voices-v1.0.bin")):
        target = model_dir / name
        if target.is_file() and target.stat().st_size > 0:
            continue
        logger.info(f"downloading Kokoro model file {name} (first boot)")
        tmp = model_dir / f".{name}.part"
        with requests.get(url, stream=True, timeout=600) as response:
            response.raise_for_status()
            with open(tmp, "wb") as out:
                for chunk in response.iter_content(chunk_size=1 << 20):
                    out.write(chunk)
        tmp.replace(target)


def _load_kokoro():
    global _kokoro_instance
    if _kokoro_instance is None:
        with _kokoro_lock:
            if _kokoro_instance is None:
                from kokoro_onnx import Kokoro

                model_dir = _kokoro_model_dir()
                _download_kokoro_files(model_dir)
                logger.info("loading Kokoro-82M (kokoro-onnx, CPU)")
                _kokoro_instance = Kokoro(
                    str(model_dir / "kokoro-v1.0.onnx"),
                    str(model_dir / "voices-v1.0.bin"),
                )
    return _kokoro_instance


def _patch_nano_norm_loudness(model) -> None:
    """Keep Nano's loudness-normalized reference at float32 under numpy >= 2.

    Upstream chatterbox pins numpy < 2: its ``norm_loudness`` multiplies
    the float32 reference by pyloudnorm's float64 gain scalar, which
    numpy 1.x value-based casting kept at float32 but numpy 2 (NEP 50)
    promotes to float64 — the S3 tokenizer then dies on a Float/Double
    matmul. The engine needs numpy >= 2 (OpenCV), so wrap the method on
    the loaded instance and cast the result back. The normalization
    itself is upstream's, unchanged.
    """
    original = model.norm_loudness

    def norm_loudness_float32(wav, sr, target_lufs=-27):
        return original(wav, sr, target_lufs).astype(np.float32, copy=False)

    model.norm_loudness = norm_loudness_float32


def _load_nano():
    global _nano_instance
    if _nano_instance is None:
        with _nano_lock:
            if _nano_instance is None:
                from chatterbox.tts_turbo import ChatterboxTurboTTS

                logger.info("loading Chatterbox-Nano (CPU)")
                _nano_instance = ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
                _patch_nano_norm_loudness(_nano_instance)
    return _nano_instance


def _write_float_wav(path: str, samples: np.ndarray, sample_rate: int) -> None:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


def _convert_to_target(wav_path: str, voice_file: str, voice_rate: float) -> None:
    """Transcode a generated WAV into the caller's target file.

    Callers hand us an .mp3 path; the local models all emit WAV. A
    non-1.0 rate rides along as an atempo filter for the providers
    without native speed control.
    """
    ensure_file_path_exists(voice_file)
    if voice_file.lower().endswith(".wav") and abs(voice_rate - 1.0) < 1e-9:
        Path(voice_file).write_bytes(Path(wav_path).read_bytes())
        return
    command = [utils.get_ffmpeg_binary(), "-y", "-i", wav_path]
    rate = max(_RATE_MIN, min(_RATE_MAX, float(voice_rate or 1.0)))
    if abs(rate - 1.0) >= 1e-9:
        command += ["-af", f"atempo={rate}"]
    command.append(voice_file)
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg convert failed: {(result.stderr or result.stdout or '').strip()[:200]}"
        )


def _finish(text: str, wav_path: str, voice_file: str, voice_rate: float) -> TtsResult:
    _convert_to_target(wav_path, voice_file, voice_rate)
    with AudioFileClip(voice_file) as clip:
        duration = clip.duration
    return TtsResult(
        sub_maker=populate_legacy_submaker_with_full_text(
            sub_maker=SubMaker(), text=text, audio_duration_seconds=duration
        )
    )


def _fail(provider: str, exc: Exception) -> TtsResult:
    reason = scrub_secret_values(str(exc))[:200]
    logger.error(f"{provider} local tts failed: {reason}")
    return TtsResult(error=f"{provider} TTS failed: {reason}")


def phonon_tts(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,  # noqa: ARG001 — parity with other providers; loudness is post-processing
) -> TtsResult:
    """Synthesize with Phonon-31m-en; ``voice`` is the Phonon voice name."""
    text = (text or "").strip()
    if not text:
        return TtsResult(error="Phonon TTS failed: text is empty")
    text = _preprocess_text_for_tts(text)
    try:
        model = _load_phonon()
        with tempfile.TemporaryDirectory(prefix="phonon-tts-") as work:
            wav_path = os.path.join(work, "out.wav")
            model.save(wav_path, text, voice=voice)
            return _finish(text, wav_path, voice_file, voice_rate)
    except Exception as exc:
        return _fail("Phonon", exc)


def kokoro_tts(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,  # noqa: ARG001 — parity with other providers
) -> TtsResult:
    """Synthesize with Kokoro-82M; ``voice`` is a Kokoro voice id (af_heart…)."""
    text = (text or "").strip()
    if not text:
        return TtsResult(error="Kokoro TTS failed: text is empty")
    text = _preprocess_text_for_tts(text)
    lang = "en-gb" if voice.startswith("b") else "en-us"
    speed = max(_RATE_MIN, min(_RATE_MAX, float(voice_rate or 1.0)))
    try:
        model = _load_kokoro()
        samples, sample_rate = model.create(text, voice=voice, speed=speed, lang=lang)
        with tempfile.TemporaryDirectory(prefix="kokoro-tts-") as work:
            wav_path = os.path.join(work, "out.wav")
            _write_float_wav(wav_path, np.asarray(samples, dtype=np.float32), int(sample_rate))
            # Kokoro already applied the rate natively.
            return _finish(text, wav_path, voice_file, 1.0)
    except Exception as exc:
        return _fail("Kokoro", exc)


def nano_clone_tts(
    text: str,
    reference_wav: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,  # noqa: ARG001 — parity with other providers
) -> TtsResult:
    """Synthesize with Chatterbox-Nano, zero-shot from a reference WAV."""
    text = (text or "").strip()
    if not text:
        return TtsResult(error="Chatterbox-Nano TTS failed: text is empty")
    text = _preprocess_text_for_tts(text)
    try:
        model = _load_nano()
        tensor = model.generate(text, audio_prompt_path=reference_wav)
        samples = tensor.squeeze(0).clamp(-1, 1).numpy()
        with tempfile.TemporaryDirectory(prefix="nano-tts-") as work:
            wav_path = os.path.join(work, "out.wav")
            _write_float_wav(wav_path, np.asarray(samples, dtype=np.float32), int(model.sr))
            return _finish(text, wav_path, voice_file, voice_rate)
    except Exception as exc:
        return _fail("Chatterbox-Nano", exc)


def clone_tts(
    text: str,
    voice_key: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
) -> TtsResult:
    """Synthesize with a registered per-user clone (Chatterbox-Nano)."""
    reference = reference_path_for(voice_key)
    if not reference.is_file():
        logger.error(f"cloned voice reference missing locally, voice_key: {voice_key}")
        return TtsResult(
            error="cloned voice is not available on this engine (reference not registered locally)"
        )
    return nano_clone_tts(text, str(reference), voice_file, voice_rate, voice_volume)
