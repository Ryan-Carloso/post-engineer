"""Place caption cues on the real speech using Whisper's word boundaries.

The script text is known, so its words are aligned to the words Whisper
heard (difflib sequence matching). A cue then starts when its first word is
spoken and ends when its last word ends. Words Whisper wrote differently
(numbers heard as digits, a mis-heard name) are not matched; they take their
time from the nearest matched neighbours, split by character share.
"""

import difflib
import re

# Below this share of matched script words the transcript is not trusted to
# time the cues, and callers fall back to character-share timing.
MIN_MATCHED_SHARE = 0.5
# A cue shorter than this was given no real time (words missing from the
# transcript leave a zero-width window), so the transcript cannot time it.
MIN_CUE_SECONDS = 0.1


def _norm(token: str) -> str:
    return re.sub(r"[^\w]", "", token.casefold())


def _fill_gaps(starts, ends, weights, matched, bounds):
    """Give every unmatched token a slice of the time between its anchors."""
    first_start, last_end = bounds
    count = len(weights)
    index = 0
    while index < count:
        if index in matched:
            index += 1
            continue
        run_end = index
        while run_end < count and run_end not in matched:
            run_end += 1
        window_start = ends[index - 1] if index > 0 else first_start
        window_end = starts[run_end] if run_end < count else last_end
        total = sum(weights[index:run_end])
        cursor = window_start
        for token in range(index, run_end):
            starts[token] = cursor
            cursor += (window_end - window_start) * weights[token] / total
            ends[token] = cursor
        index = run_end


def retime_by_words(script_lines, words):
    """Return `(line, start, end)` per script line, or [] when it cannot be trusted.

    `words` are Whisper's `(word, start, end)` boundaries. Returns [] with no
    words, with a line that has no words of its own, or when fewer than
    MIN_MATCHED_SHARE of the script words are found in the transcript, or when
    any cue would be shorter than MIN_CUE_SECONDS (a transcript that stops
    before the script ends).
    """
    heard = [(_norm(word), start, end) for word, start, end in words if _norm(word)]
    lines = [line.strip() for line in script_lines if line.strip()]
    if not heard or not lines:
        return []

    script_tokens: list[str] = []
    line_spans: list[tuple[int, int]] = []
    for line in lines:
        tokens = [_norm(token) for token in line.split() if _norm(token)]
        if not tokens:
            return []
        line_spans.append((len(script_tokens), len(script_tokens) + len(tokens)))
        script_tokens.extend(tokens)

    matcher = difflib.SequenceMatcher(
        None, script_tokens, [token for token, _, _ in heard], autojunk=False
    )
    starts: list[float] = [0.0] * len(script_tokens)
    ends: list[float] = [0.0] * len(script_tokens)
    matched: set[int] = set()
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            starts[block.a + offset] = heard[block.b + offset][1]
            ends[block.a + offset] = heard[block.b + offset][2]
            matched.add(block.a + offset)
    if len(matched) / len(script_tokens) < MIN_MATCHED_SHARE:
        return []

    _fill_gaps(
        starts, ends, [len(token) for token in script_tokens], matched,
        (heard[0][1], heard[-1][2]),
    )

    timed = []
    previous_end = 0.0
    for line, (first, last) in zip(lines, line_spans):
        start = max(starts[first], previous_end)
        end = ends[last - 1]
        if end - start < MIN_CUE_SECONDS:
            return []
        timed.append((line, start, end))
        previous_end = end
    return timed
