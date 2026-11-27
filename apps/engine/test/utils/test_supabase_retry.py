"""Tests for the shared Supabase retry session (app/utils/supabase_retry.py)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.utils import supabase_retry


class RetryShapeTests(unittest.TestCase):
    def test_retries_connect_failures_only(self):
        session = supabase_retry.build_retrying_session()
        retry = session.get_adapter("https://supabase.example").max_retries
        self.assertEqual(retry.connect, supabase_retry.CONNECT_RETRIES)
        self.assertIs(retry.read, False)
        self.assertEqual(retry.other, 0)
        self.assertEqual(retry.total, supabase_retry.CONNECT_RETRIES)
        self.assertEqual(retry.backoff_factor, supabase_retry.CONNECT_RETRY_BACKOFF_SECONDS)

    def test_no_status_retries(self):
        session = supabase_retry.build_retrying_session()
        retry = session.get_adapter("https://supabase.example").max_retries
        self.assertFalse(retry.status_forcelist)

    def test_mounts_both_schemes(self):
        session = supabase_retry.build_retrying_session()
        for url in ("https://supabase.example", "http://127.0.0.1:54321"):
            retry = session.get_adapter(url).max_retries
            self.assertEqual(
                retry.connect,
                supabase_retry.CONNECT_RETRIES,
                f"{url} is not using the retrying adapter",
            )

    def test_count_zero_disarms(self):
        session = supabase_retry.build_retrying_session()
        supabase_retry.set_retry_budget(session, 0)
        retry = session.get_adapter("https://supabase.example").max_retries
        self.assertEqual(retry.total, 0)
        self.assertEqual(retry.connect, 0)


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
        import requests

        session = requests.Session()
        supabase_retry.set_retry_budget(session, 1)
        self.assertEqual(session.get_adapter("https://supabase.example").max_retries.connect, 1)


if __name__ == "__main__":
    unittest.main()