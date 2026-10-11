"""Build a Chatterbox voice from a Mozilla Common Voice clip.

This is an operator-only script: it is never invoked by the app or by any
user-facing flow. It uses a Common Voice recording as a ONE-TIME bootstrap
reference to generate audio with Chatterbox, then keeps only the GENERATED
audio as the archived voice reference — the Mozilla clip is never committed,
archived, or redistributed (the dataset's hosting terms discourage it, and
the catalog only ever ships Chatterbox output).

Pipeline (phases map to the functions below):

    A. Pick a candidate clip from the dataset's validated.tsv and prepare a
       clean temporary reference (ffmpeg: mono, loudnorm, trim silence).
    B. Upload it to Modal as a temporary bootstrap voice, read the sample
       lines, and concatenate the outputs into a single longer, varied
       synthetic reference.
    C. Register the synthetic reference as the final voice (reference file
       + voices.toml entry) and validate it.

Usage:

    uv run python scripts/build_voice_reference.py \
        --tsv validated.tsv --clips-dir clips/ \
        --voice minha_voz --voices-toml voices.toml

    # non-interactive (CI-friendly): --index 42 picks the 42nd candidate

Dev and prod share the same voice catalog, so one run per voice is enough;
make sure your Modal CLI is pointed at the right environment before running.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

# Sample lines: Portuguese on purpose (the target voice reads pt); varied
# phonemes and sentence lengths give the clone more to learn from. The
# bootstrap voice reads these so the final reference is fully synthetic.
SAMPLE_LINES_PT: tuple[str, ...] = (
    "Olá! Esta é uma amostra de voz criada para o nosso catálogo de narração.",
    "Os vídeos curtos precisam de energia, clareza e um ritmo que prenda a atenção de quem assiste.",
    "Número um, número sete, número quarenta e dois. Zebra, jardim, chocolate, código, xícara.",
    "Você já imaginou quanto tempo economizaria se as publicações acontecessem sozinhas, todos os dias, no horário certo?",
    "Terça-feira chuvosa, mercado lotado, guarda-chuva esquecido em casa. A vida tem dessas ironias pequenas.",
)

# English lines for en voices, mirroring the pt set's goals: varied phonemes,
# numbers, lists, and both short and long sentences.
SAMPLE_LINES_EN: tuple[str, ...] = (
    "Hello! This is a voice sample created for our narration catalog.",
    "Short videos need energy, clarity, and a rhythm that keeps the viewer watching until the very end.",
    "Number one, number seven, number forty-two. Zebra, garden, chocolate, keyboard, umbrella.",
    "Have you ever wondered how much time you would save if everything published itself, every single day, right on schedule?",
    "A rainy Tuesday, a crowded market, an umbrella forgotten at home. Life is full of small ironies like these.",
)

SAMPLE_LINES: tuple[str, ...] = SAMPLE_LINES_PT


def sample_lines_for(language_id: str) -> tuple[str, ...]:
    """Pick the sample line set matching the target language."""
    lang = (language_id or "").strip().lower()
    if lang.startswith("en"):
        return SAMPLE_LINES_EN
    return SAMPLE_LINES_PT

BOOTSTRAP_PREFIX = "_tmp_"
MIN_UP_VOTES = 2
MIN_SENTENCE_CHARS = 20
MAX_SENTENCE_CHARS = 200
MODAL_SCRIPT = "modal_chatterbox.py"


@dataclass(frozen=True)
class ClipCandidate:
    """One usable row from a Common Voice validated.tsv file."""

    client_id: str
    clip_path: str
    sentence: str
    up_votes: int
    down_votes: int
    accent: str


def parse_validated_tsv(tsv_path: Path) -> list[ClipCandidate]:
    """Parse a Common Voice validated.tsv into candidate clips.

    Common Voice TSV columns (v9+): client_id, path, sentence, up_votes,
    down_votes, age, gender, accent, locale, segment. Unknown/extra columns
    are ignored so newer dataset revisions keep parsing.
    """
    candidates: list[ClipCandidate] = []
    with open(tsv_path, "r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            try:
                candidate = ClipCandidate(
                    client_id=str(row.get("client_id", "") or ""),
                    clip_path=str(row.get("path", "") or ""),
                    sentence=str(row.get("sentence", "") or "").strip(),
                    up_votes=int(float(row.get("up_votes", "0") or 0)),
                    down_votes=int(float(row.get("down_votes", "0") or 0)),
                    accent=str(row.get("accent", "") or ""),
                )
            except (TypeError, ValueError):
                # A malformed row must not abort the whole listing; skip it.
                continue
            if not candidate.clip_path:
                continue
            candidates.append(candidate)
    return candidates


def filter_candidates(
    candidates: list[ClipCandidate],
    min_up_votes: int = MIN_UP_VOTES,
    min_sentence_chars: int = MIN_SENTENCE_CHARS,
    max_sentence_chars: int = MAX_SENTENCE_CHARS,
) -> list[ClipCandidate]:
    """Keep clips with community approval and a substantial sentence.

    down_votes must be exactly zero: a disputed recording is a bad cloning
    reference, and the accent/quality fields are informational only.
    """
    return [
        c
        for c in candidates
        if c.up_votes >= min_up_votes
        and c.down_votes == 0
        and min_sentence_chars <= len(c.sentence) <= max_sentence_chars
    ]


def validate_voice_name(name: str) -> str:
    """Reject voice names the Modal volume would refuse.

    modal_chatterbox.write_reference requires a simple identifier (the name
    becomes a directory under /voices), so validate with the same rule and
    fail fast before any upload.
    """
    name = (name or "").strip()
    if not name.isidentifier() or name.startswith(BOOTSTRAP_PREFIX):
        raise ValueError(
            f"voice name must be a Python identifier not starting with "
            f"{BOOTSTRAP_PREFIX!r}: {name!r}"
        )
    return name


def ffmpeg_prepare_reference_command(clip_path: Path, out_path: Path) -> list[str]:
    """Build the ffmpeg command that cleans a raw clip into a reference.

    Mono WAV keeps the pipeline predictable; loudnorm evens out recording
    levels; the afftdn filter removes light background hiss common in
    crowd-sourced recordings.
    """
    return [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(clip_path),
        "-ac",
        "1",
        "-ar",
        "24000",
        "-af",
        "highpass=f=80,afftdn=nf=-25,loudnorm=I=-20:TP=-2:LRA=7",
        str(out_path),
    ]


def ffmpeg_concat_command(parts: list[Path], out_path: Path) -> list[str]:
    """Build the ffmpeg command that joins the generated parts into one file.

    Each part is already mono/24kHz WAV, so concat demuxer + loudnorm is
    enough; no re-encoding surprises.
    """
    return [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(parts[0].with_name("concat_list.txt")),
        "-af",
        "loudnorm=I=-20:TP=-2:LRA=7",
        str(out_path),
    ]


def modal_run_command(*args: str) -> list[str]:
    """Build a `uv run modal run` command against modal_chatterbox.py.

    The first arg is the `script::function` target (e.g.
    "modal_chatterbox.py::upload_reference"). The Modal environment/profile
    is whatever the operator's CLI is bound to — dev and prod share the
    voice catalog, so no --env is injected here.
    """
    return ["uv", "run", "modal", "run", *args]


def build_voices_toml(existing_text: str, name: str, language_id: str) -> str:
    """Append (or replace) a voice section in the voices.toml text.

    The existing file content (including its comments) is preserved and the
    new section is appended, matching the hand-maintained style of
    voices.toml. A duplicate section for the same name is removed first so
    rebuilding a voice cannot produce two conflicting entries.
    """
    lines = existing_text.splitlines()
    out: list[str] = []
    skipping = False
    header = f"[{name}]"
    for line in lines:
        stripped = line.strip()
        if stripped == header:
            skipping = True
            continue
        if skipping:
            # A new section header ends the block being replaced.
            if stripped.startswith("[") and stripped.endswith("]"):
                skipping = False
            else:
                continue
        out.append(line)
    section = [
        "",
        f"[{name}]",
        f'reference = "{name}/reference.wav"',
        f'language_id = "{language_id}"',
    ]
    return "\n".join(out + section).rstrip("\n") + "\n"


def remove_voice_section(existing_text: str, name: str) -> str:
    """Drop one voice section from the voices.toml text (others preserved)."""
    lines = existing_text.splitlines()
    out: list[str] = []
    skipping = False
    header = f"[{name}]"
    for line in lines:
        stripped = line.strip()
        if stripped == header:
            skipping = True
            continue
        if skipping:
            # A new section header ends the block being removed.
            if stripped.startswith("[") and stripped.endswith("]"):
                skipping = False
            else:
                continue
        out.append(line)
    return "\n".join(out).rstrip("\n") + "\n"


def run_command(command: list[str]) -> None:
    """Run an external command, streaming output and failing loudly."""
    print(f"+ {' '.join(command)}", flush=True)
    result = subprocess.run(command)
    if result.returncode != 0:
        raise SystemExit(f"command failed with exit code {result.returncode}: {command[0]}")


def select_candidate(
    candidates: list[ClipCandidate], index: int | None
) -> ClipCandidate:
    """Pick a candidate by index or interactively list them for the operator."""
    if index is not None:
        if not 0 <= index < len(candidates):
            raise SystemExit(f"index {index} is out of range (0..{len(candidates) - 1})")
        return candidates[index]

    for i, candidate in enumerate(candidates):
        accent = f" | accent: {candidate.accent}" if candidate.accent else ""
        print(f"[{i}] {candidate.sentence}{accent}")
    raw = input(f"Clip index [0..{len(candidates) - 1}]: ").strip()
    try:
        chosen = int(raw)
    except ValueError:
        raise SystemExit(f"not a number: {raw!r}")
    if not 0 <= chosen < len(candidates):
        raise SystemExit(f"index {chosen} is out of range (0..{len(candidates) - 1})")
    return candidates[chosen]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tsv", required=True, type=Path, help="validated.tsv path")
    parser.add_argument("--clips-dir", required=True, type=Path, help="dataset clips/ dir")
    parser.add_argument(
        "--clip",
        type=Path,
        default=None,
        help="use this clip file directly, skipping TSV listing/selection",
    )
    parser.add_argument("--voice", required=True, help="final voice name (identifier)")
    parser.add_argument(
        "--voices-toml", required=True, type=Path, help="voices.toml to update"
    )
    parser.add_argument(
        "--language-id", default="pt", help="Chatterbox language code (default: pt)"
    )
    parser.add_argument(
        "--index", type=int, default=None, help="pick candidate N non-interactively"
    )
    args = parser.parse_args()

    voice = validate_voice_name(args.voice)

    # ── Phase A: pick and prepare the bootstrap reference (temporary only) ──
    if args.clip is not None:
        clip_path = args.clip
        print(f"selected (explicit --clip): {clip_path.name}")
    else:
        candidates = filter_candidates(parse_validated_tsv(args.tsv))
        if not candidates:
            raise SystemExit("no candidate clips matched the filters")
        candidate = select_candidate(candidates, args.index)
        clip_path = args.clips_dir / candidate.clip_path
        print(f"selected: {candidate.sentence}")

    with tempfile.TemporaryDirectory(prefix="voice-bootstrap-") as tmp:
        work = Path(tmp)
        bootstrap_ref = work / "bootstrap.wav"
        run_command(ffmpeg_prepare_reference_command(clip_path, bootstrap_ref))
        toml_text = (
            args.voices_toml.read_text(encoding="utf-8")
            if args.voices_toml.exists()
            else ""
        )

        def sync_voices_config() -> None:
            """Write the local voices.toml and upload it to the volume."""
            args.voices_toml.write_text(toml_text, encoding="utf-8")
            run_command(
                modal_run_command(
                    f"{MODAL_SCRIPT}::put_voices_config",
                    "--path",
                    str(args.voices_toml),
                )
            )

        # ── Phase B: upload bootstrap voice and synthesize the reference ──
        # The generator resolves voices through voices.toml, so the bootstrap
        # clip needs a temporary entry until the synthetic reference exists.
        bootstrap_name = f"{BOOTSTRAP_PREFIX}{voice}"
        run_command(
            modal_run_command(
                f"{MODAL_SCRIPT}::upload_reference",
                "--voice",
                bootstrap_name,
                "--path",
                str(bootstrap_ref),
            )
        )
        toml_text = build_voices_toml(toml_text, bootstrap_name, args.language_id)
        sync_voices_config()

        parts: list[Path] = []
        lines = sample_lines_for(args.language_id)
        if lines:
            texts_json = work / "texts.json"
            texts_json.write_text(
                json.dumps({"texts": list(lines)}), encoding="utf-8"
            )
            parts_dir = work / "parts"
            run_command(
                modal_run_command(
                    f"{MODAL_SCRIPT}::generate_many_to_dir",
                    "--voice",
                    bootstrap_name,
                    "--texts-json",
                    str(texts_json),
                    "--out-dir",
                    str(parts_dir),
                )
            )
            parts = sorted(parts_dir.glob("part_*.wav"))
        if not parts:
            raise SystemExit("reference generation produced no audio parts")

        concat_list = parts_dir / "concat_list.txt"
        concat_list.write_text(
            "".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8"
        )
        synthetic = work / "synthetic_reference.wav"
        run_command(ffmpeg_concat_command(parts, synthetic))

        # ── Phase C: register the final voice from the synthetic audio ──
        run_command(
            modal_run_command(
                f"{MODAL_SCRIPT}::upload_reference",
                "--voice",
                voice,
                "--path",
                str(synthetic),
            )
        )
        # Drop the bootstrap entry: the catalog must only expose the final
        # synthetic voice (the uploaded bootstrap file stays orphaned on the
        # volume, which is harmless).
        toml_text = remove_voice_section(toml_text, bootstrap_name)
        toml_text = build_voices_toml(toml_text, voice, args.language_id)
        sync_voices_config()

    print(
        f"voice '{voice}' registered. Follow-ups (run manually):\n"
        f"  uv run modal run {MODAL_SCRIPT}::validate --voice {voice}\n"
        f"  add '{voice}' to [chatterbox] voices in config.toml so the app catalog picks it up"
    )
    return None


if __name__ == "__main__":
    sys.exit(main())
