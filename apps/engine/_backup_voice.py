"""Back up an existing Chatterbox reference sample from the Modal volume.

build_voice_reference.py OVERWRITES voices/<name>/reference.wav on the shared
`chatterbox-voices` volume. This pulls the current file down first so a bad
clone can be rolled back.
"""

import sys

import modal

VOICE_DIR = "/voices"


def main() -> None:
    voice = sys.argv[1]
    out = sys.argv[2]
    vol = modal.Volume.from_name("chatterbox-voices")
    data = b"".join(vol.read_file(f"{VOICE_DIR}/{voice}/reference.wav"))
    with open(out, "wb") as fh:
        fh.write(data)
    print(f"backed up {voice}/reference.wav -> {out} ({len(data)} bytes)")


if __name__ == "__main__":
    main()