"""Generate the four English persona demo videos with Replicate/SadTalker.

Usage from the repository root:

    REPLICATE_API_TOKEN=... \
    REPLICATE_LIPSYNC_MODEL=cjwbw/sadtalker \
    uv run --directory my-money-print python scripts/generate_persona_demos.py

The generated files are written to ../public/persona-demos and are safe to
commit as static demo assets.
"""

import sys
from pathlib import Path

from PIL import Image

from app.services import replicate_lipsync

ROOT = Path(__file__).resolve().parents[2]
CHARACTER_DIR = ROOT / "public" / "caracter-samples"
VOICE_DIR = ROOT / "public" / "voice-samples"
OUTPUT_DIR = ROOT / "public" / "persona-demos"
PERSONAS: tuple[tuple[str, str], ...] = (
    ("file-1", "calm"),
    ("file-2", "energetic"),
    ("file-3", "young"),
    ("file-4", "deep"),
)


def prepare_image(source: Path, target: Path) -> None:
    """Resize the character image to a Replicate-friendly PNG."""
    with Image.open(source) as image:
        resized = image.convert("RGB")
        resized.thumbnail((768, 768))
        resized.save(target, format="JPEG", quality=85, optimize=True)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for character_prefix, voice_prefix in PERSONAS:
        image = CHARACTER_DIR / f"{character_prefix}.png"
        audio = VOICE_DIR / f"{voice_prefix}-en-us.mp3"
        output = OUTPUT_DIR / f"{character_prefix}-en-us.mp4"
        if not image.is_file() or not audio.is_file():
            raise FileNotFoundError(f"missing inputs for {character_prefix}: {image}, {audio}")
        if output.is_file() and output.stat().st_size > 0:
            print(f"skip: {output}")
            continue

        prepared_image = OUTPUT_DIR / f".{character_prefix}-input.jpg"
        print(f"generating: {character_prefix}")
        prepare_image(image, prepared_image)
        try:
            replicate_lipsync.create_lipsync_video(
                str(prepared_image), str(audio), str(output)
            )
        finally:
            prepared_image.unlink(missing_ok=True)
        if not output.is_file() or output.stat().st_size == 0:
            raise RuntimeError(f"empty demo output for {character_prefix}")
        print(f"created: {output} ({output.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
