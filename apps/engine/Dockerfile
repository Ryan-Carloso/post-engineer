# Engine CPU image — ffmpeg pipeline only, no CUDA/torch/GPU deps.
# Python version pinned to match pyproject (>=3.11,<3.13) and uv.lock.
FROM python:3.11-slim-bookworm

# uv pinned for reproducible dependency installs from uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.8.24 /uv /uvx /bin/

# System deps: ffmpeg (render/concat), libgomp1 (ctranslate2/faster-whisper),
# ca-certificates (outbound HTTPS), tzdata (deterministic timezone).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ffmpeg \
        libgomp1 \
        ca-certificates \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=UTC \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Dependency layer first: rebuilds only when the lockfile changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Application code and static assets (fonts are required by the render
# path). config.toml is NOT copied: it may contain provider API keys, so it
# is mounted at runtime instead (see docker-compose.yml).
COPY app ./app
COPY resource/fonts ./resource/fonts
COPY main.py ./

# Non-root runtime user; storage must be writable for tasks/ and caches.
RUN useradd --create-home --uid 10001 engine \
    && mkdir -p /app/storage /app/logs \
    && chown -R engine:engine /app
USER engine

# config.toml is mounted at runtime (contains no secrets in the image).
# Required env (Supabase, upload API, InfiniteTalk endpoint) is injected by
# docker-compose; the app fails explicitly when something mandatory is absent.
ENV MPT_STORAGE_DIR=/app/storage

EXPOSE 8080

# Healthcheck validates the API is serving without rendering anything.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/docs', timeout=4).status < 500 else 1)"

CMD ["uv", "run", "--frozen", "--no-sync", "python", "main.py"]
