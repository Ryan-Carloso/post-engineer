import base64
import math
import os.path
import random
import re
from collections import deque
from os import path
from threading import Lock
import time
from typing import Sequence

from loguru import logger

from app.config import config
from app.models import const
from app.models.schema import VideoConcatMode, VideoParams
from app.services import (
    llm,
    material,
    infinitetalk,
    subtitle,
    twelvelabs,
    video,
    voice,
    upload_post,
)
from app.services import state as sm
from app.services import task_publish
from app.services import task_webhook
from app.services.bgm_history import history_repository
from app.services.notify import safe_reason, send_discord, task_failed_msg
from app.utils import file_security, ssrf, utils

HOUSE_VOICE_NAMES: dict[str, str] = {
    "calm": "en-US-JennyNeural-Female",
    "energetic": "en-US-GuyNeural-Male",
    "young": "en-US-AriaNeural-Female",
    "deep": "en-US-DavisNeural-Male",
}

#---------------
# Remote material sources, always used in cascade with per-task shuffled
# order: the starting source is drawn at random (variety across videos)
# and the rest serve as fallback when a source returns no material.
# Fixed on purpose — no API field and no configuration.
#---------------
REMOTE_VIDEO_SOURCES: list[str] = ["pexels", "pixabay", "coverr"]

#---------------
# _fail_task — marks a task FAILED and sends one Discord alert per task.
# Failure sites are scattered (phase helpers mark FAILED and start()
# re-checks the result), so recent-ids dedupes: the user gets a single
# alert per failed task, not one per phase that noticed it.
# The cache is a bounded deque (not a set) so the process can't grow it
# forever. Note the bound only evicts after MAX_FAILED_ALERTS *other
# distinct* failures — a task retried under the same id inside that
# window still dedupes (no new alert). In practice retries use fresh
# task ids, and a process restart resets the cache, so a retried task
# then alerts again.
# Check-and-add is guarded by a lock with a short blocking acquire, so
# concurrent failures of the same task dedupe to one alert instead of
# every thread slipping through.
#---------------
MAX_FAILED_ALERTS = 1000
# The critical section is microseconds; the timeout only matters if a
# thread dies while holding the lock.
_ALERT_LOCK_TIMEOUT_SECONDS = 0.5
_discord_notified_failed_tasks: deque[str] = deque(maxlen=MAX_FAILED_ALERTS)
_discord_notified_failed_tasks_lock = Lock()


def _should_send_failure_alert(task_id: str) -> bool:
    """Atomically check-and-record ``task_id``; True only on first sight.

    Waits briefly for the lock so concurrent failures of the same task
    dedupe to a single alert. Falls back to sending (True) if the lock
    can't be acquired in time — missing an alert is worse than a duplicate.
    """
    if not _discord_notified_failed_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        return True
    try:
        if task_id in _discord_notified_failed_tasks:
            return False
        _discord_notified_failed_tasks.append(task_id)
        return True
    finally:
        _discord_notified_failed_tasks_lock.release()


def _release_failure_alert(task_id: str) -> None:
    """Forget a recorded alert reservation (e.g. the send failed).

    A transient Discord outage must not permanently suppress the alert: the
    next failure notice for the task re-alerts instead of staying silent.
    Uses the same bounded lock acquire as the check-and-add path — an
    unbounded block here could hang the failure-handling thread if a lock
    holder ever died mid-critical-section.
    """
    if not _discord_notified_failed_tasks_lock.acquire(timeout=_ALERT_LOCK_TIMEOUT_SECONDS):
        logger.warning("discord alert reservation for %s not released: lock busy", task_id)
        return
    try:
        try:
            _discord_notified_failed_tasks.remove(task_id)
        except ValueError:
            pass  # already aged out of the bounded cache
    finally:
        _discord_notified_failed_tasks_lock.release()


def _task_already_failed(task_id: str) -> bool:
    """True when the task is already recorded as FAILED.

    Guards the stored error: the first failure's (most specific) message
    must survive generic follow-up notices.
    """
    try:
        task = sm.state.get_task(task_id)
    except Exception:  # noqa: BLE001 — a failed read must not hide the failure
        return False
    return bool(task) and task.get("state") == const.TASK_STATE_FAILED


def _first_http_url(paths: object) -> str | None:
    """First http(s) URL in ``paths`` (local artifact paths are not URLs)."""
    if not isinstance(paths, (list, tuple)):
        return None
    for item in paths:
        if isinstance(item, str) and item.startswith(("http://", "https://")):
            return item
    return None


def _complete_task(
    task_id: str,
    params: VideoParams,
    video_url: str | None = None,
    **kwargs: object,
) -> None:
    """Mark a task COMPLETE and fire the terminal webhook (once per task)."""
    sm.state.update_task(
        task_id, state=const.TASK_STATE_COMPLETE, progress=100, **kwargs
    )
    task_webhook.notify_terminal_task(
        task_id,
        status="completed",
        webhook_url=getattr(params, "webhook_url", None),
        video_url=video_url,
    )


