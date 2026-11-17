#!/usr/bin/env python3
"""Start local TTS + engine (dev) for the v2 faceless video run.

Reads secrets from apps/engine/.env in-process; never prints values,
never puts them on a command line.
"""
import os
import subprocess
import sys
import time
import urllib.request

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
VENV_PY = os.path.join(ENGINE_DIR, ".venv", "bin", "python")
UV = os.path.expanduser("~/.local/bin/uv")
VOICES_DIR = os.path.expanduser("~/workspace/voices")
TTS_LOG = os.path.expanduser("~/workspace/video-selfhost/logs/tts.log")
ENGINE_LOG = os.path.expanduser("~/workspace/video-selfhost/logs/engine.log")


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def wait_port(url, headers, timeout=300):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status
        except Exception:
            time.sleep(3)
    return None


def main():
    env = load_env(os.path.join(ENGINE_DIR, ".env"))
    secret = env.get("CHATTERBOX_HTTP_SECRET", "")
    if not secret:
        raise SystemExit("CHATTERBOX_HTTP_SECRET missing from engine .env")
    os.makedirs(os.path.dirname(TTS_LOG), exist_ok=True)
    os.makedirs(VOICES_DIR, exist_ok=True)

    with open(TTS_LOG, "ab") as lf:
        tts = subprocess.Popen(
            [VENV_PY, "-m", "uvicorn", "local_tts.server:app",
             "--host", "127.0.0.1", "--port", "4123"],
            cwd=ENGINE_DIR,
            env=dict(os.environ, CHATTERBOX_HTTP_SECRET=secret,
                     TTS_VOICES_DIR=VOICES_DIR),
            stdout=lf, stderr=subprocess.STDOUT, start_new_session=True)
    print(f"TTS pid={tts.pid}", flush=True)
    st = wait_port("http://127.0.0.1:4123/health",
                   {"Authorization": f"Bearer {secret}"}, timeout=300)
    print(f"TTS /health: {st}", flush=True)
    if st != 200:
        raise SystemExit("TTS did not become healthy")

    engine_env = dict(os.environ,
                      MPT_CHATTERBOX_API_KEY=secret,
                      MPT_CLONED_VOICES_REGISTRY_API_KEY=secret,
                      MPT_CLONED_VOICES_REGISTRY_BASE_URL="http://127.0.0.1:4123")
    with open(ENGINE_LOG, "ab") as lf:
        eng = subprocess.Popen(
            [UV, "run", "python", "main.py"],
            cwd=ENGINE_DIR, env=engine_env, stdout=lf, stderr=subprocess.STDOUT,
            start_new_session=True)
    print(f"engine pid={eng.pid}", flush=True)
    st = wait_port("http://127.0.0.1:8080/version", {}, timeout=300)
    print(f"engine /version: {st}", flush=True)
    if st != 200:
        raise SystemExit("engine did not come back")
    print("OK: TTS + engine up", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
