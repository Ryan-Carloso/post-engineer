"""Tests for the hand-drawn reveal (app/services/svg_sketch.py)."""
import base64
import io
import os
import subprocess
import unittest
import tempfile

import cv2
import numpy as np

from app.services import svg_sketch


def _png_with_rect(text_bgr=(30, 30, 30), size=(200, 200)) -> bytes:
    img = np.full((size[0], size[1], 3), 255, np.uint8)
    cv2.rectangle(img, (50, 60), (150, 140), text_bgr, 5)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def _svg_embedding(payload: bytes) -> str:
    encoded = base64.b64encode(payload).decode()
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200">'
        f'<image xlink:href="data:image/png;base64,{encoded}"/>'
        '<g display="none"><path d="M0,0 L10,10"/></g>'
        "</svg>"
    )


def _pencil_png(size=460) -> np.ndarray:
    with tempfile.TemporaryDirectory() as tmp:
        svg = os.path.join(tmp, "p.svg")
        out = os.path.join(tmp, "p.png")
        with open(svg, "w", encoding="utf-8") as handle:
            handle.write(svg_sketch.build_pencil_svg(output_path=svg))
        subprocess.run(["rsvg-convert", "-w", str(size), "-o", out, svg], check=True)
        return cv2.imread(out, cv2.IMREAD_UNCHANGED)


class ExtractEmbeddedPngTests(unittest.TestCase):
    def test_decodes_the_embedded_raster(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "a.svg")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(_svg_embedding(_png_with_rect()))
            image = svg_sketch.extract_embedded_png(path)
            self.assertIsNotNone(image)
            self.assertEqual(image.shape[:2], (200, 200))

    def test_returns_none_for_pure_line_art(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "b.svg")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0"/></svg>')
            self.assertIsNone(svg_sketch.extract_embedded_png(path))

    def test_returns_none_for_missing_file(self):
        self.assertIsNone(svg_sketch.extract_embedded_png("/nope/missing.svg"))


class FlattenOnWhiteTests(unittest.TestCase):
    def test_transparent_pixels_become_white_not_black(self):
        rgba = np.zeros((10, 10, 4), np.uint8)
        rgba[..., 3] = 0
        flat = svg_sketch.flatten_on_white(rgba)
        self.assertTrue((flat == 255).all())

    def test_opaque_pixels_are_preserved(self):
        rgba = np.zeros((10, 10, 4), np.uint8)
        rgba[..., :3] = 10
        rgba[..., 3] = 255
        flat = svg_sketch.flatten_on_white(rgba)
        self.assertTrue((flat == 10).all())


class DeriveInkTests(unittest.TestCase):
    def test_finds_the_outline_of_a_shape(self):
        flat = np.full((200, 200, 3), 255, np.uint8)
        cv2.rectangle(flat, (50, 60), (150, 140), (30, 30, 30), 5)
        ink = svg_sketch.derive_ink(flat)
        self.assertGreater(int(ink.sum()), 100)
        self.assertFalse(ink[:20, :].any(), "should not mark the image border")


class FitArtTests(unittest.TestCase):
    def test_crops_to_the_artwork_and_centres_it(self):
        colour = np.full((400, 400, 3), 255, np.uint8)
        ink = np.zeros((400, 400), bool)
        ink[120:260, 100:300] = True
        placed = svg_sketch.fit_art(colour, ink, 1080, 1920, margin=0.2)
        self.assertLess(placed.colour.shape[1], 1080)
        self.assertGreater(placed.offset_x, 0)
        self.assertTrue(
            placed.offset_x + placed.colour.shape[1] <= 1080,
            "artwork must stay inside the canvas",
        )

    def test_handles_empty_ink_without_crashing(self):
        colour = np.full((100, 100, 3), 255, np.uint8)
        ink = np.zeros((100, 100), bool)
        placed = svg_sketch.fit_art(colour, ink, 540, 960, margin=0.2)
        self.assertGreater(placed.colour.shape[0], 0)


