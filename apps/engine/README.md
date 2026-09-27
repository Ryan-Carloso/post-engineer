# apps/engine — Video-generation engine

Python 3.11–3.12 / FastAPI service that turns a topic into a finished short
video: script (LLM), voiceover (TTS), subtitles, stock footage, background
music, and publishing. Derived from
[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT, see
`LICENSE` in this directory), heavily extended with personas, lip-sync,
batch queue, scheduling, and social publishing.

The engine is called by `apps/web` over HTTP, authenticated with the shared
`MONEYPRINT_API_SECRET`. API docs are served at `/docs` when running.

## Develop

```bash
pnpm dev:engine     # from repo root → uv run python main.py (http://127.0.0.1:8080)
```

Or directly in this directory (requires [uv](https://docs.astral.sh/uv/)):

```bash
uv sync                  # install dependencies from uv.lock
cp config.example.toml config.toml   # then fill in provider keys
uv run python main.py    # start the API (port from config.toml `listen_port`, default 8080)
```

Requires `apps/engine/.env` (from `.env.example`) and `config.toml` (from
`config.example.toml`). `ffmpeg` must be on `PATH`.

Docker (CPU): `docker compose up -d --build` (service `engine`,
`127.0.0.1:8080:8080`; `config.toml` is mounted read-only, secrets come from
`.env` — never baked into the image).

## Test / lint / typecheck

```bash
uv run pytest -q                          # test suite
uv run ruff check app cli.py scripts test # lint
uv run python -m compileall -q app cli.py main.py  # typecheck (compile check)
```

From the repo root these run via Nx: `pnpm test`, `pnpm lint`, `pnpm typecheck`.

## Conventions

- Video-generation behavior is controlled by `config.toml` (see
  [AGENTS.md](AGENTS.md)) — never override rendering/script behavior inside
  tests.
- Integration tests hitting real LLM/TTS/stock APIs must be gated behind
  `MPT_RUN_INTEGRATION_TESTS=1`.
- All comments in English.
- Never print or log secrets, tokens, or API keys.
