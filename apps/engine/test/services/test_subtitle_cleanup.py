"""Deterministic subtitle cleanup: only "?" survives as punctuation.

The agent's script is the narration, not the caption: commas, periods and
dashes read fine aloud but clutter the on-screen text, and the user wants
captions with no terminal punctuation except "?". This is a script, not a
prompt rule and not an LLM call — it runs in under a second on every
subtitle file the engine builds, so a script that ignores the prompt
still ships clean captions.
"""

from app.services import subtitle_cleanup

_DIRTY_SRT = (
    "1\n00:00:00,000 --> 00:00:01,000\nHello, world - wait?\n\n"
    "2\n00:00:01,000 --> 00:00:02,000\nEspera...\n\n"
    "3\n00:00:02,000 --> 00:00:03,000\n...\n\n"
)


def test_user_examples():
    assert subtitle_cleanup.clean_subtitle_text("Olá, mundo.") == "Olá mundo"
    assert (
        subtitle_cleanup.clean_subtitle_text("O dia - que mudou tudo?") == "O dia que mudou tudo?"
    )
    assert subtitle_cleanup.clean_subtitle_text("Espera...") == "Espera"


def test_question_mark_survives_and_fullwidth_normalizes():
    assert subtitle_cleanup.clean_subtitle_text("Really?") == "Really?"
    assert subtitle_cleanup.clean_subtitle_text("本当？") == "本当?"


def test_apostrophes_inside_words_survive():
    assert subtitle_cleanup.clean_subtitle_text("don't stop.") == "don't stop"
    assert subtitle_cleanup.clean_subtitle_text("it's Tuesday?") == "it's Tuesday?"


def test_dashes_become_word_breaks():
    assert (
        subtitle_cleanup.clean_subtitle_text("Same jeans — same mirror") == "Same jeans same mirror"
    )
    assert subtitle_cleanup.clean_subtitle_text("well-known") == "well known"


def test_cjk_and_fullwidth_punctuation_goes():
    assert subtitle_cleanup.clean_subtitle_text("你好，世界。") == "你好世界"
    assert subtitle_cleanup.clean_subtitle_text("等等！") == "等等"


def test_empty_and_whitespace_only_clean_to_empty():
    assert subtitle_cleanup.clean_subtitle_text("") == ""
    assert subtitle_cleanup.clean_subtitle_text("   ") == ""


def test_clean_subtitle_file_rewrites_cues_and_keeps_timings(tmp_path):
    srt_path = tmp_path / "subtitle.srt"
    srt_path.write_text(_DIRTY_SRT, encoding="utf-8")
    assert subtitle_cleanup.clean_subtitle_file(str(srt_path)) is True
    cues = subtitle_cleanup.subtitle.file_to_subtitles(str(srt_path))
    assert [(index, timing, text) for index, timing, text in cues] == [
        (1, "00:00:00,000 --> 00:00:01,000", "Hello world wait?"),
        (2, "00:00:01,000 --> 00:00:02,000", "Espera"),
    ]


def test_clean_subtitle_file_drops_cues_that_clean_to_nothing(tmp_path):
    srt_path = tmp_path / "subtitle.srt"
    srt_path.write_text(_DIRTY_SRT, encoding="utf-8")
    assert subtitle_cleanup.clean_subtitle_file(str(srt_path)) is True
    # The "..." cue is gone and the remaining cues keep their timings.
    assert "Espera" in srt_path.read_text(encoding="utf-8")
    assert "..." not in srt_path.read_text(encoding="utf-8")


def test_clean_subtitle_file_returns_false_without_a_valid_srt(tmp_path):
    assert subtitle_cleanup.clean_subtitle_file(str(tmp_path / "missing.srt")) is False
    empty = tmp_path / "empty.srt"
    empty.write_text("", encoding="utf-8")
    assert subtitle_cleanup.clean_subtitle_file(str(empty)) is False
