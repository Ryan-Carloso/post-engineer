"""Schedule cancel must stop the engine pipeline (issue #447).

The web DELETE /api/schedule removes generating slots and refunds them
without telling the engine, so the batch worker keeps walking every paid
stage (subtitle, materials, render, archive) after the charge is gone.
These tests pin the fix: a cancelled task stops at the next stage
boundary, never runs later stages, and a cancelled/deleted task row is
never recreated by a later progress write.
"""

import pytest

from app.models import const
from app.models.schema import VideoParams
from app.services import state as sm
from app.services import task as tm
from app.services.state import MemoryState
from app.services.task_cancellation import request_cancel


def _params() -> VideoParams:
    return VideoParams(
        video_title="cancel test",
        video_description="desc",
        video_type="faceless",
        video_aspect="9:16",
        video_script="First paragraph. Second paragraph.",
    )


def _stub_stages(
    monkeypatch,
    entered: list[str],
    cancel_after: str | None = "audio",
    render=None,
):
    """Stage stubs that record entry; the cancel lands right after the
    ``cancel_after`` stage (schedule cancel + row delete, like the real
    delete path), so the pipeline must stop before the NEXT stage."""

    def _cancel(task_id):
        if cancel_after is not None:
            request_cancel(task_id)
            sm.state.delete_task(task_id)

    monkeypatch.setattr(tm.video_storage, "require_r2_configuration", lambda: None)
    monkeypatch.setattr(tm.start_preflight, "run", lambda *a, **k: None)

    def _script(task_id, params):
        entered.append("script")
        if cancel_after == "script":
            _cancel(task_id)
        return "First paragraph. Second paragraph."

    monkeypatch.setattr(tm, "generate_script", _script)
    monkeypatch.setattr(tm, "save_script_data", lambda *a, **k: None)
    monkeypatch.setattr(tm, "track_generation_started", lambda task_id: None)

    def _audio(task_id, params, video_script):
        entered.append("audio")
        if cancel_after == "audio":
            _cancel(task_id)
        return ("/tmp/audio.wav", 10.0, "sub-maker")

    monkeypatch.setattr(tm, "generate_audio", _audio)

    def _subtitle(*a, **k):
        entered.append("subtitle")
        if cancel_after == "subtitle":
            _cancel(a[0] if a else k.get("task_id"))
        return "/tmp/sub.srt"

    monkeypatch.setattr(tm, "generate_subtitle", _subtitle)

    def _materials(*a, **k):
        entered.append("materials")
        if cancel_after == "materials":
            _cancel(a[0] if a else k.get("task_id"))
        return ["/tmp/mat.mp4"]

    monkeypatch.setattr(tm, "get_video_materials", _materials)

    if render is None:
        def _render(task_id, *a, **k):
            entered.append("render")
            if cancel_after == "render":
                _cancel(task_id)
            return (["/tmp/final.mp4"], ["/tmp/final.mp4"], None)

        render = _render

    monkeypatch.setattr(tm, "generate_final_videos", render)
    monkeypatch.setattr(tm, "archive_final_videos", lambda *a, **k: entered.append("archive"))
    monkeypatch.setattr(tm.user_media, "prepare_segment_panels", lambda *a, **k: None)
    monkeypatch.setattr(tm.audio_trim, "task_local_copy", lambda *a, **k: None)
    monkeypatch.setattr(tm, "resolve_music_mood", lambda params: "calm")
    monkeypatch.setattr(tm, "persona_lipsync_active", lambda params: False)
    monkeypatch.setattr(tm, "lip_sync_cap_seconds", lambda params: 60.0)
    monkeypatch.setattr(tm.upload_post.upload_post_service, "is_configured", lambda: False)


def test_cancel_between_stages_stops_pipeline_and_row_not_recreated(monkeypatch):
    task_id = "cancel-pipeline-1"
    sm.state.update_task(task_id, user_id="u-1", flow="batch", state=const.TASK_STATE_PROCESSING, progress=0)
    entered: list[str] = []
    _stub_stages(monkeypatch, entered)

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert entered == ["script", "audio"]
    assert sm.state.get_task(task_id) is None


def test_cancel_before_start_runs_no_stage(monkeypatch):
    task_id = "cancel-pipeline-2"
    request_cancel(task_id)
    sm.state.delete_task(task_id)
    entered: list[str] = []
    _stub_stages(monkeypatch, entered)

    started: list[str] = []
    monkeypatch.setattr(tm, "track_generation_started", started.append)

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert entered == []
    assert sm.state.get_task(task_id) is None
    assert started == []


