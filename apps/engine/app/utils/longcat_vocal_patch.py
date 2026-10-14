"""Image-build patch: skip upstream's vocal-separation step.

Upstream's ``run_demo_avatar_single_audio_to_video.py`` runs a neural source
separator (an ONNX Kim_Vocal_2 model, via the ``audio_separator`` package)
over the input audio before generating, on the theory that narration is mixed
with music or ambience that must be stripped out.

For this pipeline that step is pure waste. The persona narration is synthesised
by Chatterbox -- it is a clean vocal stem already, with no backing track to
separate. The separator therefore spends real GPU seconds re-deriving vocals
from audio that is already vocal.

What the patch changes
----------------------
The whole assignment line (it is a single line upstream) is replaced so the
``separate()`` call is never made -- renaming the call would still run it.

One side effect is accepted deliberately: later upstream does
``os.remove(temp_vocal_path)``. With the separator bypassed that now removes the
file this patch wrote instead of a separated vocal. The file is a
container-local temp file used once by this function, so deleting it is
harmless cleanup.

Why the patch re-encodes instead of just passing the source path through
------------------------------------------------------------------------
First attempt rebound ``temp_vocal_path`` straight to the uploaded source file
and the child process died silently at "Generating segment 1/N" -- SIGKILL with
no Python traceback, on both 1 and 5 segments. The separated vocal was a 16 kHz
WAV; the uploaded source is an MP3, and handing that path to
``librosa.load`` fed the pipeline different audio characteristics than it was
built for. Re-encoding to the same 16 kHz mono WAV reproduces the input the
separator would have produced, minus the separation step.

The separator MODEL is still constructed and loaded at container startup
(upstream does it unconditionally), so a one-time load cost per warm container
remains. Only the per-clip ``separate()`` work is removed.

Run inside the Modal image build. It fails the build if the expected line is
missing, so an upstream rename cannot silently leave separation enabled while
the build log claims it was skipped.
"""

from __future__ import annotations

import os
import pathlib
import sys

MARKER = "patched: skip vocal separation"
HELPER_MARKER = "Patched in: bypass neural vocal separation for clean narration."
ASSIGNMENT_PREFIX = "temp_vocal_path = extract_vocal_from_speech("
DEFAULT_TARGET = "/LongCat-Video/run_demo_avatar_single_audio_to_video.py"


def target_path() -> pathlib.Path:
    """Path to patch.

    Resolved per call rather than at import time so a caller can override it
    (tests point this at a local copy) without the value being frozen into the
    module namespace before the override happens.
    """
    return pathlib.Path(os.environ.get("LONGCAT_PATCH_TARGET", DEFAULT_TARGET))


HELPER_FN = "_lc_direct_vocal"
HELPER_SRC = f'''

def {HELPER_FN}(source_path, target_path, _unused_separator=None, _unused_outdir=None):
    """{HELPER_MARKER}

    ffmpeg-decodes the source audio to the 16 kHz mono WAV the separator would
    have produced, so the pipeline sees the same input format it was built for.
    Raises instead of silently degrading: the caller asserts the result exists.
    """
    import subprocess as _sp

    result = _sp.run(
        ["ffmpeg", "-y", "-i", source_path, "-ac", "1", "-ar", "16000", target_path],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not os.path.exists(target_path):
        raise RuntimeError(
            f"failed to decode source audio to 16k mono WAV: {{result.stderr[-500:]}}"
        )
    return target_path
'''


def main() -> int:
    target = target_path()
    if not target.is_file():
        print(f"patch target missing: {target}", file=sys.stderr)
        return 1
    source = target.read_text()
    lines = source.splitlines(keepends=True)

    if any(MARKER in line for line in lines):
        print("vocal separation already patched; nothing to do")
        return 0

    matches = [i for i, line in enumerate(lines) if line.lstrip().startswith(ASSIGNMENT_PREFIX)]
    if len(matches) != 1:
        print(
            "patch failed: expected exactly one upstream vocal-separation call, "
            f"found {len(matches)}. Upstream changed the call site; re-read it "
            f"before re-enabling this patch. Looked for lines starting with "
            f"{ASSIGNMENT_PREFIX!r}",
            file=sys.stderr,
        )
        return 1

    index = matches[0]
    # Pure function-name substitution: every argument, the indentation and the
    # trailing parens stay exactly as upstream wrote them. The helper accepts
    # upstream's four-argument signature and ignores the two it no longer needs.
    original = lines[index]
    # The marker must land BEFORE the trailing newline. Appending it after the
    # newline turns it into the prefix of the NEXT line, and the comment then
    # swallows that statement -- which is how upstream's
    # `assert temp_vocal_path is not None` silently disappeared from the patched
    # script. A comment-only edit still parses, so no parse check catches it.
    renamed = original.replace("extract_vocal_from_speech(", f"{HELPER_FN}(", 1)
    if renamed.endswith("\n"):
        lines[index] = f"{renamed[:-1]}  # {MARKER}\n"
    else:
        lines[index] = f"{renamed}  # {MARKER}"

    patched = "".join(lines)
    guard = patched.rfind('if __name__ == "__main__":')
    if guard == -1:
        print("patch failed: could not find the module __main__ guard", file=sys.stderr)
        return 1
    patched = patched[:guard] + HELPER_SRC.lstrip("\n") + "\n" + patched[guard:]
    target.write_text(patched)
    print(f"patched line {index + 1}: vocal separation bypassed via ffmpeg re-encode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())