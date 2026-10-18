"""Read-only search over the private SVG catalog, backed by Cloudflare R2.

The catalog is a Doodly bundle licensed for private use: the artwork and its
index never live in the public repo. They live in R2 under ``svg_r2_prefix``
and are fetched on demand, then cached under ``svg_cache_dir`` so
`rsvg-convert` can rasterize from a real filesystem path.

Search is SQLite FTS5 over the ``search`` table built by the catalog indexer.
Only the text mode is implemented: it needs no extra dependency and covers the
whole catalog. The config exposes ``svg_search_mode`` so a future semantic
index can be wired without another config change; today a semantic request
warns and degrades to text rather than failing the render.

The feature is opt-in via ``svg_catalog_enabled`` (default false): without the
flag there is no SVG and material search falls back to the stock providers.
Enabling it without ``svg_r2_prefix`` is a deploy misconfiguration and fails
fast with a clear error instead of silently degrading.
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from dataclasses import dataclass
from typing import List, Optional

from loguru import logger

from app.config import config
from app.config.config import root_dir
from app.utils import file_security


@dataclass(frozen=True)
class SvgAsset:
    """One catalog entry resolved to a file in the local cache."""

    asset_id: str
    title: str
    relative_path: str
    absolute_path: str


def _config_bool(key: str, default: bool = False) -> bool:
    """TOML values may arrive as real bools or as quoted strings."""
    value = config.app.get(key, default)
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "off", "")
    return bool(value)


def _config_str(key: str, default: str) -> str:
    return str(config.app.get(key, default) or default).strip()


def _r2_bucket() -> str:
    return _config_str("svg_r2_bucket", "videos")


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


def _r2_client():
    """Build a boto3 S3 client pointed at the account's R2 endpoint.

    Imported lazily so only the SVG path needs boto3; credentials come from the
    same R2_* env vars as video storage. Signature V4 is mandatory for R2,
    which plain `requests` cannot produce; botocore does the signing. Endpoint
    URL is explicit because R2 is not AWS.
    """
    import boto3  # imported lazily so non-SVG engine operations need no client

    account_id = (os.environ.get("R2_ACCOUNT_ID") or "").strip()
    if not account_id:
        raise ValueError("svg_catalog: R2_ACCOUNT_ID is not set")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=(os.environ.get("R2_ACCESS_KEY_ID") or "").strip(),
        aws_secret_access_key=(os.environ.get("R2_SECRET_ACCESS_KEY") or "").strip(),
        # R2 ignores the region, but botocore refuses to sign without one.
        region_name="auto",
    )


def _download_key(key: str, local_path: str) -> None:
    """Fetch one R2 object into the local cache, atomically.

    A missing object surfaces as FileNotFoundError so callers can skip that
    asset; any other failure propagates loudly.
    """
    from botocore.exceptions import ClientError  # lazy, like boto3 above

    client = _r2_client()
    try:
        response = client.get_object(Bucket=_r2_bucket(), Key=key)
        payload = response["Body"].read()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in ("NoSuchKey", "NotFound", "404"):
            raise FileNotFoundError(key) from exc
        raise
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(local_path), prefix=".svg-", suffix=".part"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
        os.replace(tmp_path, local_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    logger.info(f"svg_catalog: cached r2/{_r2_bucket()}/{key}")


def _index_cache_path() -> str:
    return os.path.join(_cache_dir(), "_index", "catalog.sqlite")


def _ensure_index() -> str:
    """Return the local catalog.sqlite, downloading it from R2 on first use."""
    local = _index_cache_path()
    if os.path.isfile(local):
        return local
    prefix = _require_r2_config()
    _download_key(f"{prefix}/_index/catalog.sqlite", local)
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

    A row whose JSON is malformed or whose file cannot be fetched must not
    abort the whole search: the caller falls back to the remaining assets.
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

    try:
        absolute_path = resolve_asset_path(relative_path)
    except Exception as exc:  # one bad asset must not kill the whole search
        logger.warning(f"svg_catalog: unreadable asset {relative_path}: {exc}")
        return None

    title = payload.get("titulo_original") or row["title"] or ""
    return SvgAsset(
        asset_id=row["id"],
        title=title,
        relative_path=relative_path,
        absolute_path=absolute_path,
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

    try:
        connection = _connect()
    except Exception as exc:
        logger.warning(f"svg_catalog: index unavailable: {exc}")
        return []
    try:
        rows = connection.execute(query, (match, max(1, int(limit)))).fetchall()
    except sqlite3.Error as exc:
        logger.warning(f"svg_catalog: search failed for {search_term!r}: {exc}")
        return []
    finally:
        connection.close()

    assets: List[SvgAsset] = []
    for row in rows:
        asset = _asset_from_row(row)
        if asset is not None:
            assets.append(asset)
    return assets
