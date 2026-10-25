"""TTS provider implementations for the engine.

ElevenLabs (hosted API) and Chatterbox (self-hosted, OpenAI-compatible)
live here so ``voice.py`` stays the thin dispatch + subtitle layer. The
shared pieces the providers need (``SubMaker``, the text preprocessor,
the file-path guard, the legacy subtitle filler, ``TtsResult``) live here
too; ``voice.py`` re-imports them for the ``tts()`` dispatcher.
"""

import os
import re
from dataclasses import dataclass

import requests
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from app.config import config
from app.services.analytics import scrub_secret_values
from app.utils import utils


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


#---------------
# _scrubbed_response_body — one source for the scrubber applied to an
# upstream response body before it is stored or logged. Many TTS gateways
# echo rejected credentials verbatim (api_key/Authorization values in
# key=value or JSON shape, and "https://user:pass@host" URLs probe the
# People's own base_url). The secret-value rules come from the shared
# scrub_secret_values (analytics); the URL userinfo redactor mirrors the
# one llm.py applies to its own error paths.
#---------------
_URL_USERINFO_RE = re.compile(
    r"((?:https?|wss?)://)([^/\s?#@]*:[^/\s?#@]*@)",
    re.IGNORECASE,
)


def _scrubbed_response_body(text: str) -> str:
    """Upstream body -> credential-free, single-line, bounded evidence."""
    if not isinstance(text, str) or not text:
        return ""
    scrubbed = _URL_USERINFO_RE.sub(r"\1***:***@", text)
    scrubbed = scrub_secret_values(scrubbed)
    return " ".join(scrubbed[:200].split())


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
                # The verdict is ONLY included after the credential scrubber:
                # an upstream body may echo rejected credentials (keys,
                # "user:pass@host" URLs) — saving it raw would leak them into
                # the history row and the logs. Both the log line and the
                # stored error consume the SAME scrubbed text.
                body = _scrubbed_response_body(response.text)
                if body:
                    last_error = f"status {response.status_code}: {body}"
                else:
                    last_error = f"status {response.status_code}"
                logger.error(
                    f"chatterbox tts failed with status {response.status_code}: {body}"
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
