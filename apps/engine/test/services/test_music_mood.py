"""Unit tests for the background-music mood helpers (issue #489).

The mood is agent-supplied per request: ``VideoParams.music_mood``.
``"none"`` is an explicit no-music choice, ``None`` (the default) lets the
pipeline pick the first catalogued mood, and any other value must name a
catalogued mood. A video must never render silent by accident — a missing
or unusable catalog is an ERROR, not a quiet fallback.
"""

import unittest
import sys
from pathlib import Path
from unittest.mock import patch

from loguru import logger

# add project root to python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VideoParams
from app.services import music_mood as mm


def _params(music_mood=None):
    return VideoParams(video_subject="Lisbon trams", music_mood=music_mood)


class TestResolveMusicMood(unittest.TestCase):
    def _patch_moods(self, moods):
        return patch.object(mm, "get_available_music_moods", return_value=moods)

    def test_none_mood_is_explicit_no_music_without_consulting_catalog(self):
        with patch.object(
            mm, "get_available_music_moods",
            side_effect=AssertionError("catalog must not be consulted for 'none'"),
        ):
            self.assertEqual(mm.resolve_music_mood(_params("none")), "none")

    def test_requested_mood_passes_through(self):
        with self._patch_moods(("calm", "upbeat")):
            self.assertEqual(mm.resolve_music_mood(_params("upbeat")), "upbeat")

    def test_omitted_mood_defaults_to_first_catalogued_mood(self):
        # Input deliberately unsorted: the default must be deterministic.
        with self._patch_moods(("upbeat", "calm")):
            self.assertEqual(mm.resolve_music_mood(_params()), "calm")

    def test_omitted_mood_with_empty_catalog_reports_error_and_returns_none(self):
        records = []
        handler_id = logger.add(
            lambda message: records.append(message.record), level="ERROR"
        )
        try:
            with self._patch_moods(()):
                self.assertEqual(mm.resolve_music_mood(_params()), "none")
        finally:
            logger.remove(handler_id)
        self.assertTrue(
            any("catalog" in r["message"].lower() for r in records),
            "empty catalog must log an ERROR (forwarded to PostHog as $exception)",
        )

    def test_requested_mood_with_empty_catalog_reports_error_and_returns_none(self):
        records = []
        handler_id = logger.add(
            lambda message: records.append(message.record), level="ERROR"
        )
        try:
            with self._patch_moods(()):
                self.assertEqual(mm.resolve_music_mood(_params("upbeat")), "none")
        finally:
            logger.remove(handler_id)
        self.assertTrue(records, "empty catalog must log an ERROR")

    def test_unknown_mood_raises_value_error(self):
        with self._patch_moods(("calm", "upbeat")):
            with self.assertRaises(ValueError) as ctx:
                mm.resolve_music_mood(_params("finance"))
        self.assertIn("finance", str(ctx.exception))
        self.assertIn("calm", str(ctx.exception))


class TestValidateMusicMood(unittest.TestCase):
    def test_none_and_none_string_need_no_catalog(self):
        with patch.object(
            mm, "get_available_music_moods",
            side_effect=AssertionError("catalog must not be consulted"),
        ):
            mm.validate_music_mood(None)
            mm.validate_music_mood("none")

    def test_known_mood_passes(self):
        with patch.object(mm, "get_available_music_moods", return_value=("calm",)):
            mm.validate_music_mood("calm")

    def test_unknown_mood_raises_value_error(self):
        with patch.object(mm, "get_available_music_moods", return_value=("calm",)):
            with self.assertRaises(ValueError) as ctx:
                mm.validate_music_mood("finance")
        self.assertIn("finance", str(ctx.exception))

    def test_empty_catalog_skips_validation(self):
        # The API cannot validate against a catalog that does not exist;
        # resolve_music_mood reports that as an ERROR at render time.
        with patch.object(mm, "get_available_music_moods", return_value=()):
            mm.validate_music_mood("upbeat")


