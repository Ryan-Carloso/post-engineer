"""Generate the English narration in a cloned en-US female voice, then trim.

Uses one of the four en_us_female_* voices already published on the Chatterbox
volume (en_us_female_01..04); none is cloned from a new sample here.
"""

import sys
from pathlib import Path

from app.config import config
from app.services import longcat, voice

SCRIPT = (
    "Turn one idea into a published video. Post Engineer writes the script, "
    "generates the voice, animates a talking avatar, and posts it everywhere."
)
VOICE_NAME = "chatterbox:en_us_female_01"

LIVE_CHATTERBOX_URL = "https://joaodev904-tech--chatterbox.modal.run/v1"
config.chatterbox["base_url"] = LIVE_CHATTERBOX_URL

out = Path(sys.argv[1])
seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
out.parent.mkdir(parents=True, exist_ok=True)

print(f"[tts] {VOICE_NAME} <- {SCRIPT!r}", flush=True)
voice.tts(SCRIPT, VOICE_NAME, 1.0, str(out))
raw_s = longcat.audio_duration_seconds(str(out))
print(f"[tts] raw narration {raw_s:.2f}s", flush=True)

segments = longcat.segments_for_duration(raw_s)
clip_s = longcat.clip_seconds(segments)
trimmed = out.with_name(out.stem + "-clip.mp3")
longcat.trim_audio(str(out), str(trimmed), duration_seconds=clip_s, padding_seconds=0.0)
print(f"[trim] {longcat.audio_duration_seconds(str(trimmed)):.2f}s "
      f"({segments} segment(s) -> {clip_s:.2f}s rendered) -> {trimmed}", flush=True)