def _fail_task(
    task_id: str,
    error: str,
    params: VideoParams | None = None,
    stage: str | None = None,
    exc: BaseException | None = None,
    **kwargs: object,
) -> None:
    """Mark a task FAILED; fire-and-forget Discord alert (once per task).

    Every call emits a structured Loguru ERROR record (forwarded to
    Bugsink by the asgi sink, ERROR+) with the task id, the pipeline
    stage that failed and the error type — so the reason is visible per
    step. The full params are never logged: they may carry secrets,
    signed URLs or tokens.

    The first failure notice records its error and alerts. A later notice
    for an already-failed task only re-asserts the FAILED state — it never
    overwrites the stored error, which is the first, most specific one
    (e.g. "custom audio file is invalid: ..." must survive the generic
    "failed to generate audio" follow-up).
    """
    failed_stage = stage or "unknown"
    error_type = type(exc).__name__ if exc is not None else "TaskError"
    # Bind only safe identifiers: never params, headers, tokens or URLs.
    logger.bind(task_id=task_id, stage=failed_stage, error_type=error_type).error(
        "video task failed at stage {stage}: {error}",
        stage=failed_stage,
        error=error,
    )
    if _task_already_failed(task_id):
        sm.state.update_task(task_id, state=const.TASK_STATE_FAILED, **kwargs)
    else:
        sm.state.update_task(task_id, state=const.TASK_STATE_FAILED, error=error, **kwargs)
    # Terminal webhook (at most once per task, deduped inside): a failing
    # delivery only logs, it never changes the task outcome.
    task_webhook.notify_terminal_task(
        task_id,
        status="failed",
        webhook_url=getattr(params, "webhook_url", None),
        error=error,
    )
    if not _should_send_failure_alert(task_id):
        return
    subject = params.video_subject if params and params.video_subject else ""
    if not send_discord(task_failed_msg(task_id, error, subject)):
        # The alert never went out (network blip, webhook misconfigured):
        # release the reservation so a later failure notice re-alerts.
        _release_failure_alert(task_id)


def _limit_generated_script(script: str) -> str:
    """Keep generated speech inside the configured character budget."""
    limit = int(config.app.get("max_video_script_characters", 700))
    normalized = re.sub(r"[ \t]+", " ", script.strip())
    if len(normalized) <= limit:
        return normalized
    candidate = normalized[:limit]
    sentence_end = max(candidate.rfind(mark) for mark in ".!?。！？")
    if sentence_end >= 0:
        return candidate[: sentence_end + 1].strip()
    word_end = candidate.rfind(" ")
    return candidate[:word_end if word_end > 0 else limit].strip()


def persona_lipsync_active(params: VideoParams) -> bool:
    """True when the job should generate the persona's lip-sync intro.

    Requires a persona with a visual identity (photo_url OR avatar_url) AND
    lipsync_enabled. A faceless persona (no visual) — or one with
    lipsync_enabled=False — contributes only the voice and the video is
    rendered normally, with no face filter on the material
    (exclude_faces=False in get_video_materials).
    """
    persona = params.persona
    if persona is None or not bool(params.lipsync_enabled):
        return False
    return persona.photo_url is not None or persona.avatar_url is not None


def persona_hook_end_seconds(
    video_script: str,
    subtitles: Sequence[tuple[int, str, str]],
    minimum_seconds: float = 3.0,
    maximum_seconds: float = 6.0,
) -> float:
    """Return the subtitle boundary that completes the first script paragraph."""
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", video_script.strip())
        if paragraph.strip()
    ]
    if len(paragraphs) < 2:
        raise ValueError("persona script must contain at least two paragraphs")
    if not re.search(r"[.!?。！？]$", paragraphs[0]):
        raise ValueError("persona hook must end with terminal punctuation")

    def normalize(text: str) -> str:
        return re.sub(r"[^\w]+", "", text.casefold())

    hook = normalize(paragraphs[0])
    spoken = ""
    for _, timing, text in subtitles:
        match = re.search(
            r"\d+:\d+:\d+[,\.]\d+\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)",
            timing,
        )
        if match is None:
            continue
        spoken += normalize(text)
        if hook and hook in spoken:
            end_seconds = (
                int(match.group(1)) * 3600
                + int(match.group(2)) * 60
                + int(match.group(3))
                + int(match.group(4)) / 1000
            )
            if not minimum_seconds <= end_seconds <= maximum_seconds:
                raise ValueError(
                    f"persona hook must end between {minimum_seconds:g} and "
                    f"{maximum_seconds:g} seconds, got {end_seconds:g}"
                )
            return end_seconds

    raise ValueError("could not locate hook paragraph in subtitle timestamps")


