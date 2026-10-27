"""Audit the private secrets tree against the example files, names only.

Compares apps/engine/.env.example and config.example.toml against
secrets/{prod,dev}/engine/{.env,config.toml}, prints ONLY the names of
the keys that are missing, and exits 1 when anything is missing. Never
prints, logs, or compares values: the operator decides which gaps to
fill (some are deliberate — e.g. the SVG catalog off by default in
production).

Usage (from apps/engine):
    .venv/bin/python -m scripts.audit_secrets            # both trees
    .venv/bin/python -m scripts.audit_secrets --tree prod
"""

import argparse
import sys
import tomllib
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
# The secrets tree lives in the parent repo (post-engineer-repos/secrets).
DEFAULT_SECRETS_DIR = ENGINE_ROOT.parents[1].parent / "secrets"


def env_key_names(path: Path) -> list[str]:
    """KEY names from a .env-style file, comments and blanks skipped."""
    names: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name, sep, _value = stripped.partition("=")
        if not sep or not name.replace("_", "").isalnum():
            continue
        names.append(name)
    return names


def toml_key_names(path: Path) -> list[str]:
    """Every key name in a TOML file, section-scoped (`table.key`).

    Top-level keys have no prefix. The section is part of the name so a
    key repeated under two tables is not reported as present in both.
    """
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for key, value in data.items():
        if isinstance(value, dict):
            names.extend(f"{key}.{sub_key}" for sub_key in value)
        else:
            names.append(key)
    return names


def _sorted_unique(names: list[str]) -> list[str]:
    return sorted(set(names))


class MissingAudit:
    """Missing key names per file, one side of the audit."""

    def __init__(self, missing_env: list[str], missing_config: list[str]):
        self.missing_env = missing_env
        self.missing_config = missing_config

    def __eq__(self, other) -> bool:
        if not isinstance(other, MissingAudit):
            return NotImplemented
        return (
            self.missing_env == other.missing_env
            and self.missing_config == other.missing_config
        )

    def missing_names(self) -> list[str]:
        return _sorted_unique(self.missing_env + self.missing_config)


def audit_paths(
    env_example: Path,
    config_example: Path,
    real_env: Path,
    real_config: Path,
) -> MissingAudit:
    """Missing NAMES per side, or an empty audit when everything exists."""
    for path in (env_example, config_example, real_env, real_config):
        if not path.exists():
            raise FileNotFoundError(f"audit input missing: {path}")
    expected_env = env_key_names(env_example)
    actual_env = env_key_names(real_env)
    expected_config = toml_key_names(config_example)
    actual_config = toml_key_names(real_config)
    return MissingAudit(
        missing_env=_sorted_unique(
            [name for name in expected_env if name not in actual_env]
        ),
        missing_config=_sorted_unique(
            [name for name in expected_config if name not in actual_config]
        ),
    )


def run_audit(
    env_example: Path,
    config_example: Path,
    real_env: Path,
    real_config: Path,
) -> int:
    """Print missing names per side; exit 1 when anything is missing."""
    audit = audit_paths(env_example, config_example, real_env, real_config)
    if audit.missing_env or audit.missing_config:
        env_missing = _sorted_unique(audit.missing_env)
        config_missing = _sorted_unique(audit.missing_config)
        if env_missing:
            print(f"missing env keys (names only): {' '.join(env_missing)}")
        if config_missing:
            print(f"missing config keys (names only): {' '.join(config_missing)}")
        return 1
    print("secrets audit: every expected key name present")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Report missing key NAMES in the secrets tree (never values)."
    )
    parser.add_argument("--tree", choices=("prod", "dev"), default=None)
    args = parser.parse_args()
    env_example = ENGINE_ROOT / ".env.example"
    config_example = ENGINE_ROOT / "config.example.toml"
    exit_code = 0
    for tree in [args.tree] if args.tree else ["prod", "dev"]:
        engine_dir = DEFAULT_SECRETS_DIR / tree / "engine"
        print(f"== secrets/{tree}/engine ==")
        code = run_audit(
            env_example,
            config_example,
            engine_dir / ".env",
            engine_dir / "config.toml",
        )
        exit_code = exit_code or code
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
