import itertools
import io
import os
import random
import gc
import shutil
import subprocess
import sys
import tempfile
import time
import toml
from contextlib import redirect_stdout
from functools import lru_cache
from typing import List, Sequence, cast
from loguru import logger
import numpy as np
from moviepy import (
    AudioFileClip,
    ColorClip,
    CompositeAudioClip,
    CompositeVideoClip,
    ImageClip,
    TextClip,
    VideoFileClip,
    afx,
)
from moviepy.video.tools.subtitles import SubtitlesClip
from PIL import Image, ImageDraw, ImageFont

from app.config import config
from app.models import const
from app.services.material import MAX_LETTERBOX_BARS
from app.models.schema import (
    MaterialInfo,
    VideoAspect,
    VideoConcatMode,
    VideoParams,
    VideoTransitionMode,
)
from app.services.utils import video_effects
from app.utils import file_security, utils

DEFAULT_SUBTITLE_FONT = "BeVietnamPro-Medium.ttf"


def _resolve_font_path(font_name: str) -> str:
    """Resolve a user-supplied font name inside the bundled fonts directory.

    The name must be a plain basename — absolute paths, nested paths,
    Windows-style separators, and ``../`` traversal are rejected — and the
    file must exist. Raises ``ValueError`` on any violation.
    """
    # A backslash is a valid filename character on POSIX, so reject it
    # explicitly: on Windows it is a path separator, and the font name must
    # be a bare basename in every platform's syntax.
    if not font_name or "\\" in font_name or os.path.basename(font_name) != font_name:
        raise ValueError(f"invalid font name: {font_name!r}")
    return file_security.resolve_path_within_directory(
        utils.font_dir(), font_name
    )


def _resolve_font_with_fallback(params: VideoParams) -> str:
    """Resolve the params' font, falling back to the bundled default.

    Upgrades removed proprietary fonts (e.g. the legacy ``.ttc`` default);
    without this fallback any legacy config would fail every subtitled
    render. If even the default font is missing, the original ``ValueError``
    is re-raised — fail loudly rather than render without a font.
    """
    try:
        return _resolve_font_path(params.font_name or DEFAULT_SUBTITLE_FONT)
    except ValueError:
        if params.font_name == DEFAULT_SUBTITLE_FONT:
            raise
        logger.warning(
            f"font {params.font_name!r} not found in bundled fonts; "
            f"falling back to {DEFAULT_SUBTITLE_FONT!r}"
        )
        params.font_name = DEFAULT_SUBTITLE_FONT
        return _resolve_font_path(DEFAULT_SUBTITLE_FONT)


class SubClippedVideoClip:
    def __init__(
        self,
        file_path,
        start_time=None,
        end_time=None,
        width=None,
        height=None,
        duration=None,
        source_file_path=None,
    ):
        self.file_path = file_path
        self.start_time = start_time
        self.end_time = end_time
        self.width = width
        self.height = height
        self.source_file_path = source_file_path or file_path
        if duration is None:
            self.duration = end_time - start_time
        else:
            self.duration = duration

    def __str__(self):
        return f"SubClippedVideoClip(file_path={self.file_path}, start_time={self.start_time}, end_time={self.end_time}, duration={self.duration}, width={self.width}, height={self.height})"


audio_codec = "aac"
# The ffmpeg/AAC combo in Docker is more prone to audio quality wobble at
# default settings, so the audio bitrate is raised explicitly here to avoid
# audible distortion in the final render from too-low defaults.
audio_bitrate = "192k"
fps = 30
# When FFmpeg concats/transcodes at a fixed framerate, the final duration
# can end up tens of milliseconds shorter than MoviePy's theoretical read.
# Keep a small safety margin on the video material so frame rounding can't
# produce a black screen, stutter, or a voiceless tail at the end of the audio.
_VIDEO_DURATION_SAFETY_MARGIN = 0.1
_BGM_EXTENSIONS = (".mp3",)
_DEFAULT_VIDEO_CODEC = "libx264"
_SUPPORTED_VIDEO_CODECS = (
    "libx264",
    "h264_nvenc",
    "h264_amf",
    "h264_qsv",
    "h264_mf",
    "h264_videotoolbox",
)
_runtime_disabled_video_codecs = set()


def _get_required_video_duration(audio_duration: float) -> float:
    """
    Target duration for the concatenated video material.

    Used when compositing: material duration must cover the voiceover audio.
    Matching the audio duration exactly can leave the final video slightly
    short after FFmpeg's framerate rounding, so a light margin is always
    added. Kept as a function for testability and future margin tuning.
    """
    return max(0.0, float(audio_duration) + _VIDEO_DURATION_SAFETY_MARGIN)


def _prioritize_unique_source_clips(
    subclipped_items: List[SubClippedVideoClip],
    concat_mode: VideoConcatMode,
) -> List[SubClippedVideoClip]:
    """
    Prefer each source clip to appear only once, reducing the chance the same
    material repeats in the final video.

    Downloaded material often arrives as "one long video cut into several
    short clips". The old logic shuffled all short clips in random mode, so
    multiple slices of the same source video could land at the start and in
    the middle, reading as repetition. This function only reorders clips:
    the longest slice of each source file goes first and the rest serve as
    fallback; when total material is too short, later slices may still fill
    the audio length so generation success isn't harmed. Preferring the
    longest slice avoids randomly picking a tiny tail fragment and reusing
    material early even though enough footage exists.
    """
    if not subclipped_items:
        return []

    concat_mode_value = getattr(concat_mode, "value", concat_mode)
    if concat_mode_value != VideoConcatMode.random.value:
        return subclipped_items

    grouped_items: dict[str, list[SubClippedVideoClip]] = {}
    for item in subclipped_items:
        grouped_items.setdefault(item.source_file_path, []).append(item)

    primary_items = []
    overflow_items = []
    for items in grouped_items.values():
        primary_item = max(items, key=lambda item: item.duration)
        primary_items.append(primary_item)
        overflow_items.extend(item for item in items if item is not primary_item)

    random.shuffle(primary_items)
    random.shuffle(overflow_items)
    logger.info(
        "prioritized unique video materials, "
        f"sources: {len(grouped_items)}, "
        f"primary clips: {len(primary_items)}, "
        f"fallback clips: {len(overflow_items)}"
    )
    return primary_items + overflow_items


def get_ffmpeg_binary():
    """
    Back-compat for callers that historically read the FFmpeg path from the
    video service.

    The real resolution logic lives in `app.utils.utils.get_ffmpeg_binary()`;
    video, audio, and future pipelines should reuse the same priority order.
    This thin wrapper stays so external scripts or old tests importing
    `app.services.video.get_ffmpeg_binary` don't hit AttributeError.
    """
    return utils.get_ffmpeg_binary()


def _get_configured_video_codec() -> str:
    """
    Read the user-configured video encoder.

    This setting targets advanced users who want to try hardware encoders
    like NVENC/AMF/QSV/VideoToolbox. Only a fixed allowlist is accepted on
    purpose: opening up arbitrary FFmpeg parameters would let a typo produce
    uncontrollable output formats or fail the task only in later stages.
    """
    configured_codec = str(
        config.app.get("video_codec", _DEFAULT_VIDEO_CODEC) or _DEFAULT_VIDEO_CODEC
    ).strip()
    if configured_codec not in _SUPPORTED_VIDEO_CODECS:
        logger.warning(
            f"unsupported video codec configured: {configured_codec}, "
            f"fallback to {_DEFAULT_VIDEO_CODEC}"
        )
        return _DEFAULT_VIDEO_CODEC
    return configured_codec


