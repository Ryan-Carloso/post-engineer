"""Unit tests for app.services.tracking_props.

The helpers build the small PostHog prop dicts for video pacing
(video_clip_duration, video_transition_mode, video_variation_seed) and
the task-row identity ids. Pacing props are typed values (ints and an
enum value string), never free text, so they need no scrubbing.
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import TaskVideoRequest, VideoParams, VideoTransitionMode
from app.services import tracking_props as tp


def _params(**kwargs):
    return VideoParams(
        video_title="test subject",
        video_description="Test description.",
        video_type="voiceover",
        video_script="script",
        **kwargs,
    )


def _request(**kwargs):
    return TaskVideoRequest(
        video_title="test subject",
        video_description="Test description.",
        video_type="voiceover",
        video_script="script",
        **kwargs,
    )


class PacingTrackingPropsTests(unittest.TestCase):
    def test_explicit_pacing_values_are_carried(self):
        props = tp.pacing_tracking_props(
            _params(
                video_clip_duration=4,
                video_transition_mode=VideoTransitionMode.crossfade,
                video_variation_seed=7,
            )
        )
        self.assertEqual(
            props,
            {
                "video_clip_duration": 4,
                "video_transition_mode": "Crossfade",
                "video_variation_seed": 7,
            },
        )

    def test_transition_mode_enum_is_recorded_by_value(self):
        props = tp.pacing_tracking_props(_params(video_transition_mode=VideoTransitionMode.shuffle))
        self.assertEqual(props["video_transition_mode"], "Shuffle")

    def test_default_duration_is_recorded_and_unset_mode_and_seed_omitted(self):
        props = tp.pacing_tracking_props(
            _params(video_transition_mode=None, video_variation_seed=None)
        )
        self.assertEqual(props, {"video_clip_duration": 2})

    def test_request_without_pacing_fields_carries_no_pacing_props(self):
        self.assertEqual(tp.pacing_tracking_props(SimpleNamespace()), {})

    def test_bool_duration_is_not_a_pacing_value(self):
        props = tp.pacing_tracking_props(
            SimpleNamespace(video_clip_duration=True, video_variation_seed=False)
        )
        self.assertEqual(props, {})


class TrackingContextFromTaskTests(unittest.TestCase):
    def test_row_carries_identity_ids_and_pacing(self):
        context = tp.tracking_context_from_task(
            {
                "persona_id": "persona-9",
                "slot_id": "slot-7",
                "schedule_id": "sched-3",
                "generation_id": "gen-1",
                "video_clip_duration": 4,
                "video_transition_mode": "Crossfade",
                "video_variation_seed": 7,
            }
        )
        self.assertEqual(
            context,
            {
                "persona_id": "persona-9",
                "slot_id": "slot-7",
                "schedule_id": "sched-3",
                "generation_id": "gen-1",
                "video_clip_duration": 4,
                "video_transition_mode": "Crossfade",
                "video_variation_seed": 7,
            },
        )

    def test_digit_string_pacing_coerces_to_int(self):
        context = tp.tracking_context_from_task(
            {"video_clip_duration": "4", "video_variation_seed": "7"}
        )
        self.assertEqual(context["video_clip_duration"], 4)
        self.assertEqual(context["video_variation_seed"], 7)

    def test_blank_and_missing_pacing_is_omitted(self):
        context = tp.tracking_context_from_task(
            {
                "video_clip_duration": None,
                "video_transition_mode": "",
                "video_variation_seed": None,
            }
        )
        for key in (
            "video_clip_duration",
            "video_transition_mode",
            "video_variation_seed",
        ):
            self.assertNotIn(key, context)

    def test_bool_pacing_is_omitted(self):
        context = tp.tracking_context_from_task({"video_clip_duration": True})
        self.assertNotIn("video_clip_duration", context)


class TrackingKwargsTests(unittest.TestCase):
    def test_ids_and_pacing_ride_together(self):
        kwargs = tp.tracking_kwargs(
            _request(
                slot_id="slot-123",
                generation_id="gen-456",
                video_clip_duration=4,
                video_transition_mode=VideoTransitionMode.crossfade,
            )
        )
        self.assertEqual(
            kwargs,
            {
                "slot_id": "slot-123",
                "generation_id": "gen-456",
                "video_clip_duration": 4,
                "video_transition_mode": "Crossfade",
            },
        )

    def test_default_body_carries_only_the_default_duration(self):
        self.assertEqual(tp.tracking_kwargs(_request()), {"video_clip_duration": 2})

    def test_request_without_tracking_fields_carries_nothing(self):
        self.assertEqual(tp.tracking_kwargs(SimpleNamespace()), {})


class PersonaTrackingKwargsTests(unittest.TestCase):
    def test_returns_persona_id_when_present(self):
        self.assertEqual(
            tp.persona_tracking_kwargs(SimpleNamespace(persona=SimpleNamespace(id="persona-1"))),
            {"persona_id": "persona-1"},
        )

    def test_omits_when_no_persona(self):
        self.assertEqual(tp.persona_tracking_kwargs(SimpleNamespace()), {})
        self.assertEqual(tp.persona_tracking_kwargs(SimpleNamespace(persona=None)), {})


if __name__ == "__main__":
    unittest.main()