def generate_script(task_id, params):
    logger.info("\n\n## generating video script")
    video_script = params.video_script.strip()
    if not video_script:
        script_prompt = params.video_script_prompt
        if persona_lipsync_active(params):
            script_prompt = (
                f"{script_prompt} Start with a standalone hook paragraph of 8 to 16 words, "
                "designed to take 3 to 6 seconds when spoken. End the hook with terminal "
                "punctuation, then add exactly one blank line before the main content."
            ).strip()
        video_script = llm.generate_script(
            video_subject=params.video_subject,
            language=params.video_language,
            paragraph_number=params.paragraph_number,
            video_script_prompt=script_prompt,
            custom_system_prompt=params.custom_system_prompt,
        )
    else:
        # Log only the size — the script itself is user content and must not
        # reach the logs.
        logger.debug(f"video script received: {len(video_script)} characters")

    if persona_lipsync_active(params):
        video_script = _limit_generated_script(video_script)
        paragraphs = [
            paragraph.strip()
            for paragraph in re.split(r"\n\s*\n", video_script)
            if paragraph.strip()
        ]
        if len(paragraphs) < 2 or not re.search(r"[.!?。！？]$", paragraphs[0]):
            logger.warning("persona script has no valid hook; generating hook and body separately")
            hook = llm.generate_script(
                video_subject=params.video_subject,
                language=params.video_language,
                paragraph_number=1,
                video_script_prompt=(
                    f"{params.video_script_prompt} Regenerate the entire script. "
                    "Return only the standalone first paragraph: a complete "
                    "3 to 6 second hook of 8 to 16 words ending with terminal "
                    "punctuation."
                ),
                custom_system_prompt=params.custom_system_prompt,
                target_words_min=8,
                target_words_max=16,
            )
            body = llm.generate_script(
                video_subject=params.video_subject,
                language=params.video_language,
                paragraph_number=1,
                video_script_prompt=(
                    f"{params.video_script_prompt} Return only the main content "
                    "paragraph that follows the hook. Do not include a heading or "
                    "repeat the hook."
                ),
                custom_system_prompt=params.custom_system_prompt,
                target_words_min=72,
                target_words_max=94,
            )
            video_script = _limit_generated_script(f"{hook.strip()}\n\n{body.strip()}")
            paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", video_script) if paragraph.strip()]
            if len(paragraphs) < 2 or not re.search(r"[.!?。！？]$", paragraphs[0]):
                raise ValueError("persona script failed hook validation after separate regeneration")

    if not video_script:
        _fail_task(task_id, "failed to generate video script", params, stage="script")
        logger.error("failed to generate video script.")
        return None

    return video_script


def generate_terms(task_id, params, video_script):
    logger.info("\n\n## generating video terms")
    video_terms = params.video_terms
    if not video_terms:
        # With ordered material matching enabled, the keywords themselves must
        # also be generated in script narrative order; otherwise later ordered
        # download and ordered concat can only reuse one global theme set and
        # can't fix "later content's visuals appearing early".
        video_terms = llm.generate_terms(
            video_subject=params.video_subject,
            video_script=video_script,
            amount=8 if params.match_materials_to_script else 5,
            match_script_order=params.match_materials_to_script,
        )
    else:
        if isinstance(video_terms, str):
            video_terms = [term.strip() for term in re.split(r"[,，]", video_terms)]
        elif isinstance(video_terms, list):
            video_terms = [term.strip() for term in video_terms]
        else:
            raise ValueError("video_terms must be a string or a list of strings.")

        # Log only the count — the terms themselves are user content and must
        # not reach the logs.
        logger.debug(f"video terms: {len(video_terms)} terms")

    if not video_terms:
        _fail_task(task_id, "failed to generate video terms", params, stage="terms")
        logger.error("failed to generate video terms.")
        return None

    # Optional TwelveLabs Marengo semantic rerank: returns the original order
    # untouched when disabled. In ordered-match mode the keyword order is
    # already the script narrative order and must be preserved, so it is
    # skipped.
    if not params.match_materials_to_script:
        video_terms = twelvelabs.rerank_terms_by_subject(
            video_subject=params.video_subject,
            search_terms=video_terms,
        )

    return video_terms


def save_script_data(task_id, video_script, video_terms, params):
    script_file = path.join(utils.task_dir(task_id), "script.json")
    script_data = {
        "script": video_script,
        "search_terms": video_terms,
        "params": params,
    }

    with open(script_file, "w", encoding="utf-8") as f:
        f.write(utils.to_json(script_data))


def resolve_custom_audio_file(task_id: str, custom_audio_file: str | None) -> str:
    """Resolve a user-supplied custom audio path inside the allowed directories.

    Only files inside the current task directory or the shared
    ``local_videos`` storage directory are accepted. Absolute paths,
    ``..`` traversal, and symlink escapes pointing elsewhere are rejected
    with ValueError. An empty input resolves to "" (no custom audio).
    """
    requested_file = (custom_audio_file or "").strip()
    if not requested_file:
        return ""

    # Absolute paths are never accepted, even when they happen to land
    # inside an allowed directory: the API contract is basename-only, so a
    # host path must never be echoed back or resolved.
    if os.path.isabs(requested_file):
        raise ValueError(
            f"custom audio file '{requested_file}' must be a file name, not an "
            "absolute path; supply a base name inside the task directory or "
            "local_videos"
        )

    allowed_bases = (
        utils.task_dir(task_id),
        utils.storage_dir("local_videos", create=True),
    )
    not_found = False
    for base_dir in allowed_bases:
        try:
            return file_security.resolve_path_within_directory(
                base_dir,
                requested_file,
            )
        except ValueError as exc:
            # file_security reports a missing file with "does not exist";
            # keep that distinction so the failure message stays helpful.
            if "does not exist" in str(exc):
                not_found = True
            continue
    if not_found:
        raise ValueError(f"custom audio file '{requested_file}' does not exist")
    raise ValueError(
        "custom audio file must be task-local or inside the local_videos "
        "storage directory"
    )


