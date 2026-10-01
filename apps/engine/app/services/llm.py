import json
import logging
import re
import time

import requests
from typing import Any, List

from loguru import logger
from openai import AzureOpenAI, OpenAI
from openai.types.chat import ChatCompletion

from app.config import config
from app.services.analytics import scrub_secret_values, track_ai_request
from app.utils import secret_redaction

_max_retries = 5
_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
_DEFAULT_POLLINATIONS_MODEL = "openai-fast"
_DEPRECATED_GEMINI_MODELS = {"gemini-pro", "gemini-1.0-pro"}
MIN_SCRIPT_PARAGRAPH_NUMBER = 1
MAX_SCRIPT_PARAGRAPH_NUMBER = 10
MAX_SCRIPT_PROMPT_LENGTH = 2000
MAX_SCRIPT_SYSTEM_PROMPT_LENGTH = 8000
_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.IGNORECASE | re.DOTALL)
_UNCLOSED_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*$", re.IGNORECASE | re.DOTALL)
_URL_USERINFO_RE = re.compile(r"((?:https?|wss?)://)([^/\s?#@]*:[^/\s?#@]*@)", re.IGNORECASE)
_SENSITIVE_QUERY_RE = re.compile(
    r"([?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=)([^&#\s]+)",
    re.IGNORECASE,
)

DEFAULT_SCRIPT_SYSTEM_PROMPT = """
# Role: Video Script Generator

## Goals:
Generate a script for a video, depending on the subject of the video.

## Constrains:
1. do not under any circumstance reference this prompt in your response.
2. get straight to the point, don't start with unnecessary things like, "welcome to this video".
3. you must not include any type of markdown or formatting in the script, never use a title.
4. only return the raw content of the script.
5. do not include "voiceover", "narrator" or similar indicators of what should be spoken at the beginning of each paragraph or line.
6. you must not mention the prompt, or anything about the script itself. also, never talk about the amount of paragraphs or lines. just write the script.
7. respond in the same language as the video subject.
""".strip()


def _normalize_text_response(content, llm_provider: str) -> str:
    # Different LLM SDKs may return None, empty strings, or even non-string
    # objects in error/intercepted scenarios. Normalize defensively here so
    # later `.replace()` calls don't raise `NoneType` attribute errors.
    if content is None:
        raise ValueError(f"[{llm_provider}] returned empty text content")

    if not isinstance(content, str):
        raise TypeError(
            f"[{llm_provider}] returned non-text content: {type(content).__name__}"
        )

    # Some models wrap their output in `<think>...</think>`. Video scripts and
    # keywords only need the final speakable text — without a centralized
    # cleanup here, the WebUI, subtitles, and voiceover would all treat the
    # reasoning trace as body text.
    content = _THINK_BLOCK_RE.sub("", content)
    content = _UNCLOSED_THINK_BLOCK_RE.sub("", content).strip()
    if not content:
        raise ValueError(f"[{llm_provider}] returned empty text content")

    # Replace newlines with spaces, then ensure proper spacing after punctuation
    content = content.replace("\n", " ")
    # Add space after punctuation if missing
    content = re.sub(r'([.!?])([^\s])', r'\1 \2', content)
    # Collapse multiple spaces into single
    content = re.sub(r'\s+', ' ', content).strip()
    return content


def _sanitize_error_message(error: object) -> str:
    """
    Scrub error messages returned to the WebUI/API so credentials in a custom
    base_url can't leak.

    Some OpenAI-compatible SDKs paste the request URL verbatim into exception
    text. If a user configured `https://user:pass@example.com/v1` for a proxy
    gateway, returning `str(e)` directly would expose the password to the
    page, API callers, or downstream logs. Only the message text is handled
    here; the actual request address is untouched so the call chain keeps
    working.
    """
    message = str(error)
    message = _URL_USERINFO_RE.sub(r"\1***:***@", message)
    message = _SENSITIVE_QUERY_RE.sub(r"\1***", message)
    return message


def _extract_chat_completion_text(response, llm_provider: str) -> str:
    # OpenAI-compatible endpoints may return response objects with no
    # choices, or with empty choices/message/content, in error scenarios.
    # Validate the structure here so low-level attribute errors like
    # `NoneType is not subscriptable` never surface.
    choices = getattr(response, "choices", None)
    if not choices:
        raise ValueError(f"[{llm_provider}] returned empty choices")

    first_choice = choices[0]
    message = getattr(first_choice, "message", None)
    if message is None:
        raise ValueError(f"[{llm_provider}] returned empty message")

    content = getattr(message, "content", None)
    return _normalize_text_response(content, llm_provider)


def _extract_usage(response: object) -> dict[str, Any]:
    """Pull token/cost usage off an OpenAI-compatible response, if present.

    All OpenAI-compatible providers report prompt/completion/total tokens.
    OpenRouter additionally reports the request cost directly as
    usage.cost. Absent fields stay absent — the tracker defaults them.
    """
    usage: dict[str, Any] = {}
    raw = getattr(response, "usage", None)
    if raw is None:
        return usage
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = _get_response_field(raw, key)
        # bool is a subclass of int — exclude it so a malformed
        # `total_tokens: true` payload can't ship as 1.
        if isinstance(value, int) and not isinstance(value, bool):
            usage[key] = value
    cost = _get_response_field(raw, "cost")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool):
        usage["cost_usd"] = float(cost)
    return usage


def _get_response_field(value, key: str):
    """Read a field from either a dict or an SDK response object."""
    if isinstance(value, dict):
        return value.get(key)

    try:
        return value[key]
    except (KeyError, TypeError, AttributeError):
        return getattr(value, key, None)


def _extract_qwen_generation_text(response) -> str:
    """
    Extract text from a DashScope Generation response.

    Qwen returns the chat shape `output.choices[0].message.content` when
    called with `messages`; only the legacy completion shape returns
    `output.text`. Both paths are handled so a None `output.text` can't
    trigger an undiagnosable AttributeError on a later `.replace()`.
    """
    output = _get_response_field(response, "output")
    choices = _get_response_field(output, "choices") if output else None
    if choices is not None:
        if not choices:
            logger.warning("Qwen returned an empty choices list")
            raise ValueError("[qwen] returned empty choices")

        first_choice = choices[0]
        message = _get_response_field(first_choice, "message")
        content = _get_response_field(message, "content") if message else None
        if content is not None:
            return _normalize_text_response(content, "qwen")

    text = _get_response_field(output, "text") if output else None
    return _normalize_text_response(text, "qwen")