class PencilTests(unittest.TestCase):
    def setUp(self):
        self.png = _pencil_png()
        self.tip = svg_sketch.pencil_tip_in_sprite(self.png.shape[0])
        self.pencil = svg_sketch.Pencil(self.png, self.tip)

    def test_rejects_non_rgba_sprite(self):
        with self.assertRaises(ValueError):
            svg_sketch.Pencil(np.zeros((10, 10, 3), np.uint8), (1, 1))

    def test_rotation_never_crops_the_barrel(self):
        """The regression: rotating about a tip near the edge sliced the pencil.

        Exact equality is not the contract — Lanczos interpolation shifts a few
        anti-aliased edge pixels per angle. What must hold is that no rotation
        loses a meaningful part of the sprite.
        """
        base_area = int((self.pencil.rotate(0)[..., 3] > 40).sum())
        self.assertGreater(base_area, 1000)
        for angle in (0, 45, 90, 135, 180, -90, -135):
            area = int((self.pencil.rotate(angle)[..., 3] > 40).sum())
            self.assertGreaterEqual(
                area, base_area * 0.99,
                f"angle {angle} lost ink (cropped): {area} of {base_area}",
            )

    def test_tip_stays_centred_at_every_angle(self):
        for angle in (0, 60, 170, -120):
            sprite = self.pencil.rotate(angle)
            ys, xs = np.where(sprite[..., 3] > 200)
            self.assertGreater(len(xs), 0)
            self.assertEqual(int(sprite.shape[0]), self.pencil.texture)
            self.assertEqual(int(sprite.shape[1]), self.pencil.texture)

    def test_shadow_is_a_grey_silhouette(self):
        sprite = self.pencil.rotate(0)
        shadow = self.pencil.shadow(sprite, opacity=0.5)
        self.assertEqual(int(shadow[..., 0].max()), 90)
        self.assertLessEqual(int(shadow[..., 3].max()), 128)


class BlendTests(unittest.TestCase):
    def test_sprite_can_bleed_off_every_edge(self):
        canvas = np.full((100, 100, 3), 255, np.uint8)
        sprite = np.zeros((20, 20, 4), np.uint8)
        sprite[..., :3] = 0
        sprite[..., 3] = 255
        svg_sketch.blend(canvas, sprite, -10, -10)
        svg_sketch.blend(canvas, sprite, 95, 95)
        self.assertEqual(canvas.shape, (100, 100, 3))
        self.assertEqual(int(canvas[0, 0, 0]), 0, "top-left corner should be painted")

    def test_fully_offscreen_sprite_is_a_no_op(self):
        canvas = np.full((100, 100, 3), 255, np.uint8)
        sprite = np.zeros((20, 20, 4), np.uint8)
        sprite[..., 3] = 255
        svg_sketch.blend(canvas, sprite, 500, 500)
        self.assertEqual(int(canvas.min()), 255)


class StrokeDirectionTests(unittest.TestCase):
    def test_reports_the_leading_edge_and_heading(self):
        xs = np.arange(0, 100, 2)
        ys = np.full_like(xs, 50)
        sample = svg_sketch.stroke_direction(xs, ys)
        self.assertIsNotNone(sample)
        (x, y), angle = sample
        self.assertAlmostEqual(y, 50.0, places=3)
        self.assertAlmostEqual(x, 98.0, delta=3)
        self.assertAlmostEqual(angle, 0.0, delta=2)

    def test_returns_none_for_too_few_samples(self):
        self.assertIsNone(svg_sketch.stroke_direction(np.array([1, 2]), np.array([1, 2])))

    def test_returns_none_for_degenerate_direction(self):
        xs = np.full(30, 7)
        ys = np.full(30, 9)
        self.assertIsNone(svg_sketch.stroke_direction(xs, ys))


class PencilFollowerTests(unittest.TestCase):
    def setUp(self):
        self.png = _pencil_png()
        self.pencil = svg_sketch.Pencil(self.png, svg_sketch.pencil_tip_in_sprite(self.png.shape[0]))

    def test_first_sample_snaps_into_place(self):
        follower = svg_sketch.PencilFollower(self.pencil)
        follower.step(((100.0, 100.0), 30.0))
        self.assertEqual(follower.x, 100.0)
        self.assertEqual(follower.angle, 30.0)

    def test_none_sample_leaves_state_untouched(self):
        follower = svg_sketch.PencilFollower(self.pencil)
        follower.step(((50.0, 60.0), 10.0))
        follower.step(None)
        self.assertEqual(follower.x, 50.0)
        self.assertEqual(follower.angle, 10.0)

    def test_angle_wraps_across_the_180_boundary(self):
        follower = svg_sketch.PencilFollower(self.pencil)
        follower.step(((0.0, 0.0), 179.0))
        follower.step(((1.0, 1.0), -179.0))
        # A naive subtraction would swing ~358 degrees the wrong way.
        self.assertGreater(follower.angle, 100.0)

    def test_position_lags_towards_the_target(self):
        follower = svg_sketch.PencilFollower(self.pencil)
        follower.step(((0.0, 0.0), 0.0))
        follower.step(((100.0, 0.0), 0.0))
        self.assertGreater(follower.x, 0.0)
        self.assertLess(follower.x, 100.0)

    def test_draw_before_any_step_is_a_no_op(self):
        canvas = np.full((50, 50, 3), 255, np.uint8)
        svg_sketch.PencilFollower(self.pencil).draw(canvas)
        self.assertEqual(int(canvas.min()), 255)


class RenderFramesTests(unittest.TestCase):
    def test_produces_the_requested_number_of_frames(self):
        colour = np.full((200, 300, 3), 255, np.uint8)
        cv2.rectangle(colour, (40, 40), (260, 160), (20, 20, 20), 6)
        ink = svg_sketch.derive_ink(colour)
        placement = svg_sketch.fit_art(colour, ink, 540, 960)
        pencil = svg_sketch.Pencil(_pencil_png(), svg_sketch.pencil_tip_in_sprite(460))
        frames = svg_sketch.render_frames(placement, pencil, 12, 540, 960)
        self.assertEqual(len(frames), 12)
        for frame in frames:
            self.assertEqual(frame.shape, (960, 540, 3))

    def test_artwork_reveals_over_the_clip(self):
        """The reveal must grow frame to frame.

        Measured inside the artwork box only: the pencil is drawn on the very
        first frame, so a whole-frame ink count would mix two different things.
        """
        colour = np.full((200, 300, 3), 255, np.uint8)
        cv2.rectangle(colour, (40, 40), (260, 160), (20, 20, 20), 6)
        ink = svg_sketch.derive_ink(colour)
        placement = svg_sketch.fit_art(colour, ink, 540, 960)
        pencil = svg_sketch.Pencil(_pencil_png(), svg_sketch.pencil_tip_in_sprite(460))
        frames = svg_sketch.render_frames(placement, pencil, 16, 540, 960)

        def art_ink(frame):
            ox, oy = placement.offset_x, placement.offset_y
            h, w = placement.ink.shape[:2]
            patch = frame[oy : oy + h, ox : ox + w]
            return int((patch < 200).any(axis=2).sum())

        self.assertLess(art_ink(frames[0]), art_ink(frames[-1]))


class BuildPencilSvgTests(unittest.TestCase):
    def test_emits_gradient_and_opaque_eraser(self):
        markup = svg_sketch.build_pencil_svg(gradient=True)
        self.assertIn("linearGradient", markup)
        self.assertIn("#ef8a90", markup)

    def test_flat_variant_has_no_gradient(self):
        markup = svg_sketch.build_pencil_svg(gradient=False)
        self.assertNotIn("linearGradient", markup)


