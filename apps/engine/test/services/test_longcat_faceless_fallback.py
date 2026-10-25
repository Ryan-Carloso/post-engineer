"""Direct unit tests for the LongCat faceless-fallback module."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import PersonaParams, VideoParams
from app.services import longcat, longcat_faceless_fallback as lff
from app.services import longcat_breaker
from test.services.longcat_breaker_path import breaker_path as _breaker_path


class TestLongcatFacelessFallback(unittest.TestCase):
    def test_trip_false_logs_that_the_breaker_did_not_persist(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "alice"}), \
             patch.object(lff.longcat_breaker, "trip", return_value=False), \
             patch.object(lff.longcat_breaker, "should_emit_event", return_value=False), \
             patch.object(lff.sm, "persist_state_update"), \
             patch.object(lff.sm, "state", MagicMock(get_task=MagicMock(return_value={}))), \
             patch.object(lff.logger, "warning") as warn:
            lff.report_longcat_faceless_fallback("t1", {"user_id": "alice"}, "alice")
        warn.assert_called()
        self.assertTrue(
            any("did not persist" in str(c) for c in warn.call_args_list)
        )

    def test_intro_succeeds_then_face_fill_longcat_unavailable(self):
        """Intro lands; face-fill raises LongCatUnavailableError.

        Video stays intro-only. No avatar_disabled warning, no refund.
        """
        params = VideoParams(
            video_subject="test",
            persona=PersonaParams(
                name="Ana",
                photo_url="https://supabase.test/signed/foto.png",
                voice_id="test-voice",
            ),
        )
        state = MagicMock()
        state.get_task.return_value = {
            "user_id": "alice",
            "generation_id": "batch:sched-9:slot:slot-1",
        }
        rpc_response = MagicMock()
        rpc_response.json.return_value = {"refunded": True}
        state._rpc = MagicMock(return_value=rpc_response)
        exc = longcat.LongCatUnavailableError(
            "LongCat submit failed with HTTP 404: modal-http: workspace ac-X is disabled"
        )
        prepare = MagicMock(return_value=("intro.mp4", 0.01, "job-1"))
        face_fill = MagicMock(side_effect=exc)
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "alice"}), \
             tempfile.TemporaryDirectory() as breaker_root, \
             patch.object(lff.longcat_breaker, "_state_path", side_effect=_breaker_path(breaker_root)), \
             patch.object(lff.sm, "state", state), \
             patch.object(lff.sm, "persist_state_update") as persist:
            video, intro_report = lff.render_persona_video(
                task_id="face-fill-fail",
                params=params,
                audio_file="voice.mp3",
                combined_video_path="combined.mp4",
                video_script="script",
                subtitle_path="sub.srt",
                task=state.get_task.return_value,
                user_id="alice",
                prepare_intro=prepare,
                apply_face_fill=face_fill,
            )
        self.assertEqual(video, "intro.mp4")
        self.assertTrue(intro_report.ran)
        persist.assert_not_called()
        self.assertEqual(state._rpc.call_count, 0)

    def test_state_path_patch_honors_root(self):
        """A patch that ignores root would hide writes outside the temp dir."""
        with tempfile.TemporaryDirectory() as breaker_root:
            outside = tempfile.mkdtemp()
            try:
                path_fn = _breaker_path(breaker_root)
                honored = path_fn(outside)
                self.assertTrue(honored.startswith(outside))
                self.assertFalse(honored.startswith(breaker_root))
            finally:
                os.rmdir(outside)

    def test_should_emit_event_warns_when_the_marker_write_fails(self):
        now = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as breaker_root, \
             patch.object(longcat_breaker, "_write_state", return_value=False), \
             patch.object(longcat_breaker.logger, "warning") as warn:
            self.assertFalse(longcat_breaker.should_emit_event(now, root=breaker_root))
        self.assertTrue(any("did not persist" in str(c) for c in warn.call_args_list))

    def test_should_alert_warns_when_the_marker_write_fails(self):
        now = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as breaker_root, \
             patch.object(longcat_breaker, "_write_state", return_value=False), \
             patch.object(longcat_breaker.logger, "warning") as warn:
            self.assertTrue(longcat_breaker.should_alert(now, root=breaker_root))
        self.assertTrue(any("did not persist" in str(c) for c in warn.call_args_list))

    def test_refund_error_is_scrubbed_before_the_log(self):
        state = MagicMock()
        state.get_task.return_value = {
            "user_id": "alice",
            "generation_id": "batch:sched-9:slot:slot-1",
        }
        state._rpc = MagicMock(side_effect=RuntimeError("/secret/path/token.json boom"))
        with patch.object(lff.sm, "state", state), \
             patch.object(lff.logger, "error") as log_error:
            lff.refund_face_premium("t-refund", 1)
        message = str(log_error.call_args)
        self.assertNotIn("/secret/path/token.json", message)
        self.assertIn("refund_batch_tokens failed", message)

    def test_should_alert_hour_bucket_allows_the_next_hour(self):
        with tempfile.TemporaryDirectory() as breaker_root:
            first = datetime(2026, 10, 25, 12, 59, tzinfo=timezone.utc)
            same = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
            next_hour = datetime(2026, 10, 25, 13, 0, tzinfo=timezone.utc)
            self.assertTrue(longcat_breaker.should_alert(first, root=breaker_root))
            self.assertFalse(longcat_breaker.should_alert(same, root=breaker_root))
            self.assertTrue(longcat_breaker.should_alert(next_hour, root=breaker_root))

    def test_report_alerts_again_in_the_next_hour_bucket(self):
        """should_alert keys on %Y-%m-%dT%H: the next hour is a new alert."""
        first = datetime(2026, 10, 25, 12, 30, tzinfo=timezone.utc)
        next_hour = datetime(2026, 10, 25, 13, 0, tzinfo=timezone.utc)
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "someone-else"}), \
                tempfile.TemporaryDirectory() as breaker_root, \
                patch.object(lff, "datetime") as dt:
            dt.now.side_effect = [first, next_hour]
            dt.timezone = timezone
            state = MagicMock()
            state.get_task.return_value = {"user_id": "real-user"}
            with patch.object(lff.longcat_breaker, "_state_path",
                              side_effect=_breaker_path(breaker_root)), \
                    patch.object(lff.sm, "state", state), \
                    patch.object(lff.sm, "persist_state_update"), \
                    patch.object(lff, "track_event"), \
                    patch.object(lff, "_discord_notify") as discord, \
                    patch.object(lff.logger, "error") as log_error:
                lff.report_longcat_faceless_fallback("t1", {"user_id": "real-user"}, "real-user")
                lff.report_longcat_faceless_fallback("t2", {"user_id": "real-user-2"}, "real-user-2")
                self.assertEqual(log_error.call_count, 2)
                self.assertEqual(discord.call_count, 2)

    def test_refund_uses_schedule_and_slot_when_generation_id_is_absent(self):
        """_dispatch_generation persists slot_id/schedule_id, not generation_id."""
        state = MagicMock()
        state.get_task.return_value = {
            "user_id": "alice",
            "schedule_id": "sched-9",
            "slot_id": "slot-1",
            "persona_id": "persona-1",
        }
        rpc_response = MagicMock()
        rpc_response.json.return_value = {"refunded": True}
        state._rpc = MagicMock(return_value=rpc_response)
        with patch.object(lff.sm, "state", state):
            lff.refund_face_premium("dispatch-task", 2)
        payload = state._rpc.call_args.args[1]
        self.assertEqual(payload["p_batch_generation_id"], "batch:sched-9")
        self.assertEqual(payload["p_refund_key"], "batch:sched-9:slot:slot-1:shortface")
        self.assertEqual(payload["p_amount"], 2)

    def test_face_quality_accepts_kebab_very_good_from_params(self):
        params = VideoParams(video_subject="test", video_quality="very-good")
        self.assertEqual(lff._face_quality({}, params), "very_good")
        self.assertEqual(lff._face_quality({"post_face_quality": "very-good"}), "very_good")
        self.assertEqual(lff._face_quality({"video_quality": "very_good"}), "very_good")

    def test_report_uses_caller_user_id_when_task_is_empty(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "alice"}), \
             patch.object(lff.longcat_breaker, "trip", return_value=True), \
             patch.object(lff.longcat_breaker, "should_emit_event", return_value=False), \
             patch.object(lff.sm, "persist_state_update"), \
             patch.object(lff.sm, "state", MagicMock(get_task=MagicMock(return_value={}))), \
             patch.object(lff, "_discord_notify") as discord, \
             patch.object(lff.logger, "error") as log_error:
            lff.report_longcat_faceless_fallback("t-empty", {}, "alice")
        discord.assert_not_called()
        log_error.assert_not_called()
