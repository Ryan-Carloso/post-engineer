"""Prepare the BGM library for video generation.

Processes every mp3 under resource/songs/<mood>/:
- trims silence from the start so BGM always begins with sound
- removes tracks with long silent gaps in the middle
- trims silent outros and normalizes loudness (added incrementally, TDD)

Usage: uv run python scripts/prep_songs.py [--songs-dir resource/songs]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import toml
from concurrent.futures import ThreadPoolExecutor

import numpy as np

SILENCE_NOISE_DB = -40
SILENCE_MIN_DURATION = 0.5
MID_GAP_MIN_DURATION = 10.0
TRAILING_SILENCE_MIN_DURATION = 2.0
LEADING_TOLERANCE = 0.5
EDGE_TOLERANCE = 0.25


def detect_silences(path: str) -> list[tuple[float, float]]:
    """Return (start, end) silence intervals detected at -40dB."""
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "info", "-i", path,
            "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_DURATION}",
            "-f", "null", "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    intervals: list[tuple[float, float]] = []
    start: float | None = None
    for match in re.finditer(r"silence_(start|end): ([0-9.]+)", proc.stderr):
        kind, value = match.group(1), float(match.group(2))
        if kind == "start":
            start = value
        elif start is not None:
            intervals.append((start, value))
            start = None
    return intervals


def track_duration(path: str) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r'"duration":\s*"([0-9.]+)"', proc.stdout)
    return float(match.group(1)) if match else 0.0


def has_long_mid_gap(path: str) -> bool:
    """True if a silent gap (not intro, not outro) of >= 10s sits inside the track."""
    duration = track_duration(path)
    for start, end in detect_silences(path):
        is_interior = start > EDGE_TOLERANCE and end < duration - EDGE_TOLERANCE
        if is_interior and (end - start) >= MID_GAP_MIN_DURATION:
            return True
    return False


LOUDNORM_TARGET = "I=-16:TP=-1.5:LRA=11"

ANALYSIS_SR = 22050
ENVELOPE_WINDOW = 0.05
BEAT_SUSTAIN = 2.0
MIN_BPM = 70.0
MAX_BPM = 180.0
MAX_START_POINTS = 12
START_STRIDE_BARS = 2
TAIL_GUARD_RATIO = 0.15
TAIL_GUARD_MAX = 60.0


def decode_mono_pcm(path: str) -> np.ndarray:
    """Decode audio to a mono float32 array at ANALYSIS_SR via ffmpeg."""
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", path,
            "-f", "f32le", "-ac", "1", "-ar", str(ANALYSIS_SR), "pipe:",
        ],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32)


def rms_envelope(pcm: np.ndarray) -> np.ndarray:
    window = max(1, int(ANALYSIS_SR * ENVELOPE_WINDOW))
    usable = len(pcm) - (len(pcm) % window)
    if usable == 0:
        return np.zeros(1, dtype=np.float32)
    frames = pcm[:usable].reshape(-1, window)
    return np.sqrt(np.mean(frames * frames, axis=1))


def detect_beat_start(envelope: np.ndarray) -> float:
    """First moment where rhythmic energy takes over from a quiet intro.

    Percussive music alternates loud beats with gaps, so instead of requiring
    continuous energy we measure the duty cycle: the share of windows above a
    perceptual floor (midpoint between the quiet 20th and loud 90th percentiles)
    inside a sliding BEAT_SUSTAIN window. The beat has "started" once that share
    crosses 0.4 and stays rhythmic.
    """
    if envelope.size == 0 or float(envelope.max()) <= 0:
        return 0.0
    quiet = float(np.percentile(envelope, 20))
    loud = float(np.percentile(envelope, 90))
    floor = quiet + (loud - quiet) * 0.5
    musical = (envelope >= floor)
    sustain = max(1, int(BEAT_SUSTAIN / ENVELOPE_WINDOW))
    if musical.size <= sustain:
        return 0.0
    # forward-looking duty cycle: share of musical windows in [i, i+sustain)
    cumulative = np.concatenate(([0.0], np.cumsum(musical.astype(float))))
    duty = (cumulative[sustain:] - cumulative[:-sustain]) / sustain
    for index in np.flatnonzero(musical):
        if index < len(duty) and duty[index] >= 0.49:
            return float(round(index * ENVELOPE_WINDOW, 3))
    return 0.0


def detect_bpm(envelope: np.ndarray) -> float:
    """Tempo via autocorrelation of the positive onset-flux envelope."""
    if envelope.size < 10:
        return 0.0
    flux = np.diff(envelope)
    np.maximum(flux, 0.0, out=flux)
    if float(flux.max()) <= 0:
        return 0.0
    flux = flux - flux.mean()
    size = int(2 ** np.ceil(np.log2(2 * flux.size)))
    spectrum = np.fft.rfft(flux, size)
    corr = np.fft.irfft(spectrum * np.conj(spectrum))[: flux.size]
    if float(corr[0]) <= 0:
        return 0.0
    min_lag = max(1, int(np.ceil(60.0 / MAX_BPM / ENVELOPE_WINDOW)))
    max_lag = min(flux.size - 1, int(60.0 / MIN_BPM / ENVELOPE_WINDOW))
    if max_lag <= min_lag:
        return 0.0
    lag = min_lag + int(np.argmax(corr[min_lag : max_lag + 1]))
    return float(round(60.0 / (lag * ENVELOPE_WINDOW), 2))


def compute_start_points(
    beat_start: float, bpm: float, duration: float
) -> list[float]:
    """Bar-aligned candidate start offsets, always including 0.0 (track start).

    Points sit a fixed number of bars after the first beat so entering the
    middle of the track still sounds musical. The last tail_guard seconds are
    excluded so a random pick never lands near the outro, and long tracks are
    spaced out to at most MAX_START_POINTS entries.
    """
    points = [0.0]
    if bpm <= 0 or duration <= 0 or beat_start >= duration:
        return points
    bar = 60.0 / bpm * 4
    limit = duration - min(TAIL_GUARD_MAX, duration * TAIL_GUARD_RATIO)
    grid: list[float] = []
    moment = beat_start
    while moment <= limit + 1e-6:
        grid.append(moment)
        moment += bar * START_STRIDE_BARS
    if len(grid) > MAX_START_POINTS - 1:
        step = -(-len(grid) // (MAX_START_POINTS - 1))
        grid = grid[::step]
    points += [float(round(moment, 3)) for moment in grid]
    return points


def analyze_track(path: str) -> dict[str, object]:
    envelope = rms_envelope(decode_mono_pcm(path))
    beat_start = float(round(detect_beat_start(envelope), 3))
    bpm = detect_bpm(envelope)
    duration = float(envelope.size * ENVELOPE_WINDOW)
    return {
        "beat_start": beat_start,
        "bpm": bpm,
        "start_points": compute_start_points(beat_start, bpm, duration),
    }


def update_catalog(songs_dir: str, analysis: dict[str, dict]) -> None:
    """Merge per-track analysis (by 'mood/file.mp3' key) into catalog.toml."""
    catalog_path = os.path.join(songs_dir, "catalog.toml")
    catalog = toml.load(catalog_path) if os.path.isfile(catalog_path) else {}
    tracks = catalog.setdefault("tracks", [])
    by_file = {t.get("file"): t for t in tracks if isinstance(t, dict)}
    for key, values in analysis.items():
        entry = by_file.get(key)
        if entry is None:
            mood = key.split("/", 1)[0]
            entry = {"file": key, "moods": [mood]}
            tracks.append(entry)
            by_file[key] = entry
        entry.update(values)
    with open(catalog_path, "w") as fh:
        toml.dump(catalog, fh)


def measure_loudness(path: str) -> dict[str, float]:
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "info", "-i", path,
            "-af", f"loudnorm={LOUDNORM_TARGET}:print_format=json", "-f", "null", "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', proc.stderr, re.DOTALL)
    if not match:
        raise RuntimeError(f"loudnorm analysis failed for {path}")
    data = json.loads(match.group(0))
    keys = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    return {key: float(data[key]) for key in keys}


def normalize_track(path: str) -> bool:
    """Trim leading silence and normalize loudness to -16 LUFS in one rewrite."""
    silences = detect_silences(path)
    duration = track_duration(path)
    offset = 0.0
    # leading dead air: silence (or near-silence) starting right at the top;
    # cut through the end of that first silent stretch
    if silences and silences[0][0] <= LEADING_TOLERANCE:
        offset = silences[0][1]
        # a fully silent file would be trimmed to nothing; keep it whole
        if offset >= duration - EDGE_TOLERANCE:
            offset = 0.0
    # drop a long silent outro so AudioLoop restarts without a dead gap
    end: float | None = None
    if silences:
        last_start, last_end = silences[-1]
        if (
            last_end >= duration - EDGE_TOLERANCE
            and (duration - last_start) >= TRAILING_SILENCE_MIN_DURATION
        ):
            end = last_start
    # never trim to (near) empty: if the cut would leave almost no audio,
    # keep the file whole and only apply loudness normalization
    kept = (end if end is not None else duration) - offset
    if kept < 5.0:
        offset, end = 0.0, None
    measured = measure_loudness(path)
    # dynamic mode: linear=true produces empty output when measured LRA is 0
    filters = [
        "loudnorm={}:measured_I={:g}:measured_TP={:g}:measured_LRA={:g}:measured_thresh={:g}:offset={:g}".format(
            LOUDNORM_TARGET,
            measured["input_i"],
            measured["input_tp"],
            measured["input_lra"],
            measured["input_thresh"],
            measured["target_offset"],
        )
    ]
    with tempfile.TemporaryDirectory(dir=os.path.dirname(path)) as tmp:
        normalized = os.path.join(tmp, "normalized.mp3")
        command = ["ffmpeg", "-v", "error", "-i", path]
        if offset > 0:
            command += ["-ss", str(offset)]
        if end is not None:
            command += ["-to", str(end)]
        command += [
            "-af", ",".join(filters),
            "-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100", normalized, "-y",
        ]
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
        os.replace(normalized, path)
    return offset > 0


def trim_leading_silence(path: str) -> bool:
    """Superseded by normalize_track; kept as thin wrapper for one-off use."""
    normalize_track(path)
    return True


def process_track(mood: str, name: str, mood_dir: str) -> bool:
    """Normalize one track in place. Returns True if the track was normalized."""
    path = os.path.join(mood_dir, name)
    if has_long_mid_gap(path):
        os.remove(path)
        print(f"removed (mid gap): {mood}/{name}")
        return False
    normalized = normalize_track(path)
    print(f"{'trimmed intro + normalized' if normalized else 'normalized'}: {mood}/{name}")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--songs-dir", default=os.path.join("resource", "songs"))
    parser.add_argument("--workers", type=int, default=4, help="parallel ffmpeg workers")
    parser.add_argument(
        "--analyze-only",
        action="store_true",
        help="compute beat/bpm/start_points into catalog.toml without re-encoding audio",
    )
    args = parser.parse_args(argv)

    if not os.path.isdir(args.songs_dir):
        print(f"songs dir not found: {args.songs_dir}", file=sys.stderr)
        return 1

    jobs: list[tuple[str, str, str]] = []
    for mood in sorted(os.listdir(args.songs_dir)):
        mood_dir = os.path.join(args.songs_dir, mood)
        if not os.path.isdir(mood_dir):
            continue
        for name in sorted(os.listdir(mood_dir)):
            if name.lower().endswith(".mp3"):
                jobs.append((mood, name, mood_dir))

    if args.analyze_only:
        results = [False] * len(jobs)
    else:
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            results = list(pool.map(lambda job: process_track(*job), jobs))
    analysis: dict[str, dict] = {}
    for mood, name, mood_dir in jobs:
        if os.path.isfile(os.path.join(mood_dir, name)):
            analysis[f"{mood}/{name}"] = analyze_track(os.path.join(mood_dir, name))
    if analysis:
        update_catalog(args.songs_dir, analysis)
    print(f"done: {sum(results)}/{len(results)} tracks normalized")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
