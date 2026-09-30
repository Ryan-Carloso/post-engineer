"""Tests for the PostgREST ScheduleStore (app/services/fill_schedule.py).

The store is the fill schedule data layer: reads ``schedules`` (with embedded
personas) and writes ``scheduled_posts`` to Supabase via PostgREST using the
service role. Requires explicit SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (no
fallback — repo rule). HTTP calls validated with a mocked ``requests``.
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import fill_schedule as fs

UTC = timezone.utc

ENV = {
    "SUPABASE_URL": "https://supabase.example",
    "SUPABASE_SERVICE_ROLE_KEY": "service-key",
}

SCHEDULE_SELECT = "id,topic"


def _response(status_code=200, json_data=None):
    response = MagicMock()
    response.status_code = status_code
    response.content = b"x" if json_data is not None else b""
    response.json.return_value = json_data if json_data is not None else {}
    response.raise_for_status.return_value = None
    return response


class StoreEnvTests(unittest.TestCase):
    def test_missing_url_raises_explicitly(self):
        with patch.dict(os.environ, {k: "" for k in ENV}, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                fs.ScheduleStore()
        self.assertIn("SUPABASE_URL", str(ctx.exception))

    def test_missing_service_key_raises_explicitly(self):
        env = {"SUPABASE_URL": ENV["SUPABASE_URL"], "SUPABASE_SERVICE_ROLE_KEY": ""}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(RuntimeError) as ctx:
                fs.ScheduleStore()
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", str(ctx.exception))


class StoreRequestsTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, ENV, clear=True):
            self.store = fs.ScheduleStore(requests_module=MagicMock())
        self.requests = self.store._requests
        self.requests.request.return_value = _response(json_data=[])






    def test_pending_slots_filters_status_and_horizon(self):
        self.store.pending_slots(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        _, url, kwargs = self._last_call()
        self.assertEqual(kwargs["params"]["status"], f"eq.{fs.SLOT_PENDING}")
        self.assertTrue(kwargs["params"]["slot_at"].startswith("lte."))
        self.assertIn("schedules!inner", kwargs["params"]["select"])
        self.assertIn("linkedin_account_ids", kwargs["params"]["select"])
        self.assertEqual(kwargs["params"]["order"], "slot_at.asc")

    def test_slot_select_embeds_personas_for_generate_stage(self):
        # C1: generate() needs the personas embed inside schedules!inner.
        # Without it PostgREST doesn't return personas and EVERY tick fails
        # with "no persona embed" in production (older tests masked this by
        # injecting personas inline in the fixture).
        self.store.pending_slots(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        _, _, kwargs = self._last_call()
        select = kwargs["params"]["select"]
        self.assertIn("personas(", select)
        for field in ("niche", "script_prompt", "language", "video_aspect", "voice_id"):
            self.assertIn(field, select)

    def test_ready_due_slots_embeds_personas_for_notification(self):
        # A mensagem Discord de publish precisa do nome da persona.
        self.store.ready_due_slots(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        _, _, kwargs = self._last_call()
        self.assertIn("personas(", kwargs["params"]["select"])

    def test_generating_slots_requires_task_id(self):
        self.store.generating_slots()
        _, _, kwargs = self._last_call()
        self.assertEqual(kwargs["params"]["status"], f"eq.{fs.SLOT_GENERATING}")
        self.assertEqual(kwargs["params"]["task_id"], "not.is.null")

    def test_generating_slots_embeds_schedule_id(self):
        # The reconciler refunds batch slots under `batch:{scheduleId}` —
        # without the schedule embed the batch path is dead.
        self.store.generating_slots()
        _, _, kwargs = self._last_call()
        self.assertIn("schedules(id)", kwargs["params"]["select"])

    def test_ready_due_slots_filters_due_time(self):
        self.store.ready_due_slots(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))
        _, _, kwargs = self._last_call()
        self.assertEqual(kwargs["params"]["status"], f"eq.{fs.SLOT_READY}")
        self.assertTrue(kwargs["params"]["slot_at"].startswith("lte."))
        self.assertIn("linkedin_account_ids", kwargs["params"]["select"])

    def test_update_slot_patches_by_id(self):
        self.requests.request.return_value = _response(status_code=204)
        self.store.update_slot("slot-1", status="published", published_at="2026-09-07T12:00:00+00:00")
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(url, "https://supabase.example/rest/v1/scheduled_posts")
        self.assertEqual(kwargs["params"]["id"], "eq.slot-1")
        self.assertEqual(kwargs["json"]["status"], "published")


    def test_claim_ready_slot_is_conditional_on_ready(self):
        # C2: atomic claim — only transitions if the slot is still 'ready'.
        # A conditional PATCH (id + status=eq.ready) returns the row if the
        # race is won; returns [] if another worker/publish took the slot.
        self.requests.request.return_value = _response(json_data=[{"id": "slot-1"}])
        claimed = self.store.claim_ready_slot("slot-1")
        self.assertTrue(claimed)
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(kwargs["params"]["id"], "eq.slot-1")
        self.assertEqual(kwargs["params"]["status"], "eq.ready")
        self.assertEqual(kwargs["json"]["status"], "publishing")
        self.assertIn("representation", kwargs["headers"]["Prefer"])

    def test_claim_ready_slot_returns_false_when_lost(self):
        # Slot already claimed (or published) → PostgREST returns [].
        self.requests.request.return_value = _response(json_data=[])
        self.assertFalse(self.store.claim_ready_slot("slot-1"))

    def test_recover_stale_publishing_slots(self):
        # Stuck 'publishing' slots (engine died mid-publish) older than the
        # timeout go back to 'ready' for a safe retry.
        self.requests.request.return_value = _response(status_code=204)
        count = self.store.recover_stale_publishing(older_than_minutes=30)
        self.assertEqual(count, 0)  # PATCH returns no rows without representation
        method, url, kwargs = self._last_call()
        self.assertEqual(method, "PATCH")
        self.assertEqual(kwargs["params"]["status"], "eq.publishing")
        self.assertIn("updated_at", kwargs["params"])
        self.assertEqual(kwargs["json"]["status"], "ready")

    def test_publishing_slots_lists_claimed(self):
        self.requests.request.return_value = _response(
            json_data=[{"id": "slot-9", "status": "publishing"}]
        )
        rows = self.store.publishing_slots()
        self.assertEqual([r["id"] for r in rows], ["slot-9"])
        _, _, kwargs = self._last_call()
        self.assertEqual(kwargs["params"]["status"], "eq.publishing")

    def test_signed_url_posts_to_storage_sign(self):
        self.requests.post.return_value = _response(json_data={"signedURL": "/object/sign/personas/x?token=t"})
        url = self.store.signed_url("personas", "user-1/foto.png")
        self.assertTrue(url.startswith("https://supabase.example/storage/v1/object/sign/"))
        post_kwargs = self.requests.post.call_args
        self.assertIn("/storage/v1/object/sign/personas/user-1/foto.png", post_kwargs.args[0])
        self.assertEqual(post_kwargs.kwargs["json"]["expiresIn"], fs.SIGNED_URL_EXPIRES_SECONDS)

    def test_non_dict_rows_filtered(self):
        self.requests.request.return_value = _response(json_data=[{"id": "s1"}, "junk", 42])
        slots = self.store.pending_slots(datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc))
        self.assertEqual(len(slots), 1)

    def _last_call(self):
        call = self.requests.request.call_args
        args = call.args
        return args[0], args[1], call.kwargs


class GenerationHorizonTests(unittest.TestCase):
    """Configurable generation horizon — Modal batch cost control.

    Default 24h = generate on the eve (1 nightly batch). Larger values
    generate earlier; idle days outside the horizon never cost GPU.
    """

    def test_default_horizon_is_24h(self):
        from app.config import config as app_config

        original = app_config.app.get("fill_schedule_generation_horizon_hours")
        app_config.app.pop("fill_schedule_generation_horizon_hours", None)
        try:
            self.assertEqual(fs.ScheduleStore.generation_horizon_hours(), 24)
        finally:
            if original is not None:
                app_config.app["fill_schedule_generation_horizon_hours"] = original

    def test_horizon_read_from_config(self):
        from app.config import config as app_config

        original = app_config.app.get("fill_schedule_generation_horizon_hours")
        app_config.app["fill_schedule_generation_horizon_hours"] = 48
        try:
            self.assertEqual(fs.ScheduleStore.generation_horizon_hours(), 48)
        finally:
            if original is None:
                app_config.app.pop("fill_schedule_generation_horizon_hours", None)
            else:
                app_config.app["fill_schedule_generation_horizon_hours"] = original

    def test_pending_slots_horizon_uses_config_value(self):
        env = dict(ENV)
        with patch.dict(os.environ, env, clear=True):
            store = fs.ScheduleStore(requests_module=MagicMock())
        store._requests.request.return_value = _response(json_data=[])
        from app.config import config as app_config

        original = app_config.app.get("fill_schedule_generation_horizon_hours")
        app_config.app["fill_schedule_generation_horizon_hours"] = 1
        try:
            store.pending_slots(datetime(2026, 9, 6, 12, 0, tzinfo=UTC))
        finally:
            if original is None:
                app_config.app.pop("fill_schedule_generation_horizon_hours", None)
            else:
                app_config.app["fill_schedule_generation_horizon_hours"] = original
        kwargs = self._pair(store)[1]
        slot_at = kwargs["params"]["slot_at"]
        # 12:00 + 1h de horizonte → limite 13:00 do mesmo dia
        self.assertEqual(slot_at, "lte.2026-09-06T13:00:00+00:00")

    @staticmethod
    def _pair(store):
        call = store._requests.request.call_args
        return call.args[1], call.kwargs


if __name__ == "__main__":
    unittest.main()


class OneOffSlotsTests(unittest.TestCase):
    """One-off schedule slots: dispatched immediately, ignoring the horizon.

    Discriminator (no schema change): the joined schedule carries
    scheduled_at (batch schedules leave it NULL).
    """

    def setUp(self):
        with patch.dict(os.environ, ENV, clear=True):
            self.store = fs.ScheduleStore(requests_module=MagicMock())
        self.requests = self.store._requests
        self.requests.request.return_value = _response(json_data=[])

    def _last_call(self):
        call = self.requests.request.call_args
        return call.args[0], call.args[1], call.kwargs

    def test_slot_select_includes_scheduled_at_and_bluesky_account_ids(self):
        self.assertIn("scheduled_at", fs.ScheduleStore.SLOT_SELECT)
        self.assertIn("bluesky_account_ids", fs.ScheduleStore.SLOT_SELECT)

    def test_pending_oneoff_slots_filters_null_topic_schedules_not_null(self):
        self.store.pending_oneoff_slots()
        _, _, kwargs = self._last_call()
        params = kwargs["params"]
        self.assertEqual(params["status"], f"eq.{fs.SLOT_PENDING}")
        self.assertEqual(params["schedules.scheduled_at"], "not.is.null")
        # No horizon filter: one-off slots dispatch at creation, however
        # far out their slot_at is.
        self.assertNotIn("slot_at", params)

    def test_pending_oneoff_slots_returns_rows(self):
        rows = [{"id": "slot-1", "topic": "T"}]
        self.requests.request.return_value = _response(json_data=rows)
        self.assertEqual(self.store.pending_oneoff_slots(), rows)
