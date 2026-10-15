"""Unit tests for app.services.intro_cost.

cost_event_props is the single place that decides what cost telemetry a
video_generated event carries: a valid cost_usd, a known cost_missing_reason,
or nothing at all.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.intro_cost import (
    COST_MISSING_NO_COST_REPORTED,
    COST_MISSING_NO_INTRO,
    cost_event_props,
)


class CostEventPropsTests(unittest.TestCase):
    def test_valid_cost_returns_cost_usd(self):
        self.assertEqual(
            cost_event_props({"cost_usd": 0.05}), {"cost_usd": 0.05}
        )

    def test_cost_wins_over_reason(self):
        props = cost_event_props(
            {"cost_usd": 0.05, "cost_missing_reason": COST_MISSING_NO_INTRO}
        )
        self.assertEqual(props, {"cost_usd": 0.05})

    def test_known_reason_returned_when_no_cost(self):
        self.assertEqual(
            cost_event_props({"cost_missing_reason": COST_MISSING_NO_INTRO}),
            {"cost_missing_reason": "no_intro"},
        )
        self.assertEqual(
            cost_event_props(
                {"cost_missing_reason": COST_MISSING_NO_COST_REPORTED}
            ),
            {"cost_missing_reason": "intro_no_cost_reported"},
        )

    def test_unknown_reason_is_dropped(self):
        self.assertEqual(cost_event_props({"cost_missing_reason": "bogus"}), {})

    def test_boolean_cost_is_not_a_cost(self):
        # bool is an int subclass; True must not become $1.
        self.assertEqual(cost_event_props({"cost_usd": True}), {})

    def test_non_numeric_cost_falls_back_to_reason(self):
        props = cost_event_props(
            {"cost_usd": "free", "cost_missing_reason": COST_MISSING_NO_INTRO}
        )
        self.assertEqual(props, {"cost_missing_reason": "no_intro"})

    def test_empty_source_returns_empty(self):
        self.assertEqual(cost_event_props({}), {})


if __name__ == "__main__":
    unittest.main()
