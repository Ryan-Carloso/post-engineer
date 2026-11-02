"""Unit + source-scan tests for modal_longcat_cost and its backend wiring.

The shared container spend (cold-start weight load + scaledown hold)
belongs to no single clip, so the backend must report a stable container
id, a jobs-served count, and one scaledown price per job. These tests pin
that contract without importing Modal (the backend modules only run in
Modal containers, so the cost module is imported directly by path).
"""

import ast
import importlib.util
import unittest
from pathlib import Path


def _load_cost_module():
    engine_dir = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "modal_longcat_cost", engine_dir / "modal_longcat_cost.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ContainerCostTrackerTests(unittest.TestCase):
    def test_container_id_is_stable_for_one_tracker(self):
        module = _load_cost_module()
        tracker = module.ContainerCostTracker()
        self.assertEqual(tracker.container_id, tracker.container_id)
        self.assertEqual(len(tracker.container_id), 32)

    def test_two_trackers_get_different_ids(self):
        module = _load_cost_module()
        self.assertNotEqual(
            module.ContainerCostTracker().container_id,
            module.ContainerCostTracker().container_id,
        )

    def test_note_job_counts_including_itself(self):
        module = _load_cost_module()
        tracker = module.ContainerCostTracker()
        self.assertEqual(tracker.note_job(), 1)
        self.assertEqual(tracker.note_job(), 2)
        self.assertEqual(tracker.jobs_served, 2)

    def test_note_job_accumulates_handler_costs_for_overhead(self):
        module = _load_cost_module()
        tracker = module.ContainerCostTracker()
        tracker.note_job(0.44)
        self.assertEqual(tracker.handler_costs_total_usd, 0.44)
        tracker.note_job(0.21)
        self.assertEqual(tracker.handler_costs_total_usd, 0.65)

    def test_overhead_is_container_minus_handler_sum_across_jobs(self):
        module = _load_cost_module()
        tracker = module.ContainerCostTracker()
        tracker.note_job(0.44)
        self.assertEqual(tracker.container_overhead_usd(0.50), 0.06)
        tracker.note_job(0.21)
        self.assertEqual(tracker.container_overhead_usd(0.80), 0.15)

    def test_overhead_never_goes_negative_from_rounding(self):
        module = _load_cost_module()
        tracker = module.ContainerCostTracker()
        tracker.note_job(0.63)
        self.assertEqual(tracker.container_overhead_usd(0.62), 0.0)

    def test_invalid_handler_costs_are_not_accumulated(self):
        module = _load_cost_module()
        tracker = module.ContainerCostTracker()
        tracker.note_job(True)
        tracker.note_job(-0.5)
        tracker.note_job(float("inf"))
        self.assertEqual(tracker.handler_costs_total_usd, 0.0)
        self.assertEqual(tracker.jobs_served, 3)

    def test_scaledown_cost_is_sixty_seconds_at_rate(self):
        module = _load_cost_module()
        self.assertEqual(module.SCALEDOWN_WINDOW_S, 60)
        self.assertEqual(module.scaledown_cost_usd(0.001261), 0.0757)
        self.assertEqual(module.scaledown_cost_usd(0.0), 0.0)


class BackendWiringTests(unittest.TestCase):
    def _engine_source(self, name: str) -> str:
        engine_dir = Path(__file__).resolve().parents[2]
        return (engine_dir / name).read_text()

    def test_scaledown_window_matches_production_app(self):
        source = self._engine_source("modal_longcat.py")
        self.assertIn("scaledown_window=60", source)
        module = _load_cost_module()
        self.assertEqual(module.SCALEDOWN_WINDOW_S, 60)

    def test_done_payload_reports_container_identity_and_scaledown(self):
        engine_dir = Path(__file__).resolve().parents[2]
        tree = ast.parse((engine_dir / "modal_longcat.py").read_text())
        keys: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "generate_bytes":
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Dict):
                        for key in sub.keys:
                            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                                keys.add(key.value)
        for expected in (
            "cost_usd",
            "container_cost_usd",
            "container_overhead_usd",
            "container_id",
            "jobs_served_in_container",
            "scaledown_cost_usd",
        ):
            with self.subTest(key=expected):
                self.assertIn(expected, keys)

    def test_slim_api_image_ships_cost_module(self):
        source = self._engine_source("modal_longcat.py")
        self.assertIn('"/root/modal_longcat_cost.py"', source)

    def test_modal_modules_stay_under_file_size_cap(self):
        engine_dir = Path(__file__).resolve().parents[2]
        for name in ("modal_longcat.py", "modal_longcat_cost.py"):
            with self.subTest(module=name):
                lines = (engine_dir / name).read_text().splitlines()
                self.assertLessEqual(len(lines), 500, f"{name} grew past 500 lines")


if __name__ == "__main__":
    unittest.main()