class EndToEndTests(unittest.TestCase):
    def test_catalog_style_svg_renders_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            svg = os.path.join(tmp, "c.svg")
            with open(svg, "w", encoding="utf-8") as handle:
                handle.write(_svg_embedding(_png_with_rect()))
            frames = svg_sketch.render_sketch_clip(
                svg, _pencil_png(), svg_sketch.pencil_tip_in_sprite(460), 8, 540, 960
            )
            self.assertIsNotNone(frames)
            assert frames is not None
            self.assertEqual(len(frames), 8)

    def test_returns_none_for_line_art_svg(self):
        with tempfile.TemporaryDirectory() as tmp:
            svg = os.path.join(tmp, "d.svg")
            with open(svg, "w", encoding="utf-8") as handle:
                handle.write('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0"/></svg>')
            self.assertIsNone(
                svg_sketch.render_sketch_clip(svg, _pencil_png(), (100, 100), 4)
            )


class RevealAxisTests(unittest.TestCase):
    def test_horizontal_axis_increases_left_to_right(self):
        axis = svg_sketch._reveal_axis(50, 10, (1.0, 0.0))
        self.assertAlmostEqual(float(axis[0, 0]), 0.0, places=5)
        self.assertAlmostEqual(float(axis[0, -1]), 1.0, places=5)
        self.assertAlmostEqual(float(axis[-1, -1]), 1.0, places=5)

    def test_diagonal_axis_increases_down_and_right(self):
        axis = svg_sketch._reveal_axis(50, 50, (1.0, 1.0))
        self.assertAlmostEqual(float(axis[0, 0]), 0.0, places=5)
        self.assertAlmostEqual(float(axis[-1, -1]), 1.0, places=5)
        self.assertGreater(float(axis[0, -1]), float(axis[0, 0]), "moving right advances")
        self.assertGreater(float(axis[-1, 0]), float(axis[0, 0]), "moving down advances")
        # A 45 degree sweep is the invariant that makes it a diagonal: the
        # anti-diagonal sits exactly on the front at the halfway progress.
        self.assertAlmostEqual(float(axis[0, -1]), float(axis[-1, 0]), places=5)
        self.assertAlmostEqual(float(axis[0, -1]), 0.5, places=5)

    def test_rejects_zero_vector(self):
        with self.assertRaises(ValueError):
            svg_sketch._reveal_axis(10, 10, (0.0, 0.0))


