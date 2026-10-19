"""Unit tests for .github/scripts/select-review-models.py."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
PREFS_PATH = SCRIPTS_DIR.parent / "review" / "model-preferences.json"


def load_module():
    path = SCRIPTS_DIR / "select-review-models.py"
    spec = importlib.util.spec_from_file_location("select_review_models", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["select_review_models"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def mod():
    return load_module()


SAMPLE_OPENCODE_VERBOSE = """opencode/glm-5.3-flash-free
{
  "id": "glm-5.3-flash-free",
  "cost": {"input": 0, "output": 0},
  "limit": {"context": 200000, "output": 32000},
  "capabilities": {"toolcall": true, "input": {"image": false}}
}
opencode/deepseek-v4.1-flash-free
{
  "id": "deepseek-v4.1-flash-free",
  "cost": {"input": 0, "output": 0},
  "limit": {"context": 200000, "output": 32000},
  "capabilities": {"toolcall": true, "input": {"image": false}}
}
opencode/nemotron-3.5-super-vl-free
{
  "id": "nemotron-3.5-super-vl-free",
  "cost": {"input": 0, "output": 0},
  "limit": {"context": 1048576, "output": 131072},
  "capabilities": {"toolcall": false, "input": {"image": true}}
}
opencode/new-discovery-free
{
  "id": "new-discovery-free",
  "cost": {"input": 0, "output": 0},
  "limit": {"context": 500000, "output": 64000},
  "capabilities": {"toolcall": true, "input": {"image": false}}
}
"""


def test_preferred_available_models_keep_rank_order(mod):
    prefs = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    available = mod.parse_opencode_verbose(SAMPLE_OPENCODE_VERBOSE)
    env = {
        "HAS_ZAI_KEY": "false",
        "HAS_OPENROUTER_KEY": "false",
        "REVIEW_MODEL_PRIMARY": "zai-coding-plan/glm-5.3-flash",
        "OPENCODE_MODEL": "zai-coding-plan/glm-5.3-flash",
        "OPENROUTER_MODEL": "z-ai/glm-5.3-flash",
        "OPENROUTER_FREE_MODEL": "openrouter/free",
        "ZAI_FREE_MODEL": "glm-4.7-flash",
    }
    attempts, free_models, _ = mod.build_chain(prefs, available, env)
    assert attempts[0] == "opencode/glm-5.3-flash-free"
    assert attempts[1] == "opencode/deepseek-v4.1-flash-free"
    assert "opencode/new-discovery-free" in attempts
    assert "opencode/nemotron-3.5-super-vl-free" not in attempts
    assert attempts[0] in free_models


def test_missing_preferred_model_is_skipped(mod):
    prefs = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    # beam-free is preferred but not in the sample catalog.
    available = mod.parse_opencode_verbose(SAMPLE_OPENCODE_VERBOSE)
    env = {
        "HAS_ZAI_KEY": "false",
        "HAS_OPENROUTER_KEY": "false",
        "REVIEW_MODEL_PRIMARY": "zai-coding-plan/glm-5.3-flash",
        "OPENCODE_MODEL": "zai-coding-plan/glm-5.3-flash",
        "OPENROUTER_MODEL": "z-ai/glm-5.3-flash",
        "OPENROUTER_FREE_MODEL": "openrouter/free",
        "ZAI_FREE_MODEL": "glm-4.7-flash",
    }
    attempts, _, decisions = mod.build_chain(prefs, available, env)
    assert "opencode/beam-free" not in attempts
    skipped = [d for d in decisions if d.model_id == "opencode/beam-free"]
    assert skipped and not skipped[0].included


def test_openrouter_entries_skipped_without_key(mod):
    prefs = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    available = {
        "openrouter/thinkingmachines/inkling:free": mod.ModelMeta(
            model_id="openrouter/thinkingmachines/inkling:free",
            context=1_000_000,
            max_output=64_000,
            tool_support=True,
        )
    }
    env = {
        "HAS_ZAI_KEY": "false",
        "HAS_OPENROUTER_KEY": "false",
        "REVIEW_MODEL_PRIMARY": "zai-coding-plan/glm-5.3-flash",
        "OPENCODE_MODEL": "zai-coding-plan/glm-5.3-flash",
        "OPENROUTER_MODEL": "z-ai/glm-5.3-flash",
        "OPENROUTER_FREE_MODEL": "openrouter/free",
        "ZAI_FREE_MODEL": "glm-4.7-flash",
    }
    attempts, _, decisions = mod.build_chain(prefs, available, env)
    assert "openrouter/thinkingmachines/inkling:free" not in attempts
    assert any(
        d.model_id == "openrouter/thinkingmachines/inkling:free"
        and "openrouter key missing" in d.reason
        for d in decisions
    )


def test_discovery_failure_uses_static_preferred_list(mod):
    prefs = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    env = {
        "HAS_ZAI_KEY": "false",
        "HAS_OPENROUTER_KEY": "false",
        "REVIEW_MODEL_PRIMARY": "zai-coding-plan/glm-5.3-flash",
        "OPENCODE_MODEL": "zai-coding-plan/glm-5.3-flash",
        "OPENROUTER_MODEL": "z-ai/glm-5.3-flash",
        "OPENROUTER_FREE_MODEL": "openrouter/free",
        "ZAI_FREE_MODEL": "glm-4.7-flash",
    }
    attempts, _, _ = mod.build_chain(prefs, {}, env, discovery_failed=True)
    assert attempts[0] == "opencode/glm-5.3-flash-free"
    assert "opencode/deepseek-v4.1-flash-free" in attempts


def test_chain_override_replaces_discovery(mod, tmp_path):
    prefs = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    env = {
        "HAS_ZAI_KEY": "false",
        "HAS_OPENROUTER_KEY": "false",
        "REVIEW_MODEL_CHAIN_OVERRIDE": "opencode/glm-5.3-flash-free,opencode/deepseek-v4.1-flash-free",
        "REVIEW_MODEL_PRIMARY": "zai-coding-plan/glm-5.3-flash",
        "OPENCODE_MODEL": "zai-coding-plan/glm-5.3-flash",
        "OPENROUTER_MODEL": "z-ai/glm-5.3-flash",
        "OPENROUTER_FREE_MODEL": "openrouter/free",
        "ZAI_FREE_MODEL": "glm-4.7-flash",
    }
    attempts, _, _ = mod.build_chain(prefs, {}, env)
    assert attempts == [
        "opencode/glm-5.3-flash-free",
        "opencode/deepseek-v4.1-flash-free",
    ]


def test_main_writes_chain_file(mod, tmp_path, monkeypatch):
    prefs_copy = tmp_path / "prefs.json"
    prefs_copy.write_text(PREFS_PATH.read_text(encoding="utf-8"), encoding="utf-8")
    out = tmp_path / "chain.json"

    def fake_cli(_argv):
        return 0, SAMPLE_OPENCODE_VERBOSE, ""

    monkeypatch.setenv("HAS_ZAI_KEY", "false")
    monkeypatch.setenv("HAS_OPENROUTER_KEY", "false")
    monkeypatch.setenv("REVIEW_MODEL_PRIMARY", "zai-coding-plan/glm-5.3-flash")
    monkeypatch.setenv("OPENCODE_MODEL", "zai-coding-plan/glm-5.3-flash")
    monkeypatch.setenv("OPENROUTER_MODEL", "z-ai/glm-5.3-flash")
    monkeypatch.setenv("OPENROUTER_FREE_MODEL", "openrouter/free")
    monkeypatch.setenv("ZAI_FREE_MODEL", "glm-4.7-flash")

    monkeypatch.setattr(
        mod,
        "collect_available",
        lambda env, **kwargs: (
            mod.parse_opencode_verbose(SAMPLE_OPENCODE_VERBOSE),
            False,
        ),
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "select-review-models.py",
            "--preferences",
            str(prefs_copy),
            "--output",
            str(out),
        ],
    )
    assert mod.main() == 0
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["attempts"]
    assert payload["freeModels"]
