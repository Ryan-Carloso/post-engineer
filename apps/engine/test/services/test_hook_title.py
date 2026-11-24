"""Hook title text rules and their sync with the shared TypeScript limits."""

import re
from pathlib import Path

import pytest

from app.services import hook_title

SHARED = Path(__file__).resolve().parents[4] / "shared" / "script-segments" / "hook-title.ts"


def _shared_number(name: str) -> float:
    match = re.search(rf"export const {name} = ([0-9.]+);", SHARED.read_text(encoding="utf-8"))
    assert match is not None, f"{name} missing from the shared hook-title.ts"
    return float(match.group(1))


def _shared_code(key: str) -> str:
    match = re.search(rf"{key}: '(HOOK_TITLE_[A-Z_]+)'", SHARED.read_text(encoding="utf-8"))
    assert match is not None, f"{key} code missing from the shared hook-title.ts"
    return match.group(1)


def test_limits_match_the_shared_typescript_source():
    assert hook_title.HOOK_TITLE_MAX_WORDS == _shared_number("HOOK_TITLE_MAX_WORDS")
    assert hook_title.HOOK_TITLE_MAX_CHARS == _shared_number("HOOK_TITLE_MAX_CHARS")
    assert hook_title.HOOK_TITLE_SECONDS == _shared_number("HOOK_TITLE_SECONDS")


def test_codes_match_the_shared_typescript_source():
    assert hook_title.CODE_EMPTY == _shared_code("empty")
    assert hook_title.CODE_TOO_MANY_WORDS == _shared_code("tooManyWords")
    assert hook_title.CODE_TOO_LONG == _shared_code("tooLong")
    assert hook_title.CODE_INVALID_CHARS == _shared_code("invalidChars")


def test_a_title_at_exactly_the_limits_passes():
    assert hook_title.check_text("one two three four five six seven") == "one two three four five six seven"
    assert hook_title.check_text("a" * hook_title.HOOK_TITLE_MAX_CHARS) == "a" * hook_title.HOOK_TITLE_MAX_CHARS


def test_one_word_over_the_limit_is_refused():
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text("one two three four five six seven eight")
    assert caught.value.code == hook_title.CODE_TOO_MANY_WORDS
    assert str(caught.value).startswith("HOOK_TITLE_TOO_MANY_WORDS: ")


def test_one_character_over_the_limit_is_refused():
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text("a" * (hook_title.HOOK_TITLE_MAX_CHARS + 1))
    assert caught.value.code == hook_title.CODE_TOO_LONG


@pytest.mark.parametrize("value", ["", "   ", "  "])
def test_an_empty_or_blank_title_is_refused_not_treated_as_absent(value):
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text(value)
    assert caught.value.code == hook_title.CODE_EMPTY


@pytest.mark.parametrize("value", ["two\nlines", "tab\there", "bell\x07", "carriage\rreturn"])
def test_a_newline_or_control_character_is_refused(value):
    with pytest.raises(hook_title.HookTitleError) as caught:
        hook_title.check_text(value)
    assert caught.value.code == hook_title.CODE_INVALID_CHARS


def test_the_title_keeps_punctuation_and_case_and_collapses_spaces():
    assert hook_title.check_text("I entered the sea clothed?") == "I entered the sea clothed?"
    assert hook_title.check_text("  A   B  ") == "A B"


def test_spaces_never_count_against_the_limits():
    assert hook_title.check_text(f"  {'a ' * 7} ") == "a a a a a a a"


# --- drawing -------------------------------------------------------------

from PIL import Image, ImageFont  # noqa: E402

PORTRAIT = (1080, 1920)
LANDSCAPE = (1920, 1080)


def _font_for(size: int):
    return ImageFont.load_default(size)


def _broken_font(size: int):
    raise OSError("cannot open resource")


def _build(tmp_path, text="I entered the sea clothed?", size=PORTRAIT, font_for=_font_for, end=3.0):
    out = str(tmp_path / "title.png")
    layer, reason = hook_title.build_title(text, font_for, size, out, end)
    return layer, reason, out


def _bounds(path):
    with Image.open(path) as image:
        return image.size, image.getchannel("A").getbbox()


def test_title_is_drawn_as_a_transparent_band_below_the_status_bar(tmp_path):
    layer, reason, out = _build(tmp_path)
    assert reason is None and layer is not None
    assert layer.y == round(PORTRAIT[1] * hook_title.TOP_FRACTION)
    assert layer.x == 0 and layer.start == 0.0 and layer.end == 3.0
    (width, band_height), box = _bounds(out)
    assert width == PORTRAIT[0], "a full-width band, so it never needs an x offset"
    assert box is not None, "something was drawn"
    assert layer.floor > layer.y + band_height, "the floor sits below the band, with a gap"


