import math
import os
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from typing import Union
from xml.sax.saxutils import unescape

import requests
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.tools import subtitles

from app.config import config
from app.services.analytics import scrub_secret_values
from app.utils import utils

NO_VOICE_NAME = "no-voice"
# `none` was the no-voice sentinel used on PR #981's branch. Keep it as a
# short-term alias so API users who called that branch directly don't break
# on upgrade; the WebUI and new code use the clearer `no-voice`.
_NO_VOICE_ALIASES = {NO_VOICE_NAME, "none"}

# 100-nanosecond units per second. The subtitle timeline predates every TTS
# provider and `mktimestamp` is integer-based on it.
SUB_TIME_UNITS_PER_SECOND = 10000000


class SubMaker:
    """Subtitle carrier returned by ``tts``.

    This was ``edge_tts.SubMaker``, which the engine used both as an edge-tts
    transport handle and — via its ``subs``/``offset`` attributes — as the
    timeline ``create_subtitle`` aggregates into an SRT. edge_tts is gone; the
    timeline stays because Chatterbox returns one of these.

    ``subs`` holds the spoken fragments and ``offset`` their (start, end)
    positions in 100-nanosecond units, index-aligned. Chatterbox has no
    word-level boundaries, so the fragments are filled by
    ``populate_legacy_submaker_with_full_text``: one fragment per sentence,
    timed proportionally across the audio duration.
    """

    def __init__(self) -> None:
        self.subs: list[str] = []
        self.offset: list[tuple[int, int]] = []


@dataclass
class TtsResult:
    """Outcome of a TTS request.

    `sub_maker` carries the subtitle timeline on success; `error` carries a
    short, sanitized reason on failure (safe for the task error, the logs,
    and the PostHog `video_generation_failed` reason). Exactly one of the
    two is set.
    """

    sub_maker: SubMaker | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        """Whether the request produced audio."""
        return self.sub_maker is not None and self.error is None


def _preprocess_text_for_tts(text: str) -> str:
    """
    Preprocess text before sending it to TTS to avoid punctuation being
    spoken aloud.

    Removes periods that Portuguese voices read as "ponto" ("period"),
    while keeping other pause punctuation (commas, exclamation and
    question marks).

    Args:
        text: Original text with punctuation

    Returns:
        Preprocessed text without problematic periods
    """
    if not text:
        return text

    # Remove periods that are not abbreviations.
    # Protects common abbreviations by keeping their periods.
    processed = text

    # Common abbreviations (Portuguese and English) that must keep the
    # period - format: (regex_pattern, replacement_text)
    abbreviations = [
        # Portuguese titles
        (r'\bsr\.', 'Sr.'), (r'\bSr\.', 'Sr.'),
        (r'\bsra\.', 'Sra.'), (r'\bSra\.', 'Sra.'),
        (r'\bdra\.', 'Dra.'), (r'\bDra\.', 'Dra.'),
        (r'\bdr\.', 'Dr.'), (r'\bDr\.', 'Dr.'),
        (r'\bprof\.', 'Prof.'), (r'\bProf\.', 'Prof.'),
        (r'\beng\.', 'Eng.'), (r'\bEng\.', 'Eng.'),
        # Common abbreviations
        (r'\betc\.', 'etc.'),
        (r'\bvs\.', 'vs.'), (r'\bVs\.', 'vs.'),
        (r'\bex\.', 'ex.'), (r'\bEx\.', 'ex.'),
        (r'\bno\.', 'nº.'), (r'\bNo\.', 'Nº.'),
        (r'\bpág\.', 'pág.'), (r'\bp\.', 'p.'),
        # Emails and URLs
        (r'\b[\w\.-]+@[\w\.-]+\.com\b', None),  # Emails ending in .com
        (r'\b[\w\.-]+@[\w\.-]+\.br\b', None),   # Emails ending in .br
        (r'\b[\w\.-]+@[\w\.-]+\.gov\b', None),  # Emails ending in .gov
    ]

    # First, temporarily protect abbreviations
    protected_abbrs = []
    for i, (pattern, replacement) in enumerate(abbreviations):
        placeholder = f"__ABBREV_{i}__"
        # Find all matches and replace them
        matches = list(re.finditer(pattern, processed, flags=re.IGNORECASE))
        for match in reversed(matches):  # Reverse to keep positions correct
            # Use the original match text to preserve capitalization
            original_text = match.group(0)
            protected_abbrs.append((placeholder, original_text))
            processed = processed[:match.start()] + placeholder + processed[match.end():]

    # Preserve sentence punctuation. Providers receive the user's text as
    # written; stripping periods changes meaning and breaks subtitle alignment.
    processed = re.sub(r'\s+', ' ', processed).strip()

    # Restore abbreviations
    for placeholder, original_text in protected_abbrs:
        processed = processed.replace(placeholder, original_text)

    return processed


