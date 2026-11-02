"""Unit tests for the total (amortized) Modal cost per video.

Formula, exactly as implemented in app.services.intro_cost:

    total_cost_usd = handler_total_usd
        + (container_overhead_usd + scaledown_cost_usd) / videos_per_container

where handler_total is the video's own clip costs (intro today; intro +
outro + full-mode windows when a caller passes handler_costs_usd),
container_overhead_usd is the container's spend EXCLUDING handler costs
to date (cold-start weight load + idle hold; container_cost_usd minus
the handler costs of every job the container served), scaledown_cost is
one scaledown hold, and videos_per_container counts DISTINCT videos
(tasks) in that container — a video rendering several clips in one
container counts once. Using container_cost_usd itself here would count
this video's handler twice, because container_cost_usd already includes
it. The total is labelled "running": the container may serve more
videos later, so it is never final.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.intro_cost import (
    IntroCostReport,
    amortize_video_cost,
    completion_cost_kwargs,
    cost_event_props,
    register_container_video,
    report_from_job_cost,
)
from app.services.longcat_cost import ModalJobCost


class AmortizeVideoCostTests(unittest.TestCase):
    def test_formula_sums_handler_and_divides_shared_spend(self):
        self.assertEqual(
            amortize_video_cost(0.63, 1.87, 0.0757, 2),
            round(0.63 + (1.87 + 0.0757) / 2, 4),
        )

    def test_single_video_bears_the_whole_overhead(self):
        # Overhead = container 2.5 minus handler 0.63 = 1.87, so the total
        # is 0.63 + 1.87 + 0.0757 = 2.5757. The old formula fed the full
        # container spend (2.5) here and reported 3.2057, counting the
        # handler twice because container spend already includes it.
        self.assertEqual(amortize_video_cost(0.63, 1.87, 0.0757, 1), 2.5757)

    def test_measured_complete_dev_video_regression(self):
        # Measured 2026-11-02, 51.36s complete dev video, H100, cold:
        # handler 1.8366, container 2.8245, overhead 2.8245 - 1.8366
        # = 0.9879, scaledown 0.0658. Wrong (double-count) total would be
        # 1.8366 + 2.8245 + 0.0658 = 4.7269; the real total is 2.8903.
        self.assertEqual(amortize_video_cost(1.8366, 0.9879, 0.0658, 1), 2.8903)

    def test_missing_shared_input_never_falls_back_to_handler_only(self):
        self.assertIsNone(amortize_video_cost(0.63, None, 0.0757, 2))
        self.assertIsNone(amortize_video_cost(0.63, 1.87, None, 2))
        self.assertIsNone(amortize_video_cost(0.63, 1.87, 0.0757, 0))
        self.assertIsNone(amortize_video_cost(None, 1.87, 0.0757, 2))

    def test_bool_shared_input_is_unknown(self):
        self.assertIsNone(amortize_video_cost(0.63, True, 0.0757, 2))


class ContainerVideosRegistryTests(unittest.TestCase):
    def test_same_task_counts_once_even_for_many_clips(self):
        container = "test-registry-once"
        self.assertEqual(register_container_video(container, "task-a"), 1)
        self.assertEqual(register_container_video(container, "task-a"), 1)

    def test_two_tasks_count_twice(self):
        container = "test-registry-twice"
        register_container_video(container, "task-a")
        self.assertEqual(register_container_video(container, "task-b"), 2)


class CompletionCostKwargsTotalTests(unittest.TestCase):
    def _snapshot_report(self, container: str, task: str) -> IntroCostReport:
        return IntroCostReport(
            ran=True,
            cost_usd=0.63,
            job_id="job-1",
            container_cost_usd=2.5,
            container_overhead_usd=1.87,
            container_uptime_s=1982.0,
            container_id=container,
            jobs_served_in_container=3,
            scaledown_cost_usd=0.0757,
        )

    def test_running_total_and_container_fields(self):
        report = self._snapshot_report("test-total-1", "task-1")
        kwargs = completion_cost_kwargs("task-1", report)
        self.assertEqual(kwargs["cost_usd"], 0.63)
        self.assertEqual(kwargs["total_cost_usd"], round(0.63 + (1.87 + 0.0757) / 1, 4))
        self.assertEqual(kwargs["total_cost_label"], "running")
        self.assertEqual(kwargs["container_cost_usd"], 2.5)
        self.assertEqual(kwargs["container_overhead_usd"], 1.87)
        self.assertEqual(kwargs["container_id"], "test-total-1")
        self.assertEqual(kwargs["videos_per_container"], 1)
        self.assertEqual(kwargs["jobs_served_in_container"], 3)

    def test_second_video_in_same_container_splits_shared_spend(self):
        container = "test-total-2"
        completion_cost_kwargs("task-1", self._snapshot_report(container, "task-1"))
        kwargs = completion_cost_kwargs("task-2", self._snapshot_report(container, "task-2"))
        self.assertEqual(kwargs["videos_per_container"], 2)
        self.assertEqual(kwargs["total_cost_usd"], round(0.63 + (1.87 + 0.0757) / 2, 4))

    def test_no_overhead_snapshot_keeps_exact_old_return(self):
        report = IntroCostReport(
            ran=True,
            cost_usd=0.63,
            job_id="job-1",
            container_cost_usd=2.5,
            container_id="test-total-no-overhead",
            scaledown_cost_usd=0.0757,
        )
        kwargs = completion_cost_kwargs("task-1", report)
        self.assertEqual(kwargs, {"cost_usd": 0.63})
        self.assertNotIn("total_cost_usd", kwargs)

    def test_no_container_snapshot_keeps_exact_old_return(self):
        kwargs = completion_cost_kwargs(
            "task-old", IntroCostReport(ran=True, cost_usd=0.05, job_id="job-1")
        )
        self.assertEqual(kwargs, {"cost_usd": 0.05})

    def test_container_without_scaledown_has_no_total(self):
        report = IntroCostReport(
            ran=True, cost_usd=0.63, job_id="job-1", container_id="test-total-3"
        )
        kwargs = completion_cost_kwargs("task-1", report)
        self.assertEqual(kwargs, {"cost_usd": 0.63})
        self.assertNotIn("total_cost_usd", kwargs)

    def test_handler_costs_tuple_sums_all_clips(self):
        report = IntroCostReport(
            ran=True,
            cost_usd=0.63,
            job_id="job-1",
            handler_costs_usd=(0.63, 0.4),
            container_cost_usd=2.5,
            container_overhead_usd=1.47,
            container_uptime_s=100.0,
            container_id="test-total-4",
            scaledown_cost_usd=0.0757,
        )
        kwargs = completion_cost_kwargs("task-1", report)
        self.assertEqual(kwargs["total_cost_usd"], round(1.03 + (1.47 + 0.0757) / 1, 4))


class CostEventPropsTotalTests(unittest.TestCase):
    def test_total_fields_pass_through_individually(self):
        props = cost_event_props(
            {
                "cost_usd": 0.63,
                "total_cost_usd": 2.5757,
                "total_cost_label": "running",
                "container_cost_usd": 2.5,
                "container_overhead_usd": 1.87,
                "container_uptime_s": 1982.0,
                "container_id": "c-1",
                "jobs_served_in_container": 3,
                "scaledown_cost_usd": 0.0757,
                "videos_per_container": 1,
            }
        )
        self.assertEqual(props["total_cost_usd"], 2.5757)
        self.assertEqual(props["container_overhead_usd"], 1.87)
        self.assertEqual(props["total_cost_label"], "running")
        self.assertEqual(props["videos_per_container"], 1)
        self.assertEqual(props["container_id"], "c-1")

    def test_one_bad_total_field_never_drops_the_rest(self):
        props = cost_event_props(
            {
                "cost_usd": 0.63,
                "total_cost_usd": "not-a-number",
                "total_cost_label": "running",
                "container_id": "c-1",
            }
        )
        self.assertNotIn("total_cost_usd", props)
        self.assertEqual(props["total_cost_label"], "running")
        self.assertEqual(props["container_id"], "c-1")

    def test_unknown_total_label_is_dropped(self):
        props = cost_event_props(
            {"cost_usd": 0.63, "total_cost_usd": 1.0, "total_cost_label": "final"}
        )
        self.assertEqual(props["total_cost_usd"], 1.0)
        self.assertNotIn("total_cost_label", props)


class ReportFromJobCostTests(unittest.TestCase):
    def test_snapshot_maps_to_report(self):
        report = report_from_job_cost(
            0.63,
            "job-1",
            ModalJobCost(
                0.63, 2.5, 1982.0, "c-1", 3, 0.0757, container_overhead_usd=1.87
            ),
        )
        self.assertEqual(report.container_cost_usd, 2.5)
        self.assertEqual(report.container_overhead_usd, 1.87)
        self.assertEqual(report.container_id, "c-1")
        self.assertEqual(report.jobs_served_in_container, 3)

    def test_no_snapshot_keeps_intro_only_report(self):
        report = report_from_job_cost(0.63, "job-1", None)
        self.assertEqual(report, IntroCostReport(ran=True, cost_usd=0.63, job_id="job-1"))


if __name__ == "__main__":
    unittest.main()
