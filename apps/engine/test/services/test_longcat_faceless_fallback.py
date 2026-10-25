"""Direct unit tests for the LongCat faceless-fallback module."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import PersonaParams, VideoParams
from app.services import longcat, longcat_faceless_fallback as lff
from app.services.intro_cost import IntroCostReport


def _breaker_path(breaker_root: str):
    def _path(root=None):
        base = root if root is not None else breaker_root
        return os.path.join(base, "marker.json")

    return _path


class TestLongcatFacelessFallback(unittest.TestCase):
    def test_trip_false_logs_that_the_breaker_did_not_persist(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "alice"}), \
             patch.object(lff.longcat_breaker, "trip", return_value=False), \
             patch.object(lff.longcat_breaker, "should_emit_event", return_value=False), \
             patch.object(lff.sm, "persist_state_update"), \
             patch.object(lff.sm, "state", MagicMock(get_task=MagicMock(return_value={}))), \
             patch.object(lff.logger, "warning") as warn:
            lff.report_longcat_faceless_fallback("t1", {"user_id": "alice"})
        warn.assert_called()
        self.assertTrue(
            any("did not persist" in str(c) for c in warn.call_args_list)
        )

    def test_intro_succeeds_then_face_fill_longcat_unavailable(self):
        """Intro lands; face-fill raises LongCatUnavailableError.

        Video stays intro-only, warning is set, refund runs once.
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
        persist.assert_called_once()
        self.assertEqual(
            persist.call_args.kwargs.get("user_warning_codes"),
            ["avatar_disabled"],
        )
        self.assertEqual(state._rpc.call_count, 1)

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