def _configure_pydub_ffmpeg(audio_segment_cls):
    configured_ffmpeg = utils.get_ffmpeg_binary()
    if configured_ffmpeg:
        audio_segment_cls.converter = configured_ffmpeg


def mktimestamp(time_unit: float) -> str:
    """Format a 100-nanosecond-unit timestamp as an SRT timestamp.

    The subtitle timeline is integer-based on 100-nanosecond units;
    this formats one such value as HH:MM:SS.mmm.
    """
    hour = math.floor(time_unit / 10**7 / 3600)
    minute = math.floor((time_unit / 10**7 / 60) % 60)
    seconds = (time_unit / 10**7) % 60
    return f"{hour:02d}:{minute:02d}:{seconds:06.3f}"


def get_elevenlabs_voices(api_key: str) -> list[str]:
    if not api_key:
        return []
    try:
        url = "https://api.elevenlabs.io/v2/voices"
        params = {"is_favorite": "true", "page_size": 100}
        headers = {"xi-api-key": api_key}
        response = requests.get(url, params=params, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.warning(
                f"ElevenLabs voices fetch failed with status {response.status_code}: {response.text}"
            )
            return []
        data = response.json()
        voices = data.get("voices", [])
        return [
            f"elevenlabs:{v['voice_id']}:{v['name']}"
            for v in voices
            if v.get("voice_id") and v.get("name") and v.get("status") != "disabled"
        ]
    except Exception as e:
        logger.warning(f"ElevenLabs voices fetch failed: {str(e)}")
        return []


def get_chatterbox_voices() -> list[str]:
    """Return the configured Chatterbox voices.

    Chatterbox is self-hosted, so there is no global voice catalog. Operators
    list the voice names exposed by their server via ``[chatterbox] voices``
    (a TOML array, or a comma-separated string). Each entry is normalised to
    the ``chatterbox:<name>`` format used by the TTS dispatcher.
    """
    voices = config.chatterbox.get("voices", []) or []
    if isinstance(voices, str):
        voices = [v.strip() for v in voices.split(",") if v.strip()]
    result = []
    for v in voices:
        v = str(v).strip()
        if not v:
            continue
        result.append(v if v.startswith("chatterbox:") else f"chatterbox:{v}")
    if not result:
        # keep the dropdown usable even before any voice is configured
        result = ["chatterbox:default-Female"]
    return result


def parse_voice_name(name: str):
    # zh-CN-XiaoyiNeural-Female
    # zh-CN-YunxiNeural-Male
    # zh-CN-XiaoxiaoMultilingualNeural-V2-Female
    name = name.replace("-Female", "").replace("-Male", "").strip()
    return name

def is_elevenlabs_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("elevenlabs:")



def is_chatterbox_voice(voice_name: str) -> bool:
    return (voice_name or "").startswith("chatterbox:")


def is_no_voice(voice_name: str | None) -> bool:
    """Whether the user explicitly picked the no-voice mode.

    An empty string is deliberately NOT no-voice: an empty voice more likely
    means a broken config, a stale WebUI state, or a missing API parameter.
    Only an explicit sentinel enters the silent branch, so a real error is
    never disguised as a successful generation.
    """
    return str(voice_name or "").strip().lower() in _NO_VOICE_ALIASES


def estimate_no_voice_duration(text: str) -> float:
    """Estimate a stable video-timeline length for no-voice mode.

    No-voice mode still needs an audio placeholder to drive clip trimming,
    the subtitle timeline, and the final mux. Estimation stays simple:
    1. CJK characters at ~4.2 chars/second;
    2. English/digits at ~2.7 words/second;
    3. other languages at ~4.0 chars/second as a fallback, covering
       Russian, Arabic, Japanese kana, Korean, and other non-ASCII text;
    4. a small pause per sentence so subtitle switches are not too tight;
    5. at least 3 seconds, so a very short script never yields 0-second audio.
    """
    normalized_text = (text or "").strip()
    if not normalized_text:
        return 3.0

    cjk_chars = len(re.findall(r"[\u4e00-\u9fff]", normalized_text))
    words = len(re.findall(r"[A-Za-z0-9]+", normalized_text))
    ascii_word_chars = sum(len(word) for word in re.findall(r"[A-Za-z0-9]+", normalized_text))
    other_text_chars = 0
    for char in normalized_text:
        # A Unicode category starting with L means a letter in some language,
        # N means a digit. CJK and ASCII words were already counted above,
        # so only the remaining text is counted here to avoid double-counting
        # English.
        category = unicodedata.category(char)
        if category.startswith(("L", "N")):
            other_text_chars += 1
    other_text_chars = max(other_text_chars - cjk_chars - ascii_word_chars, 0)
    sentence_count = max(len(utils.split_string_by_punctuations(normalized_text)), 1)

    cjk_duration = cjk_chars / 4.2
    word_duration = words / 2.7
    other_text_duration = other_text_chars / 4.0
    pause_duration = max(sentence_count - 1, 0) * 0.35
    return max(3.0, cjk_duration + word_duration + other_text_duration + pause_duration)


def generate_silent_audio(duration_seconds: float, output_file: str) -> bool:
    """Generate an MP3 silent audio file as the no-voice timeline placeholder.

    FFmpeg's anullsrc generates silence directly, with fewer intermediate
    files than building a temp WAV and transcoding it. On failure return
    False so the caller handles it like an ordinary TTS failure and logs it.
    """
    ensure_file_path_exists(output_file)
    duration_seconds = max(float(duration_seconds or 0), 0.1)
    ffmpeg_binary = utils.get_ffmpeg_binary()
    command = [
        ffmpeg_binary,
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono",
        "-t",
        f"{duration_seconds:.3f}",
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "4",
        output_file,
    ]

    logger.info(
        f"generating silent audio for no-voice mode, duration: {duration_seconds:.2f}s"
    )
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        logger.error(
            "failed to generate silent audio: "
            f"{(result.stderr or result.stdout or '').strip()}"
        )
        return False
    if not os.path.exists(output_file) or os.path.getsize(output_file) <= 0:
        logger.error(
            "silent audio output file is missing or empty, "
            f"file: {output_file}, duration: {duration_seconds:.2f}s"
        )
        return False
    return True


def tts(
    text: str,
    voice_name: str,
    voice_rate: float,
    voice_file: str,
    voice_volume: float = 1.0,
    voice_pitch: str = "",
) -> TtsResult:
    """Synthesize speech and return the outcome with the failure reason.

    Every failure path returns a TtsResult carrying a specific, sanitized
    `error` instead of None — the caller forwards it to the task failure
    so the PostHog `video_generation_failed` event names the real cause
    instead of a generic "voice/subtitle mismatch".
    """
    if is_no_voice(voice_name):
        duration_seconds = estimate_no_voice_duration(text)
        if not generate_silent_audio(duration_seconds, voice_file):
            return TtsResult(error="silent audio generation failed (no-voice mode)")

        sub_maker = SubMaker()
        return TtsResult(
            sub_maker=populate_legacy_submaker_with_full_text(
                sub_maker=sub_maker,
                text=text,
                audio_duration_seconds=duration_seconds,
            )
        )

    if is_elevenlabs_voice(voice_name):
        # Format: elevenlabs:<voice_id>
        parts = voice_name.split(":", 1)
        if len(parts) >= 2 and parts[1].strip():
            return elevenlabs_tts(
                text, parts[1].strip(), voice_file, voice_rate, voice_volume
            )
        logger.error(f"Invalid elevenlabs voice name format: {voice_name}")
        return TtsResult(
            error="invalid ElevenLabs voice name (expected 'elevenlabs:<voice_id>')"
        )
    if is_chatterbox_voice(voice_name):
        # Format: chatterbox:<voice>, optionally with a display-only
        # -Female/-Male suffix.
        parts = voice_name.split(":", 1)
        if len(parts) < 2 or not parts[1].strip():
            logger.error(f"Invalid chatterbox voice name format: {voice_name}")
            return TtsResult(
                error="invalid Chatterbox voice name (expected 'chatterbox:<name>')"
            )
        chatterbox_voice = parts[1].strip()
        if chatterbox_voice.endswith(("-Female", "-Male")):
            chatterbox_voice = chatterbox_voice.rsplit("-", 1)[0]
        return chatterbox_tts(
            text, chatterbox_voice, voice_file, voice_rate, voice_volume
        )

    # Chatterbox and ElevenLabs are the only providers. An unrecognised voice
    # id used to fall through to `azure_tts_v1(...)`, which turned every typo
    # into a silent edge-tts request that failed as if it were a network
    # problem. Fail loud instead: the caller picked a voice that no longer
    # exists.
    logger.error(
        f"unknown voice: {voice_name!r}. Providers are ElevenLabs "
        "(`elevenlabs:<id>`) and Chatterbox (`chatterbox:<name>`); use the "
        f"explicit {NO_VOICE_NAME!r} sentinel for silence."
    )
    return TtsResult(
        error=(
            f"unknown voice {voice_name!r}; providers are ElevenLabs "
            f"('elevenlabs:<id>') and Chatterbox ('chatterbox:<name>'); "
            f"use {NO_VOICE_NAME!r} for silence"
        )
    )


def ensure_file_path_exists(file_path: str) -> None:
    """Make sure the output file's directory exists.

    This is a standalone safety net: the writers below open the target file
    directly, so a missing directory would fail on the local file path and
    mask the real outcome.
    """
    dir_path = os.path.dirname(file_path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)


def populate_legacy_submaker_with_full_text(
    sub_maker: SubMaker, text: str, audio_duration_seconds: float
) -> SubMaker:
    """Fill the `subs/offset` subtitle structure from the full text.

    Chatterbox returns no word-level boundaries, so the subtitle timeline
    has to be estimated: split the script into sentences and distribute
    the duration proportionally by character count. That lets
    `create_subtitle` match script sentences line by line instead of
    falling back to Whisper because the full text never matches.

    Args:
        sub_maker: object to write the subtitle data into
        text: original script text
        audio_duration_seconds: total audio duration, in seconds

    Returns:
        The SubMaker with subtitle data filled in.
    """
    # Clear old values so a caller reusing the object does not stack stale data.
    sub_maker.subs = []
    sub_maker.offset = []

    normalized_text = (text or "").strip()
    if not normalized_text:
        return sub_maker

    audio_duration_100ns = max(int(audio_duration_seconds * 10000000), 1)

    # Paths without word-level boundaries still reuse the project's original
    # "split by punctuation + distribute duration by character count"
    # strategy. That lets create_subtitle() match script sentences and
    # avoids falling back to Whisper again.
    sentences = utils.split_string_by_punctuations(normalized_text)
    if not sentences:
        sentences = [normalized_text]

    total_chars = sum(len(sentence) for sentence in sentences)
    if total_chars <= 0:
        sub_maker.subs.append(normalized_text)
        sub_maker.offset.append((0, audio_duration_100ns))
        return sub_maker

    current_offset = 0
    for index, sentence in enumerate(sentences):
        cleaned_sentence = sentence.strip()
        if not cleaned_sentence:
            continue

        # Earlier sentences get a duration proportional to their character
        # count; the last sentence absorbs the remaining duration so integer
        # rounding never loses total duration or ends subtitles before the audio.
        if index == len(sentences) - 1:
            sentence_end = audio_duration_100ns
        else:
            sentence_chars = len(cleaned_sentence)
            sentence_duration = max(
                int(audio_duration_100ns * (sentence_chars / total_chars)),
                1,
            )
            sentence_end = min(current_offset + sentence_duration, audio_duration_100ns)

        sub_maker.subs.append(cleaned_sentence)
        sub_maker.offset.append((current_offset, sentence_end))
        current_offset = sentence_end

    return sub_maker
def elevenlabs_tts(
    text: str,
    voice_id: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    model_id: str = "",
) -> TtsResult:
    text = (text or "").strip()
    if not text:
        logger.error("ElevenLabs TTS text is empty")
        return TtsResult(error="ElevenLabs TTS failed: text is empty")

    # Preprocess text to avoid TTS reading "ponto" ("period") in Portuguese
    text = _preprocess_text_for_tts(text)
    api_key = config.elevenlabs.get("api_key", "")
    if not api_key:
        logger.error("ElevenLabs API key is not set")
        return TtsResult(error="ElevenLabs TTS failed: API key is not set")

    if not model_id:
        model_id = config.elevenlabs.get("model_id", "eleven_multilingual_v2")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    # Errors where retrying will never help (auth/access/validation failures).
    _NON_RETRYABLE_CODES = {401, 403, 422}
    _NON_RETRYABLE_STATUSES = {"voice_disabled", "voice_access_denied", "unauthorized"}

    last_error: str | None = None
    for i in range(3):
        try:
            logger.info(f"start elevenlabs tts, voice_id: {voice_id}, try: {i + 1}")
            ensure_file_path_exists(voice_file)

            response = requests.post(url, json=payload, headers=headers, timeout=60)
            if response.status_code != 200:
                error_status = ""
                try:
                    detail = response.json().get("detail", {})
                    if isinstance(detail, dict):
                        error_status = detail.get("status", "")
                except Exception:
                    pass

                if response.status_code in _NON_RETRYABLE_CODES or error_status in _NON_RETRYABLE_STATUSES:
                    reason = (
                        f"ElevenLabs TTS request rejected (status {response.status_code}"
                        f"{', ' + error_status if error_status else ''}): "
                        # Scrub before the 200-cut: a cut landing mid-secret
                        # defeats the scrubber and leaks the raw remainder.
                        f"{scrub_secret_values(response.text)[:200]}"
                    )
                    logger.error(
                        f"ElevenLabs TTS failed (non-retryable) — voice_id: {voice_id}, "
                        f"status: {response.status_code}, error: {error_status or response.text[:200]}. "
                        "Please select a different ElevenLabs voice."
                    )
                    return TtsResult(error=reason)

                last_error = f"status {response.status_code}"
                logger.error(
                    f"elevenlabs tts failed with status {response.status_code}: {response.text[:200]}"
                )
                continue

            with open(voice_file, "wb") as f:
                f.write(response.content)

            audio_clip = AudioFileClip(voice_file)
            audio_duration = audio_clip.duration
            audio_clip.close()

            sub_maker = SubMaker()
            logger.success(f"elevenlabs tts succeeded: {voice_file}")
            return TtsResult(
                sub_maker=populate_legacy_submaker_with_full_text(
                    sub_maker=sub_maker,
                    text=text,
                    audio_duration_seconds=audio_duration,
                )
            )
        except Exception as e:
            last_error = scrub_secret_values(str(e))[:200]
            logger.error(f"elevenlabs tts failed: {str(e)}")

    return TtsResult(
        error=f"ElevenLabs TTS failed after 3 attempts ({last_error or 'unknown error'})"
    )




def chatterbox_tts(
    text: str,
    voice: str,
    voice_file: str,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
    model_id: str = "",
) -> TtsResult:
    """Generate speech with a self-hosted Chatterbox TTS server.

    Chatterbox (Resemble AI, MIT) is an open-source, locally hosted TTS model
    with zero-shot voice cloning — a self-hostable alternative to ElevenLabs.
    This talks to an OpenAI-compatible ``/audio/speech`` endpoint, so it works
    with the common community servers (e.g. devnen/Chatterbox-TTS-Server,
    travisvn/chatterbox-tts-api). Configure ``[chatterbox] base_url`` (and an
    optional ``api_key``).

    Like ElevenLabs, Chatterbox does not return word-level timestamps, so the
    subtitle path falls back to the full-text SubMaker. For tighter subtitle
    sync set ``subtitle_provider = "whisper"``.
    """
    text = (text or "").strip()
    if not text:
        logger.error("Chatterbox TTS text is empty")
        return TtsResult(error="Chatterbox TTS failed: text is empty")

    # Preprocess text to avoid TTS reading "ponto" ("period") in Portuguese
    text = _preprocess_text_for_tts(text)
    base_url = (config.chatterbox.get("base_url", "") or "").strip().rstrip("/")
    if not base_url:
        logger.error(
            "Chatterbox base_url is not set, please configure [chatterbox] base_url in config.toml"
        )
        return TtsResult(error="Chatterbox TTS failed: base_url is not set")

    api_key = config.chatterbox.get("api_key", "")
    if not model_id:
        model_id = config.chatterbox.get("model_id", "chatterbox") or "chatterbox"

    url = f"{base_url}/audio/speech"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model_id,
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        # OpenAI speech API accepts speed 0.25-4.0; MoneyPrinterTurbo's rate is a
        # 1.0-centred multiplier, so it maps directly (clamped to the valid range).
        "speed": max(0.25, min(4.0, float(voice_rate or 1.0))),
    }
    # voice_volume is accepted for parity with the other TTS providers but is
    # intentionally not sent: the OpenAI /audio/speech contract has no volume
    # field, so Chatterbox servers ignore it. Adjust loudness via voice_rate
    # (speed) or in post-processing instead.

    last_error: str | None = None
    for i in range(3):
        try:
            logger.info(f"start chatterbox tts, voice: {voice}, try: {i + 1}")
            ensure_file_path_exists(voice_file)

            response = requests.post(url, json=payload, headers=headers, timeout=120)
            if response.status_code != 200:
                last_error = f"status {response.status_code}"
                logger.error(
                    f"chatterbox tts failed with status {response.status_code}: {response.text[:200]}"
                )
                continue

            with open(voice_file, "wb") as f:
                f.write(response.content)

            audio_clip = AudioFileClip(voice_file)
            audio_duration = audio_clip.duration
            audio_clip.close()

            sub_maker = SubMaker()
            logger.success(f"chatterbox tts succeeded: {voice_file}")
            return TtsResult(
                sub_maker=populate_legacy_submaker_with_full_text(
                    sub_maker=sub_maker,
                    text=text,
                    audio_duration_seconds=audio_duration,
                )
            )
        except Exception as e:
            # Scrub before the 200-cut: a cut landing mid-secret defeats the
            # scrubber and leaks the raw remainder.
            last_error = scrub_secret_values(str(e))[:200]
            logger.error(f"chatterbox tts failed: {str(e)}")

    return TtsResult(
        error=f"Chatterbox TTS failed after 3 attempts ({last_error or 'unknown error'})"
    )


