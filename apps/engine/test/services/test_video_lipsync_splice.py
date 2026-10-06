import unittest
import os
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from app.services import video as vd

resources_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "resources")


def _probe_duration(path: str) -> float:
    """Read a file's duration with ffprobe, or -1.0 when it is unreadable."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=nw=1:nk=1", path,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
        return float((result.stdout or "").strip())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return -1.0


def _make_yuv420p(source: str, target: str, width: int = 580, height: int = 752) -> bool:
    """
    Re-encode a committed fixture into a libx264-compatible shape.

    Two fixture limitations force this, and neither is the splice's fault:
      * the checked-in fixtures are yuv444p, which libx264 cannot ingest
        with `-pix_fmt yuv420p` on the CI ffmpeg build; and
      * they are 580x751 — an ODD height, which libx264 rejects outright
        ("height not divisible by 2").

    Real pipeline output is always even-dimensioned 420p (combine_videos
    scales and forces yuv420p), so the test derives its inputs the same way.
    """
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", source,
            "-vf", f"scale={width}:{height}",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", target,
        ],
        capture_output=True,
        check=False,
        timeout=120,
    )
    return result.returncode == 0 and os.path.exists(target)


@unittest.skipIf(shutil.which("ffmpeg") is None, "ffmpeg not available")
@unittest.skipIf(shutil.which("ffprobe") is None, "ffprobe not available")
class TestLipSyncSpliceRealFfmpeg(unittest.TestCase):
    """
    The stream-copy splice replaces a real ffmpeg filter_complex concat.

    Two failure modes are invisible to a command-shape unit test:
      1. a wrong output duration (a desync shows up as drift over the video,
         not as an error), and
      2. an output that never actually took the intro from the lip-sync
         source.

    So these tests run the REAL ffmpeg and assert on the produced file.
    """

    def setUp(self):
        raw_background = os.path.join(resources_dir, "1.png.mp4")
        raw_lipsync = os.path.join(resources_dir, "2.png.mp4")
        for path in (raw_background, raw_lipsync):
            if not os.path.exists(path):
                self.skipTest(f"fixture missing: {path}")
        self.tmpdir = tempfile.mkdtemp(prefix="lipsync-splice-")
        self.background = os.path.join(self.tmpdir, "background.mp4")
        self.lipsync = os.path.join(self.tmpdir, "lipsync.mp4")
        if not _make_yuv420p(raw_background, self.background) or not _make_yuv420p(
            raw_lipsync, self.lipsync
        ):
            self.skipTest("could not derive yuv420p fixtures with this ffmpeg build")
        self.background_duration = _probe_duration(self.background)
        if self.background_duration <= 0:
            self.skipTest("derived background fixture is unreadable")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_splice_produces_a_playable_file_of_the_expected_length(self):
        """
        3s background, 1s intro -> ~3s output (1s intro + 2s tail).

        The old filter_graph re-encoded everything and produced the same
        length, so duration alone cannot prove the copy path is correct —
        it proves the copy path did not LOSE or DUPLICATE frames, which is
        exactly the regression a `-c copy` splice can introduce.
        """
        output = os.path.join(self.tmpdir, "out.mp4")
        intro_seconds = 1.0

        vd.replace_video_intro_with_lipsync(
            background_video=self.background,
            lipsync_video=self.lipsync,
            output_file=output,
            duration=intro_seconds,
        )

        self.assertTrue(os.path.exists(output), "splice produced no output file")
        produced = _probe_duration(output)
        self.assertGreater(produced, 0, f"output is unreadable by ffprobe: {output}")
        expected = self.background_duration
        self.assertAlmostEqual(
            produced,
            expected,
            delta=0.5,
            msg=f"spliced duration {produced}s drifted from the {expected}s background",
        )

    def test_splice_actually_swaps_the_intro_segment(self):
        """
        A copy that silently kept the background's first second would also
        pass the duration check above. Decode the output's first frame and
        prove it came from the lip-sync source and NOT from the background.

        The comparison is against a RE-ENCODE of the lip-sync fixture, not
        the raw fixture: the splice re-encodes the intro (it has to — the
        source may differ in size/format), so the output frame is a lossy
        descendant of it. Re-encoding the fixture the same way and comparing
        those makes the assertion about provenance rather than about codec
        noise; the raw fixture never matches byte-for-byte.
        """
        output = os.path.join(self.tmpdir, "swapped.mp4")
        intro_seconds = 1.0

        vd.replace_video_intro_with_lipsync(
            background_video=self.background,
            lipsync_video=self.lipsync,
            output_file=output,
            duration=intro_seconds,
        )

        def first_frame_signature(path: str) -> bytes:
            result = subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-i", path,
                    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
                ],
                capture_output=True,
                check=False,
                timeout=60,
            )
            return result.stdout or b""

        # Reference: the lip-sync fixture re-encoded exactly as the splice
        # encodes its intro (same size, same codec, same preset).
        reference = os.path.join(self.tmpdir, "intro-reference.mp4")
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-i", self.lipsync,
                "-t", str(intro_seconds),
                "-vf", "scale=580:752:force_original_aspect_ratio=decrease,"
                       "pad=580:752:(ow-iw)/2:(oh-ih)/2,setsar=1",
                "-an", "-c:v", "libx264", "-preset", vd._get_configured_video_preset(),
                "-pix_fmt", "yuv420p", reference,
            ],
            capture_output=True,
            check=False,
            timeout=120,
        )

        out_frame = first_frame_signature(output)
        self.assertTrue(out_frame, "could not decode the spliced output's first frame")
        self.assertNotEqual(
            out_frame,
            first_frame_signature(self.background),
            "output still starts with the background frame: the intro was not spliced",
        )
        self.assertEqual(
            out_frame,
            first_frame_signature(reference),
            "output's first frame is not the lip-sync frame: the intro segment is wrong",
        )

    def test_splice_leaves_no_intermediate_files(self):
        """
        The splice writes two intermediates. A crash between steps would
        otherwise leave them in the task dir forever, on a volume that is
        never swept.
        """
        output = os.path.join(self.tmpdir, "clean.mp4")
        vd.replace_video_intro_with_lipsync(
            background_video=self.background,
            lipsync_video=self.lipsync,
            output_file=output,
            duration=1.0,
        )
        leftovers = [
            name
            for name in os.listdir(self.tmpdir)
            if name.endswith(("-intro-encoded.mp4", "-tail.mp4", "-concat.txt"))
        ]
        self.assertEqual(leftovers, [], f"splice left intermediates behind: {leftovers}")