import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _migration_path() -> Path:
    start = Path(__file__).resolve()
    for parent in start.parents:
        candidate = (
            parent
            / "supabase"
            / "migrations"
            / "032_schedules-drop-post-script-prompt.sql"
        )
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("032_schedules-drop-post-script-prompt.sql not found")


class DropPostScriptPromptMigrationTests(unittest.TestCase):
    def test_sql_drops_only_the_dead_column_when_it_exists(self):
        sql = _migration_path().read_text(encoding="utf-8")
        self.assertIn("table_name = 'schedules'", sql)
        self.assertIn("column_name = 'post_script_prompt'", sql)
        self.assertIn(
            "alter table public.schedules drop column post_script_prompt", sql
        )
        # No backfill: the value fed only the deleted LLM script path.
        self.assertNotIn("update public.schedules", sql)
        # Idempotent: guarded so re-applying after the drop is a no-op.
        self.assertIn("if exists", sql)
