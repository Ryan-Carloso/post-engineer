"""Tests for scripts/export_openapi.py — the engine OpenAPI snapshot exporter.

The committed snapshot (apps/engine/openapi.json) feeds the web app's
generated engine types; these tests pin that it is deterministic, carries
the contract (not the deployment's config.toml branding), and that the
--check drift gate fails on a stale file.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.export_openapi import (
    CONTRACT_INFO,
    build_spec,
    check,
    current_spec_text,
    main,
    render,
)

ENGINE_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ENGINE_ROOT / "openapi.json"


def test_build_spec_replaces_info_and_keeps_everything_else():
    raw = {
        "openapi": "3.1.0",
        "info": {"title": "Operator Brand", "version": "9.9.9", "description": "x"},
        "paths": {"/a": {}},
    }

    spec = build_spec(raw)

    assert spec["info"] == CONTRACT_INFO
    assert spec["paths"] == {"/a": {}}
    assert spec["openapi"] == "3.1.0"
    # The input is not mutated (the FastAPI app caches its openapi dict).
    assert raw["info"]["title"] == "Operator Brand"


def test_build_spec_info_is_a_copy_of_the_constant():
    spec = build_spec({"info": {}})
    spec["info"]["title"] = "changed"
    assert CONTRACT_INFO["title"] == "Post Engineer engine"


def test_render_is_sorted_indented_and_newline_terminated():
    text = render({"b": 1, "a": {"d": 2, "c": "ã"}})

    assert text == '{\n  "a": {\n    "c": "ã",\n    "d": 2\n  },\n  "b": 1\n}\n'


def test_check_passes_on_identical_snapshot(tmp_path, capsys):
    path = tmp_path / "openapi.json"
    path.write_text("same\n", encoding="utf-8")

    assert check(path, "same\n") == 0
    assert "up to date" in capsys.readouterr().out


def test_check_fails_on_stale_snapshot(tmp_path, capsys):
    path = tmp_path / "openapi.json"
    path.write_text("old\n", encoding="utf-8")

    assert check(path, "new\n") == 1
    assert "is stale" in capsys.readouterr().err


def test_check_fails_when_snapshot_is_missing(tmp_path, capsys):
    assert check(tmp_path / "missing.json", "x\n") == 1
    assert "does not exist" in capsys.readouterr().err


def test_main_out_writes_the_given_text(tmp_path):
    out = tmp_path / "openapi.json"

    assert main(["--out", str(out)], spec_text="{}\n") == 0
    assert out.read_text(encoding="utf-8") == "{}\n"


def test_main_check_reports_drift(tmp_path):
    path = tmp_path / "openapi.json"
    path.write_text("{}\n", encoding="utf-8")

    assert main(["--check", str(path)], spec_text="{}\n") == 0
    assert main(["--check", str(path)], spec_text='{"a": 1}\n') == 1


def test_main_requires_exactly_one_mode():
    with pytest.raises(SystemExit):
        main([], spec_text="{}\n")
    with pytest.raises(SystemExit):
        main(["--out", "a", "--check", "b"], spec_text="{}\n")


def test_live_spec_is_deterministic_and_carries_the_contract():
    text = current_spec_text()

    assert text == current_spec_text()
    spec = json.loads(text)
    assert spec["info"] == CONTRACT_INFO
    assert "/api/v1/videos" in spec["paths"]
    assert "TaskVideoRequest" in spec["components"]["schemas"]
    assert "PersonaParams" in spec["components"]["schemas"]


def test_committed_snapshot_matches_the_live_contract():
    """The drift gate: a model/route change must ship a regenerated snapshot."""
    assert SNAPSHOT.read_text(encoding="utf-8") == current_spec_text(), (
        "apps/engine/openapi.json is stale — run "
        "`uv run python -m scripts.export_openapi --out openapi.json` from apps/engine"
    )