def _format_text(text: str) -> str:
    """Clean the script text before subtitle alignment.

    This cannot live only in the LLM generation step: users may also paste
    a script by hand or pass text with Markdown markers straight through
    the API. TTS usually does not speak separator lines like `---`,
    `___`, or `***`, nor emphasis markers like `_`; if subtitle alignment
    kept those characters, `create_subtitle()` would wait forever for a
    cue that never arrives, leaving the subtitle file missing and the
    Whisper-fallback correction filling in an all-zero timeline.
    """
    text = text.replace("[", " ")
    text = text.replace("]", " ")
    text = text.replace("(", " ")
    text = text.replace(")", " ")
    text = text.replace("{", " ")
    text = text.replace("}", " ")
    return utils.normalize_script_for_subtitle_matching(text)


def _split_subtitle_line(text: str, max_words: int = 10) -> list[str]:
    """Split a long subtitle line into smaller readable chunks."""
    words = [word for word in text.split() if word]
    if len(words) <= max_words:
        return [text.strip()] if text.strip() else []

    chunks: list[str] = []
    current: list[str] = []
    for word in words:
        current.append(word)
        if len(current) >= max_words:
            chunks.append(" ".join(current).strip())
            current = []
    if current:
        chunks.append(" ".join(current).strip())
    return chunks


