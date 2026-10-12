"""Generate the Option A narration in the cloned ryan voice, then run LongCat 720p."""

import json
import subprocess
import sys
import time
from pathlib import Path

import modal

from app.services import longcat_bench, voice

# infinitetalk.py lives at apps/engine/infinitetalk.py, outside the app
# package, so import it by path rather than by name.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import infinitetalk  # noqa: E402

SCRIPT = (
    "Você tem uma ideia. O Post Engineer monta o vídeo inteiro sozinho: "
    "roteiro, voz sintética, um avatar falando e publicação automática nas redes."
)
IMAGE = sys.argv[1]
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
OUT = Path(sys.argv[3])
RESOLUTION = sys.argv[4] if len(sys.argv) > 4 else "720p"

OUT.parent.mkdir(parents=True, exist_ok=True)

# 1. Narration in the freshly cloned ryan voice.
audio_file = str(OUT.parent / "ryan-narration.mp3")
print("[1/4] TTS voice=chatterbox:ryan", flush=True)
voice.tts(SCRIPT, "chatterbox:ryan", audio_file)
print(f"      narration={infinitetalk.audio_duration_seconds(audio_file):.2f}s", flush=True)

# 2. Trim to the exact clip length (3 segments -> 10.12s for a 10s target).
segments = longcat_bench.segments_for_duration(SECONDS)
clip_s = longcat_bench.clip_seconds(segments)
trimmed = str(OUT.parent / "ryan-clip.mp3")
infinitetalk.trim_audio(audio_file, trimmed, duration_seconds=clip_s, padding_seconds=0.0)
print(f"[2/4] trimmed to {infinitetalk.audio_duration_seconds(trimmed):.2f}s "
      f"({segments} segments -> {clip_s:.2f}s rendered)", flush=True)

# 3. Cold container so the boot span is real.
subprocess.run(["uv","run","modal","app","stop","moneyprint-longcat-bench","-y"],
               capture_output=True, check=False)
subprocess.run(["uv","run","modal","deploy","modal_longcat.py"],
               capture_output=True, check=False)

# 4. Generate.
runner = modal.Function.from_name("moneyprint-longcat-bench", "generate_h200")
started = time.monotonic()
print(f"[3/4] generating {RESOLUTION} on H200 ...", flush=True)
video_bytes, timings = runner.remote(
    Path(IMAGE).read_bytes(), Path(trimmed).read_bytes(), RESOLUTION, segments
)
wall = time.monotonic() - started
OUT.write_bytes(video_bytes)
print(f"[4/4] done in {wall:.0f}s", flush=True)

probe = subprocess.run(
    ["ffprobe","-v","error","-show_entries","format=duration",
     "-of","default=noprint_wrappers=1:nokey=1",str(OUT)],
    capture_output=True, text=True,
)
rendered = round(float(probe.stdout.strip()), 3) if probe.returncode == 0 else None

report = {
    "model": "longcat-video-avatar-1.5",
    "resolution": RESOLUTION,
    "voice": "chatterbox:ryan (cloned from 'Ryan voice.m4a')",
    "script": SCRIPT,
    "image": IMAGE,
    "num_segments": segments,
    "rendered_seconds": rendered,
    "container_cold_start_s": timings.get("container_cold_start_s"),
    "inference_gpu_s": timings.get("total_gpu_s"),
    "gpu_s_incl_boot": timings.get("gpu_s_incl_boot"),
    "inference_cost_usd": timings.get("cost_usd"),
    "gpu_s_incl_boot_cost_usd": timings.get("cost_usd_incl_boot"),
    "peak_vram_gb": timings.get("peak_vram_gb"),
    "wall_seconds": round(wall, 1),
    "video": str(OUT),
    "audio": trimmed,
}
print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)
OUT.with_suffix(".json").write_text(json.dumps(report, indent=2, ensure_ascii=False))