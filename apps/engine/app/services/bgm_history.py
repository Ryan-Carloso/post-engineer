"""Persistent per-user BGM selection history."""

import sqlite3
import threading
from pathlib import Path

from app.config import config


class SQLiteBgmHistoryRepository:
    def __init__(self, database_path: Path):
        self._database_path = database_path
        self._lock = threading.RLock()
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS bgm_history (user_id TEXT NOT NULL, file_path TEXT NOT NULL, selected_at INTEGER NOT NULL)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_bgm_history_user ON bgm_history (user_id, selected_at DESC)")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._database_path)

    def recent(self, user_id: str) -> list[str]:
        with self._lock, self._connect() as connection:
            rows = connection.execute("SELECT file_path FROM bgm_history WHERE user_id = ? ORDER BY selected_at DESC, rowid DESC LIMIT 3", (user_id,)).fetchall()
        return [str(row[0]) for row in rows]

    def record(self, user_id: str, file_path: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("INSERT INTO bgm_history(user_id, file_path, selected_at) VALUES (?, ?, strftime('%s','now'))", (user_id, file_path))
            connection.execute("DELETE FROM bgm_history WHERE user_id = ? AND rowid NOT IN (SELECT rowid FROM bgm_history WHERE user_id = ? ORDER BY selected_at DESC, rowid DESC LIMIT 3)", (user_id, user_id))


history_repository = SQLiteBgmHistoryRepository(
    Path(config.app.get("bgm_history_db", "storage/bgm_history.sqlite3"))
)
