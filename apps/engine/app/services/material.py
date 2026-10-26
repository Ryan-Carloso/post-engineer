import os
import random
import threading
from typing import List
from urllib.parse import urlencode

import requests
from loguru import logger

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect, VideoConcatMode
from app.services import material_verification, svg_catalog, svg_material
from app.services.material_verification import (
    MAX_LETTERBOX_BARS as MAX_LETTERBOX_BARS,
    _ratio_matches as _ratio_matches,
    _source_resolution_allowed as _source_resolution_allowed,
)
from app.services.video_download import _get_tls_verify
# save_video lives in video_download; re-exported here because existing
# callers (and tests) import it from material.
from app.services.video_download import save_video as save_video
from app.utils import secret_redaction, utils

# Thread-safe counter for API key rotation
_api_key_counter = 0
_api_key_lock = threading.Lock()


def get_api_key(cfg_key: str):
    api_keys = config.app.get(cfg_key)
    if not api_keys:
        # Never serialize the whole app config here: it holds every other
        # provider key, and this exception text can surface in logs or API
        # error responses.
        raise ValueError(
            f"\n\n##### {cfg_key} is not set #####\n\nPlease set it in the config.toml file: {config.config_file}\n\n"
        )

    # if only one key is provided, return it
    if isinstance(api_keys, str):
        return api_keys

    global _api_key_counter
    with _api_key_lock:
        _api_key_counter += 1
        return api_keys[_api_key_counter % len(api_keys)]



