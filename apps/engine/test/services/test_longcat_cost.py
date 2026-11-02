"""Unit tests for app.services.longcat_cost (Modal job cost parsing).

The engine must read the backend's container snapshot with the same
guards as the handler cost: a non-numeric value is "unknown", never
zero, and bool is excluded explicitly because it is an int subclass.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.longcat_cost import ModalJobCost, parse_modal_job_cost


class ParseModalJobCostTests(unittest.TestCase):
    def test_full_payload_parses_every_field(self):
        parsed = parse_modal_job_cost(
            {
                "cost_usd": 0.63,
                "container_cost_usd": 2.5,
                "container_uptime_s": 1982.0,
                "container_id": "abc123",
                "jobs_served_in_container": 3,
                "scaledown_cost_usd": 0.0757,
            }
        )
        self.assertEqual(
            parsed,
            ModalJobCost(
                cost_usd=0.63,
                container_cost_usd=2.5,
                container_uptime_s=1982.0,
                container_id="abc123",
                jobs_served_in_container=3,
                scaledown_cost_usd=0.0757,
            ),
        )

    def test_missing_fields_become_none(self):
        parsed = parse_modal_job_cost({"status": "done"})
        self.assertEqual(
            parsed,
            ModalJobCost(None, None, None, None, None, None),
        )

    def test_timings_fallback_for_uptime(self):
        parsed = parse_modal_job_cost(
            {"timings": {"container_uptime_s": 100.5}}
        )
        self.assertEqual(parsed.container_uptime_s, 100.5)

    def test_top_level_uptime_wins_over_timings(self):
        parsed = parse_modal_job_cost(
            {"container_uptime_s": 200.0, "timings": {"container_uptime_s": 100.0}}
        )
        self.assertEqual(parsed.container_uptime_s, 200.0)

    def test_bool_string_and_infinity_are_unknown(self):
        parsed = parse_modal_job_cost(
            {
                "cost_usd": True,
                "container_cost_usd": "free",
                "container_uptime_s": float("inf"),
                "container_id": "",
                "jobs_served_in_container": True,
                "scaledown_cost_usd": None,
            }
        )
        self.assertEqual(
            parsed,
            ModalJobCost(None, None, None, None, None, None),
        )

    def test_jobs_must_be_an_int(self):
        parsed = parse_modal_job_cost({"jobs_served_in_container": 2.5})
        self.assertIsNone(parsed.jobs_served_in_container)

    def test_overhead_parses_and_guards_like_other_costs(self):
        parsed = parse_modal_job_cost({"container_overhead_usd": 0.9879})
        self.assertEqual(parsed.container_overhead_usd, 0.9879)
        parsed_bad = parse_modal_job_cost({"container_overhead_usd": True})
        self.assertIsNone(parsed_bad.container_overhead_usd)


if __name__ == "__main__":
    unittest.main()