def cleanup_task_intermediates(task_id: str, preserved_paths: Sequence[str]) -> None:
    """Remove task intermediates while keeping final videos available locally."""
    task_directory = path.realpath(utils.task_dir(task_id))
    preserved = {
        path.realpath(file_path)
        for file_path in preserved_paths
        if file_path
    }

    if not path.isdir(task_directory):
        return

    for root, directories, files in os.walk(task_directory, topdown=False):
        for file_name in files:
            file_path = path.realpath(path.join(root, file_name))
            if file_path not in preserved:
                os.remove(file_path)
        for directory_name in directories:
            directory_path = path.join(root, directory_name)
            if not os.listdir(directory_path):
                os.rmdir(directory_path)


def resolve_persona_audio(params: VideoParams) -> tuple[str, str | None]:
    """Resolve the effective voice from the job's inline persona.

    Returns (voice_name, voice_audio). When the persona carries
    ``voice_id``, it overrides ``params.voice_name``; when it carries
    ``voice_audio_url``, the sample is used as custom audio
    (skips TTS). Without a persona, passes through the payload default.
    """
    persona = getattr(params, "persona", None)
    if persona is None:
        return params.voice_name, None

    if persona.voice_audio_url:
        return params.voice_name, persona.voice_audio_url

    if persona.voice_id:
        return HOUSE_VOICE_NAMES.get(persona.voice_id, persona.voice_id), None

    return params.voice_name, None


def generate_audio(task_id, params, video_script):
    '''
    Generate audio for the video script.
    If a custom audio file is provided, it will be used directly.
    There will be no subtitle maker object returned in this case.
    Otherwise, TTS will be used to generate the audio.
    Returns:
        - audio_file: path to the generated or provided audio file
        - audio_duration: duration of the audio in seconds
        - sub_maker: subtitle maker object if TTS is used, None otherwise
    '''
    logger.info("\n\n## generating audio")
    # The /audio and /subtitle request models don't include custom_audio_file;
    # read it defensively here so direct calls don't raise AttributeError.
    requested_custom_audio_file = getattr(params, "custom_audio_file", None)
    try:
        custom_audio_file = resolve_custom_audio_file(
            task_id, requested_custom_audio_file
        )
    except ValueError as exc:
        reason = safe_reason(exc)
        logger.error(
            "custom audio file is invalid, "
            f"task_id: {task_id}, path: {requested_custom_audio_file}, error: {reason}"
        )
        _fail_task(task_id, f"custom audio file is invalid: {reason}", params, stage="custom_audio")
        return None, None, None

    # Persona inline: the house voice overrides voice_name; the user's voice
    # sample becomes custom audio (ignores TTS).
    persona_voice_name, persona_voice_audio = resolve_persona_audio(params)
    if persona_voice_audio and not custom_audio_file:
        try:
            custom_audio_file = _download_persona_voice(task_id, persona_voice_audio)
        except PersonaVoiceError as exc:
            _fail_task(task_id, f"Custom audio rejected: {safe_reason(exc)}", params, stage="custom_audio", exc=exc)
            return None, None, None

    if not custom_audio_file:
        logger.info("no custom audio file provided, using TTS to generate audio.")
        audio_file = path.join(utils.task_dir(task_id), "audio.mp3")
        # House voice ids (calm/energetic/...) can arrive directly in
        # voice_name — faceless/debug flow, no inline persona. Resolve
        # to the video language's Neural voice before TTS; without this
        # edge-tts rejects with "Invalid voice" and the job fails.
        from app.services.persona import resolve_house_voice_name

        persona_voice_name = resolve_house_voice_name(
            persona_voice_name, getattr(params, "video_language", "")
        )
        sub_maker = voice.tts(
            text=video_script,
            voice_name=voice.parse_voice_name(persona_voice_name),
            voice_rate=params.voice_rate,
            voice_file=audio_file,
        )
        if sub_maker is None:
            _fail_task(task_id, "failed to generate audio: voice/subtitle mismatch", params, stage="audio")
            logger.error(
                """failed to generate audio:
1. check if the language of the voice matches the language of the video script.
2. check if the network is available. If you are in China, it is recommended to use a VPN and enable the global traffic mode.
            """.strip()
            )
            return None, None, None
        audio_duration = math.ceil(voice.get_audio_duration(sub_maker))
        if audio_duration == 0:
            _fail_task(task_id, "failed to get audio duration", params, stage="audio")
            logger.error("failed to get audio duration.")
            return None, None, None
        return audio_file, audio_duration, sub_maker
    else:
        logger.info(f"using custom audio file: {custom_audio_file}")
        audio_duration = voice.get_audio_duration(custom_audio_file)
        if audio_duration == 0:
            _fail_task(task_id, "failed to get audio duration from custom audio file", params, stage="audio")
            logger.error("failed to get audio duration from custom audio file.")
            return None, None, None
        return custom_audio_file, audio_duration, None