def _get_configured_video_preset() -> str:
    """Return a safe ffmpeg preset shared by CPU and hardware encoders."""
    preset = str(config.app.get("video_preset", "medium") or "medium").strip()
    if preset not in {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow"}:
        logger.warning("unsupported video preset configured: %s, fallback to medium", preset)
        return "medium"
    return preset


@lru_cache(maxsize=16)
def _ffmpeg_encoder_exists(ffmpeg_binary: str, codec: str) -> bool:
    """
    Check whether the current FFmpeg build advertises the given encoder.

    This only proves the encoder was compiled in — not that the current
    machine's hardware and drivers can actually use it. Real encode failures
    still fall back to libx264.
    """
    try:
        result = subprocess.run(
            [ffmpeg_binary, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning(
            "failed to inspect ffmpeg encoders, "
            f"fallback to {_DEFAULT_VIDEO_CODEC}: {str(exc)}"
        )
        return False

    if result.returncode != 0:
        logger.warning(
            "failed to inspect ffmpeg encoders, "
            f"fallback to {_DEFAULT_VIDEO_CODEC}: {(result.stderr or result.stdout or '').strip()}"
        )
        return False
    return codec in result.stdout


def _get_effective_video_codec(preferred_codec: str | None = None) -> str:
    """
    The video encoder actually used for this run.

    When the user picks a hardware encoder, first probe FFmpeg's encoder
    list; if this process has already seen a real encode failure, fall back
    directly so every clip in one task doesn't fail the same way.
    """
    selected_codec = preferred_codec or _get_configured_video_codec()
    if selected_codec == _DEFAULT_VIDEO_CODEC:
        return _DEFAULT_VIDEO_CODEC

    if selected_codec in _runtime_disabled_video_codecs:
        logger.warning(
            f"video codec {selected_codec} was disabled after a runtime failure, "
            f"fallback to {_DEFAULT_VIDEO_CODEC}"
        )
        return _DEFAULT_VIDEO_CODEC

    ffmpeg_binary = utils.get_ffmpeg_binary()
    if not _ffmpeg_encoder_exists(ffmpeg_binary, selected_codec):
        logger.warning(
            f"ffmpeg encoder {selected_codec} is not available, "
            f"fallback to {_DEFAULT_VIDEO_CODEC}"
        )
        return _DEFAULT_VIDEO_CODEC

    return selected_codec


def _disable_runtime_video_codec(codec: str, reason: str):
    if codec == _DEFAULT_VIDEO_CODEC:
        return
    _runtime_disabled_video_codecs.add(codec)
    logger.warning(
        f"video codec {codec} failed, fallback to {_DEFAULT_VIDEO_CODEC}. "
        f"reason: {reason}"
    )


def _get_temp_audio_dir(output_dir: str) -> str:
    """
    Return the directory to use for MoviePy's temporary audio file.

    On Windows, Windows Defender can lock files written to the task output
    directory while scanning them, causing MoviePy to fail with a
    PermissionError (WinError 32) on the TEMP_MPY_wvf_snd temp file and
    leaving the final MP4 at 0 bytes.  Using the system temp directory
    sidesteps the scan without changing behaviour on other platforms.

    On Linux/macOS/Docker the output directory is returned unchanged so
    existing behaviour is preserved.
    """
    if sys.platform == "win32":
        return tempfile.gettempdir()
    return output_dir


def _fallback_write_videofile(clip, output_file: str, failed_codec: str, reason: str, **kwargs):
    """
    Retry with libx264 after a hardware encode failure; only disable the
    hardware encoder when the retry succeeds.

    FFmpeg failures on Windows are ambiguous: unsupported GPU/driver, locked
    output file, directory permissions, antivirus interception, or generic IO
    issues are all possible. Only when libx264 writes successfully can the
    original failure be attributed to the hardware encoder with confidence,
    avoiding collateral damage to later tasks.
    """
    clip.write_videofile(output_file, codec=_DEFAULT_VIDEO_CODEC, **kwargs)
    _disable_runtime_video_codec(failed_codec, reason)
    return _DEFAULT_VIDEO_CODEC


def _write_videofile_with_codec_fallback(clip, output_file: str, codec: str, **kwargs):
    """
    Write the video with the given encoder, retrying once with libx264 on
    failure.

    Whether a hardware encoder works depends not only on FFmpeg but also on
    the GPU, drivers, and runtime environment. A generation task must not
    fail wholesale because an advanced encoder is unavailable, so the
    fallback is handled centrally here.
    """
    effective_codec = _get_effective_video_codec(codec)
    try:
        clip.write_videofile(output_file, codec=effective_codec, **kwargs)
        return effective_codec
    except Exception as exc:
        if effective_codec == _DEFAULT_VIDEO_CODEC:
            raise
        return _fallback_write_videofile(
            clip,
            output_file,
            failed_codec=effective_codec,
            reason=str(exc),
            **kwargs,
        )


def _escape_ffmpeg_concat_path(file_path: str) -> str:
    # The concat demuxer wraps paths in single quotes, so single quotes inside
    # the path must be escaped first.
    return file_path.replace("'", "'\\''")


def _format_ffmpeg_concat_path(file_path: str) -> str:
    """
    Build a path entry for a concat demuxer file list.

    FFmpeg's docs require escaping special characters and spaces in the
    concat list; backslashes in Windows absolute paths are also easily
    parsed as escape characters. Normalize to forward slashes (so
    `C:\\Users\\...` becomes `C:/Users/...`), then handle single quotes,
    for macOS/Linux compatibility.
    """
    absolute_path = os.path.abspath(file_path)
    return _escape_ffmpeg_concat_path(absolute_path.replace("\\", "/"))


def concat_video_clips_with_ffmpeg(
    clip_files: List[str], output_file: str, threads: int, output_dir: str
):
    concat_list_file = os.path.join(output_dir, "ffmpeg-concat-list.txt")
    with open(concat_list_file, "w", encoding="utf-8") as fp:
        for clip_file in clip_files:
            fp.write(f"file '{_format_ffmpeg_concat_path(clip_file)}'\n")

    def build_command(codec: str) -> list[str]:
        return [
            utils.get_ffmpeg_binary(),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_list_file,
            "-c:v",
            codec,
            "-preset",
            _get_configured_video_preset(),
            "-threads",
            str(threads or 2),
            "-pix_fmt",
            "yuv420p",
            output_file,
        ]

    def run_concat(codec: str):
        command = build_command(codec)
        # Concat and encode once with ffmpeg instead of MoviePy's per-segment
        # merge, avoiding repeated re-encoding and the quality/color-shift
        # risk that comes with it.
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            error_message = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(error_message or "ffmpeg concat failed")
        return codec

    try:
        effective_codec = _get_effective_video_codec()
        try:
            return run_concat(effective_codec)
        except Exception as exc:
            if effective_codec == _DEFAULT_VIDEO_CODEC:
                raise
            result_codec = run_concat(_DEFAULT_VIDEO_CODEC)
            _disable_runtime_video_codec(effective_codec, str(exc))
            return result_codec
    finally:
        delete_files(concat_list_file)


def replace_video_intro_with_lipsync(
    background_video: str,
    lipsync_video: str,
    output_file: str,
    duration: float = 5,
) -> str:
    """Replace the beginning of a background video with a talking avatar."""
    source = _open_video_clip_quietly(background_video)
    width, height = source.w, source.h
    source.close()
    filter_graph = (
        f"[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
        f"trim=duration={duration},setpts=PTS-STARTPTS[intro];"
        f"[0:v]trim=start={duration},setpts=PTS-STARTPTS[tail];"
        "[intro][tail]concat=n=2:v=1:a=0[outv]"
    )
    command = [
        utils.get_ffmpeg_binary(), "-y", "-i", background_video,
        "-i", lipsync_video, "-filter_complex", filter_graph,
        "-map", "[outv]", "-an", "-c:v", _get_effective_video_codec(),
        "-pix_fmt", "yuv420p", output_file,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "lip-sync concat failed").strip())
    return output_file


def _sanitize_image_file(image_path: str) -> str:
    # Some local images open fine in Pillow but carry corrupt EXIF/eXIf
    # metadata that makes ImageClip throw during parsing. Re-export a "clean
    # image" here to strip the bad metadata.
    image_root, _ = os.path.splitext(image_path)
    sanitized_path = f"{image_root}.sanitized.png"

    with Image.open(image_path) as image:
        image.load()
        # Export as PNG uniformly so JPEG/PNG's differing metadata paths can't
        # carry the corrupt block along.
        cleaned_image = Image.new(image.mode, image.size)
        cleaned_image.putdata(list(image.getdata()))
        cleaned_image.save(sanitized_path)

    return sanitized_path


def _open_image_clip_with_fallback(image_path: str):
    # Try the original image first; only generate a metadata-free copy if
    # corrupt metadata breaks it.
    try:
        return ImageClip(image_path), image_path
    except Exception as exc:
        logger.warning(
            f"failed to open image directly, trying sanitized copy: {image_path}, error: {str(exc)}"
        )
        sanitized_path = _sanitize_image_file(image_path)
        return ImageClip(sanitized_path), sanitized_path


def _open_video_clip_quietly(video_path: str, audio: bool = False) -> VideoFileClip:
    """
    Open a video file quietly, keeping MoviePy 2.1.x from printing ffmpeg
    probe info to stdout.

    Background:
    The pinned `FFMPEG_VideoReader` has `print(self.infos)` and
    `print(ffmpeg command)` calls; reading an intermediate video without an
    audio track prints `audio_found: False`. That's only input-material
    metadata — not proof the final video lacks audio — but it misleads
    WebUI/terminal users into thinking generation failed.

    Approach:
    1. Redirect stdout only for the short VideoFileClip window;
    2. Default `audio=False` because the material stage doesn't need source
       audio — the final audio is mounted in the `generate_video()` stage;
    3. If the dependency really printed something, demote it to a debug log
       for later diagnosis.
    """
    captured_stdout = io.StringIO()
    with redirect_stdout(captured_stdout):
        clip = VideoFileClip(video_path, audio=audio)

    moviepy_stdout = captured_stdout.getvalue().strip()
    if moviepy_stdout:
        logger.debug(
            "suppressed MoviePy video reader stdout for "
            f"{video_path}, chars: {len(moviepy_stdout)}"
        )

    return clip


def close_clip(clip):
    if clip is None:
        return
        
    try:
        # close main resources
        if hasattr(clip, 'reader') and clip.reader is not None:
            clip.reader.close()
            
        # close audio resources
        if hasattr(clip, 'audio') and clip.audio is not None:
            if hasattr(clip.audio, 'reader') and clip.audio.reader is not None:
                clip.audio.reader.close()
            del clip.audio
            
        # close mask resources
        if hasattr(clip, 'mask') and clip.mask is not None:
            if hasattr(clip.mask, 'reader') and clip.mask.reader is not None:
                clip.mask.reader.close()
            del clip.mask
            
        # handle child clips in composite clips
        if hasattr(clip, 'clips') and clip.clips:
            for child_clip in clip.clips:
                if child_clip is not clip:  # avoid possible circular references
                    close_clip(child_clip)
            
        # clear clip list
        if hasattr(clip, 'clips'):
            clip.clips = []
            
    except Exception as e:
        logger.error(f"failed to close clip: {str(e)}")
    
    del clip
    gc.collect()

def delete_files(files: List[str] | str):
    if isinstance(files, str):
        files = [files]

    for file in files:
        try:
            os.remove(file)
        except Exception as e:
            logger.debug(f"failed to delete file {file}: {str(e)}")


def _resolve_bgm_file_path(song_dir: str, bgm_file: str) -> str:
    # Background music may only be read from the resource/songs directory, so
    # an arbitrary user-supplied path can't be opened by MoviePy. Two common
    # inputs are accepted:
    # 1. output000.mp3 — from the BGM list or a bare filename
    # 2. ./resource/songs/output000.mp3 — a project-relative path
    # Both are re-validated against the resource/songs allowlist, so neither
    # can bypass the directory restriction.
    try:
        return file_security.resolve_path_within_directory(song_dir, bgm_file)
    except ValueError as song_dir_exc:
        if os.path.isabs(bgm_file):
            raise song_dir_exc

        project_relative_file = os.path.join(utils.root_dir(), bgm_file)
        try:
            return file_security.resolve_path_within_directory(
                song_dir, project_relative_file
            )
        except ValueError as root_dir_exc:
            raise ValueError(str(root_dir_exc)) from song_dir_exc


def select_bgm_file(
    music_mood: str,
    catalog_file: str,
    song_dir: str,
    recent_files: Sequence[str] = (),
) -> str:
    """Select an existing catalogued track for one exact mood."""
    if not music_mood or music_mood == "none":
        return ""
    try:
        catalog = toml.load(catalog_file)
    except (OSError, toml.TomlDecodeError) as exc:
        logger.warning(f"failed to load bgm catalog: {catalog_file}, error: {str(exc)}")
        return ""

    tracks = catalog.get("tracks", [])
    if not isinstance(tracks, list):
        return ""
    candidates: list[str] = []
    for raw_track in tracks:
        if not isinstance(raw_track, dict):
            continue
        track = cast(dict[str, object], raw_track)
        filename = track.get("file")
        moods = track.get("moods")
        if not isinstance(filename, str) or not isinstance(moods, list):
            continue
        if music_mood not in moods or not all(isinstance(mood, str) for mood in moods):
            continue
        try:
            resolved = _resolve_bgm_file_path(song_dir, filename)
        except ValueError:
            continue
        if resolved.lower().endswith(_BGM_EXTENSIONS) and os.path.isfile(resolved):
            candidates.append(resolved)

    recent_paths = {os.path.realpath(recent_file) for recent_file in recent_files}
    available = [
        candidate for candidate in candidates if os.path.realpath(candidate) not in recent_paths
    ]
    return random.choice(available or candidates) if candidates else ""


def get_available_music_moods(catalog_file: str | None = None) -> tuple[str, ...]:
    """Return the unique music moods declared by the BGM catalog."""
    configured_catalog = catalog_file or config.bgm.get(
        "catalog_file", os.path.join(utils.root_dir(), "resource", "songs", "catalog.toml")
    )
    resolved_catalog = str(configured_catalog)
    if not os.path.isabs(resolved_catalog):
        resolved_catalog = os.path.join(utils.root_dir(), resolved_catalog)

    try:
        catalog = toml.load(resolved_catalog)
    except (OSError, toml.TomlDecodeError) as exc:
        logger.warning(f"failed to load BGM moods: {resolved_catalog}, error: {str(exc)}")
        return ()

    tracks = catalog.get("tracks", [])
    if not isinstance(tracks, list):
        return ()

    moods: set[str] = set()
    for raw_track in tracks:
        if not isinstance(raw_track, dict):
            continue
        track = cast(dict[str, object], raw_track)
        raw_moods = track.get("moods")
        if not isinstance(raw_moods, list):
            continue
        moods.update(
            mood
            for mood in raw_moods
            if isinstance(mood, str) and mood and mood not in {"auto", "none"}
        )
    return tuple(sorted(moods))


def get_bgm_file(music_mood: str, recent_files: Sequence[str] = ()) -> str:
    """Select a catalogued BGM for the mood chosen by the LLM."""
    if not music_mood or music_mood == "none":
        logger.info(f"BGM disabled by selected music mood: {music_mood!r}")
        return ""

    catalog_file = config.bgm.get(
        "catalog_file", os.path.join(utils.root_dir(), "resource", "songs", "catalog.toml")
    )
    resolved_catalog = str(catalog_file)
    if not os.path.isabs(resolved_catalog):
        resolved_catalog = os.path.join(utils.root_dir(), resolved_catalog)
    selected_file = select_bgm_file(
        str(music_mood), resolved_catalog, utils.song_dir(), recent_files=recent_files
    )
    logger.info(
        f"BGM selection: mood={music_mood!r}, catalog={resolved_catalog!r}, "
        f"selected={selected_file or 'none'!r}"
    )
    return selected_file


def get_bgm_start_offset(
    bgm_file: str,
    catalog_file: str | None = None,
    song_dir: str | None = None,
) -> float:
    """Pick a random bar-aligned start offset for the chosen BGM.

    prep_songs.py stores rhythmic `start_points` per track in the catalog so
    renders don't always begin at the same intro. Tracks without points (or a
    missing catalog) keep the legacy behaviour and start at 0.
    """
    resolved_catalog = catalog_file or config.bgm.get(
        "catalog_file", os.path.join(utils.root_dir(), "resource", "songs", "catalog.toml")
    )
    if not os.path.isabs(resolved_catalog):
        resolved_catalog = os.path.join(utils.root_dir(), resolved_catalog)
    resolved_songs = song_dir or utils.song_dir()
    try:
        catalog = toml.load(resolved_catalog)
    except (OSError, toml.TomlDecodeError) as exc:
        logger.warning(f"failed to load bgm catalog for offsets: {resolved_catalog}, error: {str(exc)}")
        return 0.0

    target = os.path.realpath(bgm_file)
    for raw_track in catalog.get("tracks", []):
        if not isinstance(raw_track, dict):
            continue
        track = cast(dict[str, object], raw_track)
        filename = track.get("file")
        if not isinstance(filename, str):
            continue
        try:
            resolved = _resolve_bgm_file_path(resolved_songs, filename)
        except ValueError:
            continue
        if os.path.realpath(resolved) != target:
            continue
        raw_points = track.get("start_points")
        if not isinstance(raw_points, list):
            return 0.0
        points = [
            float(point) for point in raw_points if isinstance(point, (int, float))
        ]
        if not points:
            return 0.0
        offset = random.choice(points)
        logger.info(f"BGM start offset: {bgm_file!r} -> {offset}s")
        return offset
    return 0.0

def _fit_clip_to_canvas(clip, video_width: int, video_height: int):
    """
    Fit the clip to the maximized canvas without cropping content:
      1. exact ratio -> resize to canvas (zero bars)
      2. horizontal (top/bottom) bars <= MAX_LETTERBOX_BARS -> letterbox
         with the clip maximized (scale by the smaller factor, centered on a
         black background — touches both edges of one dimension)
      3. side bars (pillarbox) or out of band -> None (clip discarded;
         combine_videos skips it)

    Side bars are always rejected: clips taller/narrower than the canvas
    would create black space on the sides, breaking immersion.

    Generic for 9:16 (TikTok/Shorts), 16:9 (YouTube) and 1:1 (feed).
    """
    clip_w, clip_h = clip.size
    if clip_w == video_width and clip_h == video_height:
        return clip

    clip_ratio = clip_w / clip_h
    video_ratio = video_width / video_height
    if clip_ratio == video_ratio:
        return clip.resized(new_size=(video_width, video_height))

    # Reject side bars: the clip must be at least as wide as the canvas
    # (clip_ratio >= video_ratio).
    if clip_ratio < video_ratio:
        return None

    bars = 1 - video_ratio / clip_ratio
    if bars > MAX_LETTERBOX_BARS:
        return None

    # Maximized letterbox: smallest scale factor — the clip touches both
    # edges of one dimension and sits centered on the black background.
    scale_factor = min(video_width / clip_w, video_height / clip_h)
    new_width = int(clip_w * scale_factor)
    new_height = int(clip_h * scale_factor)
    background = ColorClip(
        size=(video_width, video_height), color=(0, 0, 0)
    ).with_duration(clip.duration)
    clip_resized = clip.resized(new_size=(new_width, new_height)).with_position("center")
    return CompositeVideoClip([background, clip_resized])


def _needs_moviepy_effects(video_transition_mode) -> bool:
    """Whether combine_videos must keep the MoviePy effects path.

    Transitions (fade/slide/shuffle) mutate the clip via MoviePy effects
    before writing; the plain fast path can re-encode straight with ffmpeg.
    """
    value = getattr(video_transition_mode, "value", video_transition_mode)
    return value not in (None, VideoTransitionMode.none.value)


def _reencode_clip_with_ffmpeg(
    src: str,
    out: str,
    start_time: float,
    end_time: float,
    target_w: int,
    target_h: int,
    codec: str,
    fps: int = 30,
    threads: int = 2,
) -> None:
    """Re-encode one subclip directly with ffmpeg (scale + letterbox pad).

    Equivalent to the MoviePy per-clip write path but ~7x faster: it skips
    MoviePy decode/encode overhead and lets ffmpeg do subclip + resize +
    letterbox in a single pass.

    The pad filter only adds black bars when the source ratio differs from
    the target (letterbox). Sources that would produce side bars are still
    rejected upstream by the fit logic (pillarbox is disallowed).
    """
    ffmpeg_binary = get_ffmpeg_binary()
    duration = max(0.0, end_time - start_time)
    if duration <= 0:
        raise ValueError(
            f"re-encode duration must be > 0 (got {duration:.3f}s for {src})"
        )
    if not os.path.isfile(src):
        raise FileNotFoundError(f"source video not found: {src}")
    effective_codec = _get_effective_video_codec(codec)
    cmd = [
        ffmpeg_binary,
        "-y",
        "-ss",
        f"{start_time:.3f}",
        "-i",
        src,
        "-t",
        f"{duration:.3f}",
        "-an",
        "-vf",
        (
            f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:black"
        ),
        "-r",
        str(fps),
        "-c:v",
        effective_codec,
        "-preset",
        _get_configured_video_preset(),
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        str(threads),
        out,
    ]
    start = time.monotonic()
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
        # Reuse the existing codec fallback machinery: only disable the
        # hardware encoder when libx264 can write the file successfully.
        if effective_codec != _DEFAULT_VIDEO_CODEC:
            logger.warning(
                f"[ffmpeg] re-encode with {effective_codec} failed, "
                f"retrying with {_DEFAULT_VIDEO_CODEC}: {str(exc)}"
            )
            cmd[cmd.index("-c:v") + 1] = _DEFAULT_VIDEO_CODEC
            try:
                subprocess.run(cmd, capture_output=True, check=True, timeout=600)
                _disable_runtime_video_codec(effective_codec, str(exc))
                elapsed = time.monotonic() - start
                logger.info(
                    f"[ffmpeg] re-encoded {os.path.basename(src)} "
                    f"({duration:.2f}s -> {target_w}x{target_h}) with "
                    f"{_DEFAULT_VIDEO_CODEC} in {elapsed:.2f}s"
                )
            except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc2:
                logger.error(
                    f"[ffmpeg] re-encode failed for {os.path.basename(src)}: {str(exc2)}"
                )
                raise RuntimeError(
                    f"ffmpeg re-encode failed for {src}: {str(exc2)}"
                ) from exc2
        logger.error(
            f"[ffmpeg] re-encode failed for {os.path.basename(src)}: {str(exc)}"
        )
        raise RuntimeError(f"ffmpeg re-encode failed for {src}: {str(exc)}") from exc
    elapsed = time.monotonic() - start
    logger.info(
        f"[ffmpeg] re-encoded {os.path.basename(src)} "
        f"({duration:.2f}s -> {target_w}x{target_h}) in {elapsed:.2f}s"
    )


def combine_videos(
    combined_video_path: str,
    video_paths: List[str],
    audio_file: str,
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_concat_mode: VideoConcatMode = VideoConcatMode.random,
    video_transition_mode: VideoTransitionMode = None,
    max_clip_duration: int = 5,
    threads: int = 2,
) -> str:
    audio_clip = AudioFileClip(audio_file)
    try:
        # Only the voiceover duration is needed here to size the material
        # concat; audio_clip isn't used afterwards. Close it right away so
        # early returns or exception paths can't leak the file handle.
        audio_duration = audio_clip.duration
    finally:
        close_clip(audio_clip)
    logger.info(f"audio duration: {audio_duration} seconds")
    logger.info(f"maximum clip duration: {max_clip_duration} seconds")
    required_video_duration = _get_required_video_duration(audio_duration)
    logger.info(
        f"required video duration: {required_video_duration:.2f} seconds "
        f"(audio duration + {_VIDEO_DURATION_SAFETY_MARGIN:.2f}s safety margin)"
    )

    # Tolerate direct API calls that omit the transition mode, so a later
    # .value access can't crash.
    transition_value = getattr(video_transition_mode, "value", video_transition_mode)
    output_dir = os.path.dirname(combined_video_path)

    aspect = VideoAspect(video_aspect)
    video_width, video_height = aspect.to_resolution()

    processed_clips = []
    subclipped_items = []
    video_duration = 0
    for video_path in video_paths:
        clip = _open_video_clip_quietly(video_path)
        clip_duration = clip.duration
        clip_w, clip_h = clip.size
        close_clip(clip)
        
        start_time = 0

        while start_time < clip_duration:
            end_time = min(start_time + max_clip_duration, clip_duration)

            # Keep every valid segment: a clip shorter than max_clip_duration
            # is never dropped, and the small tail of a long video isn't
            # swallowed either.
            if end_time > start_time:
                subclipped_items.append(
                    SubClippedVideoClip(
                        file_path=video_path,
                        start_time=start_time,
                        end_time=end_time,
                        width=clip_w,
                        height=clip_h,
                        source_file_path=video_path,
                    )
                )

            start_time = end_time
            if video_concat_mode.value == VideoConcatMode.sequential.value:
                break

    subclipped_items = _prioritize_unique_source_clips(
        subclipped_items=subclipped_items,
        concat_mode=video_concat_mode,
    )
        
    logger.debug(f"total subclipped items: {len(subclipped_items)}")
    
    # Add downloaded clips over and over until the duration of the audio (max_duration) has been reached
    for i, subclipped_item in enumerate(subclipped_items):
        if video_duration >= required_video_duration:
            break
        
        logger.debug(
            f"processing clip {i+1}: {subclipped_item.width}x{subclipped_item.height}, "
            f"source: {os.path.basename(subclipped_item.source_file_path)}, "
            f"current duration: {video_duration:.2f}s, "
            f"remaining: {required_video_duration - video_duration:.2f}s"
        )
        
        try:
            # Fast path: no transitions -> re-encode straight with ffmpeg,
            # skipping MoviePy open/fit/effects overhead entirely (~7x faster).
            if not _needs_moviepy_effects(video_transition_mode):
                clip_w, clip_h = subclipped_item.width, subclipped_item.height
                if clip_w == video_width and clip_h == video_height:
                    fit_ok = True
                else:
                    clip_ratio = clip_w / clip_h
                    video_ratio = video_width / video_height
                    if clip_ratio == video_ratio:
                        fit_ok = True
                    elif clip_ratio < video_ratio:
                        fit_ok = False
                    else:
                        bars = 1 - video_ratio / clip_ratio
                        fit_ok = bars <= MAX_LETTERBOX_BARS
                if not fit_ok:
                    logger.warning(
                        f"skipping clip: {clip_w}x{clip_h} rejected "
                        f"(pillarbox or exceeds horizontal bar limit "
                        f"{MAX_LETTERBOX_BARS:.0%}) for target "
                        f"{video_width}x{video_height}"
                    )
                    continue

                clip_file = f"{output_dir}/temp-clip-{i+1}.mp4"
                _reencode_clip_with_ffmpeg(
                    src=subclipped_item.file_path,
                    out=clip_file,
                    start_time=subclipped_item.start_time,
                    end_time=subclipped_item.end_time,
                    target_w=video_width,
                    target_h=video_height,
                    codec=_get_configured_video_codec(),
                    fps=fps,
                    threads=threads,
                )
                clip_duration_saved = subclipped_item.end_time - subclipped_item.start_time
                processed_clips.append(
                    SubClippedVideoClip(
                        file_path=clip_file,
                        duration=clip_duration_saved,
                        width=video_width,
                        height=video_height,
                        source_file_path=subclipped_item.source_file_path,
                    )
                )
                video_duration += clip_duration_saved
                continue

            clip = _open_video_clip_quietly(subclipped_item.file_path).subclipped(
                subclipped_item.start_time, subclipped_item.end_time
            )
            clip_duration = clip.duration
            # Not every clip arrives in the canvas shape: within the bar band
            # (MAX_LETTERBOX_BARS) it becomes a maximized letterbox; outside
            # it, the clip is discarded.
            clip_w, clip_h = clip.size
            if clip_w != video_width or clip_h != video_height:
                logger.debug(
                    f"fitting clip, source: {clip_w}x{clip_h}, "
                    f"target: {video_width}x{video_height}"
                )
                clip = _fit_clip_to_canvas(clip, video_width, video_height)
                if clip is None:
                    logger.warning(
                        f"skipping clip: {clip_w}x{clip_h} rejected "
                        f"(pillarbox or exceeds horizontal bar limit "
                        f"{MAX_LETTERBOX_BARS:.0%}) for target "
                        f"{video_width}x{video_height}"
                    )
                    continue
                    
            shuffle_side = random.choice(["left", "right", "top", "bottom"])
            if transition_value in (None, VideoTransitionMode.none.value):
                clip = clip
            elif transition_value == VideoTransitionMode.fade_in.value:
                clip = video_effects.fadein_transition(clip, 1)
            elif transition_value == VideoTransitionMode.fade_out.value:
                clip = video_effects.fadeout_transition(clip, 1)
            elif transition_value == VideoTransitionMode.slide_in.value:
                clip = video_effects.slidein_transition(clip, 1, shuffle_side)
            elif transition_value == VideoTransitionMode.slide_out.value:
                clip = video_effects.slideout_transition(clip, 1, shuffle_side)
            elif transition_value == VideoTransitionMode.shuffle.value:
                transition_funcs = [
                    lambda c: video_effects.fadein_transition(c, 1),
                    lambda c: video_effects.fadeout_transition(c, 1),
                    lambda c: video_effects.slidein_transition(c, 1, shuffle_side),
                    lambda c: video_effects.slideout_transition(c, 1, shuffle_side),
                ]
                shuffle_transition = random.choice(transition_funcs)
                clip = shuffle_transition(clip)

            if clip.duration > max_clip_duration:
                clip = clip.subclipped(0, max_clip_duration)
                
            # wirte clip to temp file
            clip_file = f"{output_dir}/temp-clip-{i+1}.mp4"
            _write_videofile_with_codec_fallback(
                clip,
                clip_file,
                codec=_get_configured_video_codec(),
                logger=None,
                fps=fps,
            )

            # Store clip duration before closing
            clip_duration_saved = clip.duration
            close_clip(clip)

            processed_clips.append(
                SubClippedVideoClip(
                    file_path=clip_file,
                    duration=clip_duration_saved,
                    width=clip_w,
                    height=clip_h,
                    source_file_path=subclipped_item.source_file_path,
                )
            )
            video_duration += clip_duration_saved
            
        except Exception as e:
            logger.error(f"failed to process clip: {str(e)}")

    # Only fail when there WAS material and no clip survived the shape
    # filter. Empty input (video_paths=[]) is a legitimate test path.
    if video_paths and not processed_clips:
        raise ValueError(
            f"no usable clips for target {video_width}x{video_height}: all clips "
            f"exceed the letterbox bars limit ({MAX_LETTERBOX_BARS:.0%}) for this "
            "aspect. Try a different video_subject or check the material sources."
        )

    # loop processed clips until the video duration covers the audio duration and the small safety margin.
    if video_duration < required_video_duration:
        logger.warning(
            f"video duration ({video_duration:.2f}s) is shorter than required duration "
            f"({required_video_duration:.2f}s), looping clips to match audio length."
        )
        base_clips = processed_clips.copy()
        for clip in itertools.cycle(base_clips):
            if video_duration >= required_video_duration:
                break
            processed_clips.append(clip)
            video_duration += clip.duration
        logger.info(
            f"video duration: {video_duration:.2f}s, audio duration: {audio_duration:.2f}s, "
            f"required duration: {required_video_duration:.2f}s, "
            f"looped {len(processed_clips)-len(base_clips)} clips"
        )
     
    # merge video clips progressively, avoid loading all videos at once to avoid memory overflow
    logger.info("starting clip merging process")
    if not processed_clips:
        logger.warning("no clips available for merging")
        return combined_video_path
    
    # if there is only one clip, use it directly
    if len(processed_clips) == 1:
        logger.info("using single clip directly")
        shutil.copy(processed_clips[0].file_path, combined_video_path)
        delete_files([processed_clips[0].file_path])
        logger.info("video combining completed")
        return combined_video_path

    clip_files = [clip.file_path for clip in processed_clips]
    logger.info(f"concatenating {len(clip_files)} clips with ffmpeg")
    concat_video_clips_with_ffmpeg(
        clip_files=clip_files,
        output_file=combined_video_path,
        threads=threads,
        output_dir=output_dir,
    )
    
    # clean temp files
    delete_files(clip_files)
            
    logger.info("video combining completed")
    return combined_video_path


def wrap_text(text, max_width, font="Arial", fontsize=60):
    # Subtitle wrapping must happen before the real TextClip is created, or
    # MoviePy will size the render area from the raw text. Measure width with
    # PIL at the current font/size so every line stays within the usable
    # video width — large sizes or long CJK sentences would otherwise
    # overflow the frame.
    font = ImageFont.truetype(font, fontsize)
    max_width = int(max_width)

    def get_text_size(inner_text):
        inner_text = inner_text.strip()
        if not inner_text:
            return 0, fontsize
        left, top, right, bottom = font.getbbox(inner_text)
        return right - left, bottom - top

    width, height = get_text_size(text)
    if width <= max_width:
        return text, height

    def split_long_token(token):
        # When a single token is already too wide (common with spaceless CJK
        # sentences or very long English words), fall back to per-character
        # splitting. The key rule: when a candidate goes over width, commit
        # the last still-valid line first, then start the next line with the
        # current character — never push the over-wide character back onto
        # the previous line.
        lines = []
        current = ""
        for char in token:
            candidate = f"{current}{char}"
            candidate_width, _ = get_text_size(candidate)
            if candidate_width <= max_width or not current:
                current = candidate
                continue
            lines.append(current)
            current = char
        if current:
            lines.append(current)
        return lines

    lines = []
    current = ""
    words = text.split(" ")
    for word in words:
        candidate = f"{current} {word}".strip() if current else word
        candidate_width, _ = get_text_size(candidate)
        if candidate_width <= max_width:
            current = candidate
            continue

        if current:
            lines.append(current)

        word_width, _ = get_text_size(word)
        if word_width <= max_width:
            current = word
        else:
            lines.extend(split_long_token(word))
            current = ""

    if current:
        lines.append(current)

    line_start_punctuation = "，。！？；：、,.!?;:)]}）】》」』”’"
    for index in range(1, len(lines)):
        # When a long CJK sentence is split per character, a trailing period,
        # comma, or other closing punctuation can land alone on the next
        # line, stretching the subtitle background abnormally — like a stray
        # dot hanging under the text. Without redesigning the wrap algorithm,
        # move the previous line's last character in front of the punctuation
        # line so the mark follows its text. Covers common CJK and English
        # closing punctuation.
        if not lines[index] or lines[index][0] not in line_start_punctuation:
            continue
        if len(lines[index - 1]) <= 1:
            continue

        candidate = f"{lines[index - 1][-1]}{lines[index]}"
        candidate_width, _ = get_text_size(candidate)
        if candidate_width <= max_width:
            lines[index] = candidate
            lines[index - 1] = lines[index - 1][:-1]

    result = "\n".join(line.strip() for line in lines if line.strip()).strip()
    height = len(lines) * height
    return result, height


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    # The subtitle background color comes from API/WebUI params and may be
    # empty or malformed. Only accept #RRGGBB here; invalid values fall back
    # to black so the PIL render stage can't raise and kill the task.
    if isinstance(color, str) and color.startswith("#") and len(color) == 7:
        try:
            return (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))
        except ValueError:
            pass
    return (0, 0, 0)


def _rounded_subtitle_background_clip(
    width: int,
    height: int,
    color: str,
    alpha: int = 140,
    radius: int = 16,
) -> ImageClip:
    # The new subtitle background is only used when explicitly enabled: draw
    # a rounded translucent panel as an RGBA image, then hand it to MoviePy
    # as a transparent ImageClip for compositing. The default path stays
    # untouched while a softer subtitle look can be trialed cheaply.
    rgb = _hex_to_rgb(color)
    safe_alpha = max(0, min(255, int(alpha)))
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [0, 0, max(0, width - 1), max(0, height - 1)],
        radius=max(0, int(radius)),
        fill=(rgb[0], rgb[1], rgb[2], safe_alpha),
    )
    return ImageClip(np.array(img), transparent=True)