class LLMResponseError(Exception):
    """
    Already-sanitized generation failure, raised by _generate_response_inner.

    Using a typed exception (instead of sniffing the "Error: " prefix in
    the response) avoids treating a valid model response that starts with
    "Error: " as a failure, and allows passing the provider as an explicit
    argument without mutating the global config.
    """


# OpenAI-compatible client: with 1 SDK-internal retry, a hung gateway
# (accepts TCP but never responds) fails in ~2 min — and only then does the
# fallback to OpenRouter kick in. Without this, the SDK default (600s x 3 attempts)
# would make the caller wait ~30 min for the fallback.
LLM_CLIENT_TIMEOUT_SECONDS = 60.0
LLM_CLIENT_MAX_RETRIES = 1


# Default model per provider, mirroring the provider branches in
# _generate_response_inner below. _resolve_model_name prefers the explicit
# config value; this dict only fills the gap when the branch applies a
# default. The test below pins each entry's value (dict-side drift fails
# the suite); branch defaults are updated manually — when adding or
# changing a provider branch, update its entry here too.
_PROVIDER_DEFAULT_MODELS = {
    "g4f": "gpt-3.5-turbo-16k-0613",
    "omniroute": "auto",
    "aihubmix": "gpt-5.4-mini",
    "aimlapi": "openai/gpt-4o-mini",
    "groq": "llama-3.3-70b-versatile",
    "evolink": "gpt-5.5",
    "mimo": "mimo-v2.5-pro",
    "volcengine": "doubao-seed-2-1-turbo-260628",
    "zai": "glm-5.3-flash",
    "openrouter": "openrouter/auto",
    "gemini": _DEFAULT_GEMINI_MODEL,
    "pollinations": _DEFAULT_POLLINATIONS_MODEL,
}

# Truncate AI responses in analytics: enough to spot-check what the model
# returned, small enough to keep events lean.
_RESPONSE_PREVIEW_CHARS = 500


def _resolve_model_name(llm_provider: str) -> str:
    """Best-effort model name for analytics.

    Returns the configured <provider>_model_name, or the provider branch
    default when unconfigured. Deprecated Gemini names are mapped to the
    current default, mirroring the request branch. Empty when the provider
    has neither a configured name nor a branch default — such providers
    reject the request before anything is sent.
    """
    configured = config.app.get(f"{llm_provider}_model_name", "")
    if configured:
        name = str(configured)
        if llm_provider == "gemini" and name in _DEPRECATED_GEMINI_MODELS:
            return _DEFAULT_GEMINI_MODEL
        return name
    return _PROVIDER_DEFAULT_MODELS.get(llm_provider, "")


def _track_llm_request(
    *,
    provider: str,
    primary_provider: str,
    fallback_used: bool,
    duration_ms: int,
    success: bool,
    error: str | None = None,
    response_text: str = "",
    usage: dict[str, Any] | None = None,
) -> None:
    """Emit one ai_request event for an LLM call.

    Free-text fields are scrubbed for credential-shaped fragments before
    sending (response_preview carries truncated model output, which can
    echo secrets). Telemetry never raises (see track_ai_request).
    cost_usd is None when the provider doesn't report it (OpenRouter
    reports it); token counts default to 0.
    """
    usage = usage or {}
    track_ai_request(
        {
            "backend": "llm",
            "provider": provider,
            "model": _resolve_model_name(provider),
            "primary_provider": primary_provider,
            "fallback_used": fallback_used,
            "duration_ms": duration_ms,
            "success": success,
            "error": scrub_secret_values(error or ""),
            "response_chars": len(response_text),
            "response_preview": scrub_secret_values(
                response_text[:_RESPONSE_PREVIEW_CHARS]
            ),
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
            # Present only when the provider reports it (OpenRouter).
            "cost_usd": usage.get("cost_usd"),
        }
    )


def _generate_response(prompt: str) -> str:
    # Compatibility wrapper: converts failures into the "Error: ..." string
    # expected by legacy callers (WebUI, tests, and internal services).
    # Every call is tracked as an ai_request event (backend=llm).
    llm_provider = str(config.app.get("llm_provider", "omniroute"))
    start = time.monotonic()
    usage: dict[str, Any] = {}
    try:
        result, usage = _generate_response_inner(prompt, llm_provider)
    except Exception as e:
        error = _sanitize_error_message(e)
        _track_llm_request(
            provider=llm_provider,
            primary_provider=llm_provider,
            fallback_used=False,
            duration_ms=int((time.monotonic() - start) * 1000),
            success=False,
            error=error,
            usage=usage,
        )
        return f"Error: {error}"
    _track_llm_request(
        provider=llm_provider,
        primary_provider=llm_provider,
        fallback_used=False,
        duration_ms=int((time.monotonic() - start) * 1000),
        success=True,
        response_text=result,
        usage=usage,
    )
    return result


