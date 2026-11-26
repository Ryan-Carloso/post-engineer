# Post Engineer (engine) — Agent Rules

These rules apply to every agent (human or AI) making changes in this
directory. The engine is the publish worker: every 60 seconds it publishes
the scheduled slots whose media the user uploaded (`app/services/publisher/`).
It generates no media.

---

## 1. Keys and secrets

- `config.toml`, `apps/engine/.env`, and any `project.md`-style scratch files
  may contain real API keys — they are gitignored and must NEVER be committed.
- The engine's `Dockerfile` must never `COPY` secret-bearing files into image
  layers; secrets arrive at runtime via env files or mounted config.
- Never print secret values in logs, diffs, or comments.
---

## 2. Tests

- Test runner: `pytest`; tests may use either pytest functions or `unittest.TestCase`.
- Tests never reach a real network service: Supabase, the web upload API
  and PostHog are faked (`test/conftest.py` replaces the PostHog client).
- The engine test suite must maintain at least **60% line coverage**. Run
  `uv run coverage run --source=app -m pytest -q && uv run coverage report -m`
  and treat any result below 60% as a failure.

### Structural source-scan tests must be mutmut-aware

- mutmut 3.x runs the suite against a single transformed file
  (`mutants/<module>.py`): every function exists as `x__<name>__mutmut_orig`
  plus one `x__<name>__mutmut_<N>` copy per mutant (`mangle_function_name`
  is `"x_" + name + "__mutmut"`; the working `<name>` becomes a trampoline).
- A test that reads `some_module.__file__` and reasons about function names
  (AST pins like `test_no_direct_failed_writes_outside_fail_task`) sees the
  MANGLED names under mutmut. Exempting only the literal name reports every
  copy of the pinned function's own body as an offender (184 false
  positives broke the `mutation (engine)` CI job on PR #97).
- Recognize mutmut's mangled copies of the pinned function
  (`^x__<name>__mutmut_(?:orig|\d+)$`); keep inspecting mangled copies of
  other functions so real mutant-introduced violations are still caught.
  Pin the mangling with regression tests (`MutmutSourceScanTests`).
- Verify against a real mutmut transform, not a hand-rolled one: use
  mutmut's own `mutate_file_contents` on the module, or the `mutants/`
  artifact from a failed CI run.
- **`patch.dict(os.environ, ..., clear=True)` blinds mutmut.** mutmut 3.x
  activates the mutant under test through the `MUTANT_UNDER_TEST` env var,
  read at call time by its trampoline; a plain `clear=True` wipes it, so
  every mutant trivially "survives" (the original code always runs) and the
  stats run associates no tests to the mutated functions. Tests that need a
  cleared env must preserve the variable. Outside mutmut it is unset, so the
  helper behaves exactly like `patch.dict(clear=True)`.
- Every module under `app/` has a direct test file, or its mutmut shard
  fails with "could not find any test case for any mutant".

---

