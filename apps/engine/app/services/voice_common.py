"""Shared voice-service helpers.

Leaf module: the text preprocessing, file utilities and subtitle-filling
logic shared by all TTS providers. Imported by both ``app.services.voice``
(the dispatcher) and the per-provider modules (e.g.
``app.services.voice_fishaudio``) so neither side needs to reach across the
other — no import cycles.

``SubMaker`` itself stays defined in ``app.services.voice``: the structural
test ``test_submaker_is_a_local_class_not_the_edge_package`` pins it there
(it must remain our local class, never the edge-tts package's). It is
referenced here only under ``TYPE_CHECKING`` for annotations.
"""

import os
import re
from typing import TYPE_CHECKING

from app.utils import utils

if TYPE_CHECKING:
    from app.services.voice import SubMaker


def preprocess_text_for_tts(text: str) -> str:
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
    sub_maker: "SubMaker", text: str, audio_duration_seconds: float
) -> "SubMaker":
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
