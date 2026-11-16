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


def _stub_stages(monkeypatch, entered: list[str], cancel_after: str | None = "audio"):
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
    monkeypatch.setattr(tm, "generate_final_videos", lambda *a, **k: entered.append("render") or (["/tmp/final.mp4"], ["/tmp/final.mp4"], None))
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
    # The row deleted by the cancel is never recreated by later writes.
    assert sm.state.get_task(task_id) is None


def test_cancel_before_start_runs_no_stage(monkeypatch):
    task_id = "cancel-pipeline-2"
    request_cancel(task_id)
    sm.state.delete_task(task_id)
    entered: list[str] = []
    _stub_stages(monkeypatch, entered)

    result = tm.start(task_id, _params(), stop_at="video")

    assert result is None
    assert entered == []
    assert sm.state.get_task(task_id) is None


@pytest.mark.parametrize(
    ("cancel_after", "expected_entered"),
    [
        ("script", ["script"]),
        ("audio", ["script", "audio"]),
        ("subtitle", ["script", "audio", "subtitle"]),
        ("materials", ["script", "audio", "subtitle", "materials"]),
    ],
)
def test_cancel_at_each_stage_boundary_stops_before_next_stage(
    monkeypatch, cancel_after, expected_entered
):
    # Every abort_if_cancelled boundary (script, audio, subtitle,
    # materials, render): a cancel landing after stage N must stop the
    # pipeline before stage N+1 runs.
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
    # A late progress write from the doomed worker must not resurrect it.
    state.update_task(task_id, state=const.TASK_STATE_COMPLETE, progress=100)
    assert state.get_task(task_id) is None
    state.delete_task(task_id)
