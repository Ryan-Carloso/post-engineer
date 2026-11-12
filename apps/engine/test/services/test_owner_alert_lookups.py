"""Owner-alert lookups: labels pinned to the web, best-effort display names."""

import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.owner_alert_lookups import (
    PROVIDER_LABELS,
    lookup_account_names,
    lookup_persona_name,
    provider_label,
)


class _Response:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


class _Session:
    def __init__(self, accounts=None, schedules=None, status=200):
        self.calls = []
        self.accounts = accounts if accounts is not None else []
        self.schedules = schedules if schedules is not None else []
        self.status = status

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if "/rest/v1/social_accounts" in url:
            return _Response(self.status, self.accounts)
        if "/rest/v1/schedules" in url:
            return _Response(self.status, self.schedules)
        raise AssertionError(url)

    def close(self):
        self.calls.append(("close", "", {}))


ENV = {
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-test",
}


def _repo_root() -> Path:
    # Walk up instead of counting parents: mutmut runs the suite from a
    # copied tree (mutants/), which shifts every fixed parent index.
    for parent in Path(__file__).resolve().parents:
        if (parent / "apps/web/lib/account-options.ts").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


class ProviderLabelTests(unittest.TestCase):
    def test_labels_match_the_web_source_of_truth(self):
        text = (_repo_root() / "apps/web/lib/account-options.ts").read_text()
        block = re.search(r"PROVIDER_LABELS[^=]*=\s*\{(.*?)\};", text, re.S)
        self.assertIsNotNone(block)
        pairs = re.findall(r"(?:'([^']+)'|(\w+))\s*:\s*'([^']+)'", block.group(1))
        web = {(quoted or plain): label for quoted, plain, label in pairs}
        self.assertEqual(web, PROVIDER_LABELS)

    def test_unknown_slug_falls_back_to_itself(self):
        self.assertEqual(provider_label("tiktok"), "tiktok")
        self.assertEqual(provider_label("youtube"), "YouTube")


class LookupAccountNamesTests(unittest.TestCase):
    def test_maps_provider_and_account_id_to_the_display_name(self):
        session = _Session(
            accounts=[
                {"provider": "youtube", "provider_account_id": "UC1", "account_name": "Canal X"},
                {"provider": "bluesky", "provider_account_id": "did:plc:1", "account_name": "  "},
                {"provider": "youtube", "provider_account_id": "UC2"},
                {"provider": "youtube", "provider_account_id": "UC3", "account_name": "Canal Z"},
            ]
        )
        with patch.dict(os.environ, ENV, clear=False):
            names = lookup_account_names(session, "user-1")
        self.assertEqual(names, {("youtube", "UC1"): "Canal X", ("youtube", "UC3"): "Canal Z"})

    def test_empty_when_supabase_errors(self):
        session = _Session(status=500)
        with patch.dict(os.environ, ENV, clear=False):
            self.assertEqual(lookup_account_names(session, "user-1"), {})

    def test_empty_for_a_non_list_payload(self):
        session = _Session(accounts="nope")
        with patch.dict(os.environ, ENV, clear=False):
            self.assertEqual(lookup_account_names(session, "user-1"), {})

    def test_no_http_without_a_session_under_the_test_suite(self):
        with patch("requests.Session", side_effect=AssertionError("opened")):
            self.assertEqual(lookup_account_names(None, "user-1"), {})

    def test_opens_its_own_session_outside_the_test_suite(self):
        session = _Session(
            accounts=[{"provider": "rumble", "provider_account_id": "ch1", "account_name": "Rumble 1"}]
        )
        with (
            patch("app.services.owner_alert_lookups.running_under_test", return_value=False),
            patch("requests.Session", return_value=session),
            patch.dict(os.environ, ENV, clear=False),
        ):
            names = lookup_account_names(None, "user-1")
        self.assertEqual(names, {("rumble", "ch1"): "Rumble 1"})
        self.assertIn(("close", "", {}), session.calls)

    def test_skips_when_supabase_is_not_configured(self):
        session = _Session()
        with patch.dict(
            os.environ, {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}, clear=False
        ):
            self.assertEqual(lookup_account_names(session, "user-1"), {})
        self.assertEqual(session.calls, [])


class LookupPersonaNameTests(unittest.TestCase):
    def test_reads_the_embedded_persona(self):
        session = _Session(schedules=[{"personas": {"name": "Bicuda"}}])
        with patch.dict(os.environ, ENV, clear=False):
            self.assertEqual(lookup_persona_name(session, "schedule-1"), "Bicuda")

    def test_none_when_the_persona_is_gone(self):
        for schedules in ([{"personas": None}], [{"personas": {"name": "  "}}], [], "nope"):
            session = _Session(schedules=schedules)
            with patch.dict(os.environ, ENV, clear=False):
                self.assertIsNone(lookup_persona_name(session, "schedule-1"))

    def test_none_when_supabase_errors(self):
        session = _Session(status=500)
        with patch.dict(os.environ, ENV, clear=False):
            self.assertIsNone(lookup_persona_name(session, "schedule-1"))

    def test_no_http_without_a_session_under_the_test_suite(self):
        with patch("requests.Session", side_effect=AssertionError("opened")):
            self.assertIsNone(lookup_persona_name(None, "schedule-1"))


if __name__ == "__main__":
    unittest.main()
