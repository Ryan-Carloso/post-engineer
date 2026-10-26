import json
import os.path
import re
from timeit import default_timer as timer

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None
from loguru import logger

from app.config import config
from app.utils import utils

model_size = config.whisper.get("model_size", "large-v3")
device = config.whisper.get("device", "cpu")
compute_type = config.whisper.get("compute_type", "int8")
model = None


def create(audio_file, subtitle_file: str = ""):
    global model
    if WhisperModel is None:
        logger.warning("faster_whisper not available, skipping whisper subtitle generation")
        return ""
    if not model:
        model_path = f"{utils.root_dir()}/models/whisper-{model_size}"
        model_bin_file = f"{model_path}/model.bin"
        if not os.path.isdir(model_path) or not os.path.isfile(model_bin_file):
            model_path = model_size

        logger.info(
            f"loading model: {model_path}, device: {device}, compute_type: {compute_type}"
        )
        try:
            model = WhisperModel(
                model_size_or_path=model_path, device=device, compute_type=compute_type
            )
        except Exception as e:
            logger.error(
                f"failed to load model: {e} \n\n"
                f"********************************************\n"
                f"this may be caused by network issue. \n"
                f"please download the model manually and put it in the 'models' folder. \n"
                f"see the project README FAQ (https://github.com/Ryan-Carloso/post-engineer) for more details.\n"
                f"********************************************\n\n"
            )
            return None

    logger.info(f"start, output file: {subtitle_file}")
    if not subtitle_file:
        subtitle_file = f"{audio_file}.srt"

    segments, info = model.transcribe(
        audio_file,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    logger.info(
        f"detected language: '{info.language}', probability: {info.language_probability:.2f}"
    )

    start = timer()
    subtitles = []
    # Every word with its own boundaries: the SRT below collapses them into
    # sentence cues, but the persona hook needs where its last word ends.
    spoken_words = []

    def recognized(seg_text, seg_start, seg_end):
        seg_text = seg_text.strip()
        if not seg_text:
            return

        msg = "[%.2fs -> %.2fs] %s" % (seg_start, seg_end, seg_text)
        logger.debug(msg)

        subtitles.append(
            {"msg": seg_text, "start_time": seg_start, "end_time": seg_end}
        )

    for segment in segments:
        words_idx = 0
        words_len = len(segment.words)

        seg_start = 0
        seg_end = 0
        seg_text = ""

        if segment.words:
            is_segmented = False
            for word in segment.words:
                if word.word.strip():
                    spoken_words.append((word.word.strip(), float(word.start), float(word.end)))
                if not is_segmented:
                    seg_start = word.start
                    is_segmented = True

                seg_end = word.end
                # If it contains punctuation, then break the sentence.
                seg_text += word.word

                if utils.str_contains_punctuation(word.word):
                    # remove last char
                    seg_text = seg_text[:-1]
                    if not seg_text:
                        continue

                    recognized(seg_text, seg_start, seg_end)

                    is_segmented = False
                    seg_text = ""

                if words_idx == 0 and segment.start < word.start:
                    seg_start = word.start
                if words_idx == (words_len - 1) and segment.end > word.end:
                    seg_end = word.end
                words_idx += 1

        if not seg_text:
            continue

        recognized(seg_text, seg_start, seg_end)

    end = timer()

    diff = end - start
    logger.info(f"complete, elapsed: {diff:.2f} s")

    idx = 1
    lines = []
    for subtitle in subtitles:
        text = subtitle.get("msg")
        if text:
            lines.append(
                utils.text_to_srt(
                    idx, text, subtitle.get("start_time"), subtitle.get("end_time")
                )
            )
            idx += 1

    sub = "\n".join(lines) + "\n"
    with open(subtitle_file, "w", encoding="utf-8") as f:
        f.write(sub)
    with open(words_path(subtitle_file), "w", encoding="utf-8") as f:
        json.dump(spoken_words, f)
    logger.info(f"subtitle file created: {subtitle_file}")


def words_path(subtitle_file: str) -> str:
    """Where Whisper's word boundaries are kept, next to the subtitle."""
    return f"{subtitle_file}.words.json"


def file_to_words(subtitle_file: str) -> list[tuple[str, float, float]]:
    """Whisper word boundaries saved next to `subtitle_file`, or [].

    Only Whisper writes them; any other provider, a missing file or a
    malformed one reads as no words, and callers fall back to the cues.
    """
    if not subtitle_file or not os.path.isfile(words_path(subtitle_file)):
        return []
    try:
        with open(words_path(subtitle_file), encoding="utf-8") as f:
            raw = json.load(f)
        return [(str(text), float(start), float(end)) for text, start, end in raw]
    except (OSError, ValueError, TypeError) as exc:
        logger.warning(f"unreadable word boundaries next to the subtitle: {type(exc).__name__}")
        return []


def file_to_subtitles(filename):
    if not filename or not os.path.isfile(filename):
        return []

    times_texts = []
    current_times = None
    current_text = ""
    index = 0
    with open(filename, "r", encoding="utf-8") as f:
        for line in f:
            times = re.findall("([0-9]*:[0-9]*:[0-9]*,[0-9]*)", line)
            if times:
                current_times = line
            elif line.strip() == "" and current_times:
                index += 1
                times_texts.append((index, current_times.strip(), current_text.strip()))
                current_times, current_text = None, ""
            elif current_times:
                current_text += line

    # Flush the final block. SRT files whose last subtitle is not followed by a
    # trailing blank line never hit the blank-line branch above, so without this
    # the last subtitle would be silently dropped.
    if current_times:
        index += 1
        times_texts.append((index, current_times.strip(), current_text.strip()))
    return times_texts


_CUE_TIMING_RE = re.compile(
    r"(\d+):(\d+):(\d+)[,\.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)"
)


def _spoken_length(text: str) -> int:
    """Characters that are actually spoken: punctuation and spaces dropped."""
    return len(re.sub(r"[^\w]+", "", text.casefold()))


def _retime_by_character_share(subtitle_items, script_lines):
    """Place each script line on the spoken timeline by its character share.

    Whisper cues can be coarse (one cue holding several script lines) or
    fine (one line split over several cues); either way the spoken timeline
    is the sequence of cues, and a script line's start/end is found by
    walking that timeline to the line's share of the characters, scaled so
    the script and the transcription cover the same span. Every line gets
    its own ordered, non-empty cue — never a 00:00:00 placeholder. Returns
    [] when there is no timed speech to place the lines on.
    """
    cues = []
    for _, timing, text in subtitle_items:
        match = _CUE_TIMING_RE.search(timing)
        length = _spoken_length(text)
        if match is None or length == 0:
            continue
        parts = [int(value) for value in match.groups()]
        start = parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000
        end = parts[4] * 3600 + parts[5] * 60 + parts[6] + parts[7] / 1000
        cues.append((start, max(end, start), length))
    lines = [line.strip() for line in script_lines if line.strip()]
    if not cues or not lines:
        return []
    spoken_total = sum(length for _, _, length in cues)
    line_lengths = [max(_spoken_length(line), 1) for line in lines]
    scale = spoken_total / sum(line_lengths)

    def time_at(position: float) -> float:
        offset = 0
        for start, end, length in cues:
            if position <= offset + length:
                return start + (end - start) * (position - offset) / length
            offset += length
        return cues[-1][1]

    retimed = []
    position = 0.0
    for line, length in zip(lines, line_lengths):
        start = time_at(position)
        position += length * scale
        end = max(time_at(position), start + 0.001)
        timing = (
            f"{utils.time_convert_seconds_to_hmsm(start)} --> "
            f"{utils.time_convert_seconds_to_hmsm(end)}"
        )
        retimed.append((len(retimed) + 1, timing, line))
    return retimed


def correct(subtitle_file, video_script):
    """Make the subtitle text match the script, keeping the speech timing.

    A file whose cues already match the script line for line is left as
    is. Otherwise every script line is retimed by its character share of
    the spoken timeline (see _retime_by_character_share) — the old
    line-to-cue pairing ran out of cues on coarse Whisper output and wrote
    the remaining lines at 00:00:00.
    """
    subtitle_items = file_to_subtitles(subtitle_file)
    normalized_script = utils.normalize_script_for_subtitle_matching(video_script)
    script_lines = [line.strip() for line in utils.split_string_by_punctuations(normalized_script) if line.strip()]

    if [item[2].strip() for item in subtitle_items] == script_lines:
        logger.success("Subtitle is correct")
        return

    retimed = _retime_by_character_share(subtitle_items, script_lines)
    if not retimed:
        logger.warning("subtitle has no timed speech to retime; leaving it as is")
        return
    with open(subtitle_file, "w", encoding="utf-8") as fd:
        for i, item in enumerate(retimed):
            fd.write(f"{i + 1}\n{item[1]}\n{item[2]}\n\n")
    logger.info(f"Subtitle corrected: {len(retimed)} script lines retimed by character share")

