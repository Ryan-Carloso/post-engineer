"""siglip_model: the visual verifier's model files, fetched once and checked.

Production mounts only config.toml, so the model cannot ship in the image
or in the repo. The engine downloads the pinned files into the directory
of `material_verification_model_path` (a persisted volume) and checks each
SHA-256 before the file is ever opened by onnxruntime. Tests inject the
fetcher: nothing here touches the network.
"""

import hashlib
import json
import os
import threading

import pytest

from app.services import siglip_model
from app.services.siglip_scorer import VerificationUnavailable


def _spec(name: str, body: bytes) -> siglip_model.ModelFile:
    return siglip_model.ModelFile(
        name=name,
        remote_path=f"onnx/{name}" if name.endswith(".onnx") else name,
        sha256=hashlib.sha256(body).hexdigest(),
        size=len(body),
    )


@pytest.fixture
def files(monkeypatch):
    bodies = {
        siglip_model.MODEL_FILE: b"onnx-bytes",
        "tokenizer.json": b"{}",
        "tokenizer_config.json": b"{}",
        "preprocessor_config.json": b"{}",
    }
    monkeypatch.setattr(
        siglip_model, "FILES", tuple(_spec(n, b) for n, b in bodies.items())
    )
    return bodies


class _Fetcher:
    def __init__(self, bodies, corrupt=()):
        self.bodies = bodies
        self.corrupt = set(corrupt)
        self.urls = []

    def __call__(self, url, dest_path):
        self.urls.append(url)
        name = os.path.basename(url.split("?")[0])
        body = self.bodies[name]
        if name in self.corrupt:
            body = b"tampered" + body
        with open(dest_path, "wb") as handle:
            handle.write(body)


def test_pinned_revision_and_urls():
    assert len(siglip_model.REVISION) == 40
    names = {f.name for f in siglip_model.FILES}
    assert names == {siglip_model.MODEL_FILE, "tokenizer.json", "tokenizer_config.json", "preprocessor_config.json"}
    for spec in siglip_model.FILES:
        url = siglip_model.file_url(spec)
        assert url.startswith("https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/")
        assert siglip_model.REVISION in url
        assert len(spec.sha256) == 64


def test_missing_files_are_downloaded_next_to_the_model(tmp_path, files):
    fetch = _Fetcher(files)
    model_path = str(tmp_path / "siglip" / siglip_model.MODEL_FILE)
    siglip_model.ensure_model(model_path, fetch=fetch)
    assert len(fetch.urls) == 4
    for name, body in files.items():
        assert (tmp_path / "siglip" / name).read_bytes() == body
    assert not [p for p in (tmp_path / "siglip").iterdir() if p.name.endswith(".part")]


def test_present_files_are_not_downloaded_again(tmp_path, files):
    model_path = str(tmp_path / siglip_model.MODEL_FILE)
    siglip_model.ensure_model(model_path, fetch=_Fetcher(files))
    again = _Fetcher(files)
    siglip_model.ensure_model(model_path, fetch=again)
    assert again.urls == []


def test_a_truncated_file_is_downloaded_again(tmp_path, files):
    model_path = str(tmp_path / siglip_model.MODEL_FILE)
    siglip_model.ensure_model(model_path, fetch=_Fetcher(files))
    (tmp_path / "tokenizer.json").write_bytes(b"")
    again = _Fetcher(files)
    siglip_model.ensure_model(model_path, fetch=again)
    assert [os.path.basename(u) for u in again.urls] == ["tokenizer.json"]
    assert (tmp_path / "tokenizer.json").read_bytes() == b"{}"


def test_a_file_with_the_wrong_hash_is_never_kept(tmp_path, files):
    model_path = str(tmp_path / siglip_model.MODEL_FILE)
    with pytest.raises(VerificationUnavailable):
        siglip_model.ensure_model(model_path, fetch=_Fetcher(files, corrupt={"tokenizer.json"}))
    assert not (tmp_path / "tokenizer.json").exists()
    assert not (tmp_path / "tokenizer.json.part").exists()


def test_a_failed_part_cleanup_is_swallowed(tmp_path, files, monkeypatch):
    # The finally-block cleanup must never mask the download failure: if
    # removing the .part file raises, the original VerificationUnavailable
    # still surfaces and the .part file is simply left behind.
    calls = []

    def boom(path):
        calls.append(path)
        raise OSError("read-only model volume")

    monkeypatch.setattr(os, "remove", boom)
    model_path = str(tmp_path / "siglip" / siglip_model.MODEL_FILE)
    with pytest.raises(VerificationUnavailable):
        siglip_model.ensure_model(model_path, fetch=_Fetcher(files, corrupt={siglip_model.MODEL_FILE}))
    part_path = tmp_path / "siglip" / (siglip_model.MODEL_FILE + ".part")
    assert calls == [str(part_path)]
    assert part_path.exists()
    assert not (tmp_path / "siglip" / siglip_model.MODEL_FILE).exists()


def test_a_failing_download_is_reported_as_unavailable_without_leaking_the_path(tmp_path, files):
    def boom(url, dest_path):
        raise OSError(f"disk full writing {dest_path}")

    model_path = str(tmp_path / siglip_model.MODEL_FILE)
    with pytest.raises(VerificationUnavailable) as caught:
        siglip_model.ensure_model(model_path, fetch=boom)
    assert str(tmp_path) not in str(caught.value)


def test_an_operator_managed_model_file_is_left_alone(tmp_path, files):
    fetch = _Fetcher(files)
    siglip_model.ensure_model(str(tmp_path / "my-own-model.onnx"), fetch=fetch)
    assert fetch.urls == []


def test_an_empty_model_path_is_unavailable(files):
    with pytest.raises(VerificationUnavailable):
        siglip_model.ensure_model("", fetch=_Fetcher(files))


def test_concurrent_callers_download_once(tmp_path, files):
    model_path = str(tmp_path / siglip_model.MODEL_FILE)
    fetch = _Fetcher(files)
    threads = [
        threading.Thread(target=siglip_model.ensure_model, args=(model_path,), kwargs={"fetch": fetch})
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(fetch.urls) == 4


def test_warm_does_nothing_when_verification_is_off(monkeypatch, tmp_path):
    monkeypatch.setitem(siglip_model.config.app, "material_verification_enabled", False)
    monkeypatch.setitem(siglip_model.config.app, "material_verification_model_path", str(tmp_path / siglip_model.MODEL_FILE))
    called = []
    monkeypatch.setattr(siglip_model, "ensure_model", lambda path, fetch=None: called.append(path))
    siglip_model.warm()
    assert called == []


def test_warm_fetches_the_model_when_verification_is_on(monkeypatch, tmp_path):
    path = str(tmp_path / siglip_model.MODEL_FILE)
    monkeypatch.setitem(siglip_model.config.app, "material_verification_enabled", True)
    monkeypatch.setitem(siglip_model.config.app, "material_verification_model_path", path)
    called = []
    monkeypatch.setattr(siglip_model, "ensure_model", lambda p, fetch=None: called.append(p))
    siglip_model.warm()
    assert called == [path]


def test_warm_never_stops_the_boot_when_makedirs_fails(monkeypatch, tmp_path):
    # Regression: warm() only caught VerificationUnavailable, but
    # ensure_model's os.makedirs (and a getsize race in _present) raise
    # OSError, which stopped the boot despite the "never stops the boot"
    # contract in asgi.py and in warm()'s own docstring.
    monkeypatch.setitem(siglip_model.config.app, "material_verification_enabled", True)
    monkeypatch.setitem(siglip_model.config.app, "material_verification_model_path", str(tmp_path / "siglip" / siglip_model.MODEL_FILE))

    def fail(path, fetch=None):
        raise OSError("read-only model volume")

    monkeypatch.setattr(siglip_model, "ensure_model", fail)
    siglip_model.warm()  # must not raise


def test_a_model_directory_os_error_is_unavailable_not_a_crash(monkeypatch, tmp_path, files):
    def boom(path, exist_ok=False):
        raise OSError("read-only volume")

    monkeypatch.setattr(os, "makedirs", boom)
    model_path = str(tmp_path / "siglip" / siglip_model.MODEL_FILE)
    with pytest.raises(VerificationUnavailable) as caught:
        siglip_model.ensure_model(model_path, fetch=_Fetcher(files))
    assert str(tmp_path) not in str(caught.value)


def test_warm_never_stops_the_boot_when_the_download_fails(monkeypatch, tmp_path):
    monkeypatch.setitem(siglip_model.config.app, "material_verification_enabled", True)
    monkeypatch.setitem(siglip_model.config.app, "material_verification_model_path", str(tmp_path / siglip_model.MODEL_FILE))

    def fail(path, fetch=None):
        raise VerificationUnavailable("offline")

    monkeypatch.setattr(siglip_model, "ensure_model", fail)
    siglip_model.warm()  # must not raise


def test_boot_hook_warms_the_model():
    source = open(os.path.join(os.path.dirname(__file__), "..", "..", "app", "asgi.py"), encoding="utf-8").read()
    assert "siglip_model.warm()" in source


def test_pinned_hashes_match_the_published_list():
    # The model file hash is the one Hugging Face publishes for the pinned revision.
    model = next(f for f in siglip_model.FILES if f.name == siglip_model.MODEL_FILE)
    assert model.sha256 == "35083107956da5d1c7a95e30fe89e19a1589c36dc940b75725200a5e72a37b03"
    assert model.size == 217965403
    json.dumps([f.sha256 for f in siglip_model.FILES])
