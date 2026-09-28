"""Structured failure logging for video tasks.

Every _fail_task call must emit a Loguru ERROR record (forwarded to
Bugsink by the asgi sink) with task_id, stage and error_type bound —
never the full params. The stage names the pipeline step that failed so
the reason is visible per step in Bugsink.
"""

import ast
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from loguru import logger

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import TaskVideoRequest
from app.services import task as task_service


class _LogCapture:
    def __init__(self):
        self.records = []
        self.handler_id = logger.add(lambda message: self.records.append(message.record))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        logger.remove(self.handler_id)

    def errors(self):
        return [r for r in self.records if r["level"].name == "ERROR"]


def _params_with_secret():
    return TaskVideoRequest(
        video_subject="subject-with-s3cr3t-token",
        custom_audio_file="/tmp/signed-audio-url-with-secret",
    )


class FailTaskLoggingTests(unittest.TestCase):
    def test_fail_task_logs_structured_error(self):
        with _LogCapture() as capture, patch.object(
            task_service, "send_discord", return_value=True
        ):
            task_service._fail_task("t-1", "boom", stage="audio")

        errors = capture.errors()
        self.assertEqual(len(errors), 1)
        record = errors[0]
        self.assertEqual(record["extra"].get("task_id"), "t-1")
        self.assertEqual(record["extra"].get("stage"), "audio")
        self.assertIn("error_type", record["extra"])
        self.assertIn("boom", record["message"])

    def test_fail_task_never_logs_params_or_secrets(self):
        params = _params_with_secret()
        with _LogCapture() as capture, patch.object(
            task_service, "send_discord", return_value=True
        ):
            task_service._fail_task("t-2", "boom", params, stage="script")

        for record in capture.errors():
            self.assertNotIn("s3cr3t-token", record["message"])
            self.assertNotIn("signed-audio-url-with-secret", record["message"])
            for value in record["extra"].values():
                self.assertNotIn("s3cr3t-token", str(value))

    def test_fail_task_without_stage_defaults_to_unknown(self):
        with _LogCapture() as capture, patch.object(
            task_service, "send_discord", return_value=True
        ):
            task_service._fail_task("t-3", "boom")

        self.assertEqual(capture.errors()[0]["extra"].get("stage"), "unknown")

    def test_every_fail_task_call_logs_each_step(self):
        # The user wants the failure reason visible per step in Bugsink:
        # repeated notices log every time (the Discord alert stays deduped).
        with _LogCapture() as capture, patch.object(
            task_service, "send_discord", return_value=True
        ) as send_discord:
            task_service._fail_task("t-4", "first: script broke", stage="script")
            task_service._fail_task("t-4", "second: generic", stage="pipeline")

        self.assertEqual(len(capture.errors()), 2)
        stages = [r["extra"].get("stage") for r in capture.errors()]
        self.assertEqual(stages, ["script", "pipeline"])
        send_discord.assert_called_once()

    def test_no_direct_failed_writes_outside_fail_task(self):
        # Pin: TASK_STATE_FAILED must only ever be written by _fail_task
        # (reads, e.g. _task_already_failed, are fine).
        src = Path(task_service.__file__).read_text()
        tree = ast.parse(src)
        offenders = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef) or node.name == "_fail_task":
                continue
            for child in ast.walk(node):
                if not isinstance(child, ast.Call):
                    continue
                func = child.func
                is_update_task = (
                    isinstance(func, ast.Attribute) and func.attr == "update_task"
                )
                if not is_update_task:
                    continue
                for arg in list(child.args) + [kw.value for kw in child.keywords]:
                    if (
                        isinstance(arg, ast.Attribute)
                        and arg.attr == "TASK_STATE_FAILED"
                    ):
                        offenders.append(f"{node.name}:{child.lineno}")
        self.assertEqual(offenders, [])


class StartCrashStageTests(unittest.TestCase):
    def _run_start_until_crash(self, fail_in):
        params = TaskVideoRequest(video_subject="topic")
        task_id = "crash-task"
        task_service.sm.state.update_task(task_id, user_id="u-1")
        with (
            patch.object(
                task_service, "generate_script",
                side_effect=RuntimeError("boom") if fail_in == "generate_script" else None,
                return_value="script text",
            ),
            patch.object(
                task_service, "generate_terms",
                side_effect=RuntimeError("boom") if fail_in == "generate_terms" else None,
                return_value="terms",
            ),
            patch.object(task_service, "send_discord", return_value=True),
            patch.object(task_service, "cleanup_task_intermediates"),
            _LogCapture() as capture,
        ):
            if fail_in == "generate_script":
                task_service.start(task_id, params, stop_at="video")
            else:
                # script succeeds, terms crashes
                task_service.start(task_id, params, stop_at="video")
        return capture

    def test_crash_before_any_phase_logs_stage_start(self):
        capture = self._run_start_until_crash("generate_script")
        stages = [r["extra"].get("stage") for r in capture.errors()]
        self.assertIn("start", stages)

    def test_crash_after_script_logs_last_completed_phase(self):
        capture = self._run_start_until_crash("generate_terms")
        stages = [r["extra"].get("stage") for r in capture.errors()]
        self.assertIn("script", stages)

    def test_mark_records_stage_in_task_state(self):
        # The SSE progress endpoint reads the stage from task state, so
        # _mark() must persist the last completed phase there. Run a minimal
        # start(): patch everything after the script phase so start()
        # returns early at stop_at="script".
        params = TaskVideoRequest(video_subject="topic")
        task_id = "stage-task"
        task_service.sm.state.update_task(task_id, user_id="u-1")
        with (
            patch.object(task_service, "generate_script", return_value="ok script"),
            patch.object(task_service, "send_discord", return_value=True),
            patch.object(task_service, "cleanup_task_intermediates"),
            patch.object(task_service, "save_script_data"),
        ):
            task_service.start(task_id, params, stop_at="script")
        task = task_service.sm.state.get_task(task_id)
        self.assertIsNotNone(task)
        self.assertEqual(task.get("stage"), "script")