def _generate_response_inner(
    prompt: str, llm_provider: str
) -> tuple[str, dict[str, Any]]:
    """Core LLM call — no telemetry here; callers own the ai_request event.

    Returns (text, usage) where usage may carry prompt/completion/total
    tokens and, when the provider reports it (OpenRouter), cost_usd.
    Usage is {} when unavailable."""
    try:
        content = ""
        logger.info(f"llm provider: {llm_provider}")
        if llm_provider == "g4f":
            if not config.app.get("enable_g4f", False):
                raise ValueError(
                    "g4f provider is disabled by default because it relies on "
                    "reverse-engineered third-party endpoints. Set enable_g4f=true "
                    "in config.toml only if you understand and accept the security, "
                    "reliability, and legal risks."
                )

            logger.warning(
                "g4f provider is enabled. This provider may be unstable and carries "
                "supply-chain and terms-of-service risks. Prefer official providers, "
                "OpenAI-compatible APIs, LiteLLM, Ollama, or local inference for production."
            )
            try:
                import g4f
            except ImportError as e:
                raise ValueError(
                    "g4f package is not installed by default. Install the optional "
                    "dependency with `uv sync --extra g4f` only if you understand "
                    "and accept the provider risks."
                ) from e

            model_name = config.app.get("g4f_model_name", "")
            if not model_name:
                model_name = "gpt-3.5-turbo-16k-0613"
            content = g4f.ChatCompletion.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            api_version = ""  # for azure
            if llm_provider == "moonshot":
                api_key = config.app.get("moonshot_api_key")
                model_name = config.app.get("moonshot_model_name")
                base_url = "https://api.moonshot.cn/v1"
            elif llm_provider == "ollama":
                # api_key = config.app.get("openai_api_key")
                api_key = "ollama"  # any string works but you are required to have one
                model_name = config.app.get("ollama_model_name")
                base_url = config.app.get("ollama_base_url", "")
                if not base_url:
                    base_url = config.get_default_ollama_base_url()
            elif llm_provider == "openai":
                api_key = config.app.get("openai_api_key")
                model_name = config.app.get("openai_model_name")
                base_url = config.app.get("openai_base_url", "")
                if not base_url:
                    base_url = "https://api.openai.com/v1"
            elif llm_provider == "omniroute":
                api_key = config.app.get("omniroute_api_key")
                model_name = config.app.get("omniroute_model_name")
                base_url = config.app.get("omniroute_base_url", "")
                # OmniRoute (https://github.com/diegosouzapw/OmniRoute) is a
                # local OpenAI-compatible gateway running via Docker that
                # exposes hundreds of providers behind a single endpoint. It
                # accepts requests without an API key (the "auto" combo
                # already includes free keyless providers), so an empty
                # api_key falls back to a placeholder, following the ollama
                # provider pattern.
                if not base_url:
                    base_url = "http://localhost:20128/v1"
                if not model_name:
                    model_name = "auto"
                if not api_key:
                    api_key = "omniroute"
            elif llm_provider == "aihubmix":
                api_key = config.app.get("aihubmix_api_key")
                model_name = config.app.get("aihubmix_model_name")
                base_url = config.app.get("aihubmix_base_url", "")
                # AIHubMix speaks the OpenAI Chat Completions protocol. A separate
                # provider entry keeps the partner's default gateway and
                # recommended model out of the generic OpenAI provider, so
                # existing users are unaffected.
                if not base_url:
                    base_url = "https://aihubmix.com/v1"
                if not model_name:
                    model_name = "gpt-5.4-mini"
            elif llm_provider == "aimlapi":
                api_key = config.app.get("aimlapi_api_key")
                model_name = config.app.get("aimlapi_model_name")
                base_url = config.app.get("aimlapi_base_url", "")
                if not base_url:
                    base_url = "https://api.aimlapi.com/v1"
                if not model_name:
                    model_name = "openai/gpt-4o-mini"
            elif llm_provider == "oneapi":
                api_key = config.app.get("oneapi_api_key")
                model_name = config.app.get("oneapi_model_name")
                base_url = config.app.get("oneapi_base_url", "")
            elif llm_provider == "azure":
                api_key = config.app.get("azure_api_key")
                model_name = config.app.get("azure_model_name")
                base_url = config.app.get("azure_base_url", "")
                api_version = config.app.get("azure_api_version", "2024-02-15-preview")
            elif llm_provider == "gemini":
                api_key = config.app.get("gemini_api_key")
                model_name = config.app.get("gemini_model_name")
                base_url = config.app.get("gemini_base_url", "")
                # Legacy Gemini model names are being retired; map them
                # automatically so users with the old values don't get a 404.
                if not model_name:
                    model_name = _DEFAULT_GEMINI_MODEL
                elif model_name in _DEPRECATED_GEMINI_MODELS:
                    logger.warning(
                        f"gemini model '{model_name}' is deprecated, fallback to '{_DEFAULT_GEMINI_MODEL}'"
                    )
                    model_name = _DEFAULT_GEMINI_MODEL
            elif llm_provider == "grok":
                api_key = config.app.get("grok_api_key")
                model_name = config.app.get("grok_model_name")
                base_url = config.app.get("grok_base_url", "")
                if not base_url:
                    base_url = "https://api.x.ai/v1"
            elif llm_provider == "groq":
                api_key = config.app.get("groq_api_key")
                model_name = config.app.get("groq_model_name")
                if not model_name:
                    model_name = "llama-3.3-70b-versatile"
                base_url = config.app.get("groq_base_url", "")
                if not base_url:
                    base_url = "https://api.groq.com/openai/v1"
            elif llm_provider == "qwen":
                api_key = config.app.get("qwen_api_key")
                model_name = config.app.get("qwen_model_name")
                base_url = "***"
            elif llm_provider == "cloudflare":
                api_key = config.app.get("cloudflare_api_key")
                model_name = config.app.get("cloudflare_model_name")
                account_id = config.app.get("cloudflare_account_id")
                base_url = "***"
            elif llm_provider == "minimax":
                api_key = config.app.get("minimax_api_key")
                model_name = config.app.get("minimax_model_name")
                base_url = config.app.get("minimax_base_url", "")
                if not base_url:
                    base_url = "https://api.minimax.io/v1"
            elif llm_provider == "evolink":
                api_key = config.app.get("evolink_api_key")
                model_name = config.app.get("evolink_model_name")
                base_url = config.app.get("evolink_base_url", "")
                if not base_url:
                    base_url = "https://direct.evolink.ai/v1"
                if not model_name:
                    model_name = "gpt-5.5"
            elif llm_provider == "mimo":
                api_key = config.app.get("mimo_api_key")
                model_name = config.app.get("mimo_model_name")
                base_url = config.app.get("mimo_base_url", "")
                # Xiaomi MiMo's docs state OpenAI Chat Completions compatibility.
                # A dedicated provider keeps its default endpoint and model
                # name separate, so users don't configure MiMo as a generic
                # OpenAI custom base_url — and future MiMo multimodal or TTS
                # support keeps a clean boundary.
                if not base_url:
                    base_url = "https://api.xiaomimimo.com/v1"
                if not model_name:
                    model_name = "mimo-v2.5-pro"
            elif llm_provider == "volcengine":
                api_key = config.app.get("volcengine_api_key")
                model_name = config.app.get("volcengine_model_name")
                base_url = config.app.get("volcengine_base_url", "")
                # VolcEngine Ark exposes an OpenAI-compatible Chat Completions
                # API. A dedicated provider lets users pick VolcEngine directly
                # instead of mixing Ark's key/base_url into the generic OpenAI
                # config, which is also easier to maintain.
                if not base_url:
                    base_url = "https://ark.cn-beijing.volces.com/api/v3"
                if not model_name:
                    model_name = "doubao-seed-2-1-turbo-260628"
            elif llm_provider == "zai":
                # Z.ai (Zhipu GLM) exposes an OpenAI-compatible endpoint.
                # (OpenRouter is the automatic fallback; zai remains
                # selectable as a primary provider.)
                api_key = config.app.get("zai_api_key")
                model_name = config.app.get("zai_model_name")
                base_url = config.app.get("zai_base_url")
                if not base_url:
                    base_url = "https://api.z.ai/api/paas/v4"
                if not model_name:
                    model_name = "glm-5.3-flash"
            elif llm_provider == "openrouter":
                # OpenRouter (https://openrouter.ai) — unified gateway over
                # 300+ models behind one OpenAI-compatible endpoint. Used as
                # the automatic fallback when the primary provider fails.
                # Attribution headers (HTTP-Referer / X-Title) are optional
                # and only identify the app in the OpenRouter dashboard.
                # The default model is the Auto Router: OpenRouter picks the
                # model server-side per request, so no code change is needed
                # when models are deprecated.
                api_key = config.app.get("openrouter_api_key")
                model_name = config.app.get("openrouter_model_name")
                base_url = config.app.get("openrouter_base_url", "")
                if not base_url:
                    base_url = "https://openrouter.ai/api/v1"
                if not model_name:
                    model_name = "openrouter/auto"
            elif llm_provider == "modelscope":
                api_key = config.app.get("modelscope_api_key")
                model_name = config.app.get("modelscope_model_name")
                base_url = config.app.get("modelscope_base_url")
                if not base_url:
                    base_url = "https://api-inference.modelscope.cn/v1/"
            elif llm_provider == "ernie":
                api_key = config.app.get("ernie_api_key")
                secret_key = config.app.get("ernie_secret_key")
                base_url = config.app.get("ernie_base_url")
                model_name = "***"
                if not secret_key:
                    raise ValueError(
                        f"{llm_provider}: secret_key is not set, please set it in the config.toml file."
                    )
            elif llm_provider == "pollinations":
                try:
                    base_url = config.app.get("pollinations_base_url", "")
                    if not base_url:
                        base_url = "https://text.pollinations.ai/openai"
                    model_name = config.app.get(
                        "pollinations_model_name", _DEFAULT_POLLINATIONS_MODEL
                    )
                   
                    # Prepare the payload
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "user", "content": prompt}
                        ],
                        "seed": 101  # Optional but helps with reproducibility
                    }
                    
                    # Optional parameters if configured
                    if config.app.get("pollinations_private"):
                        payload["private"] = True
                    if config.app.get("pollinations_referrer"):
                        payload["referrer"] = config.app.get("pollinations_referrer")
                    
                    headers = {
                        "Content-Type": "application/json"
                    }
                    
                    # Make the API request
                    response = requests.post(base_url, headers=headers, json=payload)
                    response.raise_for_status()
                    result = response.json()
                    
                    if result and "choices" in result and len(result["choices"]) > 0:
                        content = result["choices"][0]["message"]["content"]
                        return _normalize_text_response(content, llm_provider), {}
                    else:
                        raise Exception(f"[{llm_provider}] returned an invalid response format")
                        
                except requests.exceptions.RequestException as e:
                    raise Exception(f"[{llm_provider}] request failed: {str(e)}")
                except Exception as e:
                    raise Exception(f"[{llm_provider}] error: {str(e)}")

            elif llm_provider == "litellm":
                model_name = config.app.get("litellm_model_name")

            if llm_provider not in ["pollinations", "ollama", "litellm", "omniroute"]:  # Skip validation for providers that don't require API key
                if not api_key:
                    raise ValueError(
                        f"{llm_provider}: api_key is not set, please set it in the config.toml file."
                    )
                if not model_name:
                    raise ValueError(
                        f"{llm_provider}: model_name is not set, please set it in the config.toml file."
                    )
                if not base_url and llm_provider not in ["gemini"]:
                    raise ValueError(
                        f"{llm_provider}: base_url is not set, please set it in the config.toml file."
                    )

            if llm_provider == "qwen":
                import dashscope
                from dashscope.api_entities.dashscope_response import GenerationResponse

                dashscope.api_key = api_key
                response = dashscope.Generation.call(
                    model=model_name, messages=[{"role": "user", "content": prompt}]
                )
                if response:
                    if isinstance(response, GenerationResponse):
                        status_code = response.status_code
                        if status_code != 200:
                            raise Exception(
                                f'[{llm_provider}] returned an error response: "{response}"'
                            )

                        return _extract_qwen_generation_text(response), {}
                    else:
                        raise Exception(
                            f'[{llm_provider}] returned an invalid response: "{response}"'
                        )
                else:
                    raise Exception(f"[{llm_provider}] returned an empty response")

            if llm_provider == "gemini":
                import google.generativeai as genai

                if not base_url:
                    genai.configure(api_key=api_key, transport="rest")
                else:
                    genai.configure(api_key=api_key, transport="rest", client_options={'api_endpoint': base_url})

                generation_config = {
                    "temperature": 0.5,
                    "top_p": 1,
                    "top_k": 1,
                    "max_output_tokens": 2048,
                }

                safety_settings = [
                    {
                        "category": "HARM_CATEGORY_HARASSMENT",
                        "threshold": "BLOCK_ONLY_HIGH",
                    },
                    {
                        "category": "HARM_CATEGORY_HATE_SPEECH",
                        "threshold": "BLOCK_ONLY_HIGH",
                    },
                    {
                        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        "threshold": "BLOCK_ONLY_HIGH",
                    },
                    {
                        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                        "threshold": "BLOCK_ONLY_HIGH",
                    },
                ]

                model = genai.GenerativeModel(
                    model_name=model_name,
                    generation_config=generation_config,
                    safety_settings=safety_settings,
                )

                try:
                    response = model.generate_content(prompt)
                    candidates = response.candidates
                    generated_text = candidates[0].content.parts[0].text
                except (AttributeError, IndexError) as e:
                    logger.warning(
                        f"gemini returned invalid response content: {str(e)}"
                    )
                    raise ValueError(
                        f"[{llm_provider}] returned invalid response content"
                    )

                return _normalize_text_response(generated_text, llm_provider), {}

            if llm_provider == "cloudflare":
                response = requests.post(
                    f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model_name}",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "messages": [
                            {
                                "role": "system",
                                "content": "You are a friendly assistant",
                            },
                            {"role": "user", "content": prompt},
                        ]
                    },
                )
                result = response.json()
                # The raw provider response may embed credentials; only a
                # redacted, size-level summary reaches the logs.
                logger.info(secret_redaction.redact_value(
                    {"provider": "cloudflare", "result_chars": len(str(result))}
                ))
                return _normalize_text_response(result["result"]["response"], llm_provider), {}

            if llm_provider == "ernie":
                response = requests.post(
                    "https://aip.baidubce.com/oauth/2.0/token", 
                    params={
                        "grant_type": "client_credentials",
                        "client_id": api_key,
                        "client_secret": secret_key,
                    }
                )
                access_token = response.json().get("access_token")
                # Keep the token out of the URL string: pass it as a request
                # param so it can never leak through URL logging.
                chat_params = {"access_token": access_token}

                payload = json.dumps(
                    {
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.5,
                        "top_p": 0.8,
                        "penalty_score": 1,
                        "disable_search": False,
                        "enable_citation": False,
                        "response_format": "text",
                    }
                )
                headers = {"Content-Type": "application/json"}

                response = requests.request(
                    "POST", base_url, headers=headers, data=payload, params=chat_params
                ).json()
                return _normalize_text_response(response.get("result"), llm_provider), {}

            if llm_provider == "litellm":
                import litellm

                if not model_name:
                    raise ValueError(
                        f"{llm_provider}: model_name is not set, please set it in the config.toml file."
                    )

                response = litellm.completion(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                    drop_params=True,
                )

                if not response:
                    raise ValueError(f"[{llm_provider}] returned empty response")
                if not getattr(response, "choices", None):
                    raise ValueError(f"[{llm_provider}] returned empty response")

                return (
                    _extract_chat_completion_text(response, llm_provider),
                    _extract_usage(response),
                )

            if llm_provider == "azure":
                # The Azure OpenAI SDK builds its request address from
                # `azure_endpoint` and `api_version`, so it can't reuse the
                # generic OpenAI-compatible `base_url` init below. Complete
                # the request inside the Azure branch and return immediately,
                # or the later fallback would overwrite the client — making a
                # validated Azure credential silently unused.
                logger.info(f"requesting azure chat completion, model: {model_name}")
                client = AzureOpenAI(
                    api_key=api_key,
                    api_version=api_version,
                    azure_endpoint=base_url,
                )
                response = client.chat.completions.create(
                    model=model_name, messages=[{"role": "user", "content": prompt}]
                )
                if response:
                    if isinstance(response, ChatCompletion):
                        return (
                            _extract_chat_completion_text(response, llm_provider),
                            _extract_usage(response),
                        )
                    else:
                        raise Exception(
                            f'[{llm_provider}] returned an invalid response: "{response}", please check your network '
                            f"connection and try again."
                        )
                else:
                    raise Exception(
                        f"[{llm_provider}] returned an empty response, please check your network connection and try again."
                    )

            if llm_provider == "modelscope":
                content = ''
                client = OpenAI(
                    api_key=api_key,
                    base_url=base_url,
                    timeout=LLM_CLIENT_TIMEOUT_SECONDS,
                    max_retries=LLM_CLIENT_MAX_RETRIES,
                )
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                    extra_body={"enable_thinking": False},
                    stream=True
                )
                if response:
                    for chunk in response:
                        if not chunk.choices:
                            continue
                        delta = chunk.choices[0].delta
                        if delta and delta.content:
                            content += delta.content
                    
                    if not content.strip():
                        raise ValueError("Empty content in stream response")
                    
                    return _normalize_text_response(content, llm_provider), {}
                else:
                    raise Exception(f"[{llm_provider}] returned an empty response")

            elif llm_provider == "openrouter":
                # OpenRouter attribution headers are optional and only
                # identify the app in the OpenRouter dashboard; without
                # them the call is a plain OpenAI-compatible request.
                attribution_headers: dict[str, str] = {}
                site_url = config.app.get("openrouter_site_url", "")
                if site_url:
                    attribution_headers["HTTP-Referer"] = str(site_url)
                app_name = config.app.get("openrouter_app_name", "")
                if app_name:
                    attribution_headers["X-Title"] = str(app_name)
                client = OpenAI(
                    api_key=api_key,
                    base_url=base_url,
                    timeout=LLM_CLIENT_TIMEOUT_SECONDS,
                    max_retries=LLM_CLIENT_MAX_RETRIES,
                    default_headers=attribution_headers or None,
                )
                response = client.chat.completions.create(
                    model=model_name, messages=[{"role": "user", "content": prompt}]
                )
                if response:
                    if isinstance(response, ChatCompletion):
                        return (
                            _extract_chat_completion_text(response, llm_provider),
                            _extract_usage(response),
                        )
                    else:
                        raise Exception(
                            f'[{llm_provider}] returned an invalid response: "{response}", please check your network '
                            f"connection and try again."
                        )
                else:
                    raise Exception(f"[{llm_provider}] returned an empty response")

            else:
                client = OpenAI(
                    api_key=api_key,
                    base_url=base_url,
                    timeout=LLM_CLIENT_TIMEOUT_SECONDS,
                    max_retries=LLM_CLIENT_MAX_RETRIES,
                )

            response = client.chat.completions.create(
                model=model_name, messages=[{"role": "user", "content": prompt}]
            )
            if response:
                if isinstance(response, ChatCompletion):
                    return (
                        _extract_chat_completion_text(response, llm_provider),
                        _extract_usage(response),
                    )
                else:
                    raise Exception(
                        f'[{llm_provider}] returned an invalid response: "{response}", please check your network '
                        f"connection and try again."
                    )
            else:
                raise Exception(
                    f"[{llm_provider}] returned an empty response, please check your network connection and try again."
                )

        return _normalize_text_response(content, llm_provider), {}
    except Exception as e:
        raise LLMResponseError(_sanitize_error_message(e)) from e


