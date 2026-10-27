"""The secrets audit reports missing key NAMES only, never values.

An operator script comparing apps/engine/.env.example and
config.example.toml against the private secrets tree
(secrets/{prod,dev}/engine/*). It must print exactly the missing names
and exit nonzero when something is missing: a missing key currently means
a half-configured environment (e.g. the SVG catalog silently off in
production), and the operator decides which gaps to fill.
"""

import io
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.audit_secrets import (
    MissingAudit,
    audit_paths,
    env_key_names,
    run_audit,
    toml_key_names,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_env_parsing_returns_key_names_only():
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "env.example"
        _write(path, "A_KEY=1\nB_KEY=2\n# comment=need\n   \nBOGUS.nope=3\n")
        names = env_key_names(path)
    assert names == ["A_KEY", "B_KEY"]


def test_toml_parsing_returns_section_and_key_names():
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "config.example.toml"
        _write(path, 'top = "value"\n[app]\nextra_key = "x"\n')
        names = toml_key_names(path)
    assert names == ["top", "app.extra_key"]


def test_audit_with_everything_present_reports_nothing_missing():
    with _layout("A_KEY=1\nB_KEY=2\n", "k = 1\n", "A_KEY=1\nB_KEY=2\n", "k = 2\n") as paths:
        audit = audit_paths(*paths)
    assert audit == MissingAudit(missing_env=[], missing_config=[])


def test_audit_reports_every_missing_side():
    with _layout("A_KEY=1\nB_KEY=2\n", "k = 1\nj = 2\n", "", "") as paths:
        audit = audit_paths(*paths)
    assert audit.missing_env == ["A_KEY", "B_KEY"]
    assert audit.missing_config == ["j", "k"]


def test_run_audit_prints_missing_names_and_never_values():
    with _layout("A_KEY=1\nB_KEY=2\n", "k = 1\n", "", "") as paths:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = run_audit(*paths)
    out = buffer.getvalue()
    assert "A_KEY" in out
    assert "k" in out
    assert code == 1
    assert "B_KEY=2" not in out
    assert "=1" not in out


def _layout(env_example: str, config_example: str, real_env: str, real_config: str):
    import contextlib

    @contextlib.contextmanager
    def ctx():
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "secrets" / "prod" / "engine"
            examples = Path(tmp) / "examples"
            _write(examples / ".env.example", env_example)
            _write(examples / "config.example.toml", config_example)
            _write(root / ".env", real_env)
            _write(root / "config.toml", real_config)
            yield (
                examples / ".env.example",
                examples / "config.example.toml",
                root / ".env",
                root / "config.toml",
            )

    return ctx()