def _split_subtitle_lines(text: str) -> list[str]:
    """Split script text by punctuation and cap each subtitle chunk length."""
    raw_lines = utils.split_string_by_punctuations(text)
    split_lines: list[str] = []
    for line in raw_lines:
        split_lines.extend(_split_subtitle_line(line, max_words=10))
    return split_lines


def _build_subtitle_formatter():
    """Return the shared SRT line formatter.

    Split out as a small helper so every subtitle writer shares one SRT
    line format instead of each drifting into its own subtle variant.
    """

    def formatter(idx: int, start_time: float, end_time: float, sub_text: str) -> str:
        start_t = mktimestamp(start_time).replace(".", ",")
        end_t = mktimestamp(end_time).replace(".", ",")
        return f"{idx}\n{start_t} --> {end_t}\n{sub_text}\n"

    return formatter


# Arabic diacritics and Tatweel elongation marks can appear in TTS-returned
# text. They carry no meaning but break exact matching between script text
# and subtitle cue strings.
_ARABIC_DIACRITICS = re.compile("[\u0610-\u061A\u064B-\u065F\u0670\u0640\u06D6-\u06ED]")


def _normalize_arabic(text: str) -> str:
    """Normalize common Arabic letter variants to tolerate cue mismatches.

    TTS may return an Arabic letter form different from the original script,
    e.g. normalizing أ/إ/آ to ا, or carrying diacritics. This is only used
    as the last-resort matching fallback and never changes the subtitle
    text itself, so the displayed content is unaffected.
    """
    text = _ARABIC_DIACRITICS.sub("", text)
    for src, dst in (
        ("أإآٱ", "ا"),
        ("ىئ", "ي"),
        ("ة", "ه"),
        ("ؤ", "و"),
    ):
        for ch in src:
            text = text.replace(ch, dst)
    return text


