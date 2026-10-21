import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _migration_path() -> Path:
    start = Path(__file__).resolve()
    for parent in start.parents:
        candidate = parent / "supabase" / "migrations" / "023_cloned-voices.sql"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("023_cloned-voices.sql not found")


class ClonedVoicesMigrationLiteralsTests(unittest.TestCase):
    def test_sql_literals_match_engine_contract(self):
        sql = _migration_path().read_text(encoding="utf-8")
        self.assertIn("create table if not exists public.cloned_voices", sql)
        self.assertIn("status in ('pending', 'ready', 'failed')", sql)
        self.assertIn("consent_at timestamptz not null", sql)
        self.assertIn("storage_path text not null", sql)
        self.assertIn("engine_voice_key text not null", sql)
        self.assertIn("error_code text", sql)
        self.assertIn("cloned_voices_owner_all", sql)
        self.assertIn("user_id = auth.uid()", sql)
