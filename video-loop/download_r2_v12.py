#!/usr/bin/env python3
"""Fetch the finished v12 final video DIRECTLY from the R2 dev archive
(bucket `videos`, key from task-v12-final.json video_storage_path),
resuming the partial local file. Credentials come from the engine .env
in-process; never printed."""
import json
import os
import time

ENGINE_DIR = os.path.expanduser("~/workspace/pe-local-selfhost/apps/engine")
OUT_DIR = os.path.expanduser("~/workspace/video-selfhost")
OUT_PATH = os.path.join(OUT_DIR, "daily-dose-weight-regain-faceless-v12.mp4")


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main():
    env = load_env(os.path.join(ENGINE_DIR, ".env"))
    final = json.load(open(os.path.join(OUT_DIR, "task-v12-final.json")))
    key = final["video_storage_path"]
    print(f"key={key}", flush=True)
    import boto3
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    head = s3.head_object(Bucket="videos", Key=key)
    total = head["ContentLength"]
    print(f"R2 object size: {total}", flush=True)
    have = os.path.getsize(OUT_PATH) if os.path.exists(OUT_PATH) else 0
    print(f"resuming at {have} bytes", flush=True)
    while have < total:
        resp = s3.get_object(Bucket="videos", Key=key,
                             Range=f"bytes={have}-{total - 1}")
        mode = "ab" if have else "wb"
        with open(OUT_PATH, mode) as f:
            while True:
                chunk = resp["Body"].read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
                have += len(chunk)
        print(f"have={have}/{total}", flush=True)
        if have < total:
            time.sleep(5)
    print(f"downloaded {OUT_PATH} ({have} bytes)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