def _get_visible_center_position(
    text_clip: TextClip,
    container_width: int,
    container_height: int,
) -> tuple[int, int]:
    """
    Center the TextClip in the background container by its actual visible
    pixels.

    MoviePy's TextClip builds a transparent canvas from font line height and
    baseline. Many fonts' visible glyphs are not at that canvas's geometric
    center, so a plain `with_position("center")` centers the whole
    transparent canvas and the subtitle reads as shifted up or down. Read the
    TextClip's transparency mask and offset only by the bbox of pixels that
    actually exist, so the text the user sees is visually centered in the
    subtitle background.
    """
    x = int(round((container_width - text_clip.w) / 2))
    y = int(round((container_height - text_clip.h) / 2))

    try:
        if text_clip.mask is None:
            return x, y

        mask_frame = text_clip.mask.get_frame(0)
        ys, _ = np.where(mask_frame > 0.01)
        if len(ys) == 0:
            return x, y

        visible_top = int(ys.min())
        visible_bottom = int(ys.max())
        visible_height = visible_bottom - visible_top + 1
        y = int(round((container_height - visible_height) / 2 - visible_top))
    except Exception as exc:
        logger.debug(f"failed to center subtitle text by visible mask: {str(exc)}")

    return x, y


def generate_video(
    video_path: str,
    audio_path: str,
    subtitle_path: str,
    output_file: str,
    params: VideoParams,
    music_mood: str,
    recent_bgm_files: list[str] | None = None,
):
    aspect = VideoAspect(params.video_aspect)
    video_width, video_height = aspect.to_resolution()

    logger.info(f"generating video: {video_width} x {video_height}")
    logger.info(f"  ① video: {video_path}")
    logger.info(f"  ② audio: {audio_path}")
    logger.info(f"  ③ subtitle: {subtitle_path}")
    logger.info(f"  ④ output: {output_file}")

    # https://github.com/harry0703/MoneyPrinterTurbo/issues/217
    # PermissionError: [WinError 32] The process cannot access the file because it is being used by another process: 'final-1.mp4.tempTEMP_MPY_wvf_snd.mp3'
    # write into the same directory as the output file
    output_dir = os.path.dirname(output_file)

    font_path = ""
    if params.subtitle_enabled:
        if not params.font_name:
            params.font_name = DEFAULT_SUBTITLE_FONT
        font_path = _resolve_font_with_fallback(params)
        if os.name == "nt":
            font_path = font_path.replace("\\", "/")

        logger.info(f"  ⑤ font: {font_path}")

    def resolve_subtitle_background_color():
        # Back-compat for the historical param: `text_background_color` may be
        # a boolean or an actual color string. Normalize here so passing
        # True/False straight into TextClip can't produce surprising renders.
        if isinstance(params.text_background_color, bool):
            return "#000000" if params.text_background_color else None
        return params.text_background_color

    def create_text_clip(subtitle_item):
        params.font_size = int(params.font_size)
        params.stroke_width = int(params.stroke_width)
        phrase = subtitle_item[1]
        max_width = video_width * 0.9
        bg_color = resolve_subtitle_background_color()
        rounded_bg_enabled = bool(
            getattr(params, "rounded_subtitle_background", False) and bg_color
        )
        has_subtitle_background = bool(bg_color)
        pad_x = int(params.font_size * 0.6) if has_subtitle_background else 0
        # The subtitle background needs explicit horizontal padding. Deduct
        # the padding from the available width before wrapping, so long
        # English lines or large sizes that exactly fill 90% of the video
        # width don't touch the background edges and look clipped. Both the
        # plain rectangle and rounded backgrounds share this path;
        # background-less subtitles keep the original max width.
        text_max_width = max(1, int(max_width) - 2 * pad_x)
        wrapped_txt, txt_height = wrap_text(
            phrase,
            max_width=text_max_width,
            font=font_path,
            fontsize=params.font_size,
        )
        interline = int(params.font_size * 0.25)
        line_count = wrapped_txt.count("\n") + 1
        vertical_padding = int(params.font_size * 0.35)
        text_clip_margin_y = max(
            int(params.font_size * 0.3), int(params.stroke_width * 2)
        )
        # MoviePy auto-shrinks the text box height under `method=label`; with
        # multiline subtitles, stroke, or a background color it can clip the
        # lower half of the last line. Pass a more conservative height here,
        # folding line spacing and extra top/bottom padding in, so both the
        # subtitle background and the text itself always render fully.
        clip_h = int(txt_height + vertical_padding + (interline * line_count))

        if rounded_bg_enabled:
            # A rounded background should hug the text width instead of reusing
            # the 90% video width. Measure the longest line with PIL first,
            # then add horizontal padding, so short subtitles don't get an
            # over-wide panel.
            try:
                font = ImageFont.truetype(font_path, params.font_size)
                text_w = max(
                    int(font.getbbox(line)[2] - font.getbbox(line)[0])
                    for line in wrapped_txt.split("\n")
                )
            except Exception as exc:
                logger.warning(
                    f"failed to measure subtitle text width, fallback to max width: {str(exc)}"
                )
                text_w = int(max_width)

            box_w = max(1, min(int(max_width), text_w + 2 * pad_x))
            radius = max(8, int(params.font_size * 0.4))
            text_clip = TextClip(
                text=wrapped_txt,
                font=font_path,
                font_size=params.font_size,
                color=params.text_fore_color,
                bg_color=None,
                stroke_color=params.stroke_color,
                stroke_width=params.stroke_width,
                interline=interline,
                size=(box_w, None),
                text_align="center",
                margin=(0, text_clip_margin_y),
            )
            clip_h = max(clip_h, text_clip.h)
            bg_clip = _rounded_subtitle_background_clip(
                width=box_w,
                height=clip_h,
                color=bg_color,
                alpha=140,
                radius=radius,
            )
            text_position = _get_visible_center_position(text_clip, box_w, clip_h)
            _clip = CompositeVideoClip(
                [bg_clip, text_clip.with_position(text_position)],
                size=(box_w, clip_h),
            )
        elif bg_color:
            size = (
                int(max_width),
                clip_h,
            )
            text_clip = TextClip(
                text=wrapped_txt,
                font=font_path,
                font_size=params.font_size,
                color=params.text_fore_color,
                bg_color=None,
                stroke_color=params.stroke_color,
                stroke_width=params.stroke_width,
                interline=interline,
                size=(int(max_width), None),
                text_align="center",
                margin=(0, text_clip_margin_y),
            )
            size = (size[0], max(size[1], text_clip.h))
            bg_clip = _rounded_subtitle_background_clip(
                width=size[0],
                height=size[1],
                color=bg_color,
                alpha=255,
                radius=0,
            )
            text_position = _get_visible_center_position(text_clip, size[0], size[1])
            _clip = CompositeVideoClip(
                [bg_clip, text_clip.with_position(text_position)],
                size=size,
            )
        else:
            size = (
                int(max_width),
                clip_h,
            )
            _clip = TextClip(
                text=wrapped_txt,
                font=font_path,
                font_size=params.font_size,
                color=params.text_fore_color,
                bg_color=None,
                stroke_color=params.stroke_color,
                stroke_width=params.stroke_width,
                interline=interline,
                size=size,
                text_align="center",
            )
        duration = subtitle_item[0][1] - subtitle_item[0][0]
        _clip = _clip.with_start(subtitle_item[0][0])
        _clip = _clip.with_end(subtitle_item[0][1])
        _clip = _clip.with_duration(duration)
        if params.subtitle_position == "bottom":
            _clip = _clip.with_position(("center", video_height * 0.95 - _clip.h))
        elif params.subtitle_position == "top":
            _clip = _clip.with_position(("center", video_height * 0.05))
        elif params.subtitle_position == "custom":
            # Ensure the subtitle is fully within the screen bounds
            margin = 10  # Additional margin, in pixels
            max_y = video_height - _clip.h - margin
            min_y = margin
            custom_y = (video_height - _clip.h) * (params.custom_position / 100)
            custom_y = max(
                min_y, min(custom_y, max_y)
            )  # Constrain the y value within the valid range
            _clip = _clip.with_position(("center", custom_y))
        else:  # center
            _clip = _clip.with_position(("center", "center"))
        return _clip

    video_clip = _open_video_clip_quietly(video_path)
    audio_clip = AudioFileClip(audio_path).with_effects(
        [afx.MultiplyVolume(params.voice_volume)]
    )

    def make_textclip(text):
        return TextClip(
            text=text,
            font=font_path,
            font_size=params.font_size,
        )

    if subtitle_path and os.path.exists(subtitle_path):
        sub = SubtitlesClip(
            subtitles=subtitle_path, encoding="utf-8", make_textclip=make_textclip
        )
        text_clips = []
        for item in sub.subtitles:
            clip = create_text_clip(subtitle_item=item)
            text_clips.append(clip)
        video_clip = CompositeVideoClip([video_clip, *text_clips])

    bgm_file = get_bgm_file(music_mood, recent_files=recent_bgm_files or ())
    if bgm_file and recent_bgm_files is not None:
        recent_bgm_files.append(bgm_file)
    if bgm_file:
        try:
            start_offset = get_bgm_start_offset(bgm_file)
            bgm_clip = (
                AudioFileClip(bgm_file)
                .subclipped(start_offset)
                .with_effects(
                    [
                        afx.MultiplyVolume(params.bgm_volume),
                        afx.AudioFadeOut(3),
                        afx.AudioLoop(duration=video_clip.duration),
                    ]
                )
            )
            audio_clip = CompositeAudioClip([audio_clip, bgm_clip])
        except Exception as e:
            logger.error(f"failed to add bgm: {str(e)}")

    video_clip = video_clip.with_audio(audio_clip)
    # Explicitly keep the input audio's sample rate; fall back to MoviePy's
    # 44100Hz default when unavailable. This reduces resampling-induced
    # quality wobble across runtimes, especially in Docker.
    output_audio_fps = int(getattr(audio_clip, "fps", 0) or 44100)
    _write_videofile_with_codec_fallback(
        video_clip,
        output_file=output_file,
        codec=_get_configured_video_codec(),
        audio_codec=audio_codec,
        audio_fps=output_audio_fps,
        audio_bitrate=audio_bitrate,
        temp_audiofile_path=_get_temp_audio_dir(output_dir),
        threads=params.n_threads or 2,
        preset=_get_configured_video_preset(),
        logger=None,
        fps=fps,
    )
    video_clip.close()
    del video_clip


