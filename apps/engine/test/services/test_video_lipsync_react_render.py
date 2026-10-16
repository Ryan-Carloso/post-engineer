"""Real-ffmpeg integration test for the react layout.

The argv tests in test_video_lipsync_layout.py prove the filter graph is
built correctly. This proves ffmpeg ACCEPTS it and produces a sane file —
a filter that is syntactically plausible but rejected at runtime is still a
broken layout.

The audio assertion is the one that matters most. Both inputs here carry a
tone: the background at 200Hz, the persona at 1000Hz. If the compositor maps
the background's audio the output is dominated by 200Hz — which is exactly
the bug a Pexels b-roll would cause in production, and one no argv test can
catch on its own.
"""

import math
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import video as vd

WIDTH = 540
HEIGHT = 960
HOOK_SECONDS = 2.0
TOTAL_SECONDS = 4.0

BROLL_TONE_HZ = 200
PERSONA_TONE_HZ = 1000


def _ffmpeg(args: list[str]) -> None:
    result = subprocess.run(
        [vd.utils.get_ffmpeg_binary(), "-v", "error", "-y", *args],
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    if result.returncode != 0:
        raise AssertionError(f"ffmpeg failed: {result.stderr[-800:]}")


def _make_clips(workdir: Path) -> tuple[str, str]:
    """A b-roll clip with its own tone, and a persona clip with a different one."""
    background = workdir / "background.mp4"
    persona = workdir / "persona.mp4"

    # B-roll: 4s of colour bars plus a 200Hz tone. The tone is what makes the
    # audio-mapping bug detectable.
    _ffmpeg([
        "-f", "lavfi", "-i", f"testsrc=size={WIDTH}x{HEIGHT}:rate=30:duration={TOTAL_SECONDS}",
        "-f", "lavfi", "-i", f"sine=frequency={BROLL_TONE_HZ}:sample_rate=44100:duration={TOTAL_SECONDS}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(background),
    ])

    # Persona: portrait-ish input the compositor has to fit, plus a 1000Hz tone.
    _ffmpeg([
        "-f", "lavfi", "-i", f"color=c=blue:size=306x736:rate=30:duration={TOTAL_SECONDS}",
        "-f", "lavfi", "-i", f"sine=frequency={PERSONA_TONE_HZ}:sample_rate=44100:duration={TOTAL_SECONDS}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(persona),
    ])
    return str(background), str(persona)


def _dominant_tone_hz(video_path: str) -> tuple[float, float]:
    """Goertzel energy at the persona and b-roll tones. Returns (p, b)."""
    raw = subprocess.run(
        [vd.utils.get_ffmpeg_binary(), "-v", "error", "-i", video_path,
         "-t", str(HOOK_SECONDS), "-vn", "-ac", "1", "-ar", "8000",
         "-f", "s16le", "-"],
        capture_output=True,
        check=False,
        timeout=180,
    ).stdout
    samples = struct.unpack(f"<{len(raw) // 2}h", raw[: len(raw) // 2 * 2])

    def energy(freq: float) -> float:
        rate = 8000.0
        coeff = 2.0 * math.cos(2.0 * math.pi * freq / rate)
        s1 = s2 = 0.0
        for value in samples:
            s0 = value + coeff * s1 - s2
            s2, s1 = s1, s0
        return math.sqrt(max(s1 * s1 + s2 * s2 - coeff * s1 * s2, 0.0))

    return energy(PERSONA_TONE_HZ), energy(BROLL_TONE_HZ)


class ReactLayoutRenderTest(unittest.TestCase):
    """Renders both layouts with real ffmpeg over the same inputs."""

    def _render(self, layout: str, out: Path) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            background, persona = _make_clips(workdir)
            return vd.compose_lipsync_layout(
                background_video=background,
                lipsync_video=persona,
                output_file=str(out),
                duration=HOOK_SECONDS,
                layout=layout,
            )

    def test_react_output_keeps_frame_size_and_duration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "react.mp4"
            self._render("react", out)
            self.assertTrue(out.exists(), "react render produced no file")

            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)],
                capture_output=True, text=True, check=False, timeout=60,
            ).stdout.strip()
            self.assertEqual(probe, f"{WIDTH},{HEIGHT}")

            duration = vd.video_duration_seconds(str(out))
            # The hook is spliced in front of the b-roll, so the total is the
            # background length, not hook+background.
            self.assertAlmostEqual(duration, TOTAL_SECONDS, delta=0.5)

    def test_react_keeps_the_persona_voice(self) -> None:
        """The output must carry the persona's 1000Hz, not the b-roll's 200Hz."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "react.mp4"
            self._render("react", out)
            persona_energy, broll_energy = _dominant_tone_hz(str(out))
            self.assertGreater(
                persona_energy,
                broll_energy,
                f"audio came from the background ({broll_energy:.0f}) instead of "
                f"the persona ({persona_energy:.0f})",
            )

    def test_standard_layout_still_renders(self) -> None:
        """Regression: the new layout param must not break the default path."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "standard.mp4"
            self._render("standard", out)
            self.assertTrue(out.exists(), "standard render produced no file")


if __name__ == "__main__":
    unittest.main()