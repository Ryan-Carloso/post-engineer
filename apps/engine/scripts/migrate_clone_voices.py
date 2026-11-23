"""Copy clone WAVs from the VPS tts_voices volume onto Modal.

The worker reads clones from the Modal volume ``cpu-worker-voices``.
This script is the one-off copy of files that already exist on the VPS.
It does not print file bytes.

Dry run (lists voice keys only):

    python scripts/migrate_clone_voices.py --voices-dir /path/to/tts_voices

Upload, after ``modal deploy modal_cpu_worker.py`` and with
``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` set:

    python scripts/migrate_clone_voices.py --voices-dir /path/to/tts_voices --apply

On the VPS the files are inside the ``mpt-tts-cpu`` container:

    docker cp mpt-tts-cpu:/voices /tmp/tts-voices
    python scripts/migrate_clone_voices.py --voices-dir /tmp/tts-voices --apply

New clones are written to that volume by registration. This script does
not need to run again for those.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from chatterbox_registry_volume import load_voices_toml  # noqa: E402
from local_tts.routing import resolve_reference_path  # noqa: E402


def clone_files(voices_dir: Path) -> list[tuple[str, str, Path]]:
    """Voice key, language, and reference WAV for every entry in voices.toml."""
    registry = load_voices_toml(voices_dir / "voices.toml")
    found: list[tuple[str, str, Path]] = []
    for name in sorted(registry):
        section = registry[name]
        path = resolve_reference_path(voices_dir, section["reference"])
        if path.is_file():
            found.append((name, section.get("language_id") or "en", path))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voices-dir", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    voices_dir = Path(args.voices_dir)
    rows = clone_files(voices_dir)
    if not rows:
        print(f"no clone WAVs under {voices_dir}")
        return 0
    for name, _language, path in rows:
        print(f"{name} {path.name} {path.stat().st_size}")
    if not args.apply:
        print(f"dry run: {len(rows)} file(s); pass --apply to upload")
        return 0
    from app.services.cpu_worker_dispatch import publish_clone_reference

    for name, language, path in rows:
        publish_clone_reference(name, language, path.read_bytes())
        print(f"uploaded {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
