"""Download stock videos into the local cache.

This module is the low-level home of save_video: material.py imports it and
re-exports it, and svg_material imports it directly. Keeping the downloader
out of material.py breaks the old import cycle — material.py imports
svg_material at top level, so svg_material could only reach save_video
through a lazy import inside the function body.
"""
import os

from loguru import logger
from moviepy.video.io.VideoFileClip import VideoFileClip

from app.config import config
from app.utils import ssrf, utils

# Cap for cached stock-video downloads (bytes).
_VIDEO_MAX_BYTES = 200 * 1024 * 1024


def _get_tls_verify() -> bool:
    # TLS certificate verification is on by default, so material search and
    # download traffic can't be intercepted or tampered with by a
    # man-in-the-middle on public networks or untrusted proxies.
    # It may only be disabled explicitly via `tls_verify = false` in
    # `config.toml` for environments that need it (corporate proxy,
    # self-signed certificates, ...).
    tls_verify = config.app.get("tls_verify", True)
    if isinstance(tls_verify, str):
        tls_verify = tls_verify.strip().lower() not in ("0", "false", "no", "off")

    if not tls_verify:
        logger.warning(
            "TLS certificate verification is disabled by config.app.tls_verify=false. "
            "Only use this in trusted proxy environments."
        )

    return bool(tls_verify)


def save_video(video_url: str, save_dir: str = "") -> str:
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")

    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    url_without_query = video_url.split("?")[0]
    url_hash = utils.md5(url_without_query)
    video_id = f"vid-{url_hash}"
    video_path = f"{save_dir}/{video_id}.mp4"

    # if video already exists, return the path
    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        logger.info(f"video already exists: {video_path}")
        return video_path

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    # Download via the SSRF-guarded helper: every redirect hop is validated,
    # the body is streamed with a byte cap and video/* content-type required.
    try:
        ssrf.download_public_file(
            video_url,
            video_path,
            what="stock video",
            max_bytes=_VIDEO_MAX_BYTES,
            allowed_content_types=("video/",),
            timeout=240,
            tls_verify=_get_tls_verify(),
            headers=headers,
            proxies=config.proxy,
        )
    except Exception as e:
        logger.warning(f"video download rejected or failed: {video_url} => {str(e)}")

    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        clip = None
        try:
            clip = VideoFileClip(video_path)
            duration = clip.duration
            fps = clip.fps
            if duration > 0 and fps > 0:
                return video_path
        except Exception as e:
            logger.warning(f"invalid video file: {video_path} => {str(e)}")
            try:
                os.remove(video_path)
            except Exception as remove_error:
                logger.warning(
                    f"failed to remove invalid video file: {video_path}, error: {str(remove_error)}"
                )
        finally:
            if clip is not None:
                try:
                    clip.close()
                except Exception as close_error:
                    logger.warning(
                        f"failed to close video clip: {video_path}, error: {str(close_error)}"
                    )
    return ""
