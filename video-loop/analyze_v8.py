#!/usr/bin/env python3
"""Analyse the finished v8 faceless video: extract frames (every 4s),
transcribe with word timestamps (faster-whisper tiny, EN, CPU int8),
and detect scene cuts (ffmpeg scdet) for rhythm measurement.

Writes frames-v8/f-XX.jpg, audio-v8.wav, transcript-v8.json,
words-v8.json, cuts-v8.txt.
"""
import json
import os
import subprocess

OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
VIDEO = os.path.join(OUT_DIR, "daily-dose-weight-regain-faceless-v8.mp4")
FRAMES_DIR = os.path.join(OUT_DIR, "frames-v8")
AUDIO = os.path.join(OUT_DIR, "audio-v8.wav")
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
    # 3. Scene cuts (threshold 0.4).
    with open(os.path.join(OUT_DIR, "cuts-v8.txt"), "w") as lf:
        subprocess.run(
            ["ffmpeg", "-v", "info", "-i", VIDEO,
             "-vf", "select='gt(scene,0.4)',showinfo",
             "-f", "null", "-"],
            stderr=lf, stdout=subprocess.DEVNULL, check=False)
    # 4. Transcribe with word timestamps.
    code = (
        "import json, os\n"
        "os.environ.pop('no_proxy', None); os.environ.pop('NO_PROXY', None)\n"
        "from faster_whisper import WhisperModel\n"
        "m = WhisperModel('tiny', device='cpu', compute_type='int8')\n"
        "segs, info = m.transcribe(%r, language='en', word_timestamps=True)\n"
        "out = [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segs]\n"
        "words = [{'w': w.word.strip(), 'start': round(w.start, 2), 'end': round(w.end, 2)} for s in segs for w in s.words]\n"
        "print(json.dumps({'duration': round(info.duration, 2), 'segments': out}, indent=1))\n"
        "json.dump({'duration': round(info.duration, 2), 'segments': out}, open(%r, 'w'))\n"
        "json.dump({'words': words}, open(%r, 'w'))\n"
        % (AUDIO, os.path.join(OUT_DIR, "transcript-v8.json"),
           os.path.join(OUT_DIR, "words-v8.json"))
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
