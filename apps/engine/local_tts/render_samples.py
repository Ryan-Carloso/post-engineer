"""Render the picker sample for every house voice in the catalog.

Writes ``<out_dir>/<voice name>.mp3`` (mono, 64 kbps) — the files the web
voice picker plays from ``/voice-samples/<name>.mp3``. Re-run whenever
``app/services/voice_catalog.json`` changes:

    TTS_VOICES_DIR=/tmp/tts-voices PYTHONPATH=. python -m local_tts.render_samples \\
        ../web/public/voice-samples

On macOS set ESPEAK_NG_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib and
ESPEAK_NG_DATA=/opt/homebrew/share/espeak-ng-data (brew install espeak-ng).
"""

from __future__ import annotations

import io
import subprocess
import sys
from pathlib import Path

import soundfile as sf

from app.services.voice_catalog import load_catalog
from local_tts import backends

SAMPLE_TEXT = "Hi! This is how I sound. Let's make your next video together."


def render(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for voice in load_catalog():
        samples, sample_rate = backends.synthesize_preset(voice["provider"], voice["model_voice"], SAMPLE_TEXT)
        wav = io.BytesIO()
        sf.write(wav, samples, sample_rate, format="WAV")
        target = out_dir / f"{voice['name']}.mp3"
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-ac", "1", "-b:a", "64k", str(target)],
            input=wav.getvalue(),
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"mp3 encode failed for {voice['name']}: {result.stderr[-300:]!r}")
        print(f"{voice['name']}: {target.stat().st_size} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m local_tts.render_samples <out_dir>")
    render(Path(sys.argv[1]))