@pytest.mark.parametrize(
    ("cancel_after", "expected_entered"),
    [
        ("script", ["script"]),
        ("audio", ["script", "audio"]),
        ("subtitle", ["script", "audio", "subtitle"]),
        ("materials", ["script", "audio", "subtitle", "materials"]),
        ("render", ["script", "audio", "subtitle", "materials", "render"]),
    ],
)
def test_cancel_at_each_stage_boundary_stops_before_next_stage(
    monkeypatch, cancel_after, expected_entered
):
    task_id = f"cancel-stage-{cancel_after}"
    sm.state.update_task(
        task_id, user_id="u-1", flow="batch", state=const.TASK_STATE_PROCESSING, progress=0
    )
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after=cancel_after)

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert entered == expected_entered
    assert sm.state.get_task(task_id) is None


@pytest.mark.parametrize(
    "cancel_after",
    ["script", "audio", "subtitle", "materials", "render"],
)
def test_abort_pops_progress_milestones(monkeypatch, cancel_after):
    task_id = f"cancel-milestone-{cancel_after}"
    sm.state.update_task(
        task_id, user_id="u-1", flow="batch", state=const.TASK_STATE_PROCESSING, progress=0
    )
    tm._progress_milestones[task_id] = 50
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after=cancel_after)

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert task_id not in tm._progress_milestones


def test_cancel_during_render_skips_archive_cross_post_and_terminal_webhook(monkeypatch):
    task_id = "cancel-during-render-1"
    sm.state.update_task(
        task_id,
        user_id="u-1",
        flow="direct",
        state=const.TASK_STATE_PROCESSING,
        progress=0,
        video_storage_path="task/cancel-during-render-1/final.mp4",
    )
    tm._progress_milestones[task_id] = 50
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after="render")

    webhook_calls: list[dict] = []
    monkeypatch.setattr(
        tm.task_webhook,
        "notify_terminal_task",
        lambda *a, **k: webhook_calls.append(k),
    )
    cross_post_calls: list[dict] = []
    monkeypatch.setattr(tm.upload_post.upload_post_service, "is_configured", lambda: True)
    monkeypatch.setattr(tm.upload_post.upload_post_service, "auto_upload", True)
    monkeypatch.setattr(tm.upload_post.upload_post_service, "platforms", ["youtube"])
    monkeypatch.setattr(
        tm.upload_post, "cross_post_video",
        lambda *a, **k: cross_post_calls.append(k) or {"success": True},
    )
    monkeypatch.setattr(tm.video_storage, "read_final_video_r2", lambda *a, **k: b"bytes")

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert entered == ["script", "audio", "subtitle", "materials", "render"]
    assert webhook_calls == []
    assert cross_post_calls == []
    assert sm.state.get_task(task_id) is None
    assert task_id not in tm._progress_milestones


def test_empty_render_result_fails_without_archiving(monkeypatch):
    task_id = "cancel-empty-render-1"
    sm.state.update_task(
        task_id, user_id="u-1", flow="direct", state=const.TASK_STATE_PROCESSING, progress=0
    )
    entered: list[str] = []

    def _empty_render(task_id, *a, **k):
        entered.append("render")
        return ([], [], None)

    _stub_stages(monkeypatch, entered, cancel_after=None, render=_empty_render)

    webhook_calls: list[dict] = []
    monkeypatch.setattr(
        tm.task_webhook,
        "notify_terminal_task",
        lambda *a, **k: webhook_calls.append(k),
    )

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert entered == ["script", "audio", "subtitle", "materials", "render"]
    assert [call.get("status") for call in webhook_calls] == ["failed"]


def test_cancelled_task_progress_write_does_not_resurrect_memory_row():
    state = MemoryState()
    request_cancel("cancel-mem-1")
    state.update_task("cancel-mem-1", state=const.TASK_STATE_PROCESSING, progress=20)
    state.delete_task("cancel-mem-1")
    state.update_task("cancel-mem-1", state=const.TASK_STATE_COMPLETE, progress=100)
    assert state.get_task("cancel-mem-1") is None


def test_cancelled_row_is_never_recreated_by_delete_then_write(monkeypatch):
    state = sm.state
    task_id = "cancel-del-1"
    request_cancel(task_id)
    state.update_task(task_id, user_id="u-1", state=const.TASK_STATE_PROCESSING, progress=20)
    state.delete_task(task_id)
    state.update_task(task_id, state=const.TASK_STATE_COMPLETE, progress=100)
    assert state.get_task(task_id) is None
    state.delete_task(task_id)