def _generate_response_with_fallback(prompt: str) -> str:
    # The OpenRouter fallback covers ANY primary-provider failure
    # (invalid-key 401/403, insufficient balance, missing model, gateway
    # down, rate limit, timeout...). The only exception is OpenRouter
    # already being the primary provider — repeating the same call
    # wouldn't fix the error and would just double cost and latency.
    #
    # The provider is passed as an explicit argument on every call: mutating
    # config.app["llm_provider"] here would race between concurrent requests
    # (a parallel request would read "openrouter" as primary and lose its own
    # fallback).
    #
    # Every call is tracked as one ai_request event (backend=llm) with the
    # provider that actually served it, whether the fallback ran, and the
    # sanitized error when it failed.
    primary_provider = str(config.app.get("llm_provider", "omniroute"))
    start = time.monotonic()
    used_provider = primary_provider
    fallback_used = False
    error: str | None = None
    result = ""
    usage: dict[str, Any] = {}
    try:
        try:
            result, usage = _generate_response_inner(prompt, primary_provider)
        except Exception as primary_error:
            primary_message = _sanitize_error_message(primary_error)

            if primary_provider == "openrouter":
                raise

            openrouter_key = config.app.get("openrouter_api_key", "")
            if not openrouter_key:
                raise

            logger.warning(
                f"primary llm provider '{primary_provider}' failed, "
                f"falling back to openrouter: {primary_message}"
            )
            used_provider = "openrouter"
            fallback_used = True
            result, usage = _generate_response_inner(prompt, "openrouter")
    except Exception as e:
        error = _sanitize_error_message(e)
    _track_llm_request(
        provider=used_provider,
        primary_provider=primary_provider,
        fallback_used=fallback_used,
        duration_ms=int((time.monotonic() - start) * 1000),
        success=error is None,
        error=error,
        response_text=result,
        usage=usage,
    )
    if error is not None:
        return f"Error: {error}"
    return result


