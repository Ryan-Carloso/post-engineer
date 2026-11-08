"""The shipped BGM catalog stays in sync with the tracks on disk.

Every MP3 under ``resource/songs/`` must be listed in ``catalog.toml``
with a verified CC0 license and a Freesound source URL — an unlisted
track never plays, and an unverified license must never ship (the
unlicensed MP3s removed in the 2026-09-26 cleanup stay removed).
"""

import sys
import unittest
from pathlib import Path

import toml

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import music_mood as mm


def _songs_dir() -> Path:
    """Walk up from this file until the catalog is found (mutmut-safe)."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        candidate = parent / "resource" / "songs"
        if (candidate / "catalog.toml").is_file():
            return candidate
    raise AssertionError("resource/songs/catalog.toml not found above test file")


class BgmCatalogSyncTests(unittest.TestCase):
    def test_every_track_on_disk_is_catalogued_with_cc0_license(self):
        songs_dir = _songs_dir()
        catalog = toml.load(songs_dir / "catalog.toml")
        tracks = catalog.get("tracks", [])
        by_file = {track.get("file"): track for track in tracks}
        on_disk = sorted(
            str(p.relative_to(songs_dir)) for p in songs_dir.rglob("*.mp3")
        )
        self.assertTrue(on_disk, "no MP3 tracks shipped")
        for rel in on_disk:
            self.assertIn(rel, by_file, f"{rel} on disk but not in catalog.toml")
        for track in tracks:
            self.assertEqual(
                track.get("license"),
                "CC0-1.0",
                f"{track.get('file')} must carry a verified CC0-1.0 license",
            )
            source = track.get("source", "")
            self.assertTrue(
                source.startswith("https://freesound.org/"),
                f"{track.get('file')} must record its Freesound source URL",
            )
            self.assertTrue(
                track.get("moods"),
                f"{track.get('file')} must declare at least one mood",
            )
            self.assertTrue(
                (songs_dir / track["file"]).is_file(),
                f"catalogued {track.get('file')} is missing from disk",
            )

    def test_catalog_offers_exactly_the_shipped_moods(self):
        self.assertEqual(
            mm.get_available_music_moods(),
            ("calm", "energetic", "inspiring", "upbeat"),
        )


if __name__ == "__main__":
    unittest.main()
