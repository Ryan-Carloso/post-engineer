"""Clone materialization failures and the store factory."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services.cloned_voices import materialize as materialize_module
from app.services.cloned_voices.materialize import materialize_clone
from app.services.cloned_voices.store import ClonedVoiceStore

_KEY = "u0123456789ab_0123456789ab"


def _params() -> dict[str, str]:
    return {"voice_name": f"chatterbox_nano:{_KEY}"}


def _store(
    row: Any, wav: bytes = b"RIFF-wav"
) -> SimpleNamespace:
    return SimpleNamespace(
        get_ready_by_engine_voice_key=lambda key: row,
        download_reference_wav=lambda storage_path: wav,
    )


def test_materialize_rejects_a_row_that_is_not_a_dict(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="not a ready cloned_voices row"):
        materialize_clone(_params(), tmp_path, _store(["not-a-dict"]))


def test_materialize_rejects_a_row_without_a_storage_path(
    tmp_path: Path,
) -> None:
    with pytest.raises(RuntimeError, match="has no storage_path"):
        materialize_clone(_params(), tmp_path, _store({"language": "en"}))


def test_materialize_rejects_an_empty_download(tmp_path: Path) -> None:
    store = _store(
        {"storage_path": "user/cloned-voices/c/reference.wav", "language": "en"},
        b"",
    )
    with pytest.raises(RuntimeError, match="download was empty"):
        materialize_clone(_params(), tmp_path, store)


def test_store_factory_builds_a_store_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://supabase.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    store = materialize_module._store()
    assert isinstance(store, ClonedVoiceStore)
    assert store._base_url == "https://supabase.example"