def _limit_script_text(text: str | None, max_length: int, field_name: str) -> str:
    value = (text or "").strip()
    if len(value) <= max_length:
        return value

    # The API layer already validates length with Pydantic; this extra guard
    # protects direct generate_script callers (WebUI, internal services) from
    # sending oversized prompts to the model, which would spike token costs or
    # fail the request.
    logger.warning(
        f"{field_name} is too long and will be truncated to {max_length} characters."
    )
    return value[:max_length]


def _normalize_script_paragraph_number(paragraph_number: int | None) -> int | None:
    if paragraph_number is None:
        return None
    try:
        value = int(paragraph_number)
    except (TypeError, ValueError):
        value = MIN_SCRIPT_PARAGRAPH_NUMBER

    if value < MIN_SCRIPT_PARAGRAPH_NUMBER or value > MAX_SCRIPT_PARAGRAPH_NUMBER:
        # The WebUI and API already clamp the range; guard internal callers
        # too so a bad argument can't inflate LLM costs or yield empty output.
        logger.warning(
            "script paragraph_number is out of range and will be clamped: "
            f"{value}"
        )
        return max(MIN_SCRIPT_PARAGRAPH_NUMBER, min(value, MAX_SCRIPT_PARAGRAPH_NUMBER))

    return value


def build_script_prompt(
    video_subject: str,
    language: str = "",
    paragraph_number: int | None = None,
    video_script_prompt: str = "",
    custom_system_prompt: str = "",
    target_words_min: int | None = None,
    target_words_max: int | None = None,
) -> str:
    paragraph_number = _normalize_script_paragraph_number(paragraph_number)
    video_script_prompt = _limit_script_text(
        video_script_prompt, MAX_SCRIPT_PROMPT_LENGTH, "video_script_prompt"
    )
    custom_system_prompt = _limit_script_text(
        custom_system_prompt, MAX_SCRIPT_SYSTEM_PROMPT_LENGTH, "custom_system_prompt"
    )

    # Keep the "script generation rules" and the "runtime context" as separate
    # blocks. Advanced users overriding the default system prompt still get
    # the video subject, language, and length context they need.
    prompt = custom_system_prompt or DEFAULT_SCRIPT_SYSTEM_PROMPT
    minimum_words = target_words_min or int(config.app.get("script_target_words_min", 80))
    maximum_words = target_words_max or int(config.app.get("script_target_words_max", 110))
    prompt += f"""

# Initialization:
- video subject: {video_subject}
- target length: {minimum_words} to {maximum_words} words
""".rstrip()
    if paragraph_number is not None:
        prompt += f"\n- number of paragraphs: {paragraph_number}"
    if language:
        prompt += f"\n- language: {language}"
    if video_script_prompt:
        prompt += f"""

# Additional User Requirements:
{video_script_prompt}
""".rstrip()

    return prompt


