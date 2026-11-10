"""Letterbox ceiling for fitting source clips to the target canvas.

A clip whose horizontal (top/bottom) bars exceed this share of the frame
is dropped as unusable instead of being letterboxed into a sliver. The
constant is mode-agnostic and video.py's _fit_clip_to_canvas still
enforces it for every clip, including the images-mode neutral canvas.
"""

MAX_LETTERBOX_BARS = 0.35
