"""Tests for the SVG draw-on helpers in app/services/svg_draw.py.

The module turns a catalog SVG into a hand-drawn reveal animation by walking
``stroke-dashoffset`` from each shape's measured length down to zero. These
tests pin the geometry (collection, measurement, dash math, progress mapping)
and the frame-rendering contract (fallbacks instead of exceptions).
"""
import math
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest import mock

from app.services import svg_draw

SVG_NS = "http://www.w3.org/2000/svg"


def _element(tag, **attrs):
    element = ET.Element(f"{{{SVG_NS}}}{tag}")
    for key, value in attrs.items():
        element.set(key, value)
    return element


def _root(*children):
    root = ET.Element(f"{{{SVG_NS}}}svg")
    for child in children:
        root.append(child)
    return root


class FlattenCommandsTests(unittest.TestCase):
    """Each SVG path command flattens to the right polyline."""

    def test_lineto_absolute_and_relative(self):
        self.assertEqual(svg_draw._flatten("M 0 0 L 3 4"), [(0.0, 0.0), (3.0, 4.0)])
        self.assertEqual(svg_draw._flatten("M 1 1 l 2 3"), [(1.0, 1.0), (3.0, 4.0)])

    def test_implicit_lineto_pairs(self):
        self.assertEqual(
            svg_draw._flatten("M 0 0 3 4 6 8"),
            [(0.0, 0.0), (3.0, 4.0), (6.0, 8.0)],
        )

    def test_horizontal_and_vertical(self):
        self.assertEqual(svg_draw._flatten("M 0 0 H 5"), [(0.0, 0.0), (5.0, 0.0)])
        self.assertEqual(svg_draw._flatten("M 1 2 h 4"), [(1.0, 2.0), (5.0, 2.0)])
        self.assertEqual(svg_draw._flatten("M 0 0 V 7"), [(0.0, 0.0), (0.0, 7.0)])
        self.assertEqual(svg_draw._flatten("M 1 2 v 3"), [(1.0, 2.0), (1.0, 5.0)])

    def test_cubic_endpoints(self):
        points = svg_draw._flatten("M 0 0 C 0 10 10 10 10 0")
        self.assertEqual(points[0], (0.0, 0.0))
        self.assertEqual(points[-1], (10.0, 0.0))
        # Midpoint of the symmetric cubic sits at (5, 7.5).
        middle = points[len(points) // 2]
        self.assertAlmostEqual(middle[0], 5.0, places=6)
        self.assertAlmostEqual(middle[1], 7.5, places=6)

    def test_cubic_relative(self):
        points = svg_draw._flatten("M 1 1 c 0 0 10 0 10 0")
        self.assertEqual(points[-1], (11.0, 1.0))

    def test_smooth_cubic_reflects_previous_control(self):
        # After C(0,0 5,0 5,0) the S control reflects to (5,0), so the S
        # segment is the flat cubic (5,0)->(5,0)->(10,0)->(10,0) and its
        # midpoint is (7.5, 0).
        points = svg_draw._flatten("M 0 0 C 0 0 5 0 5 0 S 10 0 10 0")
        middle = points[24 + 12]
        self.assertAlmostEqual(middle[0], 7.5, places=6)
        self.assertAlmostEqual(middle[1], 0.0, places=6)

    def test_smooth_cubic_without_previous_control_uses_current_point(self):
        points = svg_draw._flatten("M 0 0 S 10 0 10 0")
        self.assertEqual(points[-1], (10.0, 0.0))

    def test_quadratic_endpoints(self):
        points = svg_draw._flatten("M 0 0 Q 5 5 10 0")
        self.assertEqual(points[0], (0.0, 0.0))
        self.assertEqual(points[-1], (10.0, 0.0))

    def test_quadratic_relative(self):
        points = svg_draw._flatten("M 1 1 q 4 4 9 -1")
        self.assertEqual(points[-1], (10.0, 0.0))

    def test_smooth_quadratic_without_previous_control_uses_current_point(self):
        points = svg_draw._flatten("M 0 0 T 10 10")
        self.assertEqual(points[-1], (10.0, 10.0))

    def test_smooth_quadratic_relative(self):
        points = svg_draw._flatten("M 1 1 t 9 9")
        self.assertEqual(points[-1], (10.0, 10.0))

    def test_smooth_quadratic_reflects_previous_control(self):
        # Q control (0,10) reflected about (10,10) gives (20,10); the T
        # midpoint is (17.5, 10).
        points = svg_draw._flatten("M 0 0 Q 0 10 10 10 T 20 10")
        middle = points[24 + 12]
        self.assertAlmostEqual(middle[0], 17.5, places=6)
        self.assertAlmostEqual(middle[1], 10.0, places=6)

    def test_arc_uses_endpoint_chord(self):
        points = svg_draw._flatten("M 0 0 A 5 5 0 0 1 3 4")
        self.assertEqual(points, [(0.0, 0.0), (3.0, 4.0)])
        self.assertAlmostEqual(svg_draw.path_length("M 0 0 A 5 5 0 0 1 3 4"), 5.0)

    def test_arc_relative(self):
        points = svg_draw._flatten("M 1 1 a 5 5 0 0 1 2 3")
        self.assertEqual(points, [(1.0, 1.0), (3.0, 4.0)])

    def test_degenerate_path_length_is_zero(self):
        self.assertEqual(svg_draw.path_length(""), 0.0)
        self.assertEqual(svg_draw.path_length("M 0 0"), 0.0)


class FlattenMovetoTests(unittest.TestCase):
    def test_multi_pair_moveto_closes_to_first_point(self):
        # Per the SVG spec, coordinate pairs after the first in M/m are
        # implicit linetos; a following Z must close to the initial moveto
        # point, not to the last implicit lineto.
        points = svg_draw._flatten("M 10 20 30 40 Z")
        self.assertEqual(points[0], (10.0, 20.0))
        self.assertEqual(points[1], (30.0, 40.0))
        self.assertEqual(points[-1], (10.0, 20.0))

    def test_second_subpath_gets_its_own_start(self):
        points = svg_draw._flatten("M 0 0 L 5 5 M 10 20 30 40 Z")
        self.assertEqual(points[-1], (10.0, 20.0))

    def test_path_length_counts_the_closing_segment(self):
        # Two legs of the triangle: (10,20)->(30,40)->(10,20).
        length = svg_draw.path_length("M 10 20 30 40 Z")
        self.assertAlmostEqual(length, 2 * math.hypot(20, 20), places=6)


class CollectDrawableTests(unittest.TestCase):
    def test_stroked_shapes_come_back_in_document_order(self):
        root = _root(
            _element("rect", stroke="black", width="10", height="10"),
            _element("circle", stroke="red", r="5"),
            _element("path", stroke="#123456", d="M 0 0 L 1 1"),
        )
        found = svg_draw.collect_drawable(root)
        self.assertEqual(
            [element.tag.rsplit("}", 1)[-1] for element in found],
            ["rect", "circle", "path"],
        )

    def test_fill_only_shapes_are_skipped(self):
        root = _root(
            _element("rect", fill="black", width="10", height="10"),
            _element("circle", stroke="none", r="5"),
            _element("ellipse", stroke="transparent", rx="5", ry="3"),
            _element("line", stroke="", x1="0", y1="0", x2="1", y2="1"),
        )
        self.assertEqual(svg_draw.collect_drawable(root), [])

    def test_non_shape_tags_are_skipped_even_when_stroked(self):
        root = _root(
            _element("text", stroke="black"),
            _element("g", stroke="black"),
        )
        self.assertEqual(svg_draw.collect_drawable(root), [])

    def test_nested_shapes_are_found(self):
        inner = _element("line", stroke="black", x1="0", y1="0", x2="2", y2="2")
        group = _element("g")
        group.append(inner)
        root = _root(group)
        self.assertEqual(svg_draw.collect_drawable(root), [inner])


class IsDrawableTests(unittest.TestCase):
    def test_true_when_at_least_one_stroke_exists(self):
        root = _root(_element("rect", fill="black", width="1", height="1"),
                     _element("path", stroke="black", d="M 0 0 L 1 1"))
        self.assertTrue(svg_draw.is_drawable(root))

    def test_false_for_silhouette_artwork(self):
        root = _root(_element("rect", fill="black", width="10", height="10"))
        self.assertFalse(svg_draw.is_drawable(root))


class ShapeLengthTests(unittest.TestCase):
    def test_line_uses_hypotenuse(self):
        element = _element("line", x1="0", y1="0", x2="3", y2="4")
        self.assertAlmostEqual(svg_draw.shape_length(element), 5.0)

    def test_rect_is_perimeter(self):
        element = _element("rect", width="10", height="20")
        self.assertAlmostEqual(svg_draw.shape_length(element), 60.0)

    def test_circle_from_r(self):
        element = _element("circle", r="10")
        self.assertAlmostEqual(
            svg_draw.shape_length(element), 2 * math.pi * 10, places=6
        )

    def test_ellipse_from_rx_ry(self):
        element = _element("ellipse", rx="10", ry="5")
        length = svg_draw.shape_length(element)
        # Ramanujan's approximation sits between the two circle bounds.
        self.assertGreater(length, 2 * math.pi * 5)
        self.assertLess(length, 2 * math.pi * 10)

    def test_polyline_sums_segments(self):
        element = _element("polyline", points="0,0 3,4 6,4")
        self.assertAlmostEqual(svg_draw.shape_length(element), 8.0)

    def test_degenerate_polyline_is_zero(self):
        element = _element("polyline", points="1,1")
        self.assertEqual(svg_draw.shape_length(element), 0.0)

    def test_path_delegates_to_path_length(self):
        element = _element("path", d="M 0 0 L 3 4")
        self.assertAlmostEqual(svg_draw.shape_length(element), 5.0, places=6)

    def test_unknown_tag_is_zero(self):
        self.assertEqual(svg_draw.shape_length(_element("text")), 0.0)


class TotalDrawLengthTests(unittest.TestCase):
    def _root(self, inner: str):
        return ET.fromstring(
            f'<svg xmlns="{svg_draw.SVG_NS}" viewBox="0 0 200 200">{inner}</svg>'
        )

    def test_sums_every_drawable_shape(self):
        root = self._root(
            '<line x1="0" y1="0" x2="3" y2="4" stroke="#111"/>'
            '<rect x="0" y="0" width="10" height="20" stroke="#111"/>'
        )
        self.assertAlmostEqual(svg_draw.total_draw_length(root), 5.0 + 60.0)

    def test_ignores_shapes_without_a_stroke(self):
        root = self._root(
            '<line x1="0" y1="0" x2="3" y2="4" fill="#111"/>'
            '<rect x="0" y="0" width="10" height="20" stroke="#111"/>'
        )
        self.assertAlmostEqual(svg_draw.total_draw_length(root), 60.0)

    def test_no_drawable_shapes_is_zero(self):
        root = self._root('<rect x="0" y="0" width="10" height="20" fill="#111"/>')
        self.assertEqual(svg_draw.total_draw_length(root), 0.0)


class DashForTests(unittest.TestCase):
    def test_measured_shape_gets_length_times_margin(self):
        element = _element("line", x1="0", y1="0", x2="20", y2="0")
        self.assertAlmostEqual(svg_draw.dash_for(element, 64.0), 20.0 * 1.05)

    def test_degenerate_shape_falls_back_to_stroke_width(self):
        element = _element("line", **{"stroke-width": "2"})
        self.assertAlmostEqual(svg_draw.dash_for(element, 2.0), 8.0)

    def test_degenerate_shape_without_stroke_width_uses_default(self):
        self.assertAlmostEqual(svg_draw.dash_for(_element("line"), 64.0), 64.0)

    def test_invalid_stroke_width_uses_default(self):
        element = _element("line", **{"stroke-width": "abc"})
        self.assertAlmostEqual(svg_draw.dash_for(element, 64.0), 64.0)

    def test_dash_never_below_one(self):
        self.assertAlmostEqual(svg_draw.dash_for(_element("line"), 0.0), 1.0)


class ApplyProgressTests(unittest.TestCase):
    def _two_lines(self):
        return _root(
            _element("line", stroke="black", x1="0", y1="0", x2="20", y2="0"),
            _element("line", stroke="black", x1="0", y1="0", x2="40", y2="0"),
        )

    def test_no_shapes_returns_empty(self):
        root = _root(_element("rect", fill="black", width="1", height="1"))
        self.assertEqual(svg_draw.apply_progress(root, 0.5), [])

    def test_progress_zero_hides_everything(self):
        shapes = svg_draw.apply_progress(self._two_lines(), 0.0, stagger=False)
        for element in shapes:
            dash = float(element.get("stroke-dasharray"))
            self.assertAlmostEqual(float(element.get("stroke-dashoffset")), dash)

    def test_progress_one_draws_everything(self):
        shapes = svg_draw.apply_progress(self._two_lines(), 1.0, stagger=False)
        for element in shapes:
            self.assertAlmostEqual(float(element.get("stroke-dashoffset")), 0.0)

    def test_progress_is_clamped(self):
        over = svg_draw.apply_progress(self._two_lines(), 2.0, stagger=False)
        under = svg_draw.apply_progress(self._two_lines(), -1.0, stagger=False)
        for element in over:
            self.assertAlmostEqual(float(element.get("stroke-dashoffset")), 0.0)
        for element in under:
            dash = float(element.get("stroke-dasharray"))
            self.assertAlmostEqual(float(element.get("stroke-dashoffset")), dash)

    def test_stagger_reveals_shapes_in_document_order(self):
        # At 25% with two staggered shapes, the first is half drawn and the
        # second has not started yet.
        shapes = svg_draw.apply_progress(self._two_lines(), 0.25, stagger=True)
        first_dash = float(shapes[0].get("stroke-dasharray"))
        second_dash = float(shapes[1].get("stroke-dasharray"))
        self.assertAlmostEqual(
            float(shapes[0].get("stroke-dashoffset")), first_dash * 0.5, places=3
        )
        self.assertAlmostEqual(
            float(shapes[1].get("stroke-dashoffset")), second_dash, places=3
        )

    def test_no_stagger_advances_shapes_together(self):
        shapes = svg_draw.apply_progress(self._two_lines(), 0.25, stagger=False)
        for element in shapes:
            dash = float(element.get("stroke-dasharray"))
            self.assertAlmostEqual(
                float(element.get("stroke-dashoffset")), dash * 0.75, places=3
            )

    def test_dasharray_is_set_on_every_shape(self):
        shapes = svg_draw.apply_progress(self._two_lines(), 0.5)
        self.assertEqual(len(shapes), 2)
        for element in shapes:
            self.assertGreater(float(element.get("stroke-dasharray")), 0.0)


class RenderProgressFramesTests(unittest.TestCase):
    DRAWABLE_SVG = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        '<path d="M 10 10 L 90 90" stroke="black" stroke-width="2"/>'
        "</svg>"
    )
    SILHOUETTE_SVG = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        '<rect width="100" height="100" fill="black"/>'
        "</svg>"
    )

    def _write_svg(self, directory, content, name="art.svg"):
        path = os.path.join(directory, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return path

    def _fake_run_success(self):
        def fake_run(argv, **kwargs):
            output = argv[argv.index("-o") + 1]
            with open(output, "wb") as handle:
                handle.write(b"png")
            return mock.Mock(returncode=0)

        return fake_run

    def test_unparsable_svg_returns_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            svg_path = self._write_svg(directory, "<svg><unclosed>", "bad.svg")
            self.assertEqual(
                svg_draw.render_progress_frames(svg_path, directory, 3, 100), []
            )

    def test_silhouette_artwork_returns_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            svg_path = self._write_svg(directory, self.SILHOUETTE_SVG)
            self.assertEqual(
                svg_draw.render_progress_frames(svg_path, directory, 3, 100), []
            )

    def test_frames_render_in_order_with_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            svg_path = self._write_svg(directory, self.DRAWABLE_SVG)
            with mock.patch(
                "subprocess.run", side_effect=self._fake_run_success()
            ):
                written = svg_draw.render_progress_frames(
                    svg_path, directory, 3, 100
                )
                # The intermediate frame SVGs are cleaned up; only PNGs remain.
                leftovers = [
                    name
                    for name in os.listdir(directory)
                    if name.endswith(".svg") and name != "art.svg"
                ]
        self.assertEqual(len(written), 3)
        self.assertEqual(
            [os.path.basename(path) for path in written],
            ["draw-0000.png", "draw-0001.png", "draw-0002.png"],
        )
        self.assertEqual(leftovers, [])

    def test_frame_failure_returns_short_list(self):
        calls = []

        def fake_run(argv, **kwargs):
            calls.append(len(calls))
            if calls[-1] == 1:
                raise OSError("rsvg gone")
            output = argv[argv.index("-o") + 1]
            with open(output, "wb") as handle:
                handle.write(b"png")
            return mock.Mock(returncode=0)

        with tempfile.TemporaryDirectory() as directory:
            svg_path = self._write_svg(directory, self.DRAWABLE_SVG)
            with mock.patch("subprocess.run", side_effect=fake_run):
                written = svg_draw.render_progress_frames(
                    svg_path, directory, 4, 100
                )
        self.assertEqual(len(written), 1)

    def test_single_frame_is_fully_drawn(self):
        with tempfile.TemporaryDirectory() as directory:
            svg_path = self._write_svg(directory, self.DRAWABLE_SVG)
            with mock.patch(
                "subprocess.run", side_effect=self._fake_run_success()
            ):
                written = svg_draw.render_progress_frames(
                    svg_path, directory, 1, 100
                )
        self.assertEqual(len(written), 1)

    def test_frame_svg_cleanup_failure_does_not_abort(self):
        with tempfile.TemporaryDirectory() as directory:
            svg_path = self._write_svg(directory, self.DRAWABLE_SVG)
            with mock.patch(
                "subprocess.run", side_effect=self._fake_run_success()
            ), mock.patch("os.remove", side_effect=OSError("locked")):
                written = svg_draw.render_progress_frames(
                    svg_path, directory, 2, 100
                )
        self.assertEqual(len(written), 2)


if __name__ == "__main__":
    unittest.main()
