# MoneyPrinterTurbo — Agent Rules

These rules apply to every agent (human or AI) making changes in this repository.
They exist so that video-generation behaviour stays consistent across every
entry point (CLI, HTTP API, WebUI, batch runner, tests) and is controlled from
one place.

---

## 1. Video-generation logic lives in config + schema, NEVER in tests

**Absolute rule.** A test must exercise the production defaults — it must NOT
override video-generation behaviour.

### Forbidden in test files (`test/**/*.py`)
- Setting `video_script_prompt` or `custom_system_prompt` to change how the
  script is written (sentence length, punctuation, tone, language rules…).
- Overriding subtitle styling (`subtitle_position`, `font_name`,
  `text_background_color`, `font_size`, `stroke_width`,
  `rounded_subtitle_background`, …).
- Hardcoding `video_aspect`, `voice_name`, `bgm_type`, `video_codec`, or any
  other field that changes the *look, sound, or structure* of the output.

### Allowed in test files
- `video_subject`, `video_language`, `voice_name`, `video_aspect` — i.e.
  the **what** (the topic and its language), not the **how** (rendering /
  caption style).
- Assertions on the produced files (exists, non-empty, valid mp4).

### Where the behaviour MUST be changed instead
- **Subtitle styling** → `config.toml` `[ui]` section
  (read by `app/models/schema.py` `VideoParams`).
- **Script/caption style** (sentence length, punctuation rhythm) →
  `config.toml` `[app]` `default_video_script_prompt`
  (read by `VideoParams.video_script_prompt`).
- **Encoding speed** → `config.toml` `[app]` `video_codec`
  (use `h264_videotoolbox` on macOS for ~10x speedup).

If you find yourself wanting to change how a video looks or reads from inside
a test, **stop** — add it to `config.toml` instead, then let the test verify
the default works.

---

## 2. Single source of truth: `config.toml`

`VideoParams` in `app/models/schema.py` reads its defaults from `config.app`
and `config.ui`. New tunable fields MUST be wired through config the same way:

```python
# GOOD — default comes from config, with a safe fallback
font_name: Optional[str] = config.ui.get("font_name", "STHeitiMedium.ttc")

# BAD — hardcoded, can't be changed without a code edit
font_name: Optional[str] = "STHeitiMedium.ttc"
```

When you add a new tunable:
1. Add it to `config.toml` and `config.example.toml` with a doc comment.
2. Wire `VideoParams` to read it via `config.app.get(...)` / `config.ui.get(...)`.
3. Keep the fallback identical to the previous behaviour (no silent change).

The WebUI (`webui/Main.py`) already reads `config.ui` for subtitle styling, so
anything you add there propagates to every entry point automatically.

---

## 3. Language is a runtime parameter, never hardcoded in prompts

The script-generation prompt is built by `build_script_prompt()` in
`app/services/llm.py`. It receives `language` as a separate field and injects
it as `- language: <code>`. Therefore:

- Instruction-style prompt text (like `default_video_script_prompt`) MUST be
  written in **English** (the instruction language), never in the output
  language. The LLM then writes the script in whatever `language` the task
  requested.
- Do NOT bake "write in Portuguese" / "escreva em português" into a default
  prompt. That breaks every other language. Pass `video_language` instead.

---

## 4. macOS rendering: use VideoToolbox

Software `libx264` encoding on macOS is ~10× too slow for this pipeline
(concat of ~10 clips can take 14+ minutes and time out). Always set in
`config.toml`:

```toml
video_codec = "h264_videotoolbox"
```

The code falls back to `libx264` automatically if the hardware encoder is
unavailable, so this is safe on any host.

---

## 5. Keys and secrets

- `config.toml`, `apps/engine/.env`, and any `project.md`-style scratch files
  may contain real API keys — they are gitignored and must NEVER be committed.
- The engine's `Dockerfile` must never `COPY` secret-bearing files into image
  layers; secrets arrive at runtime via env files or mounted config.
- Never print secret values in logs, diffs, or comments.
---

## 6. Tests

- Test runner: `pytest`; tests may use either pytest functions or `unittest.TestCase`.
- Integration tests (anything hitting real LLM / TTS / Pexels) MUST be gated
  behind `MPT_RUN_INTEGRATION_TESTS=1` via `@unittest.skipUnless(...)`.
- A test that calls `tm.start(...)` end-to-end is for verifying that the
  **production defaults** produce a valid video — not for redefining those
  defaults.
- The engine test suite must maintain at least **60% line coverage**. Run
  `make coverage` (or the equivalent `uv run coverage ...` commands) and treat
  any result below 60% as a failure.

---

