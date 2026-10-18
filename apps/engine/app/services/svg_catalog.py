"""Read-only search over the private SVG catalog (resource/svg/_index).

The catalog is a Doodly bundle licensed for private use: the artwork and its
index never live in the public repo. They are injected on deploy and read from
disk, so `rsvg-convert` can rasterize from a real filesystem path.

Search is SQLite FTS5 over the ``search`` table built by the catalog indexer.
Only the text mode is implemented: it needs no extra dependency and covers the
whole catalog. The config exposes ``svg_search_mode`` so a future semantic
index can be wired without another config change; today a semantic request
warns and degrades to text rather than failing the render.
"""
from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from typing import List, Optional

from loguru import logger

from app.config import config
from app.config.config import root_dir
from app.utils import file_security


@dataclass(frozen=True)
class SvgAsset:
    """One catalog entry resolved to a file on disk."""

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


def _config_path(key: str, default: str) -> str:
    return os.path.join(root_dir, str(config.app.get(key, default) or default).strip())


def assets_root() -> str:
    return _config_path("svg_assets_root", "resource/svg")


def index_dir() -> str:
    return _config_path("svg_catalog_index_dir", "resource/svg/_index")


def _catalog_db() -> str:
    return os.path.join(index_dir(), "catalog.sqlite")


def is_enabled() -> bool:
    """The feature is opt-in and needs a real index on disk.

    Both checks matter: a deployment without the private artwork must degrade
    to the stock providers instead of failing every render.
    """
    if not _config_bool("svg_catalog_enabled", False):
        return False
    return os.path.isfile(_catalog_db())


def resolve_asset_path(relative_path: str) -> str:
    """Map an index-relative path to a real file, refusing to escape the root.

    The relative path comes from the catalog index, not from the caller, but it
    still travels through the generic path guard: a tampered or rebuilt index
    must not be able to point the renderer at an arbitrary file.
    """
    root = assets_root()
    # require_file=False so a missing file raises FileNotFoundError below:
    # traversal is a ValueError from the guard, absence is its own signal.
    resolved = file_security.resolve_path_within_directory(
        root, relative_path, require_file=False
    )
    if not resolved.lower().endswith(".svg"):
        raise ValueError("not an svg file")
    if not os.path.isfile(resolved):
        raise FileNotFoundError(relative_path)
    return resolved


def _search_mode() -> str:
    mode = str(config.app.get("svg_search_mode", "texto")).strip().lower()
    if mode not in ("hibrido", "semantico", "texto"):
        logger.warning(f"unknown svg_search_mode={mode!r}, using texto")
        return "texto"
    if mode != "texto" and not _semantic_models_available():
        logger.warning(
            "svg_search_mode requires an ONNX index under "
            "svg_catalog_index_dir/models; falling back to texto"
        )
        return "texto"
    return mode


def _semantic_models_available() -> bool:
    # Reserved for the semantic index. No dependency on onnxruntime exists yet,
    # so this is always False and every non-text mode degrades to text.
    return False


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_catalog_db())
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

    A row whose JSON is malformed or whose file has gone missing must not abort
    the whole search: the caller falls back to the remaining assets.
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
    except (ValueError, FileNotFoundError):
        logger.warning(f"svg_catalog: unreadable asset {relative_path}")
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

    connection = _connect()
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