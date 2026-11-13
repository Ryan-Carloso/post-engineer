"""ScheduleStore.persona_bound_accounts (issue #572).

Direct unit tests for the binding read: the generate pre-flight proves
every scheduled account against this map, so the read must group rows
per provider, query only the persona's rows, and ignore malformed rows
instead of crashing the tick.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.fill_schedule.store import ScheduleStore


class _FakeResponse:
    def __init__(self, rows):
        self._rows = rows
        self.status_code = 200
        self.content = b"[...]"

    def raise_for_status(self):
        return None

    def json(self):
        return self._rows


class _FakeRequests:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def request(self, method, url, headers=None, timeout=None, **kwargs):
        self.calls.append({"method": method, "url": url, "params": kwargs.get("params")})
        return _FakeResponse(self.rows)


def _store(rows):
    store = ScheduleStore.__new__(ScheduleStore)
    store._requests = _FakeRequests(rows)
    store._base_url = "https://supabase.example"
    store._headers = {}
    return store


class PersonaBoundAccountsTests(unittest.TestCase):
    def test_groups_rows_per_provider(self):
        store = _store(
            [
                {"provider": "youtube", "provider_account_id": "yt-1"},
                {"provider": "youtube", "provider_account_id": "yt-2"},
                {"provider": "instagram", "provider_account_id": "ig-1"},
            ]
        )
        self.assertEqual(
            store.persona_bound_accounts("persona-1"),
            {"youtube": ["yt-1", "yt-2"], "instagram": ["ig-1"]},
        )

    def test_queries_only_the_persona_rows(self):
        store = _store([])
        store.persona_bound_accounts("persona-1")
        call = store._requests.calls[0]
        self.assertEqual(call["method"], "GET")
        self.assertTrue(call["url"].endswith("/rest/v1/persona_default_accounts"))
        self.assertEqual(call["params"]["persona_id"], "eq.persona-1")

    def test_returns_an_empty_map_when_nothing_is_bound(self):
        self.assertEqual(_store([]).persona_bound_accounts("persona-1"), {})

    def test_skips_malformed_rows(self):
        store = _store(
            [
                {"provider": "youtube", "provider_account_id": "yt-1"},
                "not a row",
                {"provider": "youtube"},
                {"provider": "youtube", "provider_account_id": ""},
                {"provider": 42, "provider_account_id": "yt-2"},
                {"provider_account_id": "yt-3"},
            ]
        )
        self.assertEqual(store.persona_bound_accounts("persona-1"), {"youtube": ["yt-1"]})


if __name__ == "__main__":
    unittest.main()
