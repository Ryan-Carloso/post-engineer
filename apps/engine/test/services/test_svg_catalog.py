"""Tests for the R2-backed private SVG catalog (app/services/svg_catalog.py).

The R2 client is faked in-memory: no network, no credentials. Key layout under
test mirrors the real bucket: ``<prefix>/_index/catalog.sqlite`` for the FTS5
index and ``<prefix>/<arquivo_relativo>`` for each asset.
"""
import io
import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from botocore.exceptions import ClientError

from app.services import svg_catalog


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": code}}, "GetObject")


class FakeR2Client:
    """In-memory stand-in for the boto3 S3 client."""

    def __init__(self, objects: dict):
        self.objects = dict(objects)
        self.requested_keys = []

    def get_object(self, Bucket, Key):
        self.requested_keys.append(Key)
        if Key not in self.objects:
            raise _client_error("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key])}


class FailingR2Client(FakeR2Client):
    """Every fetch blows up: the catalog must degrade, not crash."""

    def get_object(self, Bucket, Key):
        raise RuntimeError("r2 is down")


def _build_index_bytes(rows: list) -> bytes:
    """Build a catalog.sqlite mirroring the real Doodly index schema."""
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    try:
        db = sqlite3.connect(path)
        db.executescript(
            """
            CREATE TABLE assets(
                id TEXT PRIMARY KEY,
                asset_id INTEGER,
                pack TEXT,
                vector_row INTEGER UNIQUE,
                data TEXT
            );
            CREATE VIRTUAL TABLE search USING fts5(
                id UNINDEXED, title, tags, labels,
                tokenize='unicode61 remove_diacritics 2'
            );
            """
        )
        for asset_id, title, relative in rows:
            db.execute(
                "INSERT INTO assets (id, asset_id, pack, vector_row, data)"
                " VALUES (?,?,?,?,?)",
                (
                    asset_id,
                    int(asset_id.split(":")[-1]),
                    relative.split("/")[0],
                    abs(hash(asset_id)) % 100000,
                    json.dumps(
                        {
                            "id": asset_id,
                            "titulo_original": title,
                            "arquivo_relativo": relative,
                        }
                    ),
                ),
            )
            db.execute(
                "INSERT INTO search (id, title, tags, labels) VALUES (?,?,?,?)",
                (asset_id, title, title, title),
            )
        db.commit()
        db.close()
        with open(path, "rb") as handle:
            return handle.read()
    finally:
        os.unlink(path)


class SvgCatalogR2Tests(unittest.TestCase):
    PREFIX = "svg-catalog"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache_dir = os.path.join(self.tmp.name, "cache")
        self.rows = [
            ("4:2663187", "Hen Standing on Money", "Animals 3/hen money.svg"),
            ("6:2683622", "Hen Throwing Up Money", "Animals 3/hen throw.svg"),
            ("9:1111111", "Café na Praça", "Animals 3/cafe.svg"),
        ]
        self.svg_bytes = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        objects = {f"{self.PREFIX}/_index/catalog.sqlite": _build_index_bytes(self.rows)}
        for _, _, relative in self.rows:
            objects[f"{self.PREFIX}/{relative}"] = self.svg_bytes
        self.fake = FakeR2Client(objects)
        patcher = patch.object(svg_catalog, "_r2_client", return_value=self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        self._config(enabled=True)

    def _config(self, enabled=True, prefix=PREFIX, extra=None):
        values = {
            "svg_catalog_enabled": enabled,
            "svg_r2_prefix": prefix,
            "svg_cache_dir": self.cache_dir,
        }
        if extra:
            values.update(extra)
        patcher = patch.object(svg_catalog.config, "app", values)
        patcher.start()
        self.addCleanup(patcher.stop)

    # ---- is_enabled -------------------------------------------------

    def test_disabled_when_flag_is_false(self):
        self._config(enabled=False)
        self.assertFalse(svg_catalog.is_enabled())
        self.assertEqual(self.fake.requested_keys, [])

    def test_enabled_with_flag_and_prefix(self):
        self.assertTrue(svg_catalog.is_enabled())

    def test_enabled_without_prefix_fails_fast(self):
        self._config(prefix="")
        with self.assertRaises(ValueError):
            svg_catalog.is_enabled()

    def test_enabled_without_prefix_key_fails_fast(self):
        self._config(extra={"svg_r2_prefix": None})
        with self.assertRaises(ValueError):
            svg_catalog.is_enabled()

    def test_flag_accepts_string_false(self):
        self._config(enabled="false")
        self.assertFalse(svg_catalog.is_enabled())

    def test_flag_accepts_string_true(self):
        self._config(enabled="true")
        self.assertTrue(svg_catalog.is_enabled())

    # ---- index download ---------------------------------------------

    def test_ensure_index_downloads_once_then_uses_cache(self):
        first = svg_catalog._ensure_index()
        second = svg_catalog._ensure_index()
        self.assertEqual(first, second)
        self.assertTrue(os.path.isfile(first))
        index_requests = [
            key
            for key in self.fake.requested_keys
            if key == f"{self.PREFIX}/_index/catalog.sqlite"
        ]
        self.assertEqual(len(index_requests), 1)

    def test_ensure_index_uses_existing_cache(self):
        cached = os.path.join(self.cache_dir, "_index", "catalog.sqlite")
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with open(cached, "wb") as handle:
            handle.write(b"cached")
        self.assertEqual(svg_catalog._ensure_index(), cached)
        self.assertEqual(self.fake.requested_keys, [])

    def test_download_missing_key_raises_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            svg_catalog._download_key(
                f"{self.PREFIX}/nope.svg", os.path.join(self.cache_dir, "nope.svg")
            )

    # ---- path resolution --------------------------------------------

    def test_resolve_asset_path_cache_hit_skips_r2(self):
        cached = os.path.join(self.cache_dir, "Animals 3", "hen money.svg")
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with open(cached, "wb") as handle:
            handle.write(b"cached")
        resolved = svg_catalog.resolve_asset_path("Animals 3/hen money.svg")
        self.assertEqual(resolved, cached)
        self.assertEqual(self.fake.requested_keys, [])

    def test_resolve_asset_path_cache_miss_downloads(self):
        resolved = svg_catalog.resolve_asset_path("Animals 3/hen money.svg")
        self.assertTrue(os.path.isfile(resolved))
        with open(resolved, "rb") as handle:
            self.assertEqual(handle.read(), self.svg_bytes)
        self.assertIn(f"{self.PREFIX}/Animals 3/hen money.svg", self.fake.requested_keys)

    def test_resolve_asset_path_rejects_traversal(self):
        with self.assertRaises(ValueError):
            svg_catalog.resolve_asset_path("../../etc/passwd")
        self.assertEqual(self.fake.requested_keys, [])

    def test_resolve_asset_path_rejects_non_svg(self):
        with self.assertRaises(ValueError):
            svg_catalog.resolve_asset_path("notes.txt")

    def test_resolve_asset_path_missing_on_r2(self):
        with self.assertRaises(FileNotFoundError):
            svg_catalog.resolve_asset_path("Animals 3/nope.svg")

    # ---- search -------------------------------------------------------

    def test_search_returns_assets_with_cached_paths(self):
        assets = svg_catalog.search("money")
        self.assertEqual(len(assets), 2)
        for asset in assets:
            self.assertTrue(os.path.isfile(asset.absolute_path))
            self.assertTrue(asset.relative_path.endswith(".svg"))

    def test_search_skips_unfetchable_asset(self):
        del self.fake.objects[f"{self.PREFIX}/Animals 3/hen money.svg"]
        assets = svg_catalog.search("money")
        self.assertEqual([a.title for a in assets], ["Hen Throwing Up Money"])

    def test_search_returns_empty_when_disabled(self):
        self._config(enabled=False)
        self.assertEqual(svg_catalog.search("money"), [])
        self.assertEqual(self.fake.requested_keys, [])

    def test_search_degrades_when_index_download_fails(self):
        with patch.object(
            svg_catalog, "_r2_client", return_value=FailingR2Client({})
        ):
            with patch("loguru.logger.warning"):
                self.assertEqual(svg_catalog.search("money"), [])

    def test_search_returns_empty_for_no_match(self):
        self.assertEqual(svg_catalog.search("zzzznotathing"), [])

    def test_search_survives_malformed_fts_syntax(self):
        # A bare operator or unbalanced quote must not raise out of FTS5:
        # the terms come from an LLM-written script.
        self.assertIsInstance(svg_catalog.search('money AND "'), list)

    def test_search_honours_limit(self):
        self.assertEqual(len(svg_catalog.search("money", limit=1)), 1)

    def test_search_folds_diacritics(self):
        # The index tokenizer is 'unicode61 remove_diacritics 2', so an
        # unaccented query must still find the accented title.
        assets = svg_catalog.search("cafe")
        self.assertEqual([a.title for a in assets], ["Café na Praça"])

    def test_search_folds_query_diacritics(self):
        assets = svg_catalog.search("Café")
        self.assertEqual([a.title for a in assets], ["Café na Praça"])


class SvgSearchModeTests(unittest.TestCase):
    def test_semantic_mode_falls_back_to_text_without_models(self):
        with patch.object(svg_catalog, "_semantic_models_available", return_value=False):
            self.assertEqual(svg_catalog._search_mode(), "texto")

    def test_unknown_mode_falls_back_to_text(self):
        with patch.object(svg_catalog.config, "app", {"svg_search_mode": "bogus"}):
            with patch("loguru.logger.warning"):
                self.assertEqual(svg_catalog._search_mode(), "texto")

    def test_text_mode_never_requires_models(self):
        with patch.object(svg_catalog, "_semantic_models_available", return_value=False):
            with patch.object(svg_catalog.config, "app", {"svg_search_mode": "texto"}):
                self.assertEqual(svg_catalog._search_mode(), "texto")


if __name__ == "__main__":
    unittest.main()
