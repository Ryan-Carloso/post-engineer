"""Unit tests for the persona lip-sync layout split (video_layout).

These assert the ffmpeg argv the compositor builds, not that ffmpeg succeeds:
the filter graph is the contract, and argv assertions are what pin it. A real
render is covered separately in test_video_lipsync_splice.py's style, which
needs committed fixtures.

The bug this guards hardest is the audio map. A Pexels background clip HAS its
own audio track, so `-map 0:a?` silently produces a video where the persona
speaks over stock footage audio. The prototype hit exactly that.
"""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VideoParams
from app.services import video as vd


class FakeClip:
    """Stand-in for the probe result of _open_video_clip_quietly."""

    def __init__(self, w: int, h: int) -> None:
        self.w = w
        self.h = h

    def close(self) -> None:
        pass


class LayoutCommandTest(unittest.TestCase):
    """Captures every ffmpeg invocation a layout produces."""

    def setUp(self) -> None:
        self.commands: list[list[str]] = []
        self._real_run = vd._run_ffmpeg_bounded
        self._real_open = vd._open_video_clip_quietly
        self._real_exists = os.path.exists

        def fake_run(command, timeout=None, failure_message="", **_kwargs):
            self.commands.append(list(command))
            return None

        vd._run_ffmpeg_bounded = fake_run
        vd._open_video_clip_quietly = lambda path: FakeClip(1080, 1920)
        # The concat tail is written by ffmpeg in the real flow; here it never
        # appears, so pretend it does or the cleanup path raises.
        os.path.exists = lambda path: True

    def tearDown(self) -> None:
        vd._run_ffmpeg_bounded = self._real_run
        vd._open_video_clip_quietly = self._real_open
        os.path.exists = self._real_exists

    def _graph(self) -> str:
        """The single filter_complex string of the react render."""
        for command in self.commands:
            for index, token in enumerate(command):
                if token == "-filter_complex":
                    return command[index + 1]
        raise AssertionError(f"no filter_complex in {self.commands}")

    def _map_specs(self) -> list[str]:
        maps: list[str] = []
        for command in self.commands:
            for index, token in enumerate(command):
                if token == "-map" and index + 1 < len(command):
                    maps.append(command[index + 1])
        return maps

    # ------------------------------------------------------------------
    # react layout
    # ------------------------------------------------------------------

    def test_react_vstacks_avatar_over_broll(self) -> None:
        vd.compose_lipsync_layout(
            background_video="bg.mp4",
            lipsync_video="face.mp4",
            output_file="out.mp4",
            duration=5.0,
            layout="react",
        )
        graph = self._graph()
        self.assertIn("vstack=inputs=2", graph)
        # The persona block scales by WIDTH and is cropped from the top, which
        # keeps head and shoulders and drops the torso.
        self.assertIn(f"scale={1080}:-2", graph)
        self.assertIn("crop=1080:960", graph)

    def test_react_splits_frame_in_exactly_halves(self) -> None:
        vd.compose_lipsync_layout(
            background_video="bg.mp4",
            lipsync_video="face.mp4",
            output_file="out.mp4",
            duration=5.0,
            layout="react",
        )
        graph = self._graph()
        # Half of 1920 is 960. Pinning the literal guards an off-by-one that
        # would make vstack produce 1919 pixels and the tail shift by a frame.
        self.assertIn("crop=1080:960", graph)
        self.assertEqual(graph.count("crop=1080:960"), 2)

    def test_react_draws_a_divider_on_the_seam(self) -> None:
        vd.compose_lipsync_layout(
            background_video="bg.mp4",
            lipsync_video="face.mp4",
            output_file="out.mp4",
            duration=5.0,
            layout="react",
        )
        graph = self._graph()
        self.assertIn("drawbox", graph)
        self.assertIn("y=958", graph)

    def test_react_maps_audio_from_the_lipsync_input(self) -> None:
        """Input 1 is the avatar. Input 0 is the Pexels clip, which has sound.

        Mapping 0:a? produces a video where the narration is drowned by the
        stock footage's own audio. This is the assertion that keeps that from
        coming back.
        """
        vd.compose_lipsync_layout(
            background_video="bg.mp4",
            lipsync_video="face.mp4",
            output_file="out.mp4",
            duration=5.0,
            layout="react",
        )
        maps = self._map_specs()
        self.assertIn("1:a", maps)
        self.assertNotIn("0:a?", maps)
        self.assertNotIn("0:a", maps)

    # ------------------------------------------------------------------
    # standard layout (default) is untouched
    # ------------------------------------------------------------------

    def test_standard_layout_does_not_stack(self) -> None:
        vd.compose_lipsync_layout(
            background_video="bg.mp4",
            lipsync_video="face.mp4",
            output_file="out.mp4",
            duration=5.0,
            layout="standard",
        )
        for command in self.commands:
            joined = " ".join(command)
            self.assertNotIn("vstack", joined)

    def test_standard_layout_keeps_the_splice_tail(self) -> None:
        """standard still splices: intro replaces the head of the b-roll."""
        vd.compose_lipsync_layout(
            background_video="bg.mp4",
            lipsync_video="face.mp4",
            output_file="out.mp4",
            duration=5.0,
            layout="standard",
        )
        joined = " ".join(" ".join(c) for c in self.commands)
        self.assertIn("concat", joined)
        self.assertIn("-ss", joined)

    # ------------------------------------------------------------------
    # unknown layout fails loud
    # ------------------------------------------------------------------

    def test_unknown_layout_raises_instead_of_silently_standard(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            vd.compose_lipsync_layout(
                background_video="bg.mp4",
                lipsync_video="face.mp4",
                output_file="out.mp4",
                duration=5.0,
                layout="cinematic",
            )
        self.assertIn("cinematic", str(ctx.exception))
        self.assertEqual(self.commands, [])


class VideoParamsLayoutTest(unittest.TestCase):
    """The field itself: default, and the NULL-means-standard contract."""

    def test_default_layout_is_standard(self) -> None:
        params = VideoParams(video_subject="coins")
        self.assertEqual(params.video_layout, "standard")

    def test_layout_rejects_unknown_value(self) -> None:
        with self.assertRaises(ValueError):
            VideoParams(video_subject="coins", video_layout="cinematic")

    def test_layout_accepts_both_documented_values(self) -> None:
        for value in ("standard", "react"):
            self.assertEqual(
                VideoParams(video_subject="coins", video_layout=value).video_layout,
                value,
            )


if __name__ == "__main__":
    unittest.main()