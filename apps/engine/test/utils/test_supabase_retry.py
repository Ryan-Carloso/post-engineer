"""Tests for the shared Supabase retry session (app/utils/supabase_retry.py)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.utils import supabase_retry


class RetryShapeTests(unittest.TestCase):
    def test_retries_connect_failures_only(self):
        # A connect failure happens before the request reaches Supabase, so
        # retrying it is safe for the token RPC POSTs. A read failure can come
        # after Supabase applied the POST, so it must never retry.
        session = supabase_retry.build_retrying_session()
        retry = session.get_adapter("https://supabase.example").max_retries
        self.assertEqual(retry.connect, supabase_retry.CONNECT_RETRIES)
        self.assertIs(retry.read, False)
        # other=0: SSL/header errors are not connection failures and must not
        # be retried either. urllib3 excludes 0 from the exhausted check but
        # decrements it to -1 on the first occurrence, which does exhaust.
        self.assertEqual(retry.other, 0)
        self.assertEqual(retry.total, supabase_retry.CONNECT_RETRIES)
        self.assertEqual(retry.backoff_factor, supabase_retry.CONNECT_RETRY_BACKOFF_SECONDS)

    def test_no_status_retries(self):
        # A 5xx on a POST RPC is not safe to retry blindly: the policy is
        # connect-phase failures only. status_forcelist must stay empty.
        session = supabase_retry.build_retrying_session()
        retry = session.get_adapter("https://supabase.example").max_retries
        self.assertFalse(retry.status_forcelist)

    def test_mounts_both_schemes(self):
        # Supabase is https in production, but the engine's own tests and
        # self-hosters behind a proxy can use http. An unmounted prefix would
        # silently fall back to no retries.
        session = supabase_retry.build_retrying_session()
        for url in ("https://supabase.example", "http://127.0.0.1:54321"):
            retry = session.get_adapter(url).max_retries
            self.assertEqual(
                retry.connect,
                supabase_retry.CONNECT_RETRIES,
                f"{url} is not using the retrying adapter",
            )

    def test_count_zero_disarms(self):
        # The scheduler's fail-fast state for the rest of a tick.
        session = supabase_retry.build_retrying_session()
        supabase_retry.set_retry_budget(session, 0)
        retry = session.get_adapter("https://supabase.example").max_retries
        self.assertEqual(retry.total, 0)
        self.assertEqual(retry.connect, 0)


class WorstCaseTests(unittest.TestCase):
    """The bound that keeps state.py's update_task lock bounded.

    These assert the function's own output (never a formula re-derived here),
    so fixing the function cannot leave a stale copy of the wrong arithmetic
    here claiming to be correct.
    """

    def test_sleep_schedule_matches_urllib3(self):
        # Measured against urllib3 2.x: count=2 sleeps 0 then
        # backoff_factor * 2**1 = 1.0, i.e. 1.0 total — NOT the 0.5 a naive
        # "one backoff period" reading gives.
        self.assertEqual(supabase_retry.retry_sleep_seconds(1), 0.0)
        self.assertEqual(supabase_retry.retry_sleep_seconds(2), 1.0)
        self.assertEqual(supabase_retry.retry_sleep_seconds(3), 3.0)

    def test_counts_every_attempt(self):
        # `count` retries means count+1 attempts, each able to burn the whole
        # connect timeout. The old formula used count, understating the bound
        # by a full connect timeout.
        connect, read = 3, 10
        self.assertEqual(
            supabase_retry.worst_case_seconds(connect, read),
            max((supabase_retry.CONNECT_RETRIES + 1) * connect + 1.0, read),
        )

    def test_store_timeout_uses_the_read_bound(self):
        self.assertEqual(supabase_retry.worst_case_seconds(10, 30), 31.0)

    def test_state_call_stays_at_the_pre_retry_ceiling(self):
        # The invariant state.py's comment depends on: (3, 10) must not exceed
        # the 10s the flat timeout=10 used to guarantee.
        self.assertLessEqual(supabase_retry.worst_case_seconds(3, 10), 10)
        self.assertEqual(supabase_retry.worst_case_seconds(3, 10), 10.0)

    def test_connect_five_would_break_the_state_ceiling(self):
        # Pins why connect stays at 3s: 5s overshoots the ceiling, so raising
        # it requires revisiting the budget first.
        self.assertGreater(supabase_retry.worst_case_seconds(5, 10), 10)


class RetryBudgetSwapTests(unittest.TestCase):
    """set_retry_budget must not cost a pooled connection.

    The scheduler re-arms the budget at the top of every tick; if that swap
    replaced the adapter, every re-arm would discard the PoolManager and force
    a fresh TCP+TLS handshake on the next call.
    """

    def test_pool_survives_a_rearm(self):
        session = supabase_retry.build_retrying_session()
        adapter_before = session.get_adapter("https://supabase.example")
        pool_before = adapter_before.poolmanager

        supabase_retry.set_retry_budget(session, supabase_retry.CONNECT_RETRIES)

        adapter_after = session.get_adapter("https://supabase.example")
        self.assertIs(adapter_after, adapter_before, "re-arm replaced the adapter")
        self.assertIs(adapter_after.poolmanager, pool_before, "re-arm dropped the pool")

    def test_pool_survives_a_disarm(self):
        session = supabase_retry.build_retrying_session()
        pool_before = session.get_adapter("https://supabase.example").poolmanager
        supabase_retry.set_retry_budget(session, 0)
        self.assertIs(session.get_adapter("https://supabase.example").poolmanager, pool_before)

    def test_budget_change_is_visible_to_both_schemes(self):
        session = supabase_retry.build_retrying_session()
        supabase_retry.set_retry_budget(session, 0)
        for url in ("https://supabase.example", "http://127.0.0.1:54321"):
            self.assertEqual(
                session.get_adapter(url).max_retries.connect,
                0,
                f"{url} kept the old retry budget",
            )

    def test_unmounted_session_still_gets_a_budget(self):
        # A hand-built session has no adapters; the swap must mount one
        # rather than silently leaving the default (no connect retries).
        import requests

        session = requests.Session()
        supabase_retry.set_retry_budget(session, 1)
        self.assertEqual(session.get_adapter("https://supabase.example").max_retries.connect, 1)


if __name__ == "__main__":
    unittest.main()