def generate_subtitle(task_id, params, video_script, sub_maker, audio_file):
    '''
    Generate subtitle for the video script.
    If subtitle generation is disabled or no subtitle maker is provided, it will return an empty string.
    Otherwise, it will generate the subtitle using the specified provider.
    Returns:
        - subtitle_path: path to the generated subtitle file
    '''
    logger.info("\n\n## generating subtitle")
    if not params.subtitle_enabled:
        return ""

    subtitle_path = path.join(utils.task_dir(task_id), "subtitle.srt")
    subtitle_provider = config.app.get("subtitle_provider", "edge").strip().lower()
    logger.info(f"\n\n## generating subtitle, provider: {subtitle_provider}")

    if sub_maker is None and subtitle_provider != "whisper":
        # Custom audio never goes through TTS, so there is no Edge/Azure TTS
        # sub_maker timeline. Only Whisper can transcribe subtitles directly
        # from the audio file; other subtitle providers keep their existing
        # behavior to avoid producing a wrong empty timeline.
        logger.warning(
            "subtitle maker is missing, skip subtitle generation for provider: "
            f"{subtitle_provider}"
        )
        return ""

    subtitle_fallback = False
    if subtitle_provider == "edge":
        voice.create_subtitle(
            text=video_script, sub_maker=sub_maker, subtitle_file=subtitle_path
        )
        if not os.path.exists(subtitle_path):
            subtitle_fallback = True
            logger.warning("subtitle file not found, fallback to whisper")

    if subtitle_provider == "whisper" or subtitle_fallback:
        subtitle.create(audio_file=audio_file, subtitle_file=subtitle_path)
        logger.info("\n\n## correcting subtitle")
        subtitle.correct(subtitle_file=subtitle_path, video_script=video_script)

    subtitle_lines = subtitle.file_to_subtitles(subtitle_path)
    if not subtitle_lines:
        logger.warning(f"subtitle file is invalid: {subtitle_path}")
        return ""

    return subtitle_path


def get_video_materials(task_id, params, video_terms, audio_duration):
    if params.video_materials:
        logger.info("\n\n## preprocess local materials")
        materials = video.preprocess_video(
            materials=params.video_materials, clip_duration=params.video_clip_duration
        )
        if not materials:
            _fail_task(task_id, "no valid materials found", params, stage="materials")
            logger.error(
                "no valid materials found, please check the materials and try again."
            )
            return None
        return [material_info.url for material_info in materials]
    else:
        source_order = list(REMOTE_VIDEO_SOURCES)
        random.shuffle(source_order)
        logger.info(
            f"\n\n## downloading videos from {' -> '.join(source_order)} (random cascade)"
        )
        # Ordered-match mode only applies when explicitly enabled by the user.
        # Force material downloads to round-robin in keyword order so an early
        # keyword can't download too many clips and squeeze later script
        # themes out of the final timeline.
        downloaded_videos = material.download_videos(
            task_id=task_id,
            search_terms=video_terms,
            video_aspect=params.video_aspect,
            video_concat_mode=(
                VideoConcatMode.sequential
                if params.match_materials_to_script
                else params.video_concat_mode
            ),
            audio_duration=audio_duration,
            max_clip_duration=params.video_clip_duration,
            match_script_order=params.match_materials_to_script,
            source_mix=source_order,
            exclude_faces=persona_lipsync_active(params),
        )
        if not downloaded_videos:
            _fail_task(task_id, "failed to download videos", params, stage="download")
            logger.error(
                "failed to download videos, maybe the network is not available. if you are in China, please use a VPN."
            )
            return None
        return downloaded_videos


def generate_final_videos(
    task_id, params, downloaded_videos, audio_file, subtitle_path, video_script, music_mood
):
    final_video_paths = []
    combined_video_paths = []
    # Single output per task. match_materials_to_script forces sequential
    # concatenation (stable, explainable timeline); otherwise, respects the
    # configured concat mode.
    video_concat_mode = (
        VideoConcatMode.sequential
        if params.match_materials_to_script
        else params.video_concat_mode
    )
    video_transition_mode = params.video_transition_mode
    task = sm.state.get_task(task_id)
    user_id = str(task.get("user_id", "internal")) if task else "internal"
    recent_bgm_files = history_repository.recent(user_id)
    bgm_history_count = len(recent_bgm_files)

    combined_video_path = path.join(utils.task_dir(task_id), "combined-1.mp4")
    logger.info(f"\n\n## combining video => {combined_video_path}")
    video.combine_videos(
        combined_video_path=combined_video_path,
        video_paths=downloaded_videos,
        audio_file=audio_file,
        video_aspect=params.video_aspect,
        video_concat_mode=video_concat_mode,
        video_transition_mode=video_transition_mode,
        max_clip_duration=params.video_clip_duration,
        threads=params.n_threads,
    )

    video_for_render = combined_video_path
    if persona_lipsync_active(params):
        logger.info("generating persona lip-sync intro")
        video_for_render = prepare_persona_lipsync_video(
            task_id=task_id,
            params=params,
            audio_file=audio_file,
            background_video=combined_video_path,
            index=1,
            video_script=video_script,
            subtitle_path=subtitle_path,
        )

    sm.state.update_task(task_id, progress=75, music_mood=music_mood)

    final_video_path = path.join(utils.task_dir(task_id), "final-1.mp4")
    logger.info(f"\n\n## generating video => {final_video_path}")
    video.generate_video(
        video_path=video_for_render,
        audio_path=audio_file,
        subtitle_path=subtitle_path,
        output_file=final_video_path,
        params=params,
        music_mood=music_mood,
        recent_bgm_files=recent_bgm_files,
    )
    if len(recent_bgm_files) > bgm_history_count:
        history_repository.record(user_id, recent_bgm_files[-1])

    sm.state.update_task(task_id, progress=100, music_mood=music_mood)

    final_video_paths.append(final_video_path)
    combined_video_paths.append(combined_video_path)

    return final_video_paths, combined_video_paths