def _match_script_line(script_lines: list[str], current_text: str, sub_index: int) -> str:
    """Match the accumulated subtitle text against a script sentence.

    Reuses the project's original "split the script by punctuation, then
    compare segment by segment" approach:
    1. exact match first;
    2. then a match after stripping punctuation and Markdown `_` markers;
    3. finally an Arabic letter-form normalization match.

    That tolerates:
    - punctuation the TTS output may drop or split apart;
    - Chinese word boundaries not lining up exactly with the script text.
    """
    if len(script_lines) <= sub_index:
        return ""

    target_line = script_lines[sub_index]
    if current_text == target_line:
        return target_line.strip()

    current_text_normalized = re.sub(r"[_\W]+", "", current_text)
    target_line_normalized = re.sub(r"[_\W]+", "", target_line)
    if current_text_normalized == target_line_normalized:
        return target_line.strip()

    # Last-resort Arabic tolerance: the letter forms, diacritics, or Tatweel
    # in TTS-returned text may differ from the script. Normalize and compare
    # only after plain matching failed; non-Arabic text is unaffected.
    current_ar = re.sub(r"[_\W]+", "", _normalize_arabic(current_text))
    target_ar = re.sub(r"[_\W]+", "", _normalize_arabic(target_line))
    if current_ar and current_ar == target_ar:
        return target_line.strip()

    return ""


