#!/usr/bin/env python3
"""Search Pexels videos (portrait) and print candidates with file links.

Uses the registered custom.pexels credential via surrogate — never prints
the key. Prints id, duration, dimensions, and portrait video_files only.
Usage: python3 pexels_search_v14.py "<query>" [per_page]
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def main() -> int:
    query = sys.argv[1]
    per_page = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    params = urllib.parse.urlencode(
        {"query": query, "per_page": per_page, "orientation": "portrait"})
    url = f"https://api.pexels.com/v1/videos/search?{params}"
    request = urllib.request.Request(
        url, headers={"User-Agent": "muse-custom-connector/1.0"})
    add_surrogate_to_request(request, "custom.pexels",
                             allowed_hosts=["api.pexels.com"])
    try:
        with urllib.request.build_opener(NoRedirect()).open(
                request, timeout=60) as response:
            data = read_json_response(response)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.reason}")
        return 1
    print(f"total_results={data.get('total_results')}")
    for v in data.get("videos", []):
        portrait = [f for f in v.get("video_files", [])
                    if f.get("width", 0) < f.get("height", 0)]
        print(json.dumps({
            "id": v.get("id"),
            "duration": v.get("duration"),
            "width": v.get("width"),
            "height": v.get("height"),
            "url": v.get("url"),
            "portrait_files": [
                {"width": f.get("width"), "height": f.get("height"),
                 "quality": f.get("quality"), "file_type": f.get("file_type"),
                 "link": f.get("link")}
                for f in portrait],
        }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
