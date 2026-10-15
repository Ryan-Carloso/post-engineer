"""Fail-fast guard for unknown llm_provider names (issue #159).

Lives in its own module because test_llm.py is grandfathered over the
file-size cap and may not grow.
"""

import inspect
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import llm


class TestUnknownLlmProvider(unittest.TestCase):
    def test_unknown_provider_error_lists_supported_providers(self):
        """The error message must list every supported provider name."""
        with self.assertRaises(ValueError) as ctx:
            llm._generate_response_inner("Say hello", "omnirout")
        message = str(ctx.exception)
        self.assertIn("supported providers:", message)
        for provider in llm.SUPPORTED_LLM_PROVIDERS:
            self.assertIn(provider, message)

    def test_unknown_provider_never_raises_unbound_local_error(self):
        """Regression: an unknown provider must never surface as UnboundLocalError."""
        try:
            llm._generate_response_inner("Say hello", "omnirout")
        except UnboundLocalError:
            self.fail("unknown llm_provider must not raise UnboundLocalError")
        except ValueError:
            pass  # the expected clear error

    def test_supported_providers_match_dispatch_chain(self):
        """
        SUPPORTED_LLM_PROVIDERS is the single source of truth shared by the
        fail-fast guard and its error message. The dispatch chain must handle
        exactly these names so the two cannot drift apart.
        """
        source = inspect.getsource(llm._generate_response_inner)
        dispatched = set(re.findall(r'llm_provider == "([\w]+)"', source))
        self.assertEqual(dispatched, set(llm.SUPPORTED_LLM_PROVIDERS))