def search_videos_pexels(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)
    video_orientation = aspect.name
    video_width, video_height = aspect.to_resolution()
    api_key = get_api_key("pexels_api_keys")
    headers = {
        "Authorization": api_key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    }
    # Build URL
    params = {"query": search_term, "per_page": 20, "orientation": video_orientation}
    query_url = f"https://api.pexels.com/videos/search?{urlencode(params)}"
    logger.info(f"searching videos: {query_url}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
        )
        response = r.json()
        video_items = []
        if "videos" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["videos"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["video_files"]
            # Best file (largest area) whose orientation matches the
            # video_aspect — without requiring an exact resolution, which
            # discarded valid portraits in other dimensions (720x1280 etc.).
            best_file = None
            best_area = 0
            for video in video_files:
                w = int(video["width"])
                h = int(video["height"])
                if not _source_resolution_allowed(w, h):
                    continue
                if not _ratio_matches(w, h, aspect):
                    continue
                area = w * h
                if area > best_area:
                    best_area = area
                    best_file = video
            if best_file is not None:
                item = MaterialInfo()
                item.provider = "pexels"
                item.url = best_file["link"]
                item.duration = duration
                video_items.append(item)
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def search_videos_pixabay(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)

    video_width, video_height = aspect.to_resolution()

    api_key = get_api_key("pixabay_api_keys")
    # Build URL
    params = {
        "q": search_term,
        "video_type": "all",  # Accepted values: "all", "film", "animation"
        "per_page": 50,
        "key": api_key,
    }
    query_url = f"https://pixabay.com/api/videos/?{urlencode(params)}"
    # The Pixabay API only accepts the key as a `key` query parameter (no
    # header auth exists), so it must stay in the request URL — but it must
    # never reach the logs. Log the redacted URL instead.
    logger.info(
        f"searching videos: {secret_redaction.redact_url(query_url)}, "
        f"with proxies: {config.proxy}"
    )

    try:
        r = requests.get(
            query_url, proxies=config.proxy, verify=_get_tls_verify(), timeout=(30, 60)
        )
        response = r.json()
        video_items = []
        if "hits" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["hits"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["videos"]
            # Best file (largest area) whose shape stays within the bar
            # ceiling against the video_aspect — shapes outside the band are
            # discarded at the source.
            best_file = None
            best_area = -1
            for video_type in video_files:
                video = video_files[video_type]
                w = int(video.get("width") or 0)
                h = int(video.get("height") or 0)
                if not _source_resolution_allowed(w, h):
                    continue
                if not _ratio_matches(w, h, aspect):
                    continue
                area = w * h
                if area > best_area:
                    best_area = area
                    best_file = video
            if best_file is not None:
                item = MaterialInfo()
                item.provider = "pixabay"
                item.url = best_file["url"]
                item.duration = duration
                video_items.append(item)
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def search_videos_coverr(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    """
    Coverr (https://coverr.co) - free HD/4K stock videos,
    subject to Coverr license terms (https://coverr.co/license).

    Coverr API notes (based on official docs at api.coverr.co/docs/):
      - Auth: Authorization: Bearer <api_key>
      - Search endpoint: GET /videos?query=..., response shape {"hits": [...], ...}
      - Adding ?urls=true returns direct mp4 links in the search response
      - The URL is a signed JWT (bound to the API key, no expiry)
      - The Coverr library is mostly 16:9 landscape; 9:16 portrait is very
        rare (~1%), so this function does no aspect_ratio filtering — the
        downstream resize + letterbox logic in video.py handles it uniformly
      - The duration field arrives as a number or a string; both are accepted

    This function uses the urls.mp4_download field as the download address —
    per the official Coverr docs
    (https://api.coverr.co/docs/videos/#download-a-video), GETting that URL
    already counts as a legitimate download event on Coverr's side, so there
    is no need to call PATCH /videos/:id/stats/downloads.
    """
    api_key = get_api_key("coverr_api_keys")
    aspect = VideoAspect(video_aspect)
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {
        "query": search_term,
        "page_size": 20,
        "urls": "true",
        "sort": "popular",
    }
    query_url = f"https://api.coverr.co/videos?{urlencode(params)}"
    logger.info(f"searching videos: {query_url}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
        )
        response = r.json()
        video_items: List[MaterialInfo] = []

        if not isinstance(response, dict) or "hits" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items

        for v in response["hits"]:
            # duration may arrive as a number (11.625) or a string ("10.500000")
            # depending on the response.
            try:
                duration = int(float(v.get("duration") or 0))
            except (TypeError, ValueError):
                continue
            if duration < minimum_duration:
                continue

            # Can't evaluate the bar ceiling without dimensions — reject.
            width = int(v.get("width") or 0)
            height = int(v.get("height") or 0)
            if not _source_resolution_allowed(width, height) or not _ratio_matches(
                width, height, aspect
            ):
                continue

            video_id = v.get("id")
            mp4_download_url = (v.get("urls") or {}).get("mp4_download")
            if not video_id or not mp4_download_url:
                continue

            item = MaterialInfo()
            item.provider = "coverr"
            item.url = mp4_download_url
            item.duration = duration
            video_items.append(item)
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def _build_search_videos(
    source: str,
    video_aspect: VideoAspect,
    source_mix: List[str] = None,
):
    """
    Resolve the video search function(s).

    Without `source_mix`: behaves as before — only the `source` provider.
    With `source_mix` (2+ providers): cascades per keyword in list order; a
    provider is only queried when the previous ones returned no material. An
    enabled SVG catalog always leads the cascade (svg_catalog.lead_cascade).
    """
    providers = {
        "svg": svg_material.search_videos_svg,
        "pexels": search_videos_pexels,
        "pixabay": search_videos_pixabay,
        "coverr": search_videos_coverr,
    }
    if source_mix:
        chain = [providers[n] for n in svg_catalog.lead_cascade(source_mix) if n in providers]
    else:
        chain = [providers.get(source, search_videos_pexels)]

    if len(chain) <= 1:
        return chain[0] if chain else search_videos_pexels

    def search_with_fallback(
        search_term: str,
        minimum_duration: int,
        video_aspect: VideoAspect = video_aspect,
    ) -> List[MaterialInfo]:
        for search_fn in chain:
            items = search_fn(
                search_term=search_term,
                minimum_duration=minimum_duration,
                video_aspect=video_aspect,
            )
            if items:
                return items
        return []

    return search_with_fallback


def download_videos(
    task_id: str,
    search_terms: List[str],
    source: str = "pexels",
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_concat_mode: VideoConcatMode = VideoConcatMode.random,
    audio_duration: float = 0.0,
    max_clip_duration: int = 5,
    match_script_order: bool = False,
    source_mix: List[str] = None,
    exclude_faces: bool | None = None,
    material_scorer=None,
) -> List[str]:
    search_videos = _build_search_videos(source, video_aspect, source_mix)

    material_directory = config.app.get("material_directory", "").strip()
    if material_directory == "task":
        material_directory = utils.task_dir(task_id)
    elif material_directory and not os.path.isdir(material_directory):
        material_directory = ""

    if match_script_order:
        return _download_videos_by_script_order(
            task_id=task_id,
            search_terms=search_terms,
            search_videos=search_videos,
            video_aspect=video_aspect,
            audio_duration=audio_duration,
            max_clip_duration=max_clip_duration,
            material_directory=material_directory,
            exclude_faces=exclude_faces,
            material_scorer=material_scorer,
        )

    valid_video_items = []
    valid_video_urls = []
    term_groups = []
    found_duration = 0.0
    for search_term in search_terms:
        video_items = search_videos(
            search_term=search_term,
            minimum_duration=max_clip_duration,
            video_aspect=video_aspect,
        )
        logger.info(f"found {len(video_items)} videos for '{search_term}'")

        term_items = []
        for item in video_items:
            if item.url not in valid_video_urls:
                term_items.append(item)
                valid_video_urls.append(item.url)
                found_duration += item.duration
        valid_video_items.extend(term_items)
        term_groups.append((search_term, term_items))

    logger.info(
        f"found total videos: {len(valid_video_items)}, required duration: {audio_duration} seconds, found duration: {found_duration} seconds"
    )
    if material_verification.verification_config().enabled:
        valid_video_items, decisions = material_verification.apply_verification(
            term_groups,
            scorer=material_scorer,
            subject_to_asset=material_verification.subject_to_asset_from_config(),
        )
        material_verification.emit_material_fallback_summary(task_id, decisions)
    video_paths = []

    concat_mode_value = getattr(video_concat_mode, "value", video_concat_mode)
    if concat_mode_value == VideoConcatMode.random.value:
        random.shuffle(valid_video_items)

    total_duration = 0.0
    for item in valid_video_items:
        try:
            logger.info(f"downloading video: {item.url}")
            saved_video_path = svg_material.resolve_material_path(
                item,
                material_directory,
                max_clip_duration,
                exclude_faces,
                video_aspect,
            )
            if saved_video_path:
                logger.info(f"video saved: {os.path.basename(saved_video_path)}")
                video_paths.append(saved_video_path)
                seconds = min(max_clip_duration, item.duration)
                total_duration += seconds
                if total_duration > audio_duration:
                    logger.info(
                        f"total duration of downloaded videos: {total_duration} seconds, skip downloading more"
                    )
                    break
        except Exception as e:
            logger.error(f"failed to download video: {utils.to_json(item)} => {str(e)}")
    logger.success(f"downloaded {len(video_paths)} videos")
    return video_paths


def _download_videos_by_script_order(
    task_id: str,
    search_terms: List[str],
    search_videos,
    video_aspect: VideoAspect,
    audio_duration: float,
    max_clip_duration: int,
    material_directory: str,
    exclude_faces: bool | None = None,
    material_scorer=None,
) -> List[str]:
    """
    Download materials in script order.

    The default download logic merges every keyword's candidate materials
    into one big list; if the first keyword returns many results, the final
    download may keep consuming that keyword's materials while later script
    topics never make the timeline. Grouping by keyword and downloading
    round-robin here — round 1 takes each keyword's 1st candidate, round 2
    each keyword's 2nd candidate — keeps the material order close to the
    script order without rewriting the video composition engine.
    """
    logger.info("downloading videos with script-order material matching")
    candidate_groups = []
    valid_video_urls = set()
    found_duration = 0.0

    for search_term in search_terms:
        video_items = search_videos(
            search_term=search_term,
            minimum_duration=max_clip_duration,
            video_aspect=video_aspect,
        )
        logger.info(f"found {len(video_items)} videos for '{search_term}'")

        term_items = []
        for item in video_items:
            if item.url in valid_video_urls:
                continue
            term_items.append(item)
            valid_video_urls.add(item.url)
            found_duration += item.duration

        if term_items:
            candidate_groups.append((search_term, term_items))

    logger.info(
        f"found total ordered video candidates: {sum(len(items) for _, items in candidate_groups)}, "
        f"required duration: {audio_duration} seconds, found duration: {found_duration} seconds"
    )
    verification_enabled = material_verification.verification_config().enabled
    if verification_enabled:
        candidate_groups = material_verification.verified_script_order_groups(
            candidate_groups, task_id, material_scorer
        )

    video_paths = []
    total_duration = 0.0
    candidate_index = 0
    while candidate_groups and total_duration <= audio_duration:
        has_candidate = False
        for search_term, term_items in candidate_groups:
            if candidate_index >= len(term_items):
                continue

            has_candidate = True
            item = term_items[candidate_index]
            try:
                logger.info(
                    f"downloading ordered video for '{search_term}': {item.url}"
                )
                saved_video_path = svg_material.resolve_material_path(
                    item,
                    material_directory,
                    max_clip_duration,
                    exclude_faces,
                    video_aspect,
                )
                if not saved_video_path and verification_enabled and (
                    item.provider not in ("svg", "neutral")
                ):
                    # Failed verified stock degrades to neutral, never
                    # to unverified stock from the original pool.
                    saved_video_path = svg_material.resolve_material_path(
                        material_verification.neutral_item_for(item),
                        material_directory,
                        max_clip_duration,
                        exclude_faces,
                        video_aspect,
                    )
                if not saved_video_path:
                    continue

                logger.info(f"video saved: {os.path.basename(saved_video_path)}")
                video_paths.append(saved_video_path)
                total_duration += min(max_clip_duration, item.duration)
                if total_duration > audio_duration:
                    logger.info(
                        f"total duration of downloaded videos: {total_duration} seconds, skip downloading more"
                    )
                    break
            except Exception as e:
                logger.error(
                    f"failed to download ordered video: {utils.to_json(item)} => {str(e)}"
                )
                continue

        if not has_candidate:
            break

        candidate_index += 1

    logger.success(f"downloaded {len(video_paths)} ordered videos")
    return video_paths


if __name__ == "__main__":
    download_videos(
        "test123", ["Money Exchange Medium"], audio_duration=100, source="pixabay"
    )
