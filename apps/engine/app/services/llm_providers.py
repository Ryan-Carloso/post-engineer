"""Registry of LLM provider names the engine can dispatch (issue #159).

SUPPORTED_LLM_PROVIDERS is the single source of truth shared by the
fail-fast guard below and its error message, so the two cannot drift
apart. A test pins the dispatch chain in llm.py to exactly this set.
"""

SUPPORTED_LLM_PROVIDERS = (
    "g4f",
    "moonshot",
    "ollama",
    "openai",
    "aihubmix",
    "aimlapi",
    "oneapi",
    "azure",
    "gemini",
    "grok",
    "groq",
    "qwen",
    "cloudflare",
    "minimax",
    "evolink",
    "mimo",
    "volcengine",
    "zai",
    "openrouter",
    "openrouter_free",
    "modelscope",
    "ernie",
    "pollinations",
    "litellm",
)


def validate_llm_provider(llm_provider: str) -> None:
    """Fail fast with a clear error on unknown provider names.

    Without this guard an unknown name (e.g. a typo in config.toml) fell
    through every dispatch branch, left api_key unbound, and surfaced as
    the cryptic UnboundLocalError "cannot access local variable 'api_key'".
    """
    if llm_provider not in SUPPORTED_LLM_PROVIDERS:
        raise ValueError(
            f"unknown llm_provider: {llm_provider!r}; "
            f"supported providers: {', '.join(SUPPORTED_LLM_PROVIDERS)}"
        )
