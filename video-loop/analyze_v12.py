#!/usr/bin/env python3
"""Analyse the finished v12 faceless video: extract frames (every 4s + 1fps
map), transcribe with word timestamps (faster-whisper BASE, EN, CPU int8 —
tiny returned 0 words on v9), and detect scene cuts (ffmpeg scdet).

Writes frames-v12/f-XX.jpg, frames-v12-1fps/s-XX.jpg, audio-v12.wav,
transcript-v12.json, words-v12.json, cuts-v12.txt.
"""
import json
import os
import subprocess

OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
VIDEO = os.path.join(OUT_DIR, "daily-dose-weight-regain-faceless-v12.mp4")
FRAMES_DIR = os.path.join(OUT_DIR, "frames-v12")
FRAMES1_DIR = os.path.join(OUT_DIR, "frames-v12-1fps")
AUDIO = os.path.join(OUT_DIR, "audio-v12.wav")
VENV_PY = os.path.expanduser(
    "~/workspace/pe-local-selfhost/apps/engine/.venv/bin/python")


def sh(cmd):
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main():
    if not os.path.exists(VIDEO):
        raise SystemExit(f"video not found: {VIDEO}")
    os.makedirs(FRAMES_DIR, exist_ok=True)
    os.makedirs(FRAMES1_DIR, exist_ok=True)
    # 1. Frames: one every 4s.
    sh(["ffmpeg", "-y", "-v", "error", "-i", VIDEO,
        "-vf", "fps=1/4", os.path.join(FRAMES_DIR, "f-%02d.jpg")])
    # 1b. 1fps map for the photo-boundary check.
    sh(["ffmpeg", "-y", "-v", "error", "-i", VIDEO,
        "-vf", "fps=1", os.path.join(FRAMES1_DIR, "s-%02d.jpg")])
    # 2. Audio track for transcription.
    sh(["ffmpeg", "-y", "-v", "error", "-i", VIDEO,
        "-vn", "-ac", "1", "-ar", "16000", AUDIO])
    # 3. Scene cuts (threshold 0.4).
    with open(os.path.join(OUT_DIR, "cuts-v12.txt"), "w") as lf:
        subprocess.run(
            ["ffmpeg", "-v", "info", "-i", VIDEO,
             "-vf", "select='gt(scene,0.4)',showinfo",
             "-f", "null", "-"],
            stderr=lf, stdout=subprocess.DEVNULL, check=False)
    # 4. Transcribe with word timestamps (BASE model).
    code = (
        "import json, os\n"
        "os.environ.pop('no_proxy', None); os.environ.pop('NO_PROXY', None)\n"
        "from faster_whisper import WhisperModel\n"
        "m = WhisperModel('base', device='cpu', compute_type='int8')\n"
        "segs, info = m.transcribe(%r, language='en', word_timestamps=True)\n"
        "segs = list(segs)  # NOTE: segs is a generator — the v9/v12 scripts\n"
        "                    # consumed it building `out`, leaving `words` empty.\n"
        "out = [{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segs]\n"
        "words = [{'w': w.word.strip(), 'start': round(w.start, 2), 'end': round(w.end, 2)} for s in segs for w in s.words]\n"
        "print(json.dumps({'duration': round(info.duration, 2), 'segments': out}, indent=1))\n"
        "json.dump({'duration': round(info.duration, 2), 'segments': out}, open(%r, 'w'))\n"
        "json.dump({'words': words}, open(%r, 'w'))\n"
        % (AUDIO, os.path.join(OUT_DIR, "transcript-v12.json"),
           os.path.join(OUT_DIR, "words-v12.json"))
    )
    env = dict(os.environ)
    env.pop("no_proxy", None)
    env.pop("NO_PROXY", None)
    subprocess.run([VENV_PY, "-c", code], check=True, env=env)
    print("frames:", sorted(os.listdir(FRAMES_DIR)), flush=True)
    print("1fps:", sorted(os.listdir(FRAMES1_DIR)), flush=True)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
