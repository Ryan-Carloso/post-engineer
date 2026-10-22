"""CPU model backends for the local TTS server.

Each model loads lazily on first use and stays resident: Phonon (31M,
q8) and Kokoro (82M) for the house presets, Chatterbox Nano (110M) for
per-user clones. All three run on CPU only. Generation is serialized by one
lock — the VPS has a few cores, and parallel runs would only slow each
other down while multiplying peak memory.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

import numpy as np

PHONON_REPO = "hf://gradium/phonon-31m-en"
KOKORO_REPO = "hexgrad/Kokoro-82M"

_lock = threading.Lock()
_models: dict[str, Any] = {}


def _phonon() -> Any:
    if "phonon" not in _models:
        import ptts

        _models["phonon"] = ptts.TTS(PHONON_REPO, lang="en", quant="q8")
    return _models["phonon"]


def _use_system_espeak() -> None:
    """Point Kokoro's G2P at the system espeak-ng when configured.

    The espeakng-loader wheel misaki uses ships a library whose compiled-in
    data path is its CI build directory, so phonemizing fails with
    "phontab: No such file or directory". ESPEAK_NG_LIBRARY/ESPEAK_NG_DATA
    (set in Dockerfile.tts) swap in the distro's espeak-ng before misaki
    imports the loader. Unset = keep the bundled one.
    """
    library = os.environ.get("ESPEAK_NG_LIBRARY")
    data = os.environ.get("ESPEAK_NG_DATA")
    if library is None or data is None:
        return
    import espeakng_loader

    espeakng_loader.get_library_path = lambda: library
    espeakng_loader.get_data_path = lambda: data


def _kokoro(lang_code: str) -> Any:
    key = f"kokoro_{lang_code}"
    if key not in _models:
        _use_system_espeak()
        from kokoro import KPipeline

        _models[key] = KPipeline(lang_code=lang_code, repo_id=KOKORO_REPO, device="cpu")
    return _models[key]


def _nano() -> Any:
    if "nano" not in _models:
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        _models["nano"] = ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
    return _models["nano"]


def _synth_phonon(text: str, voice: str) -> tuple[np.ndarray, int]:
    tts = _phonon()
    chunks: list[np.ndarray] = []
    with tts.stream(text, voice=voice) as audio:
        sample_rate = int(audio.sample_rate)
        for pcm in audio:
            chunks.append(np.asarray(pcm, dtype=np.float32).reshape(-1))
    if not chunks:
        raise RuntimeError("phonon produced no audio")
    return np.concatenate(chunks), sample_rate


def _synth_kokoro(text: str, voice: str) -> tuple[np.ndarray, int]:
    # Kokoro voice ids start with the accent: a* = American, b* = British.
    pipeline = _kokoro("a" if voice.startswith("a") else "b")
    chunks = [
        np.asarray(result.audio, dtype=np.float32).reshape(-1)
        for result in pipeline(text, voice=voice)
        if result.audio is not None
    ]
    if not chunks:
        raise RuntimeError("kokoro produced no audio")
    return np.concatenate(chunks), 24000


def _synth_nano(text: str, reference_path: Path) -> tuple[np.ndarray, int]:
    model = _nano()
    wav = model.generate(text, audio_prompt_path=str(reference_path))
    return np.asarray(wav.detach().cpu().numpy(), dtype=np.float32).reshape(-1), int(model.sr)


def synthesize_preset(provider: str, model_voice: str, text: str) -> tuple[np.ndarray, int]:
    with _lock:
        if provider == "phonon":
            return _synth_phonon(text, model_voice)
        if provider == "kokoro":
            return _synth_kokoro(text, model_voice)
    raise ValueError(f"unknown provider: {provider}")


def synthesize_clone(reference_path: Path, text: str) -> tuple[np.ndarray, int]:
    with _lock:
        return _synth_nano(text, reference_path)


def loaded_models() -> list[str]:
    return sorted(_models)