def _write_subtitle_items(sub_items: list[str], subtitle_file: str) -> bool:
    """Write aggregated subtitle segments to an SRT file, with a readability check.

    Returns:
    - `True`: the subtitle file was written and moviepy can parse it;
    - `False`: writing or parsing the subtitle file failed.
    """
    try:
        ensure_file_path_exists(subtitle_file)
        with open(subtitle_file, "w", encoding="utf-8") as file:
            file.write("\n".join(sub_items) + "\n")

        sbs = subtitles.file_to_subtitles(subtitle_file, encoding="utf-8")
        duration = max([tb for ((ta, tb), txt) in sbs]) if sbs else 0
        logger.info(
            f"completed, subtitle file created: {subtitle_file}, duration: {duration}"
        )
        return True
    except Exception as e:
        logger.error(f"failed, error: {str(e)}")
        if os.path.exists(subtitle_file):
            os.remove(subtitle_file)
        return False


def _build_subtitle_items_from_legacy_submaker(
    sub_maker: SubMaker, script_lines: list[str]
) -> list[str]:
    """Aggregate the project's `subs/offset` structure into per-sentence SRT segments.

    This keeps the original core approach, split out as its own function so
    the sentence-matching and writing flow lives in one place.
    """
    formatter = _build_subtitle_formatter()
    start_time = -1.0
    sub_items = []
    sub_index = 0
    sub_line = ""

    legacy_offsets = getattr(sub_maker, "offset", [])
    legacy_subs = getattr(sub_maker, "subs", [])
    for _, (offset, sub) in enumerate(zip(legacy_offsets, legacy_subs)):
        current_start_time, current_end_time = offset
        if start_time < 0:
            start_time = current_start_time

        sub_line += unescape(sub)
        matched_text = _match_script_line(script_lines, sub_line, sub_index)
        if not matched_text:
            continue

        sub_index += 1
        sub_items.append(
            formatter(
                idx=sub_index,
                start_time=start_time,
                end_time=current_end_time,
                sub_text=matched_text,
            )
        )
        start_time = -1.0
        sub_line = ""

    if sub_line.strip():
        logger.warning(
            f"legacy subtitle items still have unmatched text after aggregation: {sub_line}"
        )

    return sub_items