def generate_script(
    video_subject: str,
    language: str = "",
    paragraph_number: int | None = None,
    video_script_prompt: str = "",
    custom_system_prompt: str = "",
    target_words_min: int | None = None,
    target_words_max: int | None = None,
) -> str:
    paragraph_number = _normalize_script_paragraph_number(paragraph_number)
    video_script_prompt = _limit_script_text(
        video_script_prompt, MAX_SCRIPT_PROMPT_LENGTH, "video_script_prompt"
    )
    custom_system_prompt = _limit_script_text(
        custom_system_prompt, MAX_SCRIPT_SYSTEM_PROMPT_LENGTH, "custom_system_prompt"
    )
    prompt = build_script_prompt(
        video_subject=video_subject,
        language=language,
        paragraph_number=paragraph_number,
        video_script_prompt=video_script_prompt,
        custom_system_prompt=custom_system_prompt,
        target_words_min=target_words_min,
        target_words_max=target_words_max,
    )
    final_script = ""
    logger.info(
        "generating video script: "
        f"subject={video_subject}, paragraph_number={paragraph_number}, "
        f"has_custom_prompt={bool(video_script_prompt.strip())}, "
        f"has_custom_system_prompt={bool(custom_system_prompt.strip())}"
    )

    def format_response(response):
        # Clean the script
        # Remove asterisks, hashes
        response = response.replace("*", "")
        response = response.replace("#", "")

        # Remove markdown syntax
        response = re.sub(r"\[.*\]", "", response)
        response = re.sub(r"\(.*\)", "", response)

        # Split the script into paragraphs
        paragraphs = response.split("\n\n")

        # Select the specified number of paragraphs
        # selected_paragraphs = paragraphs[:paragraph_number]

        # Join the selected paragraphs into a single string
        return "\n\n".join(paragraphs)

    for i in range(_max_retries):
        try:
            response = _generate_response_with_fallback(prompt=prompt)
            if response:
                final_script = format_response(response)
            else:
                logging.error("gpt returned an empty response")

            # g4f may return an error message
            if final_script and "当日额度已消耗完" in final_script:
                raise ValueError(final_script)

            if final_script:
                break
        except Exception as e:
            logger.error(f"failed to generate script: {e}")

        if i < _max_retries:
            logger.warning(f"failed to generate video script, trying again... {i + 1}")
    if "Error: " in final_script:
        logger.error(f"failed to generate video script: {final_script}")
    else:
        logger.success(f"completed: \n{final_script}")
    return final_script.strip()


def generate_music_mood(video_script: str, available_moods: tuple[str, ...]) -> str:
    """Ask the LLM which background-music mood fits the generated script.

    Returns one of available_moods. "none" means no mood fits, which the
    caller treats as "no BGM for this video".
    """
    options = (*available_moods, "none")
    if not available_moods:
        logger.warning("music mood selection skipped: BGM catalog has no moods")
        return "none"
    prompt = f"""You are a video music supervisor. Read the video script below and
choose the background music mood that best matches its emotional tone.

# Rules:
- Answer with EXACTLY one word and nothing else.
- Choose one of: {", ".join(options)}.
- If no mood clearly fits the script, answer: none.

# Script:
{video_script.strip()}
""".strip()
    logger.info(f"music mood options from catalog: {', '.join(options)}")
    logger.debug(f"music mood prompt: {prompt}")

    for i in range(_max_retries):
        try:
            response = _generate_response_with_fallback(prompt=prompt)
            mood = (response or "").strip().casefold().split()[0] if (response or "").strip() else ""
            logger.info(f"music mood LLM response: {response!r}")
            if mood in options:
                logger.success(f"resolved music mood: {mood}")
                return mood
            logger.warning(f"invalid music mood response: {response!r}")
        except Exception as e:
            logger.error(f"failed to resolve music mood: {e}")

        if i < _max_retries:
            logger.warning(f"failed to resolve music mood, trying again... {i + 1}")
    return "none"


