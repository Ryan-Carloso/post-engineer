"""Generate the Option A narration in the cloned ryan voice.

The engine's [chatterbox] base_url in config.toml still points at the old
deployment label; this override uses the URL Modal actually serves today.
"""

import sys
from pathlib import Path

from app.config import config
from app.services import longcat, voice

SCRIPT = (
    "Você tem uma ideia. O Post Engineer monta o vídeo inteiro sozinho: "
    "roteiro, voz sintética, um avatar falando e publicação automática nas redes."
)

LIVE_CHATTERBOX_URL = "https://joaodev904-tech--chatterbox.modal.run/v1"
config.chatterbox["base_url"] = LIVE_CHATTERBOX_URL

out = Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)

print(f"[tts] chatterbox:ryan <- {SCRIPT!r}", flush=True)
# tts(text, voice_name, voice_rate, voice_file, ...) -- rate is positional.
voice.tts(SCRIPT, "chatterbox:ryan", 1.0, str(out))
print(f"[tts] narration {longcat.audio_duration_seconds(str(out)):.2f}s -> {out}", flush=True)