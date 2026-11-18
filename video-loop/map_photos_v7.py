#!/usr/bin/env python3
"""Map every second of the v7 video to the source photo on screen.

Extracts 1 fps, downscales each frame and each of the 29 source photos
to 32x32 RGB, and picks the nearest source by mean squared error.
Prints a per-second timeline: which photo is showing, and how long
each photo runs. This is the ground truth for text/image mapping and
for rhythm (photo durations), independent of the engine's logs.
"""
import json
import os
import subprocess

import numpy as np
from PIL import Image

ROOT = os.path.expanduser("~/workspace/video-selfhost")
VIDEO = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v7.mp4")
FRAMES_1FPS = os.path.join(ROOT, "frames-v7-1fps")
DRIVE = __import__("importlib").import_module("drive_v7")

SIZE = (32, 32)


def sig(path):
    im = Image.open(path).convert("RGB").resize(SIZE)
    return np.asarray(im, dtype=np.float32).ravel()


def main():
    os.makedirs(FRAMES_1FPS, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", VIDEO,
                    "-vf", "fps=1", os.path.join(FRAMES_1FPS, "s-%03d.jpg")],
                   check=True)
    # Source signatures, keyed by short name.
    sources = {}
    for kind, d, name in DRIVE.PHOTOS:
        sources[name] = sig(os.path.join(d, name))
    names = list(sources)
    mat = np.stack([sources[n] for n in names])
    frames = sorted(f for f in os.listdir(FRAMES_1FPS) if f.endswith(".jpg"))
    timeline = []
    for f in frames:
        sec = int(f.split("-")[1].split(".")[0]) - 1
        s = sig(os.path.join(FRAMES_1FPS, f))
        dist = ((mat - s) ** 2).mean(axis=1)
        best = int(dist.argmin())
        timeline.append((sec, names[best], float(dist[best])))
    # Collapse runs.
    runs = []
    for sec, name, dist in timeline:
        if runs and runs[-1][0] == name:
            runs[-1][2] = sec + 1
        else:
            runs.append([name, sec, sec + 1])
    print("per-second photo timeline (second -> photo, mse):")
    for sec, name, dist in timeline:
        print(f"  {sec:3d}s {name:55s} mse={dist:7.1f}")
    print("\nruns (photo, start, end, seconds):")
    for name, a, b in runs:
        print(f"  {name:55s} {a:3d}-{b:3d}  {b - a:4.1f}s")
    json.dump({"timeline": timeline, "runs": runs},
              open(os.path.join(ROOT, "photo-map-v7.json"), "w"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
