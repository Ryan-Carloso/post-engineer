"""Read-only search over the private SVG catalog, backed by Cloudflare R2.

The catalog is a Doodly bundle licensed for private use: the artwork and its
index never live in the public repo. They live in R2 under ``svg_r2_prefix``
and are fetched on demand, then cached under ``svg_cache_dir`` so
`rsvg-convert` can rasterize from a real filesystem path. Search reads only
the index: an asset's artwork is fetched when a render actually uses it.

Search is SQLite FTS5 over the ``search`` table built by the catalog indexer.
Only the text mode is implemented: it needs no extra dependency and covers the
whole catalog. The config exposes ``svg_search_mode`` so a future semantic
index can be wired without another config change; today a semantic request
warns and degrades to text rather than failing the render.

The feature is opt-in via ``svg_catalog_enabled`` (default false): without the
flag there is no SVG and material search falls back to the stock providers.
Enabling it without ``svg_r2_prefix`` is a deploy misconfiguration and fails
fast with a clear error instead of silently degrading. The same holds for R2
itself: missing credentials or an unreachable index raise, never an empty
result that would quietly turn every render into stock footage.
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import List, Optional

from loguru import logger

from app.config import config
from app.config.config import root_dir
from app.services import video_storage
from app.utils import file_security

# How long a verified local index is trusted before its ETag is re-checked
# against R2, so a reindexed catalog is picked up without a restart.
_INDEX_REFRESH_SECONDS = 600

# Monotonic time of the last successful index check; None forces a check.
_index_checked_at: Optional[float] = None

# Serializes index refreshes: the engine serves concurrent requests, and
# without the lock every thread that observes a stale check would call R2
# and rewrite the cached index at the same time.
_index_check_lock = threading.Lock()

# R2 downloads stream to disk in chunks of this size, so neither the 18MB
# index nor an unusually large asset is ever held whole in memory.
_DOWNLOAD_CHUNK_BYTES = 64 * 1024


@dataclass(frozen=True)
class SvgAsset:
    """One catalog entry; its artwork is fetched by resolve_asset_path."""

    asset_id: str
    title: str
    relative_path: str


def _config_bool(key: str, default: bool = False) -> bool:
    """TOML values may arrive as real bools or as quoted strings."""
    value = config.app.get(key, default)
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "off", "")
    return bool(value)


def _config_str(key: str, default: str) -> str:
    return str(config.app.get(key, default) or default).strip()


def _r2_bucket() -> str:
    return _config_str("svg_r2_bucket", video_storage.STORAGE_BUCKET)


def _r2_prefix() -> str:
    return _config_str("svg_r2_prefix", "").strip("/")


def _cache_dir() -> str:
    return os.path.join(root_dir, _config_str("svg_cache_dir", "resource/svg/_cache"))


def _require_r2_config() -> str:
    """Fail fast when the catalog is enabled without an R2 prefix.

    A deployment that opts into SVG but points at no catalog would otherwise
    silently fall back to stock providers on every render; raising here turns
    the misconfiguration into one loud error at first use.
    """
    prefix = _r2_prefix()
    if not prefix:
        raise ValueError("svg_catalog_enabled is true but svg_r2_prefix is not set")
    return prefix


def is_enabled() -> bool:
    """Whether the SVG catalog takes part in material search.

    Opt-in and off by default: without the flag there is no SVG. When the flag
    is on, the R2 prefix is required and a missing one raises (fail fast).

    Raises:
        ValueError: when ``svg_catalog_enabled`` is true but ``svg_r2_prefix``
            is not set. This is deliberate: a deployment that opts into SVG
            without pointing at a catalog must fail loudly, never silently
            fall back to the stock providers.
    """
    if not _config_bool("svg_catalog_enabled", False):
        return False
    _require_r2_config()
    return True


def lead_cascade(source_mix: List[str]) -> List[str]:
    """Put "svg" first in a material source cascade when the catalog is on.

    The stock providers then serve as fallback for keywords the catalog has
    no artwork for. Raises like is_enabled when the flag is on without a
    prefix, so a misconfigured catalog fails the render instead of using stock.
    """
    rest = [name for name in source_mix if name != "svg"]
    return ["svg", *rest] if is_enabled() else list(source_mix)


def _r2_client():
    """The video-storage R2 client, after checking every R2_* variable is set.

    The catalog shares the account and credentials with video storage, so it
    shares the builder too; the check fails before boto3 would sign a request
    with empty credentials.
    """
    video_storage.require_r2_configuration()
    return video_storage._r2_client()


def _is_missing(exc: Exception) -> bool:
    code = getattr(exc, "response", {}).get("Error", {}).get("Code")
    return code in ("NoSuchKey", "NotFound", "404")


def _download_key(key: str, local_path: str, client=None) -> Optional[str]:
    """Fetch one R2 object into the local cache, atomically.

    Returns the object's ETag. A missing object surfaces as FileNotFoundError
    so callers can skip that asset; any other failure propagates loudly.
    """
    from botocore.exceptions import ClientError  # lazy: only the SVG path needs boto3

    if client is None:
        client = _r2_client()
    try:
        response = client.get_object(Bucket=_r2_bucket(), Key=key)
    except ClientError as exc:
        if _is_missing(exc):
            raise FileNotFoundError(key) from exc
        raise
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(local_path), prefix=".svg-", suffix=".part"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            body = response["Body"]
            for chunk in iter(lambda: body.read(_DOWNLOAD_CHUNK_BYTES), b""):
                handle.write(chunk)
        os.replace(tmp_path, local_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    logger.info(f"svg_catalog: cached r2/{_r2_bucket()}/{key}")
    return response.get("ETag")


def _index_cache_path() -> str:
    return os.path.join(_cache_dir(), "_index", "catalog.sqlite")


def _read_etag(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip() or None
    except FileNotFoundError:
        return None


def _index_is_fresh(local: str, now: float) -> bool:
    return (
        os.path.isfile(local)
        and _index_checked_at is not None
        and now - _index_checked_at < _INDEX_REFRESH_SECONDS
    )


def _ensure_index() -> str:
    """Return the local catalog.sqlite, refreshed when R2 has a newer one.

    The local copy is trusted for _INDEX_REFRESH_SECONDS after a check; past
    that, the R2 object's ETag is compared with the one recorded when the copy
    was downloaded, and a mismatch (a reindexed catalog) downloads it again.

    Refreshes are serialized with a lock (checked twice: before acquiring,
    and again inside, since another thread may have just refreshed) so
    concurrent requests never stampede R2 or rewrite the cache together.
    """
    from botocore.exceptions import ClientError  # lazy: only the SVG path needs boto3

    global _index_checked_at
    local = _index_cache_path()
    now = time.monotonic()
    if _index_is_fresh(local, now):
        return local

    with _index_check_lock:
        if _index_is_fresh(local, now):
            return local

        key = f"{_require_r2_config()}/_index/catalog.sqlite"
        client = _r2_client()
        try:
            remote_etag = client.head_object(Bucket=_r2_bucket(), Key=key).get("ETag")
        except ClientError as exc:
            if _is_missing(exc):
                raise FileNotFoundError(key) from exc
            raise

        etag_path = f"{local}.etag"
        stale = (
            not os.path.isfile(local)
            or remote_etag is None
            or _read_etag(etag_path) != remote_etag
        )
        if stale:
            downloaded_etag = _download_key(key, local, client)
            if downloaded_etag is None:
                # No ETag to compare next time: drop any old one so the next
                # check downloads again instead of trusting a mismatched record.
                if os.path.isfile(etag_path):
                    os.unlink(etag_path)
            else:
                with open(etag_path, "w", encoding="utf-8") as handle:
                    handle.write(downloaded_etag)
        _index_checked_at = now
        return local


def resolve_asset_path(relative_path: str) -> str:
    """Resolve an index-relative path to the cached file, fetching from R2 on miss.

    The R2 key is the index's relative path under the catalog prefix. The
    relative path comes from the catalog index, not from the caller, but it
    still travels through the generic path guard: a tampered or rebuilt index
    must not be able to point the renderer at an arbitrary file.
    """
    root = _cache_dir()
    # require_file=False so a cache miss falls through to the R2 fetch below:
    # traversal is a ValueError from the guard, absence is its own signal.
    resolved = file_security.resolve_path_within_directory(
        root, relative_path, require_file=False
    )
    if not resolved.lower().endswith(".svg"):
        raise ValueError("not an svg file")
    if not os.path.isfile(resolved):
        prefix = _require_r2_config()
        _download_key(f"{prefix}/{relative_path}", resolved)
    return resolved


def _search_mode() -> str:
    mode = str(config.app.get("svg_search_mode", "texto")).strip().lower()
    if mode not in ("hibrido", "semantico", "texto"):
        logger.warning(f"unknown svg_search_mode={mode!r}, using texto")
        return "texto"
    if mode != "texto" and not _semantic_models_available():
        logger.warning(
            "svg_search_mode requires an ONNX index under "
            "<svg_cache_dir>/_index/models; falling back to texto"
        )
        return "texto"
    return mode


def _semantic_models_available() -> bool:
    # Reserved for the semantic index. No dependency on onnxruntime exists yet,
    # so this is always False and every non-text mode degrades to text.
    return False


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_ensure_index())
    connection.row_factory = sqlite3.Row
    return connection


def _fts_query(term: str) -> str:
    """Build a safe FTS5 MATCH expression from free text.

    FTS5 raises on bare operators and unbalanced quotes, and the search terms
    come from an LLM-written script, so punctuation must be neutralized before
    it reaches the query. Every token is quoted, which makes it a literal term
    and removes any operator meaning.
    """
    cleaned = "".join(char if char.isalnum() else " " for char in term)
    tokens = cleaned.split()
    if not tokens:
        return ""
    return " ".join(f'"{token}"' for token in tokens)


def _asset_from_row(row: sqlite3.Row) -> Optional[SvgAsset]:
    """Build an asset from a joined row, or None when it is unusable.

    A row whose JSON is malformed must not abort the whole search: the caller
    falls back to the remaining assets. The artwork itself is not fetched here.
    """
    try:
        payload = json.loads(row["data"] or "{}")
    except (TypeError, ValueError):
        logger.warning(f"svg_catalog: malformed catalog row {row['id']}")
        return None

    relative_path = payload.get("arquivo_relativo") or ""
    if not relative_path:
        logger.warning(f"svg_catalog: row {row['id']} has no arquivo_relativo")
        return None

    title = payload.get("titulo_original") or row["title"] or ""
    return SvgAsset(
        asset_id=row["id"],
        title=title,
        relative_path=relative_path,
    )


def search(search_term: str, limit: int = 5) -> List[SvgAsset]:
    """Return up to `limit` assets whose title/tags/labels match `search_term`."""
    if not is_enabled():
        return []

    mode = _search_mode()
    if mode != "texto":  # pragma: no cover - defensive, _search_mode normalizes
        mode = "texto"

    match = _fts_query(search_term)
    if not match:
        return []

    query = (
        "SELECT s.title AS title, a.id AS id, a.data AS data "
        "FROM search s JOIN assets a ON a.id = s.id "
        "WHERE search MATCH ? ORDER BY rank LIMIT ?"
    )

    # An unreachable or unreadable index raises: the catalog is enabled, so a
    # silent [] would quietly turn every render into stock footage.
    connection = _connect()
    try:
        rows = connection.execute(query, (match, max(1, int(limit)))).fetchall()
    finally:
        connection.close()

    assets: List[SvgAsset] = []
    for row in rows:
        asset = _asset_from_row(row)
        if asset is not None:
            assets.append(asset)
    return assets
