#!/usr/bin/env python3
"""Fetch remaining real photos for v6: calendar from Pexels (direct ID),
fridge / small plate / water from Openverse with fallback terms.
Center-crop to 9:16 (1152x2048), save to media-v6/, record sources."""
import io
import json
import os
import time
import urllib.parse
import urllib.request

from PIL import Image

OUT = os.path.expanduser("~/workspace/video-selfhost/media-v6")
os.makedirs(OUT, exist_ok=True)
SOURCES_PATH = os.path.join(OUT, "sources-v6.json")
sources = json.load(open(SOURCES_PATH)) if os.path.exists(SOURCES_PATH) else {}

UA = {"User-Agent": "post-engineer-test/1.0 (local test video)"}


def get(url, timeout=120):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:
            last = exc
            print(f"  download attempt {attempt+1} failed: {exc}", flush=True)
            time.sleep(5 * (attempt + 1))
    return None


def save_crop(stem, raw):
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size
    cw = min(w, int(h * 9 / 16))
    ch = int(cw * 16 / 9)
    if cw < 650 or ch > h:
        print(f"  too small for 9:16 crop ({w}x{h} -> {cw}x{ch})", flush=True)
        return False
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    img = img.crop((x0, y0, x0 + cw, y0 + ch)).resize((1152, 2048), Image.LANCZOS)
    out = os.path.join(OUT, f"{stem}.jpg")
    img.save(out, "JPEG", quality=90)
    print(f"  saved {out} ({os.path.getsize(out)} bytes)", flush=True)
    return True


def pexels(stem, photo_id, page, note):
    url = f"https://images.pexels.com/photos/{photo_id}/pexels-photo-{photo_id}.jpeg?auto=compress&cs=tinysrgb&w=1600"
    print(f"{stem}: Pexels {photo_id}", flush=True)
    raw = get(url)
    if raw and save_crop(stem, raw):
        sources[stem + ".jpg"] = {
            "source": "Pexels", "photo_id": str(photo_id), "page": page,
            "license": "Pexels License (free to use, no attribution required)",
            "note": note,
        }
        return True
    return False


def openverse(stem, terms):
    api = "https://api.openverse.org/v1/images/"
    for term in terms:
        q = {"q": term, "page_size": "8", "license_type": "commercial",
             "filter_dead": "false"}
        url = api + "?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
        except Exception as exc:
            print(f"  search {term!r} failed: {exc}", flush=True)
            continue
        for res in data.get("results", []):
            u = res.get("url", "")
            if not u.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png")):
                continue
            print(f"{stem}: trying {res.get('title')} by {res.get('creator')} "
                  f"[{res.get('license')} {res.get('license_version')}]", flush=True)
            raw = get(u)
            if raw is None:
                continue
            try:
                if save_crop(stem, raw):
                    sources[stem + ".jpg"] = {
                        "source": "Openverse",
                        "provider": res.get("provider"),
                        "title": res.get("title"),
                        "creator": res.get("creator"),
                        "license": f"{res.get('license')} {res.get('license_version')}",
                        "license_url": res.get("license_url"),
                        "page": res.get("foreign_landing_url"),
                        "direct_url": res.get("url"),
                    }
                    return True
            except Exception as exc:
                print(f"  not an image: {exc}", flush=True)
                continue
        time.sleep(2)
    return False


def main():
    ok = True
    ok &= pexels("real-calendar", 5635114,
                 "https://www.pexels.com/photo/october-calendar-on-wooden-wall-5635114/",
                 "October calendar on wooden wall, by Monstera Production")
    ok &= openverse("real-fridge", ["open refrigerator food", "fridge full of food", "open fridge"])
    ok &= openverse("real-small-plate", ["small portion plate food", "small meal plate", "healthy small lunch plate"])
    ok &= openverse("real-water", ["glass of water kitchen", "glass water table", "drinking water glass"])
    json.dump(sources, open(SOURCES_PATH, "w"), indent=2)
    print("DONE ok=", ok, flush=True)
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
