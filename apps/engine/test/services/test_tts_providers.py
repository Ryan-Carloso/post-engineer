"""Only ElevenLabs and Chatterbox remain as TTS providers.

edge_tts was the Azure v1 transport and the Chatterbox fallback; ElevenLabs,
SiliconFlow, Gemini, MiMo and Azure v2 were the other providers. All of them are
gone. They were not removed for tidiness:

* every one of them could only be reached with a voice id the UI never offers
  (the catalog exposed four house voices that resolved to Azure names), and
* the house voices resolved to Azure v1, so with edge_tts unreachable every
  video died at the `audio` stage after three 30s timeouts.

`SubMaker` survives as a local class — the subtitle carrier, not a transport.

This is a source scan, not a behaviour test: the guarantee is that a removed
provider cannot come back through a new call site.
"""

import ast
import io
import re
import tokenize
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[2] / "app"
VOICE = APP / "services" / "voice.py"

# Symbols that belong to a removed provider. Each one is a function or guard
# that only existed to reach that provider.
REMOVED_SYMBOLS = [
    # edge_tts transport
    "azure_tts_v1",
    "chatterbox_edge_tts_fallback",
    "get_chatterbox_fallback_voice",
    "create_edge_tts_communicate",
    "stream_edge_tts_chunks",
    "_stream_edge_tts_sync_with_timeout",
    "get_edge_tts_timeout_seconds",
    "_build_subtitle_items_from_edge_cues",
    # other providers (ElevenLabs stays: it is one of the two)
    "siliconflow_tts",
    "gemini_tts",
    "mimo_tts",
    "get_siliconflow_voices",
    "get_gemini_voices",
    "get_mimo_voices",
    "is_azure_v2_voice",
    "is_siliconflow_voice",
    "is_gemini_voice",
    "is_mimo_voice",
    "get_all_azure_voices",
    "_load_azure_voices",
]


def _edge_tts_import_or_use() -> list[str]:
    """Every edge_tts touchpoint in app/ — real code, not prose.

    Docstrings and comments legitimately mention edge_tts (they explain why it
    is gone), so a substring scan would flag its own explanation. This walks
    the token stream and only reports imports and attribute accesses in code.
    """
    offenders: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        try:
            tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
        except tokenize.TokenError as exc:  # pragma: no cover - defensive
            offenders.append(f"{path.name}: unparseable ({exc})")
            continue

        imports: set[str] = set()
        for token in tokens:
            if token.type != tokenize.NAME:
                continue
            if token.string == "edge_tts":
                # A NAME token, so this is code — not prose in a docstring,
                # which would have arrived as a STRING token.
                offenders.append(
                    f"{path.name}:{token.start[0]}: edge_tts used in code"
                )
            if token.string == "import":
                imports.add(token.line.strip())
        for statement in imports:
            if statement.startswith(("import edge_tts", "from edge_tts")):
                offenders.append(f"{path.name}: {statement}")
    return offenders


class TestNoEdgeTts:
    def test_app_never_imports_or_calls_edge_tts(self):
        offenders = _edge_tts_import_or_use()
        assert offenders == [], "edge_tts is still wired into the engine: " + "; ".join(
            offenders
        )

    def test_edge_tts_is_not_a_declared_dependency(self):
        pyproject = (VOICE.parents[2] / "pyproject.toml").read_text(encoding="utf-8")
        assert "edge-tts" not in pyproject
        assert "edge_tts" not in pyproject

    def test_subtitle_maker_helpers_are_gone(self):
        """The cues branch was edge_tts-only: no provider ever writes .cues."""
        source = VOICE.read_text(encoding="utf-8")
        assert ".cues" not in source, (
            "only edge_tts populated sub_maker.cues; with the package gone the "
            "branch is dead code"
        )


class TestRemainingProviders:
    def test_submaker_is_a_local_class_not_the_edge_package(self):
        tree = ast.parse(VOICE.read_text(encoding="utf-8"))
        classes = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}
        assert "SubMaker" in classes, (
            "SubMaker must be defined locally in voice.py — it is the subtitle "
            "carrier tts() returns"
        )

    @pytest.mark.parametrize("name", REMOVED_SYMBOLS)
    def test_removed_provider_symbol_is_gone(self, name):
        source = VOICE.read_text(encoding="utf-8")
        assert not re.search(rf"^def {name}\b", source, re.MULTILINE), (
            f"{name} belongs to a removed TTS provider and must not come back"
        )

    def test_azure_voice_catalog_file_is_gone(self):
        """azure_voices.json only existed to validate the Azure provider names."""
        catalog = VOICE.parent / "data" / "azure_voices.json"
        assert not catalog.exists(), (
            "azure_voices.json is unreachable now that both Azure providers are gone"
        )

    def test_tts_only_dispatches_the_two_remaining_providers(self):
        """An unknown voice must fail loudly, not fall through to a provider.

        The old final line was `return azure_tts_v1(...)`: any id the catalog
        did not recognise silently became an edge-tts request. That silent
        fall-through is what made the failure look like a network problem.

        Walks real call nodes, so the log line that NAMES azure_tts_v1 while
        explaining its removal does not count as a call.
        """
        tree = ast.parse(VOICE.read_text(encoding="utf-8"))
        tts_node = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "tts"
        )
        called = {
            child.func.id
            for child in ast.walk(tts_node)
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
        }
        assert {"chatterbox_tts", "elevenlabs_tts"} <= called
        assert "is_no_voice" in called
        assert "is_chatterbox_voice" in called
        assert "is_elevenlabs_voice" in called
        removed = called & {
            "azure_tts_v1",
            "azure_tts_v2",
            "siliconflow_tts",
            "gemini_tts",
            "mimo_tts",
            "chatterbox_edge_tts_fallback",
        }
        assert removed == set(), f"tts() still dispatches to {sorted(removed)}"