class TestLogBgmSelection(unittest.TestCase):
    def _capture(self, level):
        records = []
        handler_id = logger.add(
            lambda message: records.append(message.record), level=level
        )
        return records, handler_id

    def test_selected_track_logs_info(self):
        records, handler_id = self._capture("INFO")
        try:
            mm.log_bgm_selection("upbeat", "resource/songs/catalog.toml", "upbeat/upbeat-loop.mp3")
        finally:
            logger.remove(handler_id)
        self.assertTrue(
            any(r["level"].name == "INFO" and "upbeat" in r["message"] for r in records)
        )

    def test_missing_track_for_requested_mood_logs_error(self):
        records, handler_id = self._capture("ERROR")
        try:
            mm.log_bgm_selection("upbeat", "resource/songs/catalog.toml", "")
        finally:
            logger.remove(handler_id)
        self.assertTrue(
            any("upbeat" in r["message"] for r in records),
            "no track for a requested mood must log an ERROR ($exception)",
        )

    def test_explicit_none_logs_info_without_error(self):
        records, handler_id = self._capture("ERROR")
        try:
            mm.log_bgm_selection("none", "resource/songs/catalog.toml", "")
        finally:
            logger.remove(handler_id)
        self.assertFalse(records, "'none' is an explicit choice, not an error")

    def test_error_log_scrubs_absolute_catalog_path(self):
        # The ERROR is forwarded to PostHog as $exception: the server's
        # absolute filesystem layout must never reach analytics.
        records, handler_id = self._capture("ERROR")
        try:
            mm.log_bgm_selection("upbeat", "/app/resource/songs/catalog.toml", "")
        finally:
            logger.remove(handler_id)
        messages = [r["message"] for r in records]
        self.assertTrue(any("upbeat" in m for m in messages))
        self.assertFalse(
            any("/app/resource/songs/catalog.toml" in m for m in messages),
            "absolute catalog path leaked into the ERROR log",
        )
        self.assertTrue(any("catalog.toml" in m for m in messages))

    def test_info_log_scrubs_absolute_paths(self):
        records, handler_id = self._capture("INFO")
        try:
            mm.log_bgm_selection(
                "upbeat",
                "/app/resource/songs/catalog.toml",
                "/app/resource/songs/upbeat/upbeat-loop.mp3",
            )
        finally:
            logger.remove(handler_id)
        messages = [r["message"] for r in records]
        self.assertTrue(any("upbeat" in m for m in messages))
        self.assertFalse(
            any("/app/resource/songs/catalog.toml" in m for m in messages),
            "absolute catalog path leaked into the INFO log",
        )
        self.assertFalse(
            any("/app/resource/songs/upbeat/upbeat-loop.mp3" in m for m in messages),
            "absolute track path leaked into the INFO log",
        )


class TestGetAvailableMusicMoods(unittest.TestCase):
    def test_unreadable_catalog_logs_warning_without_the_absolute_path(self):
        # A missing catalog warns locally: the absolute path must not reach
        # the log line (the OSError text carries the path too).
        records = []
        handler_id = logger.add(
            lambda message: records.append(message.record), level="WARNING"
        )
        try:
            self.assertEqual(
                mm.get_available_music_moods("/app/resource/songs/missing.toml"), ()
            )
        finally:
            logger.remove(handler_id)
        messages = [r["message"] for r in records]
        self.assertTrue(any("missing.toml" in m for m in messages))
        self.assertFalse(
            any("/app/resource/songs/missing.toml" in m for m in messages),
            "absolute catalog path leaked into the WARNING log",
        )

    def test_reads_moods_from_catalog_file(self):
        import tempfile

        import toml

        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "catalog.toml"
            catalog.write_text(
                toml.dumps(
                    {
                        "tracks": [
                            {"file": "upbeat/a.mp3", "moods": ["upbeat", "energetic"]},
                            {"file": "calm/b.mp3", "moods": ["calm"]},
                        ]
                    }
                )
            )
            self.assertEqual(
                mm.get_available_music_moods(str(catalog)),
                ("calm", "energetic", "upbeat"),
            )

    def test_missing_catalog_returns_empty_tuple(self):
        self.assertEqual(
            mm.get_available_music_moods("/no/such/catalog.toml"), ()
        )


if __name__ == "__main__":
    unittest.main()
