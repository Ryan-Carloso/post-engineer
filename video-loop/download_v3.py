#!/usr/bin/env python3
"""Download the finished v3 video with resume: GET the engine download
endpoint (302 to a signed R2 URL), then fetch the signed URL WITHOUT the
Bearer header, resuming with Range on dropped connections.
"""
import json
import os
import sys
import urllib.error
import urllib.request

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
BASE = "http://127.0.0.1:8080/api/v1"
OUT_PATH = os.path.join(OUT_DIR, "daily-dose-weight-regain-faceless-v3.mp4")


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def signed_url(secret, task_id):
    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(
        BASE + f"/download/{task_id}/final-1.mp4",
        headers={"Authorization": f"Bearer {secret}", "x-user-id": "dev-local"})
    try:
        opener.open(req, timeout=60)
        raise SystemExit("expected 302 from download endpoint")
    except urllib.error.HTTPError as e:
        if e.code != 302:
            print(f"download endpoint FAILED: HTTP {e.code} {e.read()[:300]}")
            raise SystemExit(1)
        return e.headers.get("Location")


def main():
    task_id = json.load(open(os.path.join(OUT_DIR, "task-v3.json")))["task_id"]
    secret = load_env(os.path.join(ENGINE_DIR, ".env")).get("MONEYPRINT_API_SECRET", "")
    have = os.path.getsize(OUT_PATH) if os.path.exists(OUT_PATH) else 0
    print(f"resuming at {have} bytes", flush=True)
    for attempt in range(1, 31):
        url = signed_url(secret, task_id)
        headers = {}
        if have:
            headers["Range"] = f"bytes={have}-"
        req = urllib.request.Request(url, method="GET", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                cr = resp.headers.get("Content-Range")
                if cr and "/" in cr:
                    total = int(cr.rsplit("/", 1)[1])
                else:
                    total = int(resp.headers.get("Content-Length") or 0)
                print(f"attempt {attempt}: HTTP {resp.status} total={total}", flush=True)
                mode = "ab" if have and resp.status == 206 else "wb"
                if mode == "wb":
                    have = 0
                with open(OUT_PATH, mode) as f:
                    while True:
                        chunk = resp.read(1024 * 256)
                        if not chunk:
                            break
                        f.write(chunk)
                        have += len(chunk)
                if total and have < total:
                    print(f"short read: have={have} total={total}, resuming", flush=True)
                    time.sleep(5)
                    continue
            print(f"downloaded {OUT_PATH} ({have} bytes)", flush=True)
            return 0
        except Exception as exc:  # IncompleteRead / timeout: keep partial, retry
            print(f"attempt {attempt} interrupted ({type(exc).__name__}), have={have}", flush=True)
            time.sleep(5)
    print("download failed after retries", flush=True)
    return 1


if __name__ == "__main__":
    import time
    raise SystemExit(main())