def prepare_persona_lipsync_video(
    task_id: str,
    params: VideoParams,
    audio_file: str,
    background_video: str,
    index: int,
    video_script: str,
    subtitle_path: str,
) -> str:
    """Generate the persona intro through a complete hook paragraph."""
    persona = params.persona
    if persona is None:
        raise infinitetalk.InfiniteTalkError("lip sync requires a persona")
    image_url = persona.avatar_url or persona.photo_url
    if not image_url:
        raise infinitetalk.InfiniteTalkError("lip sync requires a persona image")

    task_dir = utils.task_dir(task_id)
    image_path = path.join(task_dir, "persona-lipsync-image.png")
    if image_url.startswith("data:image/"):
        try:
            encoded = image_url.split(",", 1)[1]
            with open(image_path, "wb") as image_file:
                image_file.write(base64.b64decode(encoded))
        except (IndexError, ValueError) as exc:
            raise infinitetalk.InfiniteTalkError("invalid persona image data URI") from exc
    else:
        # SSRF-safe download: public-address check on every redirect hop,
        # streamed body with a 20 MB cap, and image/* content-type required.
        # Rejections are surfaced as InfiniteTalkError so the lipsync intro
        # is skipped the same way other download failures are.
        try:
            ssrf.download_public_file(
                image_url,
                image_path,
                what="persona image",
                max_bytes=_PERSONA_IMAGE_MAX_BYTES,
                allowed_content_types=("image/",),
                timeout=60,
                tls_verify=config.app.get("tls_verify", True),
            )
        except ssrf.UnsafeUrlError as exc:
            raise infinitetalk.InfiniteTalkError(
                f"persona image download rejected: {exc}"
            ) from exc
        except OSError as exc:
            raise infinitetalk.InfiniteTalkError(
                f"persona image download failed: {exc}"
            ) from exc

    subtitles = subtitle.file_to_subtitles(subtitle_path)
    hook_duration = persona_hook_end_seconds(video_script, subtitles)
    lipsync_path = path.join(task_dir, f"lipsync-intro-{index}.mp4")
    infinitetalk.generate_intro(
        image_path=image_path,
        audio_path=audio_file,
        quality=params.video_quality,
        output_path=lipsync_path,
        duration_seconds=hook_duration,
    )
    output_path = path.join(task_dir, f"combined-lipsync-{index}.mp4")
    return video.replace_video_intro_with_lipsync(
        background_video,
        lipsync_path,
        output_path,
        duration=hook_duration,
    )


