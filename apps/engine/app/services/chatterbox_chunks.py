"""Chatterbox chunked synthesis (issue #539).

Chatterbox (Resemble AI, retired August 2026) loses its place on long
single-shot scripts: past ~30 s of audio it repeats a fragment, skips a
sentence, and stops early. Production evidence: a single 504-char POST
shipped a video whose narration repeated a fragment, skipped a sentence,
and stopped 14 words early (2 of the last 3 HabitLoom videos defective).

The mitigation, Chatterbox path only: split the script into per-sentence
chunks of at most ``CHATTERBOX_MAX_CHUNK_CHARS`` chars (~8-10 s of audio,
inside the model's stable window), synthesize one chunk per POST in script
order, and concatenate the chunk audios into the single output file. Short
scripts that fit in one chunk take the old single-POST path unchanged.

The prod TTS server is CPU-only (8 CPU / 16 GB RAM, no GPU); Chatterbox
on CPU runs at RTF 3-10, so ~30 s of audio takes ~120 s and the old
hardcoded 120 s timeout sat inside normal latency (13 timeouts since
Nov 7). ``CHATTERBOX_TIMEOUT_SECONDS`` (300 s) is headroom for one chunk
call (~8-10 s of audio = ~30-100 s on CPU), not the expected time.
"""

import os
import re

from loguru import logger
from pydub import AudioSegment

from app.utils import utils

# One Chatterbox POST may wait this long. A chunk is ~8-10 s of audio; at
# CPU RTF 3-10 that is ~30-100 s per call, so 300 s is headroom, not the
# expected time. Worst case per task: 3 attempts x 300 s per chunk.
CHATTERBOX_TIMEOUT_SECONDS = 300

# Chatterbox degrades past ~30 s of audio per call (~40 s hard limit);
# 300 chars is ~8-10 s of speech, well inside the stable window.
CHATTERBOX_MAX_CHUNK_CHARS = 300

# Sentence terminators. Chunks are split after one of these (plus the
# paragraph breaks, which whitespace normalisation turns into spaces).
_SENTENCE_END_RE = re.compile(r"(?<=[.!?…])\s+")

# Clause boundaries used only when a single sentence exceeds the cap:
# the delimiter stays attached to the preceding clause, so rejoining the
# chunks with a single space reproduces the original text.
_CLAUSE_END_RE = re.compile(r"(?<=[,;:—–-])\s+")

# Words whose trailing period is not a sentence end ("Dr. Smith ...").
# A piece ending in one of these is merged with the following piece.
_ABBREVIATIONS = {
    "dr",
    "mr",
    "mrs",
    "ms",
    "sr",
    "sra",
    "dra",
    "prof",
    "eng",
    "etc",
    "vs",
    "ex",
    "e.g",
    "i.e",
    "st",
    "no",
    "pág",
    "p",
}


def _ends_with_abbreviation(piece: str) -> bool:
    """Whether `piece` ends in an abbreviation period, not a sentence end."""
    last_word = piece.strip().rsplit(" ", 1)[-1].lower()
    return last_word.endswith(".") and last_word[:-1] in _ABBREVIATIONS


def _split_sentences(text: str) -> list[str]:
    """Split normalized text into sentences, keeping each terminator."""
    pieces = [piece for piece in _SENTENCE_END_RE.split(text) if piece]
    sentences: list[str] = []
    for piece in pieces:
        if sentences and _ends_with_abbreviation(sentences[-1]):
            # "Dr." / "etc." is not a sentence end: rejoin with the next piece.
            sentences[-1] = f"{sentences[-1]} {piece}"
        else:
            sentences.append(piece)
    return sentences


def _split_long_piece(piece: str, max_chars: int) -> list[str]:
    """Split one over-long piece at clause boundaries, then word boundaries.

    Each returned piece is at most `max_chars` long. The delimiter stays
    attached to the preceding piece, so joining the pieces with a single
    space reproduces the original text — except for a single word longer
    than the cap, which is hard-cut (no natural boundary exists).
    """
    if len(piece) <= max_chars:
        return [piece]
    clauses = [c for c in _CLAUSE_END_RE.split(piece) if c]
    if len(clauses) > 1:
        return _pack_pieces(
            [sub for clause in clauses for sub in _split_long_piece(clause, max_chars)],
            max_chars,
        )
    words = piece.split(" ")
    sub_pieces: list[str] = []
    for word in words:
        while len(word) > max_chars:
            sub_pieces.append(word[:max_chars])
            word = word[max_chars:]
        sub_pieces.append(word)
    return _pack_pieces([w for w in sub_pieces if w], max_chars)


def _pack_pieces(pieces: list[str], max_chars: int) -> list[str]:
    """Greedily pack pieces into chunks of at most `max_chars`, in order."""
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if not current:
            current = piece
        elif len(current) + 1 + len(piece) <= max_chars:
            current = f"{current} {piece}"
        else:
            chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks


def split_chatterbox_script(text: str, max_chars: int = CHATTERBOX_MAX_CHUNK_CHARS) -> list[str]:
    """Split a script into per-sentence chunks for Chatterbox, in order.

    Sentences are packed greedily up to `max_chars` per chunk; a single
    sentence over the cap splits at clause boundaries, never mid-word and
    never reordered. Short scripts come back as one chunk, unchanged.
    Joining the chunks with a single space reproduces the input text.
    """
    normalized = " ".join((text or "").split())
    if not normalized:
        return []
    if len(normalized) <= max_chars:
        return [normalized]
    pieces: list[str] = []
    for sentence in _split_sentences(normalized):
        pieces.extend(_split_long_piece(sentence, max_chars))
    return _pack_pieces(pieces, max_chars)


def ensure_file_path_exists(file_path: str) -> None:
    """Make sure the output file's directory exists.

    This is a standalone safety net: the writers below open the target file
    directly, so a missing directory would fail on the local file path and
    mask the real outcome.
    """
    dir_path = os.path.dirname(file_path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)


def concatenate_audio_files(part_files: list[str], output_file: str) -> None:
    """Concatenate chunk MP3s into one file, in the order given.

    pydub decodes each part and re-encodes once, so the output is a single
    valid MP3 (unlike byte concatenation, which would embed each chunk's
    headers mid-stream).
    """
    if not part_files:
        raise ValueError("cannot concatenate audio: no audio parts given")
    ffmpeg_binary = utils.get_ffmpeg_binary()
    if ffmpeg_binary:
        AudioSegment.converter = ffmpeg_binary
    combined = AudioSegment.empty()
    for part_file in part_files:
        combined += AudioSegment.from_file(part_file, format="mp3")
    directory = os.path.dirname(output_file)
    if directory:
        os.makedirs(directory, exist_ok=True)
    combined.export(output_file, format="mp3")
    logger.info(f"concatenated {len(part_files)} chatterbox audio chunks: {output_file}")
