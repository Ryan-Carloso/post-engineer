"""Tests for the R2-backed private SVG catalog (app/services/svg_catalog.py).

The R2 client is faked in-memory: no network, no credentials. Key layout under
test mirrors the real bucket: ``<prefix>/_index/catalog.sqlite`` for the FTS5
index and ``<prefix>/<arquivo_relativo>`` for each asset.
"""
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
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
        self.head_keys = []

    def _etag(self, Key):
        return '"' + hashlib.md5(self.objects[Key]).hexdigest() + '"'

    def head_object(self, Bucket, Key):
        self.head_keys.append(Key)
        if Key not in self.objects:
            raise _client_error("404")
        return {"ETag": self._etag(Key)}

    def get_object(self, Bucket, Key):
        self.requested_keys.append(Key)
        if Key not in self.objects:
            raise _client_error("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key]), "ETag": self._etag(Key)}


class FailingR2Client(FakeR2Client):
    """Every request blows up: the catalog must raise, not degrade."""

    def head_object(self, Bucket, Key):
        raise RuntimeError("r2 is down")

    def get_object(self, Bucket, Key):
        raise RuntimeError("r2 is down")


class ChunkedBody:
    """A response body that only supports sized reads, like botocore's.

    A bare .read() — the whole object into memory at once — fails the test.
    """

    def __init__(self, payload: bytes):
        self._buffer = io.BytesIO(payload)
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        if size is None or size < 0:
            raise AssertionError("download read the whole object into memory")
        return self._buffer.read(size)


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
        # The index check time is process state: start every test unchecked.
        checked = patch.object(svg_catalog, "_index_checked_at", None)
        checked.start()
        self.addCleanup(checked.stop)
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

    def _write_cached_index(self, etag):
        cached = os.path.join(self.cache_dir, "_index", "catalog.sqlite")
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with open(cached, "wb") as handle:
            handle.write(b"cached")
        with open(cached + ".etag", "w", encoding="utf-8") as handle:
            handle.write(etag)
        return cached

    def test_ensure_index_keeps_cache_when_r2_etag_matches(self):
        index_key = f"{self.PREFIX}/_index/catalog.sqlite"
        cached = self._write_cached_index(self.fake._etag(index_key))
        self.assertEqual(svg_catalog._ensure_index(), cached)
        self.assertEqual(self.fake.head_keys, [index_key])
        self.assertEqual(self.fake.requested_keys, [])

    def test_ensure_index_redownloads_when_r2_etag_changes(self):
        # A reindexed catalog in R2 has a new ETag: the stale copy is replaced.
        index_key = f"{self.PREFIX}/_index/catalog.sqlite"
        cached = self._write_cached_index('"old-etag"')
        svg_catalog._ensure_index()
        self.assertEqual(self.fake.requested_keys, [index_key])
        with open(cached, "rb") as handle:
            self.assertEqual(handle.read(), self.fake.objects[index_key])
        with open(cached + ".etag", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), self.fake._etag(index_key))

    def test_ensure_index_skips_the_r2_check_inside_the_refresh_interval(self):
        with patch.object(svg_catalog.time, "monotonic", return_value=1000.0):
            svg_catalog._ensure_index()
        with patch.object(
            svg_catalog.time,
            "monotonic",
            return_value=1000.0 + svg_catalog._INDEX_REFRESH_SECONDS - 1,
        ):
            svg_catalog._ensure_index()
        self.assertEqual(len(self.fake.head_keys), 1)

    def test_ensure_index_rechecks_r2_after_the_refresh_interval(self):
        with patch.object(svg_catalog.time, "monotonic", return_value=1000.0):
            svg_catalog._ensure_index()
        with patch.object(
            svg_catalog.time,
            "monotonic",
            return_value=1000.0 + svg_catalog._INDEX_REFRESH_SECONDS,
        ):
            svg_catalog._ensure_index()
        self.assertEqual(len(self.fake.head_keys), 2)
        # The ETag still matches, so the index was downloaded only once.
        self.assertEqual(len(self.fake.requested_keys), 1)

    def test_ensure_index_missing_on_r2_raises_file_not_found(self):
        del self.fake.objects[f"{self.PREFIX}/_index/catalog.sqlite"]
        with self.assertRaises(FileNotFoundError):
            svg_catalog._ensure_index()

    def test_download_missing_key_raises_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            svg_catalog._download_key(
                f"{self.PREFIX}/nope.svg", os.path.join(self.cache_dir, "nope.svg")
            )

    def test_download_key_streams_the_body_in_chunks(self):
        key = f"{self.PREFIX}/Animals 3/hen money.svg"
        payload = self.fake.objects[key]
        body = ChunkedBody(payload)
        client = FakeR2Client(self.fake.objects)
        client.get_object = lambda Bucket, Key: {"Body": body, "ETag": '"etag-1"'}
        local = os.path.join(self.cache_dir, "hen.svg")
        etag = svg_catalog._download_key(key, local, client)
        self.assertEqual(etag, '"etag-1"')
        with open(local, "rb") as handle:
            self.assertEqual(handle.read(), payload)
        self.assertTrue(body.read_sizes)
        self.assertTrue(all(0 < size <= 65536 for size in body.read_sizes))

    def test_ensure_index_serializes_concurrent_refreshes(self):
        head_calls = []
        original_head = self.fake.head_object

        def slow_head(Bucket, Key):
            head_calls.append(Key)
            # Widen the race window: without serialization every thread
            # passes the freshness check and calls R2 itself.
            time.sleep(0.05)
            return original_head(Bucket, Key)

        self.fake.head_object = slow_head
        results = []
        threads = [
            threading.Thread(
                target=lambda: results.append(svg_catalog._ensure_index())
            )
            for _ in range(8)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(results), 8)
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(len(head_calls), 1)

    # ---- path resolution --------------------------------------------

    def test_resolve_asset_path_cache_hit_skips_r2(self):
        cached = os.path.join(self.cache_dir, "Animals 3", "hen money.svg")
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with open(cached, "wb") as handle:
            handle.write(b"cached")
        resolved = svg_catalog.resolve_asset_path("Animals 3/hen money.svg")
        # realpath: on macOS the temp dir is reached through the /var symlink.
        self.assertEqual(os.path.realpath(resolved), os.path.realpath(cached))
        self.assertEqual(self.fake.requested_keys, [])

    def test_resolve_asset_path_has_no_bundled_fallback(self):
        """R2 is the only source: a cache miss must go to R2, never to a
        repo-bundled directory. The bundled helper no longer exists."""
        self.assertFalse(hasattr(svg_catalog, "_bundled_dir"))
        resolved = svg_catalog.resolve_asset_path("Animals 3/hen money.svg")
        self.assertTrue(os.path.isfile(resolved))
        self.assertIn(f"{self.PREFIX}/Animals 3/hen money.svg", self.fake.requested_keys)

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

    def test_search_reads_only_the_index_not_the_artwork(self):
        assets = svg_catalog.search("money")
        self.assertEqual(
            sorted(a.relative_path for a in assets),
            ["Animals 3/hen money.svg", "Animals 3/hen throw.svg"],
        )
        # Artwork is fetched later, only for the assets a render uses.
        self.assertEqual(
            self.fake.requested_keys, [f"{self.PREFIX}/_index/catalog.sqlite"]
        )

    def test_search_returns_empty_when_disabled(self):
        self._config(enabled=False)
        self.assertEqual(svg_catalog.search("money"), [])
        self.assertEqual(self.fake.requested_keys, [])

    def test_search_raises_when_the_index_cannot_be_fetched(self):
        # Enabled but unreachable must fail the render, not quietly use stock.
        with patch.object(
            svg_catalog, "_r2_client", return_value=FailingR2Client({})
        ):
            with self.assertRaises(RuntimeError):
                svg_catalog.search("money")

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


