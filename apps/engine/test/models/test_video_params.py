"""VideoParams publish-copy fields (issue #542 follow-up).

video_title / video_description are agent-supplied publish copy and
REQUIRED: a request without them fails validation loudly, like an empty
script — there is no fallback to video_subject or the mechanical caption.
Lengths are YouTube's limits; over-long values fail validation loudly,
never silently truncate. Blank values fail too: the strip validator runs
before the length check.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pydantic import ValidationError

from app.models.schema import VideoParams


def _params(**overrides):
    fields = {
        "video_title": "Slot subject",
        "video_description": "Agent description.",
        "video_type": "faceless",
    }
    fields.update(overrides)
    return VideoParams(**fields)


class VideoTitleDescriptionTests(unittest.TestCase):
    def test_missing_title_fails_validation(self):
        with self.assertRaises(ValidationError):
            VideoParams(video_description="Agent description.", video_type="faceless")

    def test_missing_description_fails_validation(self):
        with self.assertRaises(ValidationError):
            VideoParams(video_title="Slot subject", video_type="faceless")

    def test_empty_title_fails_validation(self):
        with self.assertRaises(ValidationError):
            _params(video_title="")

    def test_empty_description_fails_validation(self):
        with self.assertRaises(ValidationError):
            _params(video_description="")

    def test_blank_title_fails_validation(self):
        with self.assertRaises(ValidationError):
            _params(video_title="   ")

    def test_blank_description_fails_validation(self):
        with self.assertRaises(ValidationError):
            _params(video_description="   ")

    def test_title_and_description_are_stored_trimmed(self):
        params = _params(video_title="  Slot subject  ", video_description="  Agent description.  ")
        self.assertEqual(params.video_title, "Slot subject")
        self.assertEqual(params.video_description, "Agent description.")

    def test_title_accepts_up_to_100_chars(self):
        params = _params(video_title="t" * 100)
        self.assertEqual(params.video_title, "t" * 100)

    def test_title_over_100_chars_fails_validation(self):
        with self.assertRaises(ValidationError):
            _params(video_title="t" * 101)

    def test_description_accepts_up_to_5000_chars(self):
        params = _params(video_description="d" * 5000)
        self.assertEqual(params.video_description, "d" * 5000)

    def test_description_over_5000_chars_fails_validation(self):
        with self.assertRaises(ValidationError):
            _params(video_description="d" * 5001)
