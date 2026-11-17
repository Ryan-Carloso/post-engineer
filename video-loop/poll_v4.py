#!/usr/bin/env python3
"""Resume polling task v3 (driver died on a poll timeout; the task kept
running). Reads task id from task-v4.json, polls until terminal, downloads.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
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


def req(method, url, headers, timeout=60):
    r = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"_raw": raw[:300].decode("utf-8", "replace")}


def main():
    task_id = json.load(open(os.path.join(OUT_DIR, "task-v4.json")))["task_id"]
    secret = load_env(os.path.join(ENGINE_DIR, ".env")).get("MONEYPRINT_API_SECRET", "")
    headers = {"Authorization": f"Bearer {secret}", "x-user-id": "dev-local",
               "Content-Type": "application/json"}
    print(f"resuming task {task_id}", flush=True)
    deadline = time.time() + 60 * 60
    last = ""
    while time.time() < deadline:
        try:
            status, data = req("GET", BASE + f"/tasks/{task_id}", headers)
        except Exception as exc:
            print(f"poll error ({type(exc).__name__}), retrying", flush=True)
            time.sleep(20)
            continue
        body = data.get("body", data) if isinstance(data, dict) else {}
        state, progress = body.get("state"), body.get("progress")
        msg = f"state={state} progress={progress} stage={body.get('stage')}"
        if msg != last:
            print(f"poll: {msg}", flush=True)
            last = msg
        if state in (1, -1):
            print(f"TERMINAL state={state}", flush=True)
            print(json.dumps(body)[:2000], flush=True)
            json.dump(body, open(os.path.join(OUT_DIR, "task-v4-final.json"), "w"))
            if state != 1:
                raise SystemExit(f"task FAILED state={state}")
            break
        time.sleep(20)
    else:
        raise SystemExit("poll timed out")

    import subprocess
    r = subprocess.run([sys.executable, os.path.join(OUT_DIR, "download_v4.py")])
    if r.returncode != 0:
        raise SystemExit("download_v4.py failed")
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
