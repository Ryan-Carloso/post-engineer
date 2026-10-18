"""Pin the mutmut runner that can finish a shard when tests spawn children.

mutmut's default fork runner reaps with ``os.wait()`` and indexes the pid
in its worker table (``read_one_child_exit_status`` / ``ForkRunner.wait_for_result``).
The clean-test pass runs inside that same process. A daemon thread the suite
starts — the engine heartbeat calls ``subprocess.run`` for nvidia-smi, and
video tests spawn ffmpeg — is then a direct child of mutmut. The next
``os.wait()`` can reap that child and the shard dies with ``KeyError: <pid>``
before any score is written (PRs #222 and #223).

mutmut 3.8's forkserver runner executes the suite in its own process and
skips pids it did not fork. Both the version floor and ``process_isolation``
have to move together: 3.7 reads the key and ignores it.
"""

import tomllib
import unittest
from pathlib import Path


def _engine_root() -> Path:
    return Path(__file__).parent.parent


def _pyproject() -> dict:
    with (_engine_root() / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)


def _locked_mutmut_version() -> str:
    with (_engine_root() / "uv.lock").open("rb") as handle:
        lock = tomllib.load(handle)
    versions = [package["version"] for package in lock["package"] if package["name"] == "mutmut"]
    if len(versions) != 1:
        raise AssertionError(f"expected one mutmut entry in uv.lock, found {versions}")
    return versions[0]


class MutmutRunnerPinTests(unittest.TestCase):
    def test_mutmut_floor_is_the_forkserver_release(self):
        dev = _pyproject()["dependency-groups"]["dev"]
        mutmut_specs = [spec for spec in dev if spec.startswith("mutmut")]
        self.assertEqual(
            mutmut_specs,
            ["mutmut>=3.8.0"],
            "mutmut 3.7 ignores process_isolation and KeyErrors on stray children",
        )

    def test_lock_pins_mutmut_3_8(self):
        # The floor alone does not install 3.8 until the lock moves. A stale
        # 3.7 lock fails ``uv sync --frozen`` only after CI has already
        # checked out; this pin fails the suite first.
        self.assertEqual(_locked_mutmut_version(), "3.8.0")

    def test_process_isolation_is_forkserver(self):
        isolation = _pyproject()["tool"]["mutmut"].get("process_isolation")
        self.assertEqual(
            isolation,
            "forkserver",
            "the fork runner reaps every child with os.wait(); stray "
            "nvidia-smi/ffmpeg children crash the shard with KeyError",
        )


if __name__ == "__main__":
    unittest.main()