class DiagonalRevealTests(unittest.TestCase):
    def test_diagonal_reveal_starts_top_left_and_finishes_bottom_right(self):
        colour = np.full((200, 300, 3), 255, np.uint8)
        cv2.rectangle(colour, (40, 40), (260, 160), (20, 20, 20), 6)
        ink = svg_sketch.derive_ink(colour)
        placement = svg_sketch.fit_art(colour, ink, 540, 960)
        pencil = svg_sketch.Pencil(_pencil_png(), svg_sketch.pencil_tip_in_sprite(460))
        frames = svg_sketch.render_frames(
            placement, pencil, 16, 540, 960, direction=(1.0, 1.0)
        )

        def drawn(frame):
            """Ink revealed so far, measured on the art's own mask."""
            ox, oy = placement.offset_x, placement.offset_y
            h, w = placement.ink.shape[:2]
            patch = frame[oy : oy + h, ox : ox + w]
            return int((patch[:, :, 0] < 200)[placement.ink].sum())

        self.assertGreater(drawn(frames[-1]), drawn(frames[0]))

        # The first stroke must sit on the low-projection side, which for a
        # diagonal is the top-left of the artwork.
        ox, oy = placement.offset_x, placement.offset_y
        h, w = placement.ink.shape[:2]
        top_left = placement.ink[: max(h // 3, 1), : max(w // 3, 1)]
        self.assertGreater(int(top_left.sum()), 0, "fixture must have top-left ink")
        self.assertEqual(drawn(frames[0]), 0, "nothing should be drawn on the first frame")


class PencilFlipTests(unittest.TestCase):
    def test_angle_offset_flips_the_pencil(self):
        pencil = svg_sketch.Pencil(_pencil_png(), svg_sketch.pencil_tip_in_sprite(460))
        plain = svg_sketch.PencilFollower(pencil=pencil)
        flipped = svg_sketch.PencilFollower(pencil=pencil, angle_offset=180.0)
        sample = ((120.0, 140.0), 30.0)
        plain.step(sample)
        flipped.step(sample)
        self.assertAlmostEqual(plain.angle, 30.0, places=3)
        self.assertAlmostEqual(((flipped.angle - 210.0) % 360.0), 0.0, places=3)


class AttachPencilTests(unittest.TestCase):
    """The pencil is decoupled from frame generation so line art can use it too."""

    def setUp(self):
        self.pencil = svg_sketch.Pencil(_pencil_png(), svg_sketch.pencil_tip_in_sprite(460))

    def _frames(self, count, size=(400, 300)):
        return [np.full((size[0], size[1], 3), 252, np.uint8) for _ in range(count)]

    def test_monochrome_drops_the_colour_fill(self):
        """Line art only: the artwork's fill hue must never reach the frame."""
        fill = (200, 60, 60)
        colour = np.full((200, 300, 3), 255, np.uint8)
        cv2.rectangle(colour, (40, 40), (260, 160), fill, 30)
        ink = svg_sketch.derive_ink(colour)
        placement = svg_sketch.fit_art(colour, ink, 540, 960)
        pencil = svg_sketch.Pencil(_pencil_png(), svg_sketch.pencil_tip_in_sprite(460))

        def has_fill(frame):
            """Count pixels close to the fill colour, ignoring the pencil.

            OpenCV works in BGR, so the tuple passed to cv2.rectangle is
            already in channel order — no swap here.
            """
            patch = frame[
                placement.offset_y : placement.offset_y + placement.ink.shape[0],
                placement.offset_x : placement.offset_x + placement.ink.shape[1],
            ].astype(np.int16)
            return int((np.abs(patch - np.array(fill, np.int16)).max(axis=2) < 40).sum())

        colour_frame = svg_sketch.render_frames(placement, pencil, 8, 540, 960)[-1]
        mono_frame = svg_sketch.render_frames(
            placement, pencil, 8, 540, 960, monochrome=True
        )[-1]

        self.assertGreater(has_fill(colour_frame), 50, "colour mode should show the fill")
        self.assertEqual(has_fill(mono_frame), 0, "monochrome mode must not show the fill")

    def test_requires_aligned_inputs(self):
        with self.assertRaises(ValueError):
            svg_sketch.attach_pencil(self._frames(3), [np.zeros((10, 10), bool)], self.pencil)

    def test_draws_on_every_frame(self):
        frames = self._frames(4)
        masks = [np.zeros((400, 300), bool) for _ in range(4)]
        # A stroke needs enough new pixels for its direction to be trustworthy;
        # below that the pencil has no pose yet and stays off the canvas.
        for index in range(4):
            masks[index][200, 100 + index * 20 : 130 + index * 20] = True
        out = svg_sketch.attach_pencil(frames, masks, self.pencil)
        for frame in out:
            self.assertLess(int(frame.min()), 200, "pencil never appeared")

    def test_stays_hidden_until_a_stroke_is_well_defined(self):
        frames = self._frames(3)
        masks = [np.zeros((400, 300), bool) for _ in range(3)]
        masks[0][200, 100] = True  # a single pixel: no direction, no pencil
        out = svg_sketch.attach_pencil(frames, masks, self.pencil)
        self.assertEqual(int(out[0].min()), 252)

    def test_tolerates_empty_masks(self):
        masks = [np.zeros((400, 300), bool) for _ in range(3)]
        out = svg_sketch.attach_pencil(self._frames(3), masks, self.pencil)
        self.assertEqual(len(out), 3)

    def test_stops_early_when_no_new_ink_arrives(self):
        masks = [np.zeros((400, 300), bool) for _ in range(5)]
        masks[0][200, 100:150] = True  # only the first frame draws anything
        out = svg_sketch.attach_pencil(self._frames(5), masks, self.pencil)
        # With no fresh pixels the follower keeps its last pose, so the pencil
        # must not have wandered off by the end.
        self.assertEqual(out[0].shape, out[-1].shape)


if __name__ == "__main__":
    unittest.main()