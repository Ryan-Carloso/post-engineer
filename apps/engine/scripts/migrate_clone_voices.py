"""Check VPS clone WAVs against the copy already in Supabase Storage.

Every clone created by the app is uploaded to the ``personas`` bucket
before it is registered on the VPS ``tts_voices`` volume. This script
compares the two. It uploads a VPS file only when the database row
exists and the storage object is missing. A WAV with no
``cloned_voices`` row cannot be mapped back to a user: the engine key
is a truncated id.

Dry run:

    python scripts/migrate_clone_voices.py --voices-dir /path/to/tts_voices

Repair missing objects (needs ``SUPABASE_URL`` and
``SUPABASE_SERVICE_ROLE_KEY``):

    docker cp mpt-tts-cpu:/voices /tmp/tts-voices
    python scripts/migrate_clone_voices.py --voices-dir /tmp/tts-voices --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chatterbox_registry_volume import load_voices_toml  # noqa: E402
from local_tts.routing import resolve_reference_path  # noqa: E402


def local_clones(voices_dir: Path) -> list[tuple[str, Path]]:
    registry = load_voices_toml(voices_dir / "voices.toml")
    found: list[tuple[str, Path]] = []
    for name in sorted(registry):
        path = resolve_reference_path(voices_dir, registry[name]["reference"])
        if path.is_file():
            found.append((name, path))
    return found


def classify(name: str, store: Any) -> str:
    """``present``, ``missing_object``, or ``no_row``."""
    row = store.get_by_engine_voice_key(name)
    if not isinstance(row, dict):
        return "no_row"
    storage_path = row.get("storage_path")
    if not isinstance(storage_path, str) or not storage_path:
        return "no_row"
    try:
        payload = store.download_reference_wav(storage_path)
    except Exception as exc:
        response = getattr(exc, "response", None)
        if getattr(response, "status_code", None) == 404:
            return "missing_object"
        raise
    if not payload:
        return "missing_object"
    return "present"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voices-dir", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    rows = local_clones(Path(args.voices_dir))
    if not rows:
        print("no clone WAVs on the VPS volume")
        return 0
    from app.services.cloned_voices.store import ClonedVoiceStore

    store = ClonedVoiceStore()
    missing = 0
    for name, path in rows:
        kind = classify(name, store)
        print(f"{name} {kind} {path.stat().st_size}")
        if kind != "missing_object":
            continue
        missing += 1
        if not args.apply:
            continue
        row = store.get_by_engine_voice_key(name)
        storage_path = row.get("storage_path") if isinstance(row, dict) else None
        if not isinstance(storage_path, str) or not storage_path:
            print(f"skip {name}: no storage_path")
            continue
        store.upload_reference_wav(storage_path, path.read_bytes())
        print(f"uploaded {name}")
    if missing == 0:
        print(f"{len(rows)} VPS file(s); each ready clone is already in Supabase Storage")
        return 0
    if not args.apply:
        print(f"dry run: {missing} object(s) missing; pass --apply to upload those only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
