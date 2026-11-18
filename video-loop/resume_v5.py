#!/usr/bin/env python3
"""Resume polling the v5 task created by drive_v5.py (42090dca) until it
reaches a terminal state, then download final-1.mp4 (R2 direct fallback
if the endpoint 404s after a restart). Used if drive_v5.py itself hit
its 60-min poll deadline while the engine was still rendering.
"""
import json
import os
import time
import urllib.error
import urllib.request

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
ROOT = os.path.expanduser("~/workspace/video-selfhost")
BASE = "http://127.0.0.1:8080/api/v1"


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def req(method, url, headers, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"_raw": raw[:500].decode("utf-8", "replace")}


def main():
    secret = load_env(os.path.join(ENGINE_DIR, ".env")).get("MONEYPRINT_API_SECRET", "")
    headers = {"Authorization": f"Bearer {secret}",
               "x-user-id": "dev-local",
               "Content-Type": "application/json"}
    task_id = json.load(open(os.path.join(ROOT, "task-v5.json")))["task_id"]
    print(f"resuming poll for task {task_id}", flush=True)
    deadline = time.time() + 3 * 60 * 60
    last = ""
    while time.time() < deadline:
        try:
            status, data = req("GET", BASE + f"/tasks/{task_id}", headers)
        except Exception as exc:
            print(f"poll timeout ({type(exc).__name__}), retrying", flush=True)
            time.sleep(30)
            continue
        body = data.get("body", data) if isinstance(data, dict) else {}
        state = body.get("state")
        progress = body.get("progress")
        msg = f"state={state} progress={progress}"
        if msg != last:
            print(f"poll: {msg} {json.dumps(body)[:300]}", flush=True)
            last = msg
        if state in (1, -1):
            print(f"TERMINAL state={state}", flush=True)
            print(json.dumps(body)[:2000], flush=True)
            json.dump(body, open(os.path.join(ROOT, "task-v5-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(30)
    else:
        raise SystemExit("poll timed out after 3h")

    out_path = os.path.join(ROOT, "daily-dose-weight-regain-faceless-v5.mp4")
    r = urllib.request.Request(BASE + f"/download/{task_id}/final-1.mp4",
                               headers={"Authorization": f"Bearer {secret}"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            data = resp.read()
        open(out_path, "wb").write(data)
        print(f"downloaded {out_path} ({len(data)} bytes)", flush=True)
    except urllib.error.HTTPError as e:
        print(f"download final-1.mp4 FAILED: HTTP {e.code}", flush=True)
        print("use download_r2_v4.py adapted to v5 (task-v5-final.json)", flush=True)
        raise SystemExit(1)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