def _strip_code_fence(text: str) -> str:
    """Strip a surrounding markdown code fence from an LLM response.

    Non-OpenAI providers (Claude, Gemini, …) frequently wrap JSON output in a
    ```json … ``` fence even when asked to return raw JSON. Removing it lets the
    first json.loads() succeed instead of falling through to the regex recovery
    path (and spuriously logging a warning). Mirrors the DOTALL handling already
    used in _parse_social_metadata().
    """
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z0-9]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def generate_terms(
    video_subject: str,
    video_script: str,
    amount: int = 5,
    match_script_order: bool = False,
) -> List[str]:
    if match_script_order:
        goal = (
            f"Generate {amount} chronological stock-video search terms that follow "
            "the order of topics in the video script."
        )
        ordering_rule = (
            "6. keep the terms in the same order as the script narration; "
            "earlier terms must describe earlier visual moments."
        )
        # In ordered-keywords mode, the example count must match `amount`, so
        # the model isn't misled by a fixed 4-example set into returning too
        # few keywords for long copy and hurting material coverage.
        example_terms = [
            "opening visual topic",
            *[
                f"script visual topic {index}"
                for index in range(2, max(amount, 1))
            ],
            "final visual topic",
        ]
        output_example = json.dumps(example_terms[:amount], ensure_ascii=False)
    else:
        goal = (
            f"Generate {amount} search terms for stock videos, depending on the "
            "subject of a video."
        )
        ordering_rule = ""
        output_example = (
            '["search term 1", "search term 2", "search term 3",'
            '"search term 4", "search term 5"]'
        )

    prompt = f"""
# Role: Video Search Terms Generator

## Goals:
{goal}

## Constrains:
1. the search terms are to be returned as a json-array of strings.
2. each search term should consist of 1-3 words, always add the main subject of the video.
3. you must only return the json-array of strings. you must not return anything else. you must not return the script.
4. the search terms must be related to the subject of the video.
5. reply with english search terms only.
{ordering_rule}

## Output Example:
{output_example}

## Context:
### Video Subject
{video_subject}

### Video Script
{video_script}

Please note that you must use English for generating video search terms; Chinese is not accepted.
""".strip()

    logger.info(
        f"subject: {video_subject}, match_script_order: {match_script_order}"
    )

    search_terms = []
    response = ""
    for i in range(_max_retries):
        try:
            response = _generate_response_with_fallback(prompt)
            if "Error: " in response:
                logger.error(f"failed to generate video script: {response}")
                return response
            search_terms = json.loads(_strip_code_fence(response))
            if not isinstance(search_terms, list) or not all(
                isinstance(term, str) for term in search_terms
            ):
                logger.error("response is not a list of strings.")
                continue

        except Exception as e:
            logger.warning(f"failed to generate video terms: {str(e)}")
            if response:
                match = re.search(r"\[.*]", response, re.DOTALL)
                if match:
                    try:
                        search_terms = json.loads(match.group())
                    except Exception as e:
                        # Keep the retry flow, but always log the non-standard
                        # JSON the LLM returned — otherwise an empty search
                        # term later can't be traced back to a model-format
                        # issue vs. a parsing-logic issue.
                        logger.warning(f"failed to generate video terms: {str(e)}")

        if search_terms and len(search_terms) > 0:
            break
        if i < _max_retries:
            logger.warning(f"failed to generate video terms, trying again... {i + 1}")

    logger.success(f"completed: \n{search_terms}")
    return search_terms


# =============================================================================
# Social publishing metadata
#
# Generates the title, caption, and hashtags commonly used when publishing to
# short-video platforms, from the video subject and script. This only reuses
# the existing LLM providers — no external publishing service is involved and
# the main video pipeline is unaffected.
# =============================================================================

# Platforms differ in copy length and hashtag count preferences. Conservative
# caps are used here so callers don't need a second trim when the model
# returns overlong content.
SOCIAL_PLATFORMS = {
    "tiktok": {"title_max": 100, "caption_max": 2200, "hashtag_count": 5},
    "youtube_shorts": {"title_max": 100, "caption_max": 5000, "hashtag_count": 3},
    "instagram_reels": {"title_max": 125, "caption_max": 2200, "hashtag_count": 8},
    "facebook_reels": {"title_max": 125, "caption_max": 2200, "hashtag_count": 5},
}
DEFAULT_SOCIAL_PLATFORM = "tiktok"
DEFAULT_SOCIAL_LANGUAGE = "auto"
MAX_SOCIAL_SUBJECT_LENGTH = 500
MAX_SOCIAL_SCRIPT_LENGTH = 8000
MAX_SOCIAL_LANGUAGE_LENGTH = 64

SOCIAL_PLATFORM_LABELS = {
    "tiktok": "TikTok",
    "youtube_shorts": "YouTube Shorts",
    "instagram_reels": "Instagram Reels",
    "facebook_reels": "Facebook Reels",
}

# Generic fallback tags when the LLM is unavailable. Deliberately not tied to
# any country or language, so the API returns a usable structure for
# Chinese, English, Vietnamese, and other scenarios alike.
DEFAULT_SOCIAL_HASHTAGS = [
    "#shorts",
    "#viral",
    "#trending",
    "#fyp",
    "#video",
    "#reels",
    "#creator",
    "#content",
]


def _resolve_social_platform(platform: str | None) -> str:
    value = (platform or "").strip().lower()
    return value if value in SOCIAL_PLATFORMS else DEFAULT_SOCIAL_PLATFORM


def _normalize_social_language(language: str | None) -> str:
    value = (language or DEFAULT_SOCIAL_LANGUAGE).strip()
    if len(value) > MAX_SOCIAL_LANGUAGE_LENGTH:
        logger.warning(
            "social metadata language is too long and will be truncated to "
            f"{MAX_SOCIAL_LANGUAGE_LENGTH} characters."
        )
        value = value[:MAX_SOCIAL_LANGUAGE_LENGTH]
    return value or DEFAULT_SOCIAL_LANGUAGE


def _limit_social_text(text: str | None, max_length: int, field_name: str) -> str:
    value = (text or "").strip()
    if len(value) <= max_length:
        return value

    # The API layer clamps length; this extra guard protects internal callers
    # (or a future direct WebUI call) from sending oversized content to the
    # model and spiking token costs.
    logger.warning(
        f"{field_name} is too long and will be truncated to {max_length} characters."
    )
    return value[:max_length]


