"""Source-scan tests for the deployed LongCat Modal app.

The Modal modules only run inside Modal containers, so nothing in the normal
test suite would notice them drifting. These tests pin the contracts that the
cost reporting and the image wiring rely on.
"""

import ast
import textwrap
import unittest
from pathlib import Path


class TestGpuCostAccounting(unittest.TestCase):
    """cost_usd must be the marginal cost of THIS clip, not container uptime.

    The GPU class holds the model for the container's whole life
    (``max_containers=1``, ``scaledown_window=60``), so a cost measured from
    module import accumulates: the second clip in a warm container is billed for
    the first clip's runtime plus the idle hold between them. That number feeds
    PostHog unit economics via ``intro_cost_usd``, so it has to be per-clip.
    """

    def _handler_source(self) -> str:
        engine_dir = Path(__file__).resolve().parents[2]
        tree = ast.parse((engine_dir / "modal_longcat.py").read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.FunctionDef)
                and node.name == "generate_bytes"
            ):
                return ast.get_source_segment(
                    (engine_dir / "modal_longcat.py").read_text(), node
                ) or ""
        self.fail("generate_bytes not found in modal_longcat.py")

    def _names_in_cost_fields(self, source: str) -> tuple[set[str], set[str]]:
        """Names feeding ``cost_usd`` and ``container_cost_usd`` respectively.

        Both are keys of the status payload dict passed to ``_write_job_status``,
        so this reads dict keys (not call keywords) and collects every ``Name``
        in the value expression.
        """
        tree = ast.parse(textwrap.dedent(source))
        found: dict[str, set[str]] = {}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            for key, value in zip(node.keys, node.values):
                if (
                    isinstance(key, ast.Constant)
                    and key.value in ("cost_usd", "container_cost_usd")
                ):
                    found[key.value] = {
                        child.id
                        for child in ast.walk(value)
                        if isinstance(child, ast.Name)
                    }
        return found.get("cost_usd", set()), found.get(
            "container_cost_usd", set()
        )

    def test_cost_usd_is_derived_from_the_per_job_span(self):
        cost_names, _ = self._names_in_cost_fields(self._handler_source())
        self.assertTrue(cost_names, "no cost_usd keyword found in generate_bytes")
        self.assertNotIn(
            "_CONTAINER_START",
            cost_names,
            "cost_usd must not be billed from container start: it accumulates "
            "across every clip the warm container serves",
        )
        self.assertIn(
            "job_gpu_s",
            cost_names,
            "cost_usd must be computed from the per-clip span",
        )

    def test_container_amortised_spend_is_still_reported(self):
        _, container_names = self._names_in_cost_fields(self._handler_source())
        self.assertTrue(
            container_names,
            "container_cost_usd disappeared: the amortised spend (cold start, "
            "idle hold) is no longer observable",
        )
        self.assertIn("uptime_s", container_names)
        self.assertNotIn(
            "job_gpu_s",
            container_names,
            "container_cost_usd must use the container clock, not the per-clip one",
        )

    def test_per_job_and_container_spans_are_distinct_measurements(self):
        source = self._handler_source()
        self.assertIn("handler_started = time.monotonic()", source)
        self.assertIn("time.monotonic() - handler_started", source)
        self.assertIn("time.monotonic() - _CONTAINER_START", source)


class TestImageWiring(unittest.TestCase):
    """The patch must be applied in the image, not merely present on disk."""

    MODAL_MODULES = (
        "modal_longcat.py",
        "modal_longcat_gpu.py",
        "modal_longcat_resident.py",
        "modal_longcat_cost.py",
    )

    def _modal_source(self) -> str:
        engine_dir = Path(__file__).resolve().parents[2]
        return "\n".join(
            (engine_dir / name).read_text() for name in self.MODAL_MODULES
        )

    def test_modal_image_ships_the_resident_renderer(self):
        source = self._modal_source()
        self.assertIn('"/root/modal_longcat_resident.py"', source)

    def test_gpu_image_ships_the_cost_module(self):
        engine_dir = Path(__file__).resolve().parents[2]
        gpu_source = (engine_dir / "modal_longcat_gpu.py").read_text()
        self.assertIn('"/root/modal_longcat_cost.py"', gpu_source)

    def test_scaledown_window_matches_the_production_app(self):
        source = self._modal_source()
        self.assertIn("scaledown_window=60", source)
        self.assertNotIn("scaledown_window=300", source)

    def test_gpu_module_stays_under_the_file_size_cap(self):
        engine_dir = Path(__file__).resolve().parents[2]
        for name in self.MODAL_MODULES:
            with self.subTest(module=name):
                lines = (engine_dir / name).read_text().splitlines()
                self.assertLessEqual(
                    len(lines),
                    500,
                    f"{name} grew past the 500-line cap the split was for",
                )

    def test_modal_entry_module_keeps_every_decorated_function(self):
        engine_dir = Path(__file__).resolve().parents[2]
        gpu_source = (engine_dir / "modal_longcat_gpu.py").read_text()
        for decorator in ("@app.function", "@app.cls", "@modal.fastapi_endpoint"):
            self.assertNotIn(
                decorator,
                gpu_source,
                f"{decorator} in modal_longcat_gpu.py would not be picked up by "
                "`modal deploy modal_longcat.py`",
            )


if __name__ == "__main__":
    unittest.main()