def start(task_id, params: VideoParams, stop_at: str = "video"):
    logger.info(f"start task: {task_id}, stop_at: {stop_at}")
    music_mood = "pending"
    # [TIMING] phase wall-clock markers to find the real bottleneck per task.
    _phase_start = time.perf_counter()
    _last_phase = "start"

    def _mark(phase: str) -> None:
        nonlocal _phase_start, _last_phase
        now = time.perf_counter()
        logger.info(
            f"[TIMING] task={task_id} phase={_last_phase}->{phase} "
            f"elapsed={now - _phase_start:.1f}s"
        )
        _phase_start = now
        _last_phase = phase
        # Persist the last completed phase so the progress (SSE) endpoint
        # and failure logs can report which stage the task is in.
        # update_task() overwrites state/progress with its defaults, so
        # re-assert the current values to avoid clobbering them.
        try:
            current = sm.state.get_task(task_id) or {}
            sm.state.update_task(
                task_id,
                state=current.get("state", const.TASK_STATE_PROCESSING),
                progress=current.get("progress", 0),
                stage=phase,
            )
        except Exception:  # noqa: BLE001 — stage tracking must not break the pipeline
            logger.warning(f"could not persist stage for task {task_id}")

    try:
        sm.state.update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=5)

        # 1. Generate script
        video_script = generate_script(task_id, params)
        _mark("script")
        if not video_script or "Error: " in video_script:
            _fail_task(task_id, "failed to generate video script", params, stage="script")
            cleanup_task_intermediates(task_id, ())
            return

        sm.state.update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=10)

        if stop_at == "script":
            _complete_task(task_id, params, script=video_script)
            return {"script": video_script}

        # 2. Generate terms
        video_terms = ""
        if not params.video_materials:
            video_terms = generate_terms(task_id, params, video_script)
            _mark("terms")
            if not video_terms:
                _fail_task(task_id, "failed to generate video terms", params, stage="terms")
                cleanup_task_intermediates(task_id, ())
                return

        save_script_data(task_id, video_script, video_terms, params)

        if stop_at == "terms":
            _complete_task(task_id, params, terms=video_terms)
            return {"script": video_script, "terms": video_terms}

        sm.state.update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=20)

        # 3. Generate audio
        audio_file, audio_duration, sub_maker = generate_audio(
            task_id, params, video_script
        )
        _mark("audio")
        if not audio_file:
            _fail_task(task_id, "failed to generate audio", params, stage="audio")
            cleanup_task_intermediates(task_id, ())
            return

        max_duration = int(config.app.get("max_video_duration_seconds", 40))
        if (
            persona_lipsync_active(params)
            and audio_duration is not None
            and audio_duration > max_duration
        ):
            limited_audio_file = path.join(
                utils.task_dir(task_id), "audio-limited.mp3"
            )
            infinitetalk.trim_audio(
                audio_file,
                limited_audio_file,
                duration_seconds=max_duration,
            )
            audio_file = limited_audio_file
            audio_duration = max_duration

        sm.state.update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=30)

        if stop_at == "audio":
            _complete_task(
                task_id, params, video_url=_first_http_url([audio_file]),
                audio_file=audio_file,
            )
            return {"audio_file": audio_file, "audio_duration": audio_duration}

        # 4. Generate subtitle
        subtitle_path = generate_subtitle(
            task_id, params, video_script, sub_maker, audio_file
        )
        _mark("subtitle")

        if stop_at == "subtitle":
            _complete_task(task_id, params, subtitle_path=subtitle_path)
            return {"subtitle_path": subtitle_path}

        sm.state.update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=40)

        # 5. Get video materials
        downloaded_videos = get_video_materials(
            task_id, params, video_terms, audio_duration
        )
        _mark("materials")
        if not downloaded_videos:
            _fail_task(task_id, "failed to download videos", params, stage="download")
            cleanup_task_intermediates(task_id, ())
            return

        if stop_at == "materials":
            _complete_task(task_id, params, materials=downloaded_videos)
            return {"materials": downloaded_videos}

        sm.state.update_task(task_id, state=const.TASK_STATE_PROCESSING, progress=50)

        available_moods = video.get_available_music_moods()
        logger.info(f"available BGM moods for video: {available_moods}")
        music_mood = llm.generate_music_mood(video_script, available_moods)
        sm.state.update_task(task_id, music_mood=music_mood)
        _mark("music_mood")
        logger.info(f"music mood selected for video: {music_mood}")

        # Only the full video pipeline needs the video concat mode handling;
        # this keeps /subtitle and /audio style requests from touching
        # fields that don't exist.
        if type(params.video_concat_mode) is str:
            params.video_concat_mode = VideoConcatMode(params.video_concat_mode)

        # 6. Generate final videos
        final_video_paths, combined_video_paths = generate_final_videos(
            task_id,
            params,
            downloaded_videos,
            audio_file,
            subtitle_path,
            video_script,
            music_mood,
        )
        _mark("render")

        if not final_video_paths:
            _fail_task(task_id, "failed to generate final videos", params, stage="render")
            cleanup_task_intermediates(task_id, ())
            return

        task_publish.maybe_publish_finished_videos(
            task_id=task_id,
            params=params,
            video_paths=list(final_video_paths),
        )

        logger.success(
            f"task {task_id} finished, generated {len(final_video_paths)} videos."
        )

        # 7. Cross-post to social platforms (if enabled)
        cross_post_results = []
        if upload_post.upload_post_service.is_configured() and upload_post.upload_post_service.auto_upload:
            platforms = upload_post.upload_post_service.platforms
            logger.info(f"\n\n## cross-posting videos to {', '.join(platforms)}")

            youtube_extra = None
            if any(p.startswith("youtube") for p in platforms):
                metadata = llm.generate_social_metadata(
                    video_subject=params.video_subject,
                    video_script=video_script,
                    language=params.video_language or "",
                    platform="youtube_shorts",
                )
                youtube_extra = {
                    "youtube_title": metadata.get("title", params.video_subject),
                    "youtube_description": metadata.get("caption", ""),
                    "tags": metadata.get("hashtags", []),
                    "privacyStatus": upload_post.upload_post_service.youtube_privacy_status,
                    "containsSyntheticMedia": True,
                }

            for video_path in final_video_paths:
                result = upload_post.cross_post_video(
                    video_path=video_path,
                    title=params.video_subject or "Check out this video! #shorts #viral",
                    youtube_extra=youtube_extra,
                )
                cross_post_results.append(result)
                if result.get('success'):
                    logger.info(f"✅ Cross-posted: {video_path}")
                else:
                    logger.warning(f"⚠️ Failed to cross-post: {video_path} - {result.get('error', 'Unknown error')}")

        kwargs = {
            "videos": final_video_paths,
            "combined_videos": combined_video_paths,
            "script": video_script,
            "terms": video_terms,
            "audio_file": audio_file,
            "audio_duration": audio_duration,
            "platform_ids": params.platform_ids,
            "video_quality": params.video_quality.value,
            "subtitle_path": subtitle_path,
            "materials": downloaded_videos,
            "music_mood": music_mood,
            "cross_post_results": cross_post_results if cross_post_results else None,
        }
        _complete_task(
            task_id, params,
            video_url=_first_http_url(final_video_paths),
            **kwargs,
        )
        try:
            cleanup_task_intermediates(task_id, final_video_paths + combined_video_paths)
        except OSError as cleanup_error:
            logger.warning(
                "failed to clean task intermediates for %s: %s",
                task_id,
                cleanup_error,
            )
        return kwargs
    except Exception as exc:
        logger.exception("task %s crashed", task_id)
        _fail_task(task_id, safe_reason(exc), params, stage=_last_phase, exc=exc, music_mood=music_mood)
        try:
            cleanup_task_intermediates(task_id, ())
        except OSError as cleanup_error:
            logger.warning(
                "failed to clean task intermediates for failed task %s: %s",
                task_id,
                cleanup_error,
            )
        return