def _social_language_instruction(language: str | None) -> str:
    language = _normalize_social_language(language)
    if language.lower() == DEFAULT_SOCIAL_LANGUAGE:
        return (
            "Use the same language as the video subject and script. If the subject "
            "and script use different languages, prefer the script language."
        )

    return f'Write "title" and "caption" in this language: {language}.'


def _clamp_text(text, max_length: int) -> str:
    value = ("" if text is None else str(text)).strip()
    if max_length and len(value) > max_length:
        return value[:max_length].rstrip()
    return value


def _normalize_hashtags(raw, count: int) -> List[str]:
    """
    Normalize LLM-returned hashtags into `#tag` form.

    The LLM may return strings, arrays, spaced phrases, duplicates, or
    punctuation-laden content. Centralized cleanup keeps the API response
    shape stable and avoids empty/duplicate/malformed tags at publish time.
    """
    if isinstance(raw, str):
        candidates = re.split(r"[\s,]+", raw)
    elif isinstance(raw, (list, tuple)):
        # Each array item counts as one complete tag, so "du lich" becomes
        # "#dulich" rather than being split into two tags.
        candidates = [str(entry) for entry in raw]
    else:
        candidates = []

    seen = set()
    result: List[str] = []
    for item in candidates:
        tag = re.sub(r"[^\w]", "", item, flags=re.UNICODE)
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(f"#{tag}")
        if count and len(result) >= count:
            break
    return result


def build_social_metadata_prompt(
    video_subject: str,
    video_script: str = "",
    language: str = DEFAULT_SOCIAL_LANGUAGE,
    platform: str = DEFAULT_SOCIAL_PLATFORM,
) -> str:
    video_subject = _limit_social_text(
        video_subject, MAX_SOCIAL_SUBJECT_LENGTH, "video_subject"
    )
    video_script = _limit_social_text(
        video_script, MAX_SOCIAL_SCRIPT_LENGTH, "video_script"
    )
    platform = _resolve_social_platform(platform)
    spec = SOCIAL_PLATFORMS[platform]
    label = SOCIAL_PLATFORM_LABELS.get(platform, platform)
    language_instruction = _social_language_instruction(language)

    prompt = f"""
# Role: Short-Video Social Media Copywriter

## Goal
Write engaging publishing metadata for a short video that will be posted on {label}.

## Constraints
1. Respond ONLY with a single valid minified JSON object. No markdown, no code fences, no commentary.
2. The JSON must contain exactly these keys: "title", "caption", "hashtags".
3. "title": a catchy hook, at most {spec['title_max']} characters.
4. "caption": an engaging description that ends with a call to action, at most {spec['caption_max']} characters. Do not put hashtags inside the caption.
5. "hashtags": a JSON array of exactly {spec['hashtag_count']} strings. Each must start with "#", contain no spaces, and be relevant to the topic and to {label}.
6. {language_instruction}

## Output Example
{{"title":"...","caption":"...","hashtags":["#example","#video"]}}

## Context
### Video Subject
{video_subject}

### Video Script
{video_script}
""".strip()
    return prompt


def _parse_social_metadata(response: str, platform: str) -> dict:
    spec = SOCIAL_PLATFORMS[_resolve_social_platform(platform)]

    data = None
    try:
        data = json.loads(_strip_code_fence(response))
    except Exception:
        # Some models wrap the JSON in explanatory text or a markdown fence.
        # API callers only need the stable structure, so extract the first
        # JSON object.
        match = re.search(r"\{.*\}", response or "", re.DOTALL)
        if match:
            data = json.loads(match.group())

    if not isinstance(data, dict):
        raise ValueError("social metadata response is not a JSON object")

    title = _clamp_text(data.get("title", ""), spec["title_max"])
    caption = _clamp_text(data.get("caption", ""), spec["caption_max"])
    hashtags = _normalize_hashtags(data.get("hashtags", []), spec["hashtag_count"])

    if not title and not caption:
        raise ValueError("social metadata response is missing both title and caption")

    return {"title": title, "caption": caption, "hashtags": hashtags}


def _fallback_social_metadata(
    video_subject: str, video_script: str, platform: str
) -> dict:
    spec = SOCIAL_PLATFORMS[_resolve_social_platform(platform)]
    subject = (video_subject or "").strip()
    script = (video_script or "").strip()

    title = subject
    if not title and script:
        # With no subject, fall back to the first script sentence for the
        # title so the endpoint never returns an empty title.
        title = re.split(r"(?<=[.!?。！？])\s+", script)[0]

    return {
        "title": _clamp_text(title, spec["title_max"]),
        "caption": _clamp_text(script or subject, spec["caption_max"]),
        "hashtags": _normalize_hashtags(
            DEFAULT_SOCIAL_HASHTAGS, spec["hashtag_count"]
        ),
    }


def generate_social_metadata(
    video_subject: str,
    video_script: str = "",
    language: str = DEFAULT_SOCIAL_LANGUAGE,
    platform: str = DEFAULT_SOCIAL_PLATFORM,
) -> dict:
    """
    Generate short-video publishing copy metadata.

    The return shape is fixed as `{"title": str, "caption": str, "hashtags": List[str]}`.
    If the LLM is unavailable or returns malformed output, it degrades to a
    generic heuristic result so API callers always get a displayable,
    publish-editable structure.
    """
    platform = _resolve_social_platform(platform)
    language = _normalize_social_language(language)
    video_subject = _limit_social_text(
        video_subject, MAX_SOCIAL_SUBJECT_LENGTH, "video_subject"
    )
    video_script = _limit_social_text(
        video_script, MAX_SOCIAL_SCRIPT_LENGTH, "video_script"
    )
    prompt = build_social_metadata_prompt(
        video_subject=video_subject,
        video_script=video_script,
        language=language,
        platform=platform,
    )
    logger.info(
        f"generating social metadata: platform={platform}, language={language}"
    )

    response = ""
    for i in range(_max_retries):
        try:
            response = _generate_response_with_fallback(prompt)
            if isinstance(response, str) and "Error: " in response:
                logger.error(f"failed to generate social metadata: {response}")
                break
            metadata = _parse_social_metadata(response, platform)
            logger.success(f"completed: \n{metadata}")
            return metadata
        except Exception as e:
            logger.warning(f"failed to parse social metadata: {str(e)}")

        if i < _max_retries - 1:
            logger.warning(
                f"failed to generate social metadata, trying again... {i + 1}"
            )

    logger.warning("falling back to heuristic social metadata")
    return _fallback_social_metadata(video_subject, video_script, platform)

