"""
Search HTTP client kept for place photos only (Phase 5 PR 5).

The pre-script fact lookup (fetch_facts / format_facts_block) is deleted
with the LLM script controller: scripts now come from segments only, so
nothing fetches facts for a prompt anymore. What remains is the client
surface place_photos.py needs: the Tavily endpoint, the provider key map,
the client builder, the place-photos switch, and the startup config check.

Fail-loud rule (no silent env fallbacks): when ``enabled = true`` and none of
the configured providers has a key, ``validate_config`` raises and the app
refuses to boot. Keys are read from the environment (TAVILY_API_KEY /
EXA_API_KEY) — they never live in this repo.
"""

from __future__ import annotations

import os
from typing import Protocol

import httpx
from loguru import logger

from app.config import config

DEFAULT_TIMEOUT_SECONDS = 8.0

# Module-level snapshot of the `[search]` config section. Tests patch this
# attribute to drive different configurations; call sites must read it at
# call time, never at the caller's import time.
_search_section = config._cfg.get("search", {}) or {}

PROVIDER_ENV_KEYS = {
    "tavily": "TAVILY_API_KEY",
    "exa": "EXA_API_KEY",
}

TAVILY_SEARCH_URL = "https://api.tavily.com/search"


class _HttpPostClient(Protocol):
    """Boundary seam: tests inject a stub, production passes httpx.Client."""

    def post(
        self, url: str, json: dict[str, object], headers: dict[str, str]
    ) -> httpx.Response: ...


def _configured_providers() -> list[str]:
    providers = _search_section.get("providers", ["tavily", "exa"])
    if isinstance(providers, list):
        return [str(provider) for provider in providers]
    return []


def _build_client() -> httpx.Client:
    timeout = float(_search_section.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS))
    return httpx.Client(timeout=timeout)


def place_photos_enabled() -> bool:
    """True when named-place photos are switched on and can be looked up.

    Needs the search itself on, the literal ``place_photos = true`` and a
    Tavily key: only Tavily returns image descriptions, which are how a
    photo is matched to the place it must show.
    """
    if not bool(_search_section.get("enabled", False)):
        return False
    if _search_section.get("place_photos", False) is not True:
        return False
    return bool(os.getenv(PROVIDER_ENV_KEYS["tavily"], "").strip())


def validate_config() -> None:
    """Fail loudly at startup when search is enabled with no usable provider.

    ``enabled = true`` demands at least one configured provider with a
    non-empty API key in the environment. A key missing from one provider
    but present in another only logs at runtime (the fallback chain skips
    it and moves to the next).
    """
    if not bool(_search_section.get("enabled", False)):
        return
    providers = _configured_providers()
    missing: list[str] = []
    has_key = False
    for provider in providers:
        env_name = PROVIDER_ENV_KEYS.get(provider)
        if env_name is None:
            logger.warning(
                "[search] providers contains unsupported provider "
                f"'{provider}'; it will be skipped at runtime"
            )
            missing.append(provider)
            continue
        if os.getenv(env_name, "").strip():
            has_key = True
            continue
        missing.append(provider)
    if not has_key:
        raise ValueError(
            "config.toml [search] enabled=true but no configured search provider "
            "has an API key in the environment (missing: "
            f"{', '.join(missing) or 'no providers configured'})"
        )
    if missing:
        names = ", ".join(missing)
        logger.warning(
            f"[search] enabled but {names} missing its API key; "
            "the fallback chain skips it at runtime"
        )
    if _search_section.get("place_photos", False) is True and not os.getenv(
        PROVIDER_ENV_KEYS["tavily"], ""
    ).strip():
        logger.warning(
            "[search] place_photos needs TAVILY_API_KEY in the environment; "
            "place photos are skipped"
        )