class LeadCascadeTests(unittest.TestCase):
    def _config(self, values):
        patcher = patch.object(svg_catalog.config, "app", values)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_enabled_catalog_leads_the_cascade(self):
        self._config({"svg_catalog_enabled": True, "svg_r2_prefix": "p"})
        self.assertEqual(
            svg_catalog.lead_cascade(["coverr", "pexels", "pixabay"]),
            ["svg", "coverr", "pexels", "pixabay"],
        )

    def test_enabled_catalog_is_never_listed_twice(self):
        self._config({"svg_catalog_enabled": True, "svg_r2_prefix": "p"})
        self.assertEqual(
            svg_catalog.lead_cascade(["pexels", "svg"]), ["svg", "pexels"]
        )

    def test_disabled_catalog_keeps_the_cascade(self):
        self._config({"svg_catalog_enabled": False})
        self.assertEqual(
            svg_catalog.lead_cascade(["coverr", "pexels"]), ["coverr", "pexels"]
        )

    def test_enabled_without_prefix_fails_fast(self):
        self._config({"svg_catalog_enabled": True, "svg_r2_prefix": ""})
        with self.assertRaises(ValueError):
            svg_catalog.lead_cascade(["pexels"])

    def test_bucket_defaults_to_the_video_storage_bucket(self):
        from app.services import video_storage

        self._config({})
        self.assertEqual(svg_catalog._r2_bucket(), video_storage.STORAGE_BUCKET)


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


