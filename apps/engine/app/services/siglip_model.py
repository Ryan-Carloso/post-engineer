"""The visual verifier's model files, fetched once and checked before use.

Production mounts only config.toml, so the SigLIP model can ship neither in
the image nor in the repo. The engine downloads four pinned files into the
directory of `material_verification_model_path` (a persisted volume) and
checks each SHA-256 before onnxruntime ever opens it. A model path whose
file name is not MODEL_FILE is operator-managed and left alone.

Source: Xenova/siglip-base-patch16-224 (ONNX export of Google's Apache-2.0
siglip-base-patch16-224), pinned to one revision. Scores are tied to this
export: recalibrate the thresholds in config when it changes.
"""

import hashlib
import os
import threading
from dataclasses import dataclass
from typing import Callable, Optional

import requests
from loguru import logger

from app.config import config
from app.services.siglip_scorer import VerificationUnavailable

REPO = "Xenova/siglip-base-patch16-224"
REVISION = "4649052661e53c7000355844105f8a1792088239"
MODEL_FILE = "model_q4.onnx"
DOWNLOAD_TIMEOUT = (10, 120)
_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class ModelFile:
    name: str
    remote_path: str
    sha256: str
    size: int


FILES = (
    ModelFile(
        MODEL_FILE,
        f"onnx/{MODEL_FILE}",
        "35083107956da5d1c7a95e30fe89e19a1589c36dc940b75725200a5e72a37b03",
        217965403,
    ),
    ModelFile(
        "tokenizer.json",
        "tokenizer.json",
        "4a17c975210be5ab4c36b47d8dae4eefb866dbfb1e676e394aad85dc30a3ae08",
        2398744,
    ),
    ModelFile(
        "tokenizer_config.json",
        "tokenizer_config.json",
        "9a38d3c6b5e26fe5dcc607eda95e38d78d30d9291835bb9e8116e8174c1d4ba2",
        739,
    ),
    ModelFile(
        "preprocessor_config.json",
        "preprocessor_config.json",
        "21ee046a8a52a65e5f9c177bf840bfb39ea66c9c54cf2760630efd58e0a3ec80",
        368,
    ),
)

_lock = threading.Lock()


def file_url(spec: ModelFile) -> str:
    return f"https://huggingface.co/{REPO}/resolve/{REVISION}/{spec.remote_path}"


def _download(url: str, dest_path: str) -> None:
    with requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT) as response:
        response.raise_for_status()
        with open(dest_path, "wb") as handle:
            for chunk in response.iter_content(_CHUNK):
                handle.write(chunk)


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _present(spec: ModelFile, path: str) -> bool:
    """A file is trusted when it has the pinned size: it was hash-checked when written."""
    return os.path.isfile(path) and os.path.getsize(path) == spec.size


def _fetch_one(spec: ModelFile, model_dir: str, fetch: Callable[[str, str], None]) -> None:
    final_path = os.path.join(model_dir, spec.name)
    part_path = final_path + ".part"
    try:
        fetch(file_url(spec), part_path)
        if _sha256(part_path) != spec.sha256:
            raise VerificationUnavailable(f"{spec.name} does not match the pinned SHA-256")
        os.replace(part_path, final_path)
    except VerificationUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - any network or disk failure means "no model"
        # Type only: the message of a requests or OS error can echo paths and URLs.
        raise VerificationUnavailable(
            f"could not download {spec.name} ({type(exc).__name__})"
        ) from None
    finally:
        if os.path.exists(part_path):
            try:
                os.remove(part_path)
            except OSError:
                pass


def ensure_model(model_path: str, fetch: Optional[Callable[[str, str], None]] = None) -> None:
    """Make sure the model files sit next to `model_path`, downloading what is missing.

    Raises VerificationUnavailable when the path is unset or a download fails:
    a verifier without its model must never pass stock footage.
    """
    if not model_path:
        raise VerificationUnavailable(
            "material_verification_model_path is not set; set it to a writable "
            f"directory plus {MODEL_FILE}"
        )
    if os.path.basename(model_path) != MODEL_FILE:
        return
    model_dir = os.path.dirname(os.path.abspath(model_path))
    with _lock:
        try:
            missing = [s for s in FILES if not _present(s, os.path.join(model_dir, s.name))]
            if not missing:
                return
            os.makedirs(model_dir, exist_ok=True)
        except OSError as exc:
            # A read-only or vanished model directory is a missing model,
            # not a boot/task failure: the verifier fails closed downstream.
            raise VerificationUnavailable(
                f"could not prepare the model directory ({type(exc).__name__})"
            ) from None
        for spec in missing:
            logger.info(f"siglip model: downloading {spec.name}")
            _fetch_one(spec, model_dir, fetch or _download)


def warm() -> None:
    """Fetch the model at boot when verification is on. Never stops the boot.

    A failure is logged loudly and retried by the first scoring call, which
    fails closed while the model is missing.
    """
    enabled = config.app.get("material_verification_enabled", False)
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() not in ("0", "false", "no", "off", "")
    if not enabled:
        return
    try:
        ensure_model(str(config.app.get("material_verification_model_path", "")).strip())
    except VerificationUnavailable as exc:
        logger.error(f"siglip model unavailable at boot: {exc}")
    except OSError as exc:
        # Belt and braces: no disk error from model preparation may stop
        # the boot, whatever ensure_model converts and whatever it does not.
        # Log the type only: an OS message can echo a local path.
        logger.error(f"siglip model unavailable at boot: {type(exc).__name__}")
