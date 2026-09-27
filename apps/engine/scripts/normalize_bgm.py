#!/usr/bin/env python3
"""Attenuate loud catalog tracks once, without boosting quiet tracks."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path


TARGET_LUFS: float = -27.0
PROJECT_DIR: Path = Path(__file__).resolve().parent.parent
SONGS_DIR: Path = PROJECT_DIR / "resource" / "songs"
CATALOG_FILE: Path = SONGS_DIR / "catalog.toml"


def measure_loudness(audio_file: Path) -> float:
    command: list[str] = [
        "ffmpeg", "-hide_banner", "-i", str(audio_file), "-af",
        "loudnorm=I=-22:print_format=json", "-f", "null", "-",
    ]
    result: subprocess.CompletedProcess[str] = subprocess.run(
        command, check=False, capture_output=True, text=True
    )
    matches: list[str] = re.findall(r"\{.*?\}", result.stderr, re.DOTALL)
    if result.returncode != 0 or not matches:
        raise RuntimeError(f"ffmpeg could not measure {audio_file}: {result.stderr[-500:]}")
    data: object = json.loads(matches[-1])
    if not isinstance(data, dict) or not isinstance(data.get("input_i"), str):
        raise RuntimeError(f"ffmpeg returned no loudness for {audio_file}")
    return float(data["input_i"])


def attenuate_track(source: Path, gain_db: float) -> None:
    temporary = source.with_name(f".{source.stem}.normalized.tmp{source.suffix}")
    command: list[str] = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-af", f"volume={gain_db:.2f}dB", "-c:a", "libmp3lame", "-q:a", "2",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True)
        temporary.replace(source)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    catalog: object = tomllib.loads(CATALOG_FILE.read_text())
    if not isinstance(catalog, dict) or not isinstance(catalog.get("tracks"), list):
        raise RuntimeError(f"invalid BGM catalog: {CATALOG_FILE}")

    seen: set[Path] = set()
    for raw_track in catalog["tracks"]:
        if not isinstance(raw_track, dict) or not isinstance(raw_track.get("file"), str):
            continue
        source = SONGS_DIR / raw_track["file"]
        if source in seen:
            continue
        seen.add(source)
        if not source.is_file():
            print(f"SKIP missing: {source}", file=sys.stderr)
            continue
        loudness = measure_loudness(source)
        gain_db = min(0.0, TARGET_LUFS - loudness)
        if gain_db >= 0.0:
            print(f"KEEP {source.name}: {loudness:.1f} LUFS")
            continue
        attenuate_track(source, gain_db)
        print(f"LOWER {source.name}: {loudness:.1f} LUFS -> {gain_db:.1f} dB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