def test_title_stays_clear_of_the_face_zone(tmp_path):
    layer, _, out = _build(tmp_path, text="one two three four five six seven")
    assert layer is not None
    (_, band_height), _ = _bounds(out)
    assert layer.y + band_height <= round(PORTRAIT[1] * hook_title.MAX_BOTTOM_FRACTION)


def test_text_is_centered_inside_the_side_margin(tmp_path):
    layer, _, out = _build(tmp_path)
    assert layer is not None
    _, box = _bounds(out)
    left, _, right, _ = box
    assert left >= hook_title.SIDE_MARGIN and PORTRAIT[0] - right >= hook_title.SIDE_MARGIN
    assert abs(left - (PORTRAIT[0] - right)) <= 12, "balanced margins, give or take glyph bearings"


def test_the_text_reaches_the_renderer_unchanged(tmp_path, monkeypatch):
    seen = []
    real_fit = hook_title.media_overlay.fit

    def spy(text, *args, **kwargs):
        seen.append(text)
        return real_fit(text, *args, **kwargs)

    monkeypatch.setattr(hook_title.media_overlay, "fit", spy)
    _build(tmp_path, text="I entered the sea clothed?")
    assert seen and set(seen) == {"I entered the sea clothed?"}


def test_a_wide_word_steps_down_to_a_smaller_size_instead_of_failing(tmp_path):
    size = (540, 960)
    text = "W" * 13
    scale, stroke = 0.5, 3
    inner = size[0] - 2 * round(hook_title.SIDE_MARGIN * scale) - 2 * stroke
    widths = [_font_for(round(step * scale)).getlength(text) for step in hook_title.TITLE_SIZES]
    assert widths[0] > inner >= widths[-1], "fixture: only the smallest size holds the word"
    chosen = hook_title._choose(text, _font_for, scale, inner, 0, 10_000)
    assert chosen is not None and chosen[0] == round(hook_title.TITLE_SIZES[-1] * scale)
    layer, reason, _ = _build(tmp_path, text=text, size=size)
    assert reason is None and layer is not None


def test_text_that_needs_more_than_two_lines_is_refused_with_the_no_fit_reason(tmp_path):
    layer, reason, out = _build(tmp_path, text="supercalifragilistic expialidocious wonderful marvelous", size=(300, 533))
    assert layer is None
    assert reason == hook_title.REASON_NO_FIT
    assert not (tmp_path / "title.png").exists(), out


def test_text_that_would_pass_the_face_zone_limit_is_refused_with_the_no_fit_reason(tmp_path, monkeypatch):
    fitted = []
    real_fit = hook_title.media_overlay.fit

    def spy(*args, **kwargs):
        result = real_fit(*args, **kwargs)
        fitted.append(result)
        return result

    monkeypatch.setattr(hook_title.media_overlay, "fit", spy)
    layer, reason, _ = _build(tmp_path, text=f"{'W' * 15} {'W' * 15}", size=LANDSCAPE)
    assert any(result is not None for result in fitted), "two lines fit by width, only the height refuses"
    assert (layer, reason) == (None, hook_title.REASON_NO_FIT)


def test_a_short_title_still_fits_a_landscape_frame(tmp_path):
    layer, reason, _ = _build(tmp_path, text="Short title", size=LANDSCAPE)
    assert reason is None and layer is not None


def test_a_missing_font_is_refused_with_the_no_font_reason(tmp_path):
    layer, reason, _ = _build(tmp_path, font_for=None)
    assert (layer, reason) == (None, hook_title.REASON_NO_FONT)


def test_a_font_that_cannot_be_opened_is_refused_with_the_no_font_reason(tmp_path):
    layer, reason, _ = _build(tmp_path, font_for=_broken_font)
    assert (layer, reason) == (None, hook_title.REASON_NO_FONT)


def test_a_band_that_cannot_be_written_is_refused_with_the_render_failed_reason(tmp_path):
    layer, reason = hook_title.build_title("Short", _font_for, PORTRAIT, str(tmp_path / "gone" / "t.png"), 3.0)
    assert (layer, reason) == (None, hook_title.REASON_RENDER_FAILED)


@pytest.mark.parametrize(
    ("first_segment_end", "audio", "expected"),
    [(None, 20.0, 3.0), (1.5, 20.0, 1.5), (8.0, 20.0, 3.0), (None, 2.0, 2.0), (-1.0, 20.0, 0.0)],
)
def test_the_window_is_the_shortest_of_three_seconds_the_first_segment_and_the_audio(
    first_segment_end, audio, expected
):
    assert hook_title.title_end(first_segment_end, audio) == expected
