#!/usr/bin/env python3
"""Build the OpenCode review model attempt chain at CI runtime.

Discovery:
- OpenCode Zen free models via `opencode models opencode --verbose` (stdin closed).
- OpenRouter free models from the public models API when OPENROUTER_API_KEY is set.

Preferences live in .github/review/model-preferences.json.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

DEFAULT_PREFS = (
    Path(__file__).resolve().parent.parent / "review" / "model-preferences.json"
)
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


@dataclass(frozen=True)
class ModelMeta:
    model_id: str
    context: int = 0
    max_output: int = 0
    tool_support: bool = False
    vision_only: bool = False
    zero_cost: bool = True


@dataclass
class ChainDecision:
    model_id: str
    included: bool
    reason: str


def log(message: str) -> None:
    print(message, file=sys.stderr)


def load_preferences(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_opencode_verbose(text: str) -> dict[str, ModelMeta]:
    models: dict[str, ModelMeta] = {}
    for part in re.split(r"\n(?=opencode/)", text.strip()):
        lines = part.strip().split("\n")
        if not lines:
            continue
        header = lines[0].strip()
        if not header.startswith("opencode/"):
            continue
        body = "\n".join(lines[1:]).strip()
        if not body:
            continue
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            continue
        model_id = f"opencode/{data.get('id', header.split('/', 1)[1])}"
        cost = data.get("cost") or {}
        limit = data.get("limit") or {}
        caps = data.get("capabilities") or {}
        inp = caps.get("input") or {}
        out = caps.get("output") or {}
        vision_only = bool(inp.get("image") or inp.get("video")) and not bool(
            caps.get("toolcall")
        )
        models[model_id] = ModelMeta(
            model_id=model_id,
            context=int(limit.get("context") or 0),
            max_output=int(limit.get("output") or 0),
            tool_support=bool(caps.get("toolcall")),
            vision_only=vision_only,
            zero_cost=float(cost.get("input") or 0) == 0
            and float(cost.get("output") or 0) == 0,
        )
    return models


def discover_opencode(
    run_cli: Callable[[list[str]], tuple[int, str, str]] | None = None,
) -> dict[str, ModelMeta]:
    if run_cli is None:
        run_cli = _default_run_cli
    rc, stdout, stderr = run_cli(
        ["opencode", "models", "opencode", "--verbose"],
    )
    if rc != 0:
        raise RuntimeError(
            f"opencode models opencode --verbose failed (exit {rc}): {stderr.strip()}"
        )
    return parse_opencode_verbose(stdout)


def _default_run_cli(argv: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(
        argv,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        env={**os.environ, "OPENCODE_DISABLE_PROJECT_CONFIG": "1"},
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def discover_openrouter_free(
    fetch_url: Callable[[str], str] | None = None,
) -> dict[str, ModelMeta]:
    if fetch_url is None:
        fetch_url = _default_fetch_url
    raw = fetch_url(OPENROUTER_MODELS_URL)
    payload = json.loads(raw)
    models: dict[str, ModelMeta] = {}
    for entry in payload.get("data") or []:
        model_id = entry.get("id")
        if not isinstance(model_id, str) or not model_id.endswith(":free"):
            continue
        pricing = entry.get("pricing") or {}
        try:
            prompt = float(pricing.get("prompt", 1))
            completion = float(pricing.get("completion", 1))
        except (TypeError, ValueError):
            continue
        if prompt != 0 or completion != 0:
            continue
        supported = entry.get("supported_parameters") or []
        if "tools" not in supported:
            continue
        top = entry.get("top_provider") or {}
        models[f"openrouter/{model_id}"] = ModelMeta(
            model_id=f"openrouter/{model_id}",
            context=int(entry.get("context_length") or 0),
            max_output=int(top.get("max_completion_tokens") or 0),
            tool_support=True,
            vision_only=False,
            zero_cost=True,
        )
    return models


def _default_fetch_url(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "post-engineer-opencode-review/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def is_denied(
    model_id: str,
    meta: ModelMeta | None,
    prefs: dict[str, Any],
    *,
    paid_tier: bool = False,
) -> str | None:
    deny = prefs.get("denylist") or {}
    exact = set(deny.get("exact") or [])
    if not paid_tier and model_id in exact:
        return "denylist exact match"
    lowered = model_id.lower()
    for fragment in deny.get("idSubstrings") or []:
        if fragment.lower() in lowered:
            return f"denylist substring {fragment}"
    if deny.get("requireToolSupport") and meta is not None and not meta.tool_support:
        return "no tool support"
    min_out = int(deny.get("minOutputTokens") or 0)
    if meta is not None and min_out > 0 and meta.max_output < min_out:
        return f"max output {meta.max_output} below {min_out}"
    if (
        deny.get("requireVisionOnlyRejection")
        and meta is not None
        and meta.vision_only
    ):
        return "vision-only model"
    if meta is not None and not paid_tier and model_id.startswith("opencode/") and not meta.zero_cost:
        return "not zero-cost on opencode provider"
    return None


def heuristic_score(meta: ModelMeta) -> int:
    tool = 1_000_000_000 if meta.tool_support else 0
    return tool + meta.context + meta.max_output


def expand_paid_model(spec: dict[str, Any], env: dict[str, str]) -> str | None:
    if "model" in spec:
        template = spec["model"]
        expanded = template
        for key, value in env.items():
            expanded = expanded.replace(f"${{{key}}}", value)
        return expanded
    env_name = spec.get("modelEnv")
    if not env_name:
        return None
    value = env.get(env_name, "").strip()
    if not value:
        return None
    return value


def provider_key_ok(model_id: str, key_kind: str, env: dict[str, str]) -> bool:
    provider = model_id.split("/", 1)[0]
    if key_kind == "opencode":
        # Paid OpenCode Zen models bill behind OPENCODE_ZEN_API_KEY; free
        # opencode/*-free models need no secret at all.
        if provider == "opencode" and (
            model_id.endswith("-free") or env.get("HAS_OPENCODE_KEY") == "true"
        ):
            return True
        return env.get("HAS_OPENCODE_KEY") == "true"
    if provider == "opencode":
        return model_id.endswith("-free") or env.get("HAS_OPENCODE_KEY") == "true"
    if key_kind == "openrouter":
        return env.get("HAS_OPENROUTER_KEY") == "true"
    if provider == "openrouter":
        return env.get("HAS_OPENROUTER_KEY") == "true"
    return False


def build_chain(
    prefs: dict[str, Any],
    available: dict[str, ModelMeta],
    env: dict[str, str],
    *,
    discovery_failed: bool = False,
) -> tuple[list[str], list[str], list[ChainDecision]]:
    """Return (attempts, free_model_ids, decisions)."""
    decisions: list[ChainDecision] = []
    free_attempts: list[str] = []
    paid_attempts: list[str] = []
    free_ids: list[str] = []
    seen: set[str] = set()

    def add_free(model_id: str, reason: str) -> None:
        if model_id in seen:
            decisions.append(ChainDecision(model_id, False, "duplicate"))
            return
        seen.add(model_id)
        free_attempts.append(model_id)
        free_ids.append(model_id)
        decisions.append(ChainDecision(model_id, True, reason))

    def add_paid(model_id: str, reason: str, counts_as_free: bool) -> None:
        if model_id in seen:
            decisions.append(ChainDecision(model_id, False, "duplicate"))
            return
        seen.add(model_id)
        paid_attempts.append(model_id)
        if counts_as_free:
            free_ids.append(model_id)
        decisions.append(ChainDecision(model_id, True, reason))

    override = env.get("REVIEW_MODEL_CHAIN_OVERRIDE", "").strip()
    if override:
        for raw in override.split(","):
            model_id = raw.strip()
            if not model_id:
                continue
            meta = available.get(model_id)
            denied = is_denied(model_id, meta, prefs)
            if denied:
                decisions.append(ChainDecision(model_id, False, denied))
                continue
            is_free = model_id.startswith("opencode/") or (
                model_id.startswith("openrouter/") and model_id.endswith(":free")
            )
            if is_free:
                add_free(model_id, "override")
            else:
                add_paid(model_id, "override", False)
        max_len = int(prefs.get("maxChainLength") or 8)
        attempts = (free_attempts + paid_attempts)[:max_len]
        return attempts, [m for m in free_ids if m in attempts], decisions

    preferred = list(prefs.get("preferredFree") or [])
    if discovery_failed:
        log("Discovery failed; using static preferred free list without availability checks.")
        for model_id in preferred:
            if model_id.startswith("openrouter/") and env.get("HAS_OPENROUTER_KEY") != "true":
                decisions.append(
                    ChainDecision(model_id, False, "openrouter key missing"),
                )
                continue
            denied = is_denied(model_id, available.get(model_id), prefs)
            if denied:
                decisions.append(ChainDecision(model_id, False, denied))
                continue
            add_free(model_id, "preferred (static fallback)")
    else:
        for model_id in preferred:
            if model_id.startswith("openrouter/") and env.get("HAS_OPENROUTER_KEY") != "true":
                decisions.append(
                    ChainDecision(model_id, False, "openrouter key missing"),
                )
                continue
            if model_id not in available:
                decisions.append(ChainDecision(model_id, False, "not currently available"))
                continue
            denied = is_denied(model_id, available[model_id], prefs)
            if denied:
                decisions.append(ChainDecision(model_id, False, denied))
                continue
            add_free(model_id, "preferred (available)")

        preferred_set = set(preferred)
        discovered = [
            (mid, meta)
            for mid, meta in available.items()
            if mid not in preferred_set
            and (
                mid.startswith("opencode/")
                or (mid.startswith("openrouter/") and env.get("HAS_OPENROUTER_KEY") == "true")
            )
        ]
        discovered.sort(key=lambda item: heuristic_score(item[1]), reverse=True)
        cap = int(prefs.get("maxDiscoveredFree") or 3)
        added_discovered = 0
        for model_id, meta in discovered:
            if added_discovered >= cap:
                break
            denied = is_denied(model_id, meta, prefs)
            if denied:
                decisions.append(ChainDecision(model_id, False, denied))
                continue
            add_free(model_id, "discovered free")
            added_discovered += 1

    for spec in prefs.get("paidFallbacks") or []:
        model_id = expand_paid_model(spec, env)
        if not model_id:
            decisions.append(ChainDecision(str(spec), False, "unresolved paid fallback"))
            continue
        if model_id in seen:
            decisions.append(ChainDecision(model_id, False, "duplicate paid fallback"))
            continue
        key_kind = spec.get("key", "")
        if not provider_key_ok(model_id, key_kind, env):
            decisions.append(ChainDecision(model_id, False, f"{key_kind} key missing"))
            continue
        denied = is_denied(
            model_id,
            available.get(model_id),
            prefs,
            paid_tier=True,
        )
        if denied:
            decisions.append(ChainDecision(model_id, False, denied))
            continue
        counts_as_free = model_id == f"openrouter/{env.get('OPENROUTER_FREE_MODEL', '')}"
        add_paid(model_id, "paid fallback", counts_as_free)

    max_len = int(prefs.get("maxChainLength") or 8)
    free_budget = max(0, max_len - len(paid_attempts))
    if len(free_attempts) > free_budget:
        for dropped in free_attempts[free_budget:]:
            decisions.append(ChainDecision(dropped, False, "chain length cap (free tier)"))
        free_attempts = free_attempts[:free_budget]
    attempts = free_attempts + paid_attempts
    free_ids = [mid for mid in free_ids if mid in attempts]
    return attempts, free_ids, decisions


def collect_available(
    env: dict[str, str],
    *,
    run_cli: Callable[[list[str]], tuple[int, str, str]] | None = None,
    fetch_url: Callable[[str], str] | None = None,
) -> tuple[dict[str, ModelMeta], bool]:
    available: dict[str, ModelMeta] = {}
    discovery_failed = False
    try:
        available.update(discover_opencode(run_cli=run_cli))
    except Exception as exc:  # noqa: BLE001 — discovery failure is a fallback path
        log(f"OpenCode discovery failed: {exc}")
        discovery_failed = True
    if env.get("HAS_OPENROUTER_KEY") == "true":
        try:
            available.update(discover_openrouter_free(fetch_url=fetch_url))
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
            log(f"OpenRouter discovery failed: {exc}")
            discovery_failed = True
    elif env.get("OPENROUTER_API_KEY"):
        # When running locally with a key but HAS_OPENROUTER_KEY unset, still try.
        try:
            available.update(discover_openrouter_free(fetch_url=fetch_url))
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as exc:
            log(f"OpenRouter discovery failed: {exc}")
            discovery_failed = True
    return available, discovery_failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Select OpenCode review model chain")
    parser.add_argument(
        "--preferences",
        type=Path,
        default=DEFAULT_PREFS,
        help="Path to model-preferences.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("review-model-chain.json"),
        help="Write chain JSON here",
    )
    args = parser.parse_args()

    prefs = load_preferences(args.preferences)
    env = dict(os.environ)
    if env.get("HAS_OPENROUTER_KEY") != "true" and env.get("OPENROUTER_API_KEY"):
        env["HAS_OPENROUTER_KEY"] = "true"
    if env.get("HAS_OPENCODE_KEY") != "true" and env.get("OPENCODE_ZEN_API_KEY"):
        env["HAS_OPENCODE_KEY"] = "true"

    available, discovery_failed = collect_available(env)
    attempts, free_models, decisions = build_chain(
        prefs,
        available,
        env,
        discovery_failed=discovery_failed,
    )

    if not attempts:
        log("No review models available after selection")
        return 1

    log("Review model chain:")
    for decision in decisions:
        status = "include" if decision.included else "skip"
        log(f"  [{status}] {decision.model_id}: {decision.reason}")
    log("Final attempt order:")
    for model_id in attempts:
        log(f"  - {model_id}")

    payload = {
        "attempts": attempts,
        "freeModels": free_models,
        "discoveryFailed": discovery_failed,
        "decisions": [
            {
                "model": d.model_id,
                "included": d.included,
                "reason": d.reason,
            }
            for d in decisions
        ],
    }
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"attempts": attempts, "count": len(attempts)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
