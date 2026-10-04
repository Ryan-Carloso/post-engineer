"""End-to-end video pipeline test — real ffmpeg, minimal mocking.

Runs the full faceless generation pipeline (script -> audio -> materials ->
combine -> mux) with the REAL pipeline code and REAL ffmpeg. The ONLY thing
mocked is the LLM itself: the pipeline still builds the real script prompt
and calls ``app.services.llm.generate_script``, but that seam returns a
canned script instead of spending AI tokens — the mock lives inside the
engine, at the paid-API boundary, not in the web layer.

Materials are generated locally by ffmpeg as three distinct solid colors
and the audio is a real sine-wave file — no API keys, no network. The
final video must visibly contain DIFFERENT segments (regression test for
"the same clip repeats forever"): frames sampled across the timeline must
show different dominant colors.
"""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

from app.models.schema import MaterialInfo, TaskVideoRequest
from app.services import llm as llm_service
from app.services import task as tm

MATERIAL_COLORS = {
    "red": "0xFF0000",
    "green": "0x00FF00",
    "blue": "0x0000FF",
}
# The script the mocked LLM returns: two sentences, matching what the
# real prompt asks for. The pipeline builds the real prompt and calls the
# real llm.generate_script seam — only the response text is canned.
MOCKED_SCRIPT = (
    "First paragraph of the validation script. "
    "Second paragraph of the validation script."
)
AUDIO_SECONDS = 12
MATERIAL_SECONDS = 6
WIDTH, HEIGHT = 1080, 1920


def _ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _make_materials(local_videos: Path) -> list[str]:
    """Three visually distinct clips (solid colors) as pipeline materials."""
    names = []
    for name, color in MATERIAL_COLORS.items():
        out = local_videos / f"e2e-{name}.mp4"
        _ffmpeg(
            "-f", "lavfi", "-i",
            f"color={color}:size={WIDTH}x{HEIGHT}:duration={MATERIAL_SECONDS}:rate=30",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            str(out),
        )
        names.append(out.name)
    return names


def _make_audio(local_videos: Path) -> str:
    out = local_videos / "e2e-narration.wav"
    _ffmpeg(
        "-f", "lavfi", "-i",
        f"sine=frequency=440:duration={AUDIO_SECONDS}",
        "-c:a", "pcm_s16le",
        str(out),
    )
    return out.name


def _probe_streams(video: Path) -> list[dict]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,width,height",
            "-of", "csv=p=0",
            str(video),
        ],
        check=True, capture_output=True, text=True,
    )
    streams = []
    for line in out.stdout.strip().splitlines():
        parts = line.split(",")
        streams.append({"codec_type": parts[0]})
        if len(parts) == 3:
            streams[-1].update(width=int(parts[1]), height=int(parts[2]))
    return streams


def _probe_duration(video: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            str(video),
        ],
        check=True, capture_output=True, text=True,
    )
    return float(out.stdout.strip())


def _dominant_channel(video: Path, at_seconds: float) -> str:
    """Dominant RGB channel of a single frame — pure stdlib, no PIL."""
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", str(at_seconds),
            "-i", str(video), "-vframes", "1",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        check=True, capture_output=True,
    )
    px = out.stdout
    n = len(px) // 3
    assert n > 0, "could not extract frame"
    avg = {
        "r": sum(px[0::3]) / n,
        "g": sum(px[1::3]) / n,
        "b": sum(px[2::3]) / n,
    }
    return max(avg, key=lambda k: avg[k])


def test_faceless_pipeline_renders_multi_material_video(tmp_path, monkeypatch):
    # Isolate engine storage: materials, task dirs and audio all live here.
    storage = tmp_path / "storage"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(storage))
    local_videos = storage / "local_videos"
    local_videos.mkdir(parents=True)

    # Mock the LLM inside the engine, at the paid-API boundary: the
    # pipeline builds the real prompt and calls llm.generate_script, but
    # gets a canned script back instead of spending AI tokens.
    monkeypatch.setattr(
        llm_service, "generate_script", lambda **kwargs: MOCKED_SCRIPT
    )

    material_names = _make_materials(local_videos)
    audio_name = _make_audio(local_videos)

    params = TaskVideoRequest(
        video_subject="E2E validation",
        video_materials=[
            MaterialInfo(provider="local", url=name, duration=0)
            for name in material_names
        ],
        video_aspect="9:16",
        custom_audio_file=audio_name,
        subtitle_enabled=False,
    )
    task_id = f"e2e-{uuid.uuid4().hex[:8]}"
    result = tm.start(task_id=task_id, params=params, stop_at="video")

    assert result is not None, "pipeline returned no result"
    videos = result["videos"]
    assert len(videos) == 1
    final = Path(videos[0])
    assert final.is_file()

    streams = _probe_streams(final)
    video_streams = [s for s in streams if s["codec_type"] == "video"]
    audio_streams = [s for s in streams if s["codec_type"] == "audio"]
    assert len(video_streams) == 1
    assert video_streams[0]["width"] == WIDTH
    assert video_streams[0]["height"] == HEIGHT
    assert len(audio_streams) == 1, "final video has no audio stream"

    duration = _probe_duration(final)
    # The video is assembled from whole 2s subclips, so it rounds UP to
    # cover the audio (12s audio -> 7x2s = 14s); it must cover the audio
    # but never exceed it by more than one subclip plus the safety margin.
    assert AUDIO_SECONDS <= duration <= AUDIO_SECONDS + 2.5, (
        f"unexpected duration {duration}"
    )

    # The pipeline must assemble DIFFERENT materials, not repeat one clip:
    # the three primary 2s slices (one per color) land in the first 6s.
    channels = {
        _dominant_channel(final, at)
        for at in (1.0, 3.0, 5.0)
    }
    assert channels == {"r", "g", "b"}, (
        f"expected all three materials in the first 6s, got {channels}"
    )

    # Leave no trace outside tmp_path.
    shutil.rmtree(storage, ignore_errors=True)
