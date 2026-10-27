"""Loop short material until it covers the voice, ending exactly with it.

combine_videos trims the last clip of its first pass to the remaining
budget, but when the material is short it used to loop WHOLE clips: a 6s
clip could overshoot the voiceover by up to 6s of picture over silence (a
54.0s video for a 49.4s voice). The loop now trims its last clip to the
budget, and never repeats a place photo while drawings exist (a photo shown
eight times reads as a mistake, not as coverage).

Lives in its own module because video.py is grandfathered over the
file-size cap and may not grow.
"""

import itertools
import os

from loguru import logger

from app.services.place_names import PHOTO_FILE_PREFIX

# A remainder under this is not worth a clip of its own, and a clip this
# much longer than the remainder still counts as fitting.
TOLERANCE_SECONDS = 0.05


def _is_photo(clip) -> bool:
    return os.path.basename(clip.source_file_path or "").startswith(PHOTO_FILE_PREFIX)


def loopable(clips) -> list:
    """The clips worth repeating: drawings and footage, not place photos.

    Only photos left (no drawing to repeat) means they loop after all: an
    uncovered voice is worse than a repeated photo.
    """
    return [clip for clip in clips if not _is_photo(clip)] or list(clips)


def _trimmed(clip, take, output_dir, width, height, fps, threads):
    # Imported here: video.py imports this module, so a top-level import
    # back would be circular.
    from app.services import video as video_service

    out = f"{output_dir}/loop-trim.mp4"
    try:
        video_service._reencode_clip_with_ffmpeg(
            src=clip.file_path,
            out=out,
            start_time=0,
            end_time=take,
            target_w=width,
            target_h=height,
            codec=video_service._get_configured_video_codec(),
            fps=fps,
            threads=threads,
        )
    except Exception as exc:  # noqa: BLE001 - the whole clip is the old, safe behavior
        logger.warning(f"loop trim failed, keeping the whole clip: {type(exc).__name__}")
        return clip
    return type(clip)(
        file_path=out,
        duration=take,
        width=width,
        height=height,
        source_file_path=clip.source_file_path,
    )


def extend(
    processed_clips: list,
    base_clips: list,
    video_duration: float,
    required_duration: float,
    output_dir: str,
    width: int,
    height: int,
    fps: int,
    threads: int,
) -> float:
    """Append looped clips to `processed_clips`; return the new total duration."""
    source = loopable(base_clips)
    if sum(clip.duration for clip in source) <= 0:
        return video_duration
    for clip in itertools.cycle(source):
        remaining = required_duration - video_duration
        if remaining <= TOLERANCE_SECONDS:
            break
        if clip.duration <= remaining + TOLERANCE_SECONDS:
            processed_clips.append(clip)
            video_duration += clip.duration
            continue
        processed_clips.append(_trimmed(clip, remaining, output_dir, width, height, fps, threads))
        video_duration += processed_clips[-1].duration
        break
    return video_duration
