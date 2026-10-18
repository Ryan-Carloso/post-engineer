"""Tests for the private SVG catalog reader (app/services/svg_catalog.py)."""
import json
import os
import sqlite3
import unittest
from unittest.mock import patch

from app.services import svg_catalog


def _build_catalog(index_dir: str, assets_root: str, rows: list) -> None:
    """Create a minimal catalog.sqlite mirroring the real Doodly index schema."""
    os.makedirs(index_dir, exist_ok=True)
    os.makedirs(assets_root, exist_ok=True)
    db = sqlite3.connect(os.path.join(index_dir, "catalog.sqlite"))
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
            "INSERT INTO assets (id, asset_id, pack, vector_row, data) VALUES (?,?,?,?,?)",
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
        target = os.path.join(assets_root, relative)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w") as handle:
            handle.write('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    db.commit()
    db.close()


class SvgCatalogTests(unittest.TestCase):
    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.index_dir = os.path.join(self.tmp.name, "_index")
        self.assets_root = os.path.join(self.tmp.name, "svg")
        _build_catalog(
            self.index_dir,
            self.assets_root,
            [
                ("4:2663187", "Hen Standing on Money", "Animals 3/hen money.svg"),
                ("6:2683622", "Hen Throwing Up Money", "Animals 3/hen throw.svg"),
                ("9:1111111", "Café na Praça", "Animals 3/cafe.svg"),
            ],
        )
        self._config(index_dir=self.index_dir, assets_root=self.assets_root)

    def _config(self, index_dir=None, assets_root=None, enabled=True):
        values = {
            "svg_catalog_enabled": enabled,
            "svg_catalog_index_dir": index_dir
            if index_dir is not None
            else self.index_dir,
            "svg_assets_root": assets_root
            if assets_root is not None
            else self.assets_root,
        }
        patcher = patch.object(svg_catalog.config, "app", values)
        patcher.start()
        self.addCleanup(patcher.stop)

    # ---- is_enabled -------------------------------------------------

    def test_disabled_when_flag_is_false(self):
        self._config(enabled=False)
        self.assertFalse(svg_catalog.is_enabled())

    def test_disabled_when_catalog_db_is_missing(self):
        self._config(index_dir=os.path.join(self.tmp.name, "absent"))
        self.assertFalse(svg_catalog.is_enabled())

    def test_enabled_with_flag_and_db(self):
        self.assertTrue(svg_catalog.is_enabled())

    def test_flag_accepts_string_false(self):
        self._config(enabled="false")
        self.assertFalse(svg_catalog.is_enabled())

    def test_flag_accepts_string_true(self):
        self._config(enabled="true")
        self.assertTrue(svg_catalog.is_enabled())

    # ---- path resolution --------------------------------------------

    def test_resolve_asset_path_returns_absolute_path(self):
        resolved = svg_catalog.resolve_asset_path("Animals 3/hen money.svg")
        self.assertTrue(os.path.isfile(resolved))
        self.assertTrue(resolved.endswith("hen money.svg"))

    def test_resolve_asset_path_rejects_traversal(self):
        with self.assertRaises(ValueError):
            svg_catalog.resolve_asset_path("../../etc/passwd")

    def test_resolve_asset_path_rejects_unknown_file(self):
        with self.assertRaises(FileNotFoundError):
            svg_catalog.resolve_asset_path("Animals 3/nope.svg")

    def test_resolve_asset_path_rejects_non_svg(self):
        other = os.path.join(self.assets_root, "notes.txt")
        with open(other, "w") as handle:
            handle.write("x")
        with self.assertRaises(ValueError):
            svg_catalog.resolve_asset_path("notes.txt")

    # ---- search -------------------------------------------------------

    def test_search_returns_assets_with_absolute_paths(self):
        assets = svg_catalog.search("money")
        self.assertEqual(len(assets), 2)
        for asset in assets:
            self.assertTrue(os.path.isfile(asset.absolute_path))
            self.assertTrue(asset.relative_path.endswith(".svg"))

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