class R2ClientCredentialTests(unittest.TestCase):
    """The R2 client builder never leaks credential values.

    Any missing R2_* variable fails fast with a message that names the
    variable, not its value; the key id and secret are passed to boto3 but
    never appear in any error text or log line this module produces.
    """

    @staticmethod
    @contextmanager
    def _isolated_environ(overrides):
        # Same mutmut-safe pattern as test_video_storage._isolated_environ:
        # behave like patch.dict(clear=True) without wiping MUTANT_UNDER_TEST.
        sentinel = os.environ.get("MUTANT_UNDER_TEST")
        with patch.dict(os.environ, overrides, clear=True):
            if sentinel is not None:
                os.environ["MUTANT_UNDER_TEST"] = sentinel
            yield

    def test_missing_account_id_raises_without_credential_values(self):
        # Deliberately fake values shaped nothing like real credentials: the
        # point is that whatever is configured never appears in the error.
        key_id = "test-key-id-not-a-real-credential"
        secret = "test-secret-not-a-real-credential"
        with self._isolated_environ(
            {"R2_ACCESS_KEY_ID": key_id, "R2_SECRET_ACCESS_KEY": secret}
        ):
            with self.assertRaises(RuntimeError) as ctx:
                svg_catalog._r2_client()
        message = str(ctx.exception)
        self.assertNotIn(key_id, message)
        self.assertNotIn(secret, message)
        self.assertIn("R2_ACCOUNT_ID", message)

    def test_missing_secret_key_raises_instead_of_signing_with_empty_credentials(self):
        import boto3

        with self._isolated_environ(
            {"R2_ACCOUNT_ID": "acct123", "R2_ACCESS_KEY_ID": "k"}
        ), patch.object(boto3, "client") as mock_client:
            with self.assertRaises(RuntimeError) as ctx:
                svg_catalog._r2_client()
        self.assertIn("R2_SECRET_ACCESS_KEY", str(ctx.exception))
        mock_client.assert_not_called()

    def test_client_points_at_the_account_r2_endpoint(self):
        import boto3

        with patch.dict(
            os.environ,
            {
                "R2_ACCOUNT_ID": "acct123",
                "R2_ACCESS_KEY_ID": "k",
                "R2_SECRET_ACCESS_KEY": "s",
            },
        ), patch.object(boto3, "client") as mock_client:
            svg_catalog._r2_client()
        _, kwargs = mock_client.call_args
        self.assertEqual(
            kwargs["endpoint_url"], "https://acct123.r2.cloudflarestorage.com"
        )
        self.assertEqual(kwargs["region_name"], "auto")


if __name__ == "__main__":
    unittest.main()
