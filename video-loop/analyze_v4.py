#!/usr/bin/env python3
"""Analyse the finished v3 faceless video: extract 10 frames (every 4s)
and transcribe the audio with faster-whisper (tiny, EN, CPU int8).

Writes frames-v4/f-XX.jpg, audio-v4.wav and analysis-v4.json.
"""
import json
import os
import subprocess
import sys

OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
VIDEO = os.path.join(OUT_DIR, "daily-dose-weight-regain-faceless-v4.mp4")
FRAMES_DIR = os.path.join(OUT_DIR, "frames-v4")
AUDIO = os.path.join(OUT_DIR, "audio-v4.wav")
VENV_PY = os.path.expanduser(
    "~/workspace/pe-local-selfhost/apps/engine/.venv/bin/python")


def sh(cmd):
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main():
    if not os.path.exists(VIDEO):
        raise SystemExit(f"video not found: {VIDEO}")
    os.makedirs(FRAMES_DIR, exist_ok=True)
    # 1. Frames: one every 4s.
    sh(["ffmpeg", "-y", "-v", "error", "-i", VIDEO,
        "-vf", "fps=1/4", os.path.join(FRAMES_DIR, "f-%02d.jpg")])
    # 2. Audio track for transcription.
    sh(["ffmpeg", "-y", "-v", "error", "-i", VIDEO,
        "-vn", "-ac", "1", "-ar", "16000", AUDIO])
    # 3. Transcribe with faster-whisper (proxy vars unset: httpx chokes
    # on the bracketed IPv6 entries in no_proxy).
    code = (
        "import json, os\n"
        "os.environ.pop('no_proxy', None); os.environ.pop('NO_PROXY', None)\n"
        "from faster_whisper import WhisperModel\n"
        "m = WhisperModel('tiny', device='cpu', compute_type='int8')\n"
        "segs, info = m.transcribe(%r, language='en')\n"
        "out = [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segs]\n"
        "print(json.dumps({'duration': round(info.duration, 2), 'segments': out}, indent=1))\n"
        "json.dump({'duration': round(info.duration, 2), 'segments': out}, open(%r, 'w'))\n"
        % (AUDIO, os.path.join(OUT_DIR, "transcript-v4.json"))
    )
    env = dict(os.environ)
    env.pop("no_proxy", None)
    env.pop("NO_PROXY", None)
    subprocess.run([VENV_PY, "-c", code], check=True, env=env)
    print("frames:", sorted(os.listdir(FRAMES_DIR)), flush=True)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