def _watch_terminal_effects(monkeypatch):
    """Record the terminal-failure side effects a cancelled worker must not emit."""
    from loguru import logger

    fail_calls: list[tuple] = []
    original_fail = tm._fail_task

    def _fail(*args, **kwargs):
        fail_calls.append((args, kwargs))
        return original_fail(*args, **kwargs)

    webhook_calls: list[dict] = []
    discord_calls: list[str] = []
    events: list[str] = []
    logs: list[str] = []
    original_track = tm.track_event

    def _track(event_name, properties=None, immediate=False):
        events.append(event_name)
        return original_track(event_name, properties, immediate)

    monkeypatch.setattr(tm, "_fail_task", _fail)
    monkeypatch.setattr(
        tm.task_webhook, "notify_terminal_task", lambda *a, **k: webhook_calls.append(k)
    )
    monkeypatch.setattr(tm, "send_discord", lambda message, post=None: discord_calls.append(message) or True)
    monkeypatch.setattr(tm, "track_event", _track)
    sink = logger.add(lambda message: logs.append(str(message)), level="INFO")
    return {
        "fail_calls": fail_calls,
        "webhook_calls": webhook_calls,
        "discord_calls": discord_calls,
        "events": events,
        "logs": logs,
        "sink": sink,
    }


def _drop_log_sink(watched) -> None:
    from loguru import logger

    logger.remove(watched["sink"])


def test_cancel_mid_stage_exception_does_not_report_failure(monkeypatch, tmp_path):
    """A stage that raises after the cancel mark must abort, not fail.

    delete_video removes the task directory while the worker is inside a
    stage. The missing file raises (FileNotFoundError). That is a cancel,
    not a terminal failure: no _fail_task, no failed webhook, no Discord
    alert, no video_generation_failed. Intermediates are removed and the
    progress-milestone cache entry is popped.
    """
    from pathlib import Path

    task_id = "cancel-mid-raise-1"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    sm.state.update_task(
        task_id, user_id="u-1", flow="direct", state=const.TASK_STATE_PROCESSING, progress=0
    )
    tm._progress_milestones[task_id] = 50
    staged = Path(tm.utils.task_dir(task_id)) / "audio.mp3"
    staged.write_text("audio", encoding="utf-8")
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after=None)

    def _audio(task_id, params, video_script):
        entered.append("audio")
        request_cancel(task_id)
        sm.state.delete_task(task_id)
        raise FileNotFoundError(f"/app/storage/tasks/{task_id}/audio.mp3")

    monkeypatch.setattr(tm, "generate_audio", _audio)
    watched = _watch_terminal_effects(monkeypatch)
    try:
        result = tm.start(task_id, _params(), stop_at="video")
    finally:
        _drop_log_sink(watched)
        tm._progress_milestones.pop(task_id, None)

    assert result is None
    assert entered == ["script", "audio"]
    assert watched["fail_calls"] == []
    assert watched["webhook_calls"] == []
    assert watched["discord_calls"] == []
    assert "video_generation_failed" not in watched["events"]
    assert task_id not in tm._progress_milestones
    assert not staged.exists()
    assert any("cancelled, stopped" in line for line in watched["logs"])
    assert not any("crashed" in line for line in watched["logs"])


def test_uncaught_stage_error_without_cancel_still_fails(monkeypatch, tmp_path):
    """The same raise with no cancel mark keeps today's failure path."""
    from pathlib import Path

    task_id = "cancel-mid-raise-control"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    sm.state.update_task(
        task_id, user_id="u-1", flow="direct", state=const.TASK_STATE_PROCESSING, progress=0
    )
    tm._progress_milestones[task_id] = 50
    staged = Path(tm.utils.task_dir(task_id)) / "audio.mp3"
    staged.write_text("audio", encoding="utf-8")
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after=None)

    def _audio(task_id, params, video_script):
        entered.append("audio")
        raise FileNotFoundError(f"/app/storage/tasks/{task_id}/audio.mp3")

    monkeypatch.setattr(tm, "generate_audio", _audio)
    watched = _watch_terminal_effects(monkeypatch)
    try:
        result = tm.start(task_id, _params(), stop_at="video")
    finally:
        _drop_log_sink(watched)

    assert result is None
    assert entered == ["script", "audio"]
    assert len(watched["fail_calls"]) == 1
    assert [call.get("status") for call in watched["webhook_calls"]] == ["failed"]
    assert watched["discord_calls"]
    assert "video_generation_failed" in watched["events"]
    assert task_id not in tm._progress_milestones
    assert not staged.exists()
    task = sm.state.get_task(task_id)
    assert task is not None
    assert task["state"] == const.TASK_STATE_FAILED
    sm.state.delete_task(task_id)
    tm._progress_milestones.pop(task_id, None)