if __name__ == "__main__":
    task_id = "task_id"
    params = VideoParams(
        video_subject="金钱的作用",
        voice_name="zh-CN-XiaoyiNeural-Female",
        voice_rate=1.0,
    )
    start(task_id, params, stop_at="video")


# Limits for the persona lipsync reference image downloaded by URL.
_PERSONA_IMAGE_MAX_BYTES = 20 * 1024 * 1024  # 20 MB cap for the avatar/photo

# Limits for the persona voice sample downloaded by URL (custom audio_url).
# The 60s max duration is a temporary product limit ("for now").
PERSONA_VOICE_MAX_BYTES = 20 * 1024 * 1024  # 20 MB — fits 1 min of uncompressed audio
PERSONA_VOICE_MAX_SECONDS = 60
_PERSONA_VOICE_MAX_REDIRECTS = 5
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class PersonaVoiceError(ValueError):
    """Friendly reason (user-facing) why the persona voice URL was rejected."""


def _assert_public_url(url: str) -> None:
    """Ensure the URL points to a public address (anti-SSRF).

    Shared helper: blocks non-http(s) schemes, literal private IPs,
    hostnames resolving to private IPs, and hosts that don't resolve
    (closed failure). Raises PersonaVoiceError.
    """
    try:
        ssrf.assert_public_url(url, what="Audio URL")
    except ssrf.UnsafeUrlError as exc:
        raise PersonaVoiceError(str(exc)) from exc


def _probe_persona_voice_duration(audio_path: str) -> float | None:
    """Return the duration in seconds if ffprobe detects at least one audio stream.

    Returns None when the file isn't a valid audio (no audio stream,
    invalid duration, or ffprobe failed).
    """
    import json
    import subprocess

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                audio_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        info = json.loads(result.stdout or "{}")
    except Exception as exc:
        logger.error(
            "ffprobe failed on persona voice audio, "
            f"path: {audio_path}, error: {str(exc)}"
        )
        return None
    streams = info.get("streams") or []
    if not any(s.get("codec_type") == "audio" for s in streams):
        return None
    try:
        duration = float((info.get("format") or {}).get("duration", 0))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(duration) or duration <= 0:
        return None
    return duration


def _download_persona_voice(task_id: str, voice_audio_url: str) -> str:
    """Download the persona voice sample (signed URL) into the task dir.

    Stateless: the file lives only for the video generation.

    Only accepts a real audio file (audio stream detected by ffprobe),
    at most PERSONA_VOICE_MAX_SECONDS seconds and
    PERSONA_VOICE_MAX_BYTES bytes, served from a public address (anti-SSRF).
    Any violation raises PersonaVoiceError and cleans up the partial file.
    """
    import requests as http_client
    from urllib.parse import urljoin

    audio_file = path.join(utils.task_dir(task_id), "persona_voice")

    def _cleanup_partial() -> None:
        try:
            if os.path.exists(audio_file):
                os.remove(audio_file)
        except OSError:
            pass

    def _reject(reason: str) -> PersonaVoiceError:
        logger.error(
            f"rejected persona voice audio: {reason}, task_id: {task_id}"
        )
        _cleanup_partial()
        return PersonaVoiceError(reason)

    try:
        # Redirects followed manually to validate each destination (anti-SSRF).
        current_url = voice_audio_url
        for hop in range(_PERSONA_VOICE_MAX_REDIRECTS + 1):
            _assert_public_url(current_url)
            response = http_client.get(
                current_url, timeout=60, stream=True, allow_redirects=False
            )
            location = response.headers.get("location")
            if response.status_code in _REDIRECT_STATUSES and location:
                response.close()
                if hop == _PERSONA_VOICE_MAX_REDIRECTS:
                    raise _reject("audio URL redirected too many times")
                current_url = urljoin(current_url, location)
                continue
            break
        else:
            raise _reject("audio URL redirected too many times")

        response.raise_for_status()
        content_type = (
            (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        )
        if not content_type.startswith("audio/"):
            raise _reject(
                f"not an audio file (content-type: {content_type or 'unknown'})"
            )
        downloaded = 0
        with open(audio_file, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > PERSONA_VOICE_MAX_BYTES:
                    raise _reject(
                        f"exceeds the {PERSONA_VOICE_MAX_BYTES // 1024 // 1024} MB size limit"
                    )
                f.write(chunk)
    except PersonaVoiceError:
        raise
    except Exception as exc:
        raise _reject(f"could not be downloaded ({exc}") from exc

    duration = _probe_persona_voice_duration(audio_file)
    if duration is None:
        raise _reject("not a valid audio file (no audio stream detected)")
    if duration > PERSONA_VOICE_MAX_SECONDS:
        raise _reject(
            f"is {duration:.0f}s long — the limit is {PERSONA_VOICE_MAX_SECONDS} seconds"
        )
    return audio_file


def download_persona_voice(task_id: str, voice_audio_url: str) -> str | None:
    """Wrap _download_persona_voice returning None on any rejection.

    Kept for compatibility — the friendly error goes to the log; the
    user-visible reason is recorded by the caller (generate_audio).
    """
    try:
        return _download_persona_voice(task_id, voice_audio_url)
    except PersonaVoiceError as exc:
        logger.error(f"rejected persona voice audio, task_id: {task_id}, reason: {exc}")
        return None
    except Exception as exc:
        logger.error(f"failed to download persona voice audio, task_id: {task_id}, error: {exc}")
        return None