def preprocess_video(materials: List[MaterialInfo], clip_duration=4):
    # The WebUI may pass an empty material list in some re-generation flows;
    # return an empty result directly instead of raising a NoneType error.
    if not materials:
        return []

    # Only materials that pass preprocessing validation are returned, so
    # low-resolution images can't proceed into the video compositing flow.
    valid_materials = []
    local_videos_dir = utils.storage_dir("local_videos", create=True)

    for material in materials:
        if not material.url:
            continue

        try:
            material_source_path = file_security.resolve_path_within_directory(
                local_videos_dir, material.url
            )
        except ValueError as exc:
            # local video_materials paths come from API params and must stay
            # inside the dedicated material directory. Bare filenames are
            # allowed (and historical absolute return values are tolerated),
            # but nothing may escape to other system directories — no
            # arbitrary file reads or MoviePy probing of local sensitive
            # files.
            logger.warning(
                f"skip unsafe local material: {material.url}, "
                f"local_videos_dir: {local_videos_dir}, error: {str(exc)}"
            )
            continue

        ext = utils.parse_extension(material_source_path)
        try:
            # Read image material as an image directly, so a VideoFileClip
            # mis-detection can't trigger the unstable fallback branch.
            if ext in const.FILE_TYPE_IMAGES:
                clip, material_source_path = _open_image_clip_with_fallback(
                    material_source_path
                )
            else:
                clip = _open_video_clip_quietly(material_source_path)
        except Exception:
            # Fall back to image mode only on non-standard extensions or probe
            # failure, for back-compat with direct local image paths.
            try:
                clip, material_source_path = _open_image_clip_with_fallback(
                    material_source_path
                )
            except Exception as exc:
                logger.warning(
                    f"skip unreadable local material: {material.url}, error: {str(exc)}"
                )
                continue
        try:
            width = clip.size[0]
            height = clip.size[1]
            if width < 480 or height < 480:
                logger.warning(f"low resolution material: {width}x{height}, minimum 480x480 required")
                # Release the probe handle right after detecting low
                # resolution, and don't pass the material on.
                close_clip(clip)
                continue

            if ext in const.FILE_TYPE_IMAGES:
                logger.info(f"processing image: {material_source_path}")
                # The material was already opened once for the size probe;
                # release that handle before re-creating the image clip used
                # for export.
                close_clip(clip)
                # Create an image clip and set its duration to 3 seconds
                clip = (
                    ImageClip(material_source_path)
                    .with_duration(clip_duration)
                    .with_position("center")
                )
                # Apply a zoom effect using the resize method.
                # A lambda function is used to make the zoom effect dynamic over time.
                # The zoom effect starts from the original size and gradually scales up to 120%.
                # t represents the current time, and clip.duration is the total duration of the clip (3 seconds).
                # Note: 1 represents 100% size, so 1.2 represents 120% size.
                zoom_clip = clip.resized(
                    lambda t: 1 + (clip_duration * 0.03) * (t / clip.duration)
                )

                # Optionally, create a composite video clip containing the zoomed clip.
                # This is useful when you want to add other elements to the video.
                final_clip = CompositeVideoClip([zoom_clip])

                # Output the video to a file.
                video_file = f"{material_source_path}.mp4"
                final_clip.write_videofile(video_file, fps=30, logger=None)
                close_clip(clip)
                close_clip(final_clip)
                material.url = video_file
                logger.success(f"image processed: {video_file}")
            else:
                # Plain video material only needs its size read for validation;
                # release the handle right after the check.
                close_clip(clip)
                # Update url to the resolved absolute path so that downstream
                # stages (combine_videos) can open the file without re-resolving.
                material.url = material_source_path
        except Exception:
            close_clip(clip)
            raise

        valid_materials.append(material)

    return valid_materials
