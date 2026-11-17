#!/usr/bin/env python3
"""Fetch 7 real photos from Openverse (CC-licensed, Flickr etc.), center-crop
to 9:16 (1152x2048), save to media-v4/, record sources in sources-v4.json."""
import io
import json
import os
import time
import urllib.parse
import urllib.request

from PIL import Image

OUT = os.path.expanduser("~/workspace/video-selfhost/media-v4")
os.makedirs(OUT, exist_ok=True)

QUERIES = [
    ("real-scale", "bathroom scale"),
    ("real-jeans", "blue jeans denim"),
    ("real-diary", "open notebook diary writing"),
    ("real-eggs", "fried eggs breakfast"),
    ("real-sunrise", "sunrise sky"),
    ("real-shoes", "running shoes"),
    ("real-bowl", "healthy salad bowl food"),
]

API = "https://api.openverse.org/v1/images/"
UA = {"User-Agent": "post-engineer-test/1.0 (local test video)"}


def search(term):
    q = {"q": term, "page_size": "8", "license_type": "commercial",
         "size": "large", "filter_dead": "false"}
    url = API + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get(url):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as exc:
            last = exc
            print(f"  download attempt {attempt+1} failed: {exc}", flush=True)
            time.sleep(5 * (attempt + 1))
    return None


def main():
    sources = {}
    for stem, term in QUERIES:
        data = search(term)
        picked = None
        raw = None
        img = None
        for res in data.get("results", []):
            url = res.get("url", "")
            if not url.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png")):
                continue
            print(f"{stem}: trying {res.get('title')} by {res.get('creator')} "
                  f"[{res.get('license')} {res.get('license_version')}]", flush=True)
            raw = get(url)
            if raw is None:
                continue
            try:
                img = Image.open(io.BytesIO(raw)).convert("RGB")
            except Exception as exc:
                print(f"  not an image: {exc}", flush=True)
                continue
            w, h = img.size
            cw = min(w, int(h * 9 / 16))
            ch = int(cw * 16 / 9)
            if cw < 650 or ch > h:
                print(f"  too small for 9:16 crop ({w}x{h} -> {cw}x{ch})", flush=True)
                continue
            picked = res
            break
        if not picked:
            raise SystemExit(f"no usable Openverse result for {term!r}")
        w, h = img.size
        cw = min(w, int(h * 9 / 16))
        ch = int(cw * 16 / 9)
        if cw < 500 or ch > h:
            raise SystemExit(f"{stem}: image {w}x{h} too small for 9:16 crop")
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        img = img.crop((x0, y0, x0 + cw, y0 + ch)).resize((1152, 2048), Image.LANCZOS)
        out = os.path.join(OUT, f"{stem}.jpg")
        img.save(out, "JPEG", quality=90)
        sources[stem + ".jpg"] = {
            "source": "Openverse",
            "provider": picked.get("provider"),
            "title": picked.get("title"),
            "creator": picked.get("creator"),
            "license": f"{picked.get('license')} {picked.get('license_version')}",
            "license_url": picked.get("license_url"),
            "page": picked.get("foreign_landing_url"),
            "direct_url": picked.get("url"),
        }
        print(f"  saved {out} ({os.path.getsize(out)} bytes)", flush=True)
        time.sleep(2)
    json.dump(sources, open(os.path.join(OUT, "sources-v4.json"), "w"), indent=2)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
