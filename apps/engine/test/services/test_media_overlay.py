"""media_overlay: the info card painted inside a segment photo's panel.

The card sits at the top of the panel, inset from the panel's edges so the
photo still shows around it, with no border of its own. A card that cannot
be drawn is reported with a stable reason, never drawn half-way and never
silently dropped.
"""

from PIL import Image, ImageFont

from app.services import media_overlay

RED = (200, 30, 30, 255)
PANEL = (0, 0, 1000, 730)
SCALE = 1.0


def _font_for(size: int):
    return ImageFont.load_default(size)


def _layer(size=(1000, 730), color=RED):
    return Image.new("RGBA", size, color)


def _differs(a, b, tolerance=24):
    return any(abs(x - y) > tolerance for x, y in zip(a[:3], b[:3]))


def test_card_is_painted_at_the_top_inside_the_panel_and_leaves_the_rest_untouched():
    layer = _layer()
    reason = media_overlay.paint_card(
        layer, {"title": "Sushi Kinoshita", "subtitle": "Rua das Flores 12, Porto"}, _font_for, SCALE, PANEL
    )
    assert reason is None
    left, top, width, _ = media_overlay.card_geometry(PANEL, SCALE)
    assert _differs(layer.getpixel((left + width // 2, top + 6)), RED), "the card never darkened the photo"
    assert layer.getpixel((500, 700)) == RED
    assert layer.getpixel((500, 5)) == RED, "the strip above the card stays photo"


def test_card_is_inset_so_the_photo_shows_on_every_side_of_it():
    layer = _layer()
    media_overlay.paint_card(layer, {"title": "Sushi Kinoshita"}, _font_for, SCALE, PANEL)
    left, top, width, _ = media_overlay.card_geometry(PANEL, SCALE)
    assert left > 0 and left + width < PANEL[2]
    assert layer.getpixel((left // 2, top + 20)) == RED
    assert layer.getpixel((left + width + left // 2, top + 20)) == RED


def test_card_has_no_outline_of_its_own():
    layer = _layer()
    media_overlay.paint_card(layer, {"title": "Sushi Kinoshita"}, _font_for, SCALE, PANEL)
    left, top, width, _ = media_overlay.card_geometry(PANEL, SCALE)
    # A white outline would show as a bright pixel on the card's top edge.
    edge = layer.getpixel((left + width // 2, top + 3))
    assert max(edge[:3]) < 120, f"the card edge must be the dark card fill, got {edge}"


def test_card_never_grows_past_about_half_of_the_panel_even_with_every_field_set():
    overlay = {"title": "Sushi Kinoshita", "subtitle": "Rua das Flores 12, Porto", "badge": "EUR 35 a head"}
    height = media_overlay.measure_card(overlay, _font_for, SCALE, PANEL)
    assert height is not None
    assert height <= PANEL[3] * media_overlay.MAX_HEIGHT_FRACTION


def test_card_height_follows_its_content():
    title_only = media_overlay.measure_card({"title": "Sushi"}, _font_for, SCALE, PANEL)
    full = media_overlay.measure_card(
        {"title": "Sushi", "subtitle": "Rua das Flores 12, Porto", "badge": "EUR"}, _font_for, SCALE, PANEL
    )
    assert title_only is not None and full is not None
    assert full > title_only


def test_long_title_wraps_to_two_lines_instead_of_overflowing_the_card():
    one = media_overlay.measure_card({"title": "Sushi"}, _font_for, SCALE, PANEL)
    two = media_overlay.measure_card(
        {"title": "Restaurante Casa de Pasto do Largo da Misericordia"}, _font_for, SCALE, PANEL
    )
    assert one is not None and two is not None
    assert two > one


def test_title_that_cannot_fit_in_two_lines_is_refused_not_truncated():
    assert media_overlay.measure_card({"title": "W" * 120}, _font_for, SCALE, PANEL) is None
    layer = _layer()
    before = layer.tobytes()
    reason = media_overlay.paint_card(layer, {"title": "W" * 120}, _font_for, SCALE, PANEL)
    assert reason == media_overlay.REASON_NO_FIT
    assert layer.tobytes() == before, "a refused card must leave the layer untouched"


def test_missing_title_is_refused():
    layer = _layer()
    assert media_overlay.paint_card(layer, {"subtitle": "x"}, _font_for, SCALE, PANEL) == media_overlay.REASON_NO_TITLE
    assert media_overlay.paint_card(layer, {"title": "   "}, _font_for, SCALE, PANEL) == media_overlay.REASON_NO_TITLE


def test_a_font_that_cannot_load_is_reported_as_unavailable():
    def broken(size: int):
        raise OSError("cannot open resource")

    layer = _layer()
    before = layer.tobytes()
    assert media_overlay.paint_card(layer, {"title": "Sushi"}, broken, SCALE, PANEL) == media_overlay.REASON_NO_FONT
    assert layer.tobytes() == before


def test_card_scales_with_the_canvas():
    small = media_overlay.measure_card({"title": "Sushi"}, _font_for, 0.5, (0, 0, 500, 365))
    big = media_overlay.measure_card({"title": "Sushi"}, _font_for, 1.0, PANEL)
    assert small is not None and big is not None
    assert small < big


def test_font_loader_rejects_a_path_that_is_not_a_font(tmp_path):
    bad = tmp_path / "x.ttf"
    bad.write_bytes(b"not a font")
    loader = media_overlay.font_loader(str(bad))
    try:
        loader(40)
    except OSError:
        return
    raise AssertionError("a broken font file must raise, not render with a silent default")
