"""Make the engine package importable in normal and mutmut test runs."""

from pathlib import Path
import sys


TEST_ROOT = Path(__file__).resolve().parent.parent
if str(TEST_ROOT) not in sys.path:
    sys.path.insert(0, str(TEST_ROOT))