def create_subtitle(sub_maker: SubMaker, text: str, subtitle_file: str):
    """Build the subtitle file.

    1. Split the script into lines by punctuation.
    2. Match each subtitle line against the script text.
    3. Write the new subtitle file.
    """
    text = _format_text(text)
    script_lines = _split_subtitle_lines(text)
    try:
        sub_items = _build_subtitle_items_from_legacy_submaker(
            sub_maker, script_lines
        )

        if len(sub_items) != len(script_lines):
            logger.warning(
                f"failed, sub_items len: {len(sub_items)}, script_lines len: {len(script_lines)}"
            )
            return

        _write_subtitle_items(sub_items, subtitle_file)
    except Exception as e:
        logger.error(f"failed, error: {str(e)}")


def _get_audio_duration_from_submaker(sub_maker: SubMaker):
    """Audio duration carried by the subtitle timeline, in seconds."""
    offsets = sub_maker.offset
    if not offsets:
        return 0.0
    return offsets[-1][1] / SUB_TIME_UNITS_PER_SECOND


def _get_audio_duration_from_file(audio_file: str) -> float:
    """Get the duration of an audio file via moviepy (any ffmpeg-readable format)."""
    if not os.path.exists(audio_file):
        logger.error(f"Audio file does not exist: {audio_file}")
        return 0.0

    try:
        with AudioFileClip(audio_file) as audio:
            return audio.duration  # Duration in seconds
    except Exception as e:
        logger.error(f"Failed to get audio duration from {audio_file}: {str(e)}")
        return 0.0


# Back-compat alias: the reader never was MP3-specific.
_get_audio_duration_from_mp3 = _get_audio_duration_from_file


def get_audio_duration(target: Union[str, SubMaker]) -> float:
    """Get audio duration.

    Accepts a SubMaker or a path to any ffmpeg-readable audio file
    (mp3, wav, m4a, ...). Custom audio uploads are not MP3-only, so the
    extension must not gate the reader.
    """
    if isinstance(target, SubMaker):
        return _get_audio_duration_from_submaker(target)
    elif isinstance(target, str):
        return _get_audio_duration_from_file(target)
    else:
        logger.error(f"Invalid target type: {type(target)}")
        return 0.0