def test_empty_render_after_cancel_does_not_fail(monkeypatch):
    """A stage that returns empty because its files vanished is a cancel."""
    task_id = "cancel-empty-after-cancel"
    sm.state.update_task(
        task_id, user_id="u-1", flow="direct", state=const.TASK_STATE_PROCESSING, progress=0
    )
    tm._progress_milestones[task_id] = 70
    entered: list[str] = []

    def _empty_after_cancel(task_id, *a, **k):
        entered.append("render")
        request_cancel(task_id)
        sm.state.delete_task(task_id)
        return ([], [], None)

    _stub_stages(monkeypatch, entered, cancel_after=None, render=_empty_after_cancel)
    watched = _watch_terminal_effects(monkeypatch)
    try:
        result = tm.start(task_id, _params(), stop_at="video")
    finally:
        _drop_log_sink(watched)
        tm._progress_milestones.pop(task_id, None)

    assert result is None
    assert "render" in entered
    assert watched["fail_calls"] == []
    assert watched["webhook_calls"] == []
    assert watched["discord_calls"] == []
    assert "video_generation_failed" not in watched["events"]
    assert task_id not in tm._progress_milestones


def test_cancel_during_script_does_not_complete(monkeypatch):
    """stop_at=script must not emit a completed webhook after a mid-stage cancel."""
    task_id = "cancel-complete-script"
    sm.state.update_task(
        task_id, user_id="u-1", flow="direct", state=const.TASK_STATE_PROCESSING, progress=0
    )
    tm._progress_milestones[task_id] = 50
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after=None)

    def _script(task_id, params):
        entered.append("script")
        request_cancel(task_id)
        sm.state.delete_task(task_id)
        return "First paragraph. Second paragraph."

    monkeypatch.setattr(tm, "generate_script", _script)
    complete_calls: list[dict] = []
    original_complete = tm._complete_task

    def _complete(*args, **kwargs):
        complete_calls.append(kwargs)
        return original_complete(*args, **kwargs)

    monkeypatch.setattr(tm, "_complete_task", _complete)
    watched = _watch_terminal_effects(monkeypatch)
    try:
        result = tm.start(task_id, _params(), stop_at="script")
    finally:
        _drop_log_sink(watched)
        tm._progress_milestones.pop(task_id, None)

    assert result is None
    assert entered == ["script"]
    assert complete_calls == []
    assert watched["webhook_calls"] == []
    assert task_id not in tm._progress_milestones


def test_missing_segment_photo_after_cancel_does_not_fail(monkeypatch):
    """ImagesDoNotCoverAudio after the cancel mark is an abort, not a failure."""
    from app.services.image_coverage import ImagesDoNotCoverAudio

    task_id = "cancel-images-1"
    sm.state.update_task(
        task_id, user_id="u-1", flow="direct", state=const.TASK_STATE_PROCESSING, progress=0
    )
    entered: list[str] = []
    _stub_stages(monkeypatch, entered, cancel_after=None)

    def _panels(task_id, *a, **k):
        request_cancel(task_id)
        sm.state.delete_task(task_id)
        raise ImagesDoNotCoverAudio("a segment photo is missing")

    monkeypatch.setattr(tm.user_media, "prepare_segment_panels", _panels)
    watched = _watch_terminal_effects(monkeypatch)
    try:
        result = tm.start(task_id, _params(), stop_at="video")
    finally:
        _drop_log_sink(watched)

    assert result is None
    assert watched["fail_calls"] == []
    assert watched["webhook_calls"] == []
    assert "video_generation_failed" not in watched["events"]


def test_empty_script_after_cancel_does_not_fail(monkeypatch):
    """generate_script's own failure call must not fire once the id is cancelled."""
    task_id = "cancel-empty-script"
    request_cancel(task_id)
    tm._progress_milestones[task_id] = 50
    calls: list[tuple] = []
    monkeypatch.setattr(tm, "_fail_task", lambda *a, **k: calls.append(a))
    params = _params()
    params.video_script = ""
    try:
        assert tm.generate_script(task_id, params) is None
    finally:
        tm._progress_milestones.pop(task_id, None)
    assert calls == []
    assert task_id not in tm._progress_milestones


def test_audio_failure_after_cancel_does_not_fail(monkeypatch):
    """generate_audio's own failure call must not fire once the id is cancelled."""
    task_id = "cancel-no-voice"
    request_cancel(task_id)
    calls: list[tuple] = []
    monkeypatch.setattr(tm, "_fail_task", lambda *a, **k: calls.append(a))
    params = _params()
    params.voice_name = ""
    assert tm.generate_audio(task_id, params, "Hello there.") == (None, None, None)
    assert calls == []
