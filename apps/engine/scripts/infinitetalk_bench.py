"""Run InfiniteTalk jobs and keep each MP4 beside its cost report."""

from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict
from uuid import uuid4


class JobResponse(TypedDict):
    job_id: str
    call_id: str


class RunRecord(TypedDict):
    folder: str
    status: str
    cost_usd: float | None
    timings: dict[str, object]


@dataclass(frozen=True)
class ExperimentCase:
    name: str
    sample_steps: int
    teacache_thresh: float
    size: str


def default_experiment_cases() -> list[ExperimentCase]:
    """Return the named quality/cost cases used by the Modal benchmark suite."""
    return [
        ExperimentCase("480p_fast_steps8_tc04", 8, 0.4, "infinitetalk-480"),
        ExperimentCase("480p_balanced_steps10_tc04", 10, 0.4, "infinitetalk-480"),
        ExperimentCase("720p_baseline_steps12_tc03", 12, 0.3, "infinitetalk-720"),
        ExperimentCase("720p_fast_steps8_tc04", 8, 0.4, "infinitetalk-720"),
        ExperimentCase("720p_balanced_steps10_tc04", 10, 0.4, "infinitetalk-720"),
    ]


def experiment_output_dir(root: Path, case: ExperimentCase) -> Path:
    """Return the isolated output directory for one named experiment."""
    return root / case.name


