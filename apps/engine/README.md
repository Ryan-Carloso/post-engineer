# apps/engine — Publish worker

Python 3.11–3.12 / FastAPI service that publishes scheduled posts. Every 60
seconds it reads the ready slots in Supabase (`scheduled_posts`), downloads
the video or image the user uploaded, and publishes it to each account
through the web upload API (`POST /api/upload-content`), with per-account
retries. It generates no media. Derived from
[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT, see
`LICENSE` in this directory).

HTTP routes: `/health`, `/version` and `/ping` only.

## Develop

```bash
pnpm dev:engine     # from repo root → uv run python main.py (http://127.0.0.1:8080)
```

Or directly in this directory (requires [uv](https://docs.astral.sh/uv/)):

```bash
uv sync                  # install dependencies from uv.lock
cp config.example.toml config.toml
uv run python main.py    # start the API (port from config.toml `listen_port`, default 8080)
```

Requires `apps/engine/.env` (from `.env.example`): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `MPT_UPLOAD_API_BASE_URL` and
`MONEYPRINT_API_SECRET`.

Docker: `docker compose up -d --build` (service `engine`,
`127.0.0.1:8080:8080`; `config.toml` is mounted read-only, secrets come from
`.env` — never baked into the image).

## Test / lint / typecheck

```bash
uv run pytest -q                            # test suite
uv run ruff check app test                  # lint
uv run mypy app                             # typecheck
```

From the repo root these run via Nx: `pnpm test`, `pnpm lint`, `pnpm typecheck`.

See [AGENTS.md](AGENTS.md) for the rules.