def format_elapsed(seconds: float) -> str:
    """Format elapsed benchmark time as HH:MM:SS."""
    total_seconds = max(0, int(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds_part = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds_part:02d}"


def progress_bar(progress: int) -> str:
    """Render the compact progress indicator used in benchmark logs."""
    bounded = max(0, min(progress, 100))
    filled = bounded // 5
    return f"[{'#' * filled}{'-' * (20 - filled)}] {bounded:02d}%"


def status_progress(status: dict[str, object]) -> int:
    """Return a bounded progress value from a job status response."""
    raw_progress = status.get("progress")
    if isinstance(raw_progress, (int, float)):
        return max(0, min(int(raw_progress), 100))
    return {
        "queued": 0,
        "running": 10,
        "done": 100,
        "failed": 100,
    }.get(str(status.get("status", "unknown")), 0)


def frames_for_duration(duration_seconds: float, fps: int = 25) -> int:
    """Return a safe InfiniteTalk frame count for an audio duration."""
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("audio duration must be a positive finite number")
    if fps <= 0:
        raise ValueError("fps must be positive")
    target_frames = max(5, int(duration_seconds * fps) - 4)
    return ((target_frames - 1) // 4) * 4 + 1


def audio_duration_seconds(audio_path: Path) -> float:
    """Read an audio duration using the local ffprobe binary."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError(f"ffprobe returned an invalid audio duration: {result.stdout!r}") from error
    return duration


class JobNotVisible(RuntimeError):
    """Raised while a committed Modal volume is still propagating."""


def post_multipart(url: str, fields: dict[str, str], files: dict[str, tuple[str, bytes]], secret: str = "") -> bytes:
    boundary = f"----InfiniteTalkBench{uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend([f"--{boundary}\r\n".encode(), f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(), value.encode(), b"\r\n"])
    for name, (filename, content) in files.items():
        parts.extend([f"--{boundary}\r\n".encode(), f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode(), b"Content-Type: application/octet-stream\r\n\r\n", content, b"\r\n"])
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    request = urllib.request.Request(url, data=b"".join(parts), headers=headers, method="POST")
    return open_with_retry(request)


def post_form(url: str, fields: dict[str, str], secret: str = "") -> bytes:
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    request = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), headers=headers, method="POST")
    return open_with_retry(request)


def open_with_retry(request: urllib.request.Request) -> bytes:
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            message = error.read().decode(errors="replace")
            if error.code == 404 and "job not found" in message:
                raise JobNotVisible(message) from error
            raise RuntimeError(f"POST failed with HTTP {error.code}: {message}") from error
        except urllib.error.URLError:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("HTTP request retry loop ended unexpectedly")


def submit_job(submit_url: str, image_path: Path, audio_path: Path, frames: int, sample_steps: int, teacache_thresh: float, size: str = "infinitetalk-480", secret: str = "") -> JobResponse:
    body = json.loads(post_multipart(submit_url, {"frames": str(frames), "sample_steps": str(sample_steps), "teacache_thresh": str(teacache_thresh), "size": size}, {"image": (image_path.name, image_path.read_bytes()), "audio": (audio_path.name, audio_path.read_bytes())}, secret))
    return {"job_id": str(body["job_id"]), "call_id": str(body["call_id"])}


def fetch_status(status_url: str, job_id: str, secret: str = "") -> dict[str, object]:
    body = json.loads(post_form(status_url, {"job_id": job_id}, secret))
    if not isinstance(body, dict):
        raise RuntimeError("InfiniteTalk status response was not an object")
    return {str(key): value for key, value in body.items()}


def download_job(download_url: str, job_id: str, output_path: Path, secret: str = "") -> None:
    output_path.write_bytes(post_form(download_url, {"job_id": job_id}, secret))


def experiment_description(sample_steps: int, teacache_thresh: float, frames: int) -> dict[str, str]:
    if sample_steps == 12 and teacache_thresh == 0.2:
        name = "Economy baseline"
        change = "12 steps and teacache 0.2; already-validated reference configuration."
        tradeoff = "Lower cost; may lose motion detail compared to more steps."
    elif sample_steps == 15 and teacache_thresh == 0.2:
        name = "More steps, same teacache"
        change = "Increases diffusion from 12 to 15 steps and keeps teacache 0.2."
        tradeoff = "Expect more refined motion with a moderate cost increase."
    elif sample_steps == 20 and teacache_thresh == 0.2:
        name = "High quality, default teacache"
        change = "Increases diffusion to 20 steps and keeps teacache 0.2."
        tradeoff = "High-quality reference; higher cost and inference time."
    elif sample_steps == 12 and teacache_thresh == 0.1:
        name = "Conservative teacache"
        change = "Keeps 12 steps and reduces teacache from 0.2 to 0.1."
        tradeoff = "Less cache reuse/aggressiveness; may improve fidelity, at higher cost."
    elif sample_steps == 20 and teacache_thresh == 0.1:
        name = "Maximum fidelity tested"
        change = "Combines 20 steps with conservative teacache 0.1."
        tradeoff = "Best chance of maximum quality, with the highest expected cost."
    else:
        name = "Aggressive teacache"
        change = f"Uses {sample_steps} steps with teacache {teacache_thresh:g}."
        tradeoff = "Prioritizes speed/cost; watch for artifacts, stiffness, or lost motion."
    duration = frames / 25
    return {"name": name, "change": change, "tradeoff": tradeoff, "comparison": f"All runs use the same image, audio, and {frames} frames (~{duration:.2f}s)."}


def write_summary(output_dir: Path, runs: list[RunRecord]) -> None:
    lines = ["# InfiniteTalk Benchmark", "", "| Run | Status | Cost (USD) | Queue | Cold start | Weights | Inference | Normalize | Total GPU |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for run in runs:
        timings = run["timings"]
        values = [timings.get(key, "-") for key in ("queue_wait_s", "container_cold_start_s", "weights_load_s", "inference_s", "normalize_s", "total_gpu_s")]
        lines.append(f"| `{run['folder']}` | {run['status']} | {run['cost_usd'] if run['cost_usd'] is not None else '-'} | " + " | ".join(str(value) for value in values) + " |")
    (output_dir / "INFINITETALK_BENCH.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_existing_runs(output_dir: Path) -> list[RunRecord]:
    runs: list[RunRecord] = []
    for cost_path in sorted(output_dir.glob("run-*/run-cost.json")):
        body = json.loads(cost_path.read_text(encoding="utf-8"))
        if not isinstance(body, dict):
            continue
        timings_value = body.get("timings", {})
        timings = timings_value if isinstance(timings_value, dict) else {}
        cost_value = body.get("cost_usd")
        cost = float(cost_value) if isinstance(cost_value, (int, float)) else None
        runs.append({
            "folder": cost_path.parent.name,
            "status": str(body.get("status", "unknown")),
            "cost_usd": cost,
            "timings": timings,
        })
    return runs


def parse_cases(value: str) -> list[tuple[int, float]]:
    cases: list[tuple[int, float]] = []
    for item in value.split(","):
        steps_text, threshold_text = item.split(":", maxsplit=1)
        cases.append((int(steps_text), float(threshold_text)))
    return cases


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--submit-url", default="https://your-modal-app--infinitetalk-http-server-submit.modal.run")
    parser.add_argument("--status-url", default="https://your-modal-app--infinitetalk-http-server-status.modal.run")
    parser.add_argument("--download-url", default="https://your-modal-app--infinitetalk-http-server-download.modal.run")
    parser.add_argument("--secret", default=os.environ.get("INFINITETALK_HTTP_SECRET", ""), help="Bearer secret for the Modal endpoints (defaults to INFINITETALK_HTTP_SECRET)")
    parser.add_argument("--image", type=Path, default=Path("../public/caracter-samples/file-4.png"))
    parser.add_argument("--audio", type=Path, default=Path("../public/voice-samples/deep-en-us.mp3"))
    parser.add_argument("--out", type=Path, default=Path("bench/infinitetalk"))
    parser.add_argument("--frames", type=int)
    parser.add_argument("--size", default="infinitetalk-480", choices=["infinitetalk-480", "infinitetalk-720"])
    parser.add_argument("--runs", type=int, default=1, help="Repetitions for every steps/teacache combination")
    parser.add_argument("--steps", default="12,15,20", type=lambda value: [int(item) for item in value.split(",")])
    parser.add_argument("--teacache", default="0.2", type=lambda value: [float(item) for item in value.split(",")])
    parser.add_argument("--cases", type=parse_cases, help="Exact cases, e.g. 15:0.2,20:0.2,12:0.1")
    parser.add_argument("--poll-seconds", type=float, default=5.0)
    parser.add_argument("--timeout-seconds", type=float, default=9000.0)
    args = parser.parse_args()
    if args.runs < 1:
        raise ValueError("--runs must be at least 1")
    args.out.mkdir(parents=True, exist_ok=True)
    frames = args.frames if args.frames is not None else frames_for_duration(audio_duration_seconds(args.audio))
    print(f"Using {frames} frames for {args.audio}.", flush=True)
    runs: list[RunRecord] = []
    existing_numbers = [
        int(path.name.split("_")[0].removeprefix("run-"))
        for path in args.out.glob("run-*")
        if path.is_dir() and path.name.split("_")[0].removeprefix("run-").isdigit()
    ]
    run_number = max(existing_numbers, default=0)
    cases = args.cases if args.cases is not None else itertools.product(args.steps, args.teacache)
    for sample_steps, teacache_thresh in cases:
        for _ in range(args.runs):
            run_number += 1
            size_tag = "" if args.size == "infinitetalk-480" else "_720p"
            tag = f"run-{run_number:03d}_steps{sample_steps}_tc{teacache_thresh:g}{size_tag}"
            run_dir = args.out / tag
            run_dir.mkdir(parents=True, exist_ok=True)
            job = submit_job(args.submit_url, args.image, args.audio, frames, sample_steps, teacache_thresh, args.size, args.secret)
            print(f"{tag}: submitted job_id={job['job_id']} call_id={job['call_id']}", flush=True)
            deadline = time.monotonic() + args.timeout_seconds
            started_waiting = time.monotonic()
            last_log = started_waiting - 15.0
            previous_state = ""
            while True:
                try:
                    status = fetch_status(args.status_url, job["job_id"], args.secret)
                except JobNotVisible:
                    status = {"status": "propagating"}
                state = str(status.get("status", "unknown"))
                progress = status_progress(status)
                now = time.monotonic()
                if state != previous_state or now - last_log >= 15.0:
                    phase = str(status.get("phase", state))
                    print(
                        f"{tag}: {progress_bar(progress)} elapsed={format_elapsed(now - started_waiting)} phase={phase}",
                        flush=True,
                    )
                    previous_state = state
                    last_log = now
                if state in {"done", "failed"}:
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out waiting for job {job['job_id']}")
                time.sleep(args.poll_seconds)
            status["experiment"] = experiment_description(sample_steps, teacache_thresh, frames)
            (run_dir / "run-cost.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
            if state == "done":
                download_job(args.download_url, job["job_id"], run_dir / f"infinitetalk-steps{sample_steps}-tc{teacache_thresh:g}.mp4", args.secret)
            timings_value = status.get("timings", {})
            timings = timings_value if isinstance(timings_value, dict) else {}
            cost_value = status.get("cost_usd")
            cost = float(cost_value) if isinstance(cost_value, (int, float)) else None
            runs.append({"folder": tag, "status": state, "cost_usd": cost, "timings": timings})
            print(f"{tag}: {state}, cost_usd={cost}", flush=True)
    write_summary(args.out, load_existing_runs(args.out))


if __name__ == "__main__":
    main()
