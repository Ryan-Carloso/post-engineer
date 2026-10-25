"""Tests for the LongCat-Video-Avatar 1.5 Modal client.

The clip arithmetic lives in the same module as the HTTP client on purpose: the
length a request asks for and the length the pipeline can actually render are
one contract, and splitting them across two modules is how they drift.
"""

import contextlib
import math
import os
import tempfile
import unittest
from pathlib import Path

from unittest.mock import MagicMock, patch

import requests

from app.models.schema import LipSyncQuality
from app.services import longcat
from app.services.longcat import LongCatUnavailableError

ENGINE_DIR = Path(__file__).resolve().parents[2]


def _response(status_code: int, content: bytes) -> requests.Response:
    response = requests.Response()
    response.status_code = status_code
    response._content = content
    return response


SUBMIT_OK = _response(200, b'{"job_id":"job-1"}')
STATUS_DONE = _response(200, b'{"status":"done"}')
DOWNLOAD_OK = _response(200, b"valid-mp4")

_LONGCAT_ENV = {
    "LONGCAT_SUBMIT_URL": "https://modal.test/submit",
    "LONGCAT_STATUS_URL": "https://modal.test/status",
    "LONGCAT_DOWNLOAD_URL": "https://modal.test/download",
    "LONGCAT_HTTP_SECRET": "test-secret",
}

_LONGCAT_CONFIG = {
    "poll_interval_seconds": 0,
    "timeout_seconds": 1,
    "intro_duration_seconds": 5,
}


@contextlib.contextmanager
def _stubs(trimmed_duration: float = 5.0):
    """Patch the ffmpeg/probe seams so the HTTP flow runs on tiny fake files.

    ``trim_audio`` writes the trimmed file so the client reads something real;
    ``audio_duration_seconds`` is the measured length of that trimmed audio and
    is therefore what drives the segment count sent to Modal.
    """
    with patch.object(longcat, "trim_audio") as trim:
        trim.side_effect = lambda source, target, *args, **kwargs: Path(
            target
        ).write_bytes(b"audio")
        with patch.object(
            longcat, "audio_duration_seconds", return_value=trimmed_duration
        ):
            with patch.dict(os.environ, _LONGCAT_ENV):
                with patch.object(longcat.config, "longcat", _LONGCAT_CONFIG):
                    yield


@contextlib.contextmanager
def _inputs(temp_dir: str, output_subpath: str = "intro.mp4"):
    image_path = Path(temp_dir) / "image.png"
    audio_path = Path(temp_dir) / "audio.mp3"
    output_path = Path(temp_dir) / output_subpath
    image_path.write_bytes(b"image")
    audio_path.write_bytes(b"audio")
    yield str(image_path), str(audio_path), str(output_path)


class TestClipArithmetic(unittest.TestCase):
    """Upstream fixes the frame budget; segment count is the only length knob."""

    def test_upstream_frame_budget_literals(self):
        # These three literals ARE the contract with upstream
        # run_demo_avatar_single_audio_to_video.py. If any of them ever stops
        # matching, every rendered length below is wrong.
        self.assertEqual(longcat.UPSTREAM_NUM_FRAMES, 93)
        self.assertEqual(longcat.UPSTREAM_NUM_COND_FRAMES, 13)
        self.assertEqual(longcat.AVATAR_V15_SAVE_FPS, 25)

    def test_clip_seconds_appends_eighty_frames_per_extra_segment(self):
        # First segment is 93 frames; each extra one appends 93 - 13 = 80.
        self.assertAlmostEqual(longcat.clip_seconds(1), 3.72)
        self.assertAlmostEqual(longcat.clip_seconds(2), 6.92)
        self.assertAlmostEqual(longcat.clip_seconds(3), 10.12)

    def test_segments_for_duration_rounds_up_to_cover_the_audio(self):
        # Rounding DOWN would under-render a narration: upstream only pads
        # audio that is shorter than the clip, never truncates it, so a short
        # clip desyncs the lip sync past the last frame.
        self.assertEqual(longcat.segments_for_duration(3.0), 1)
        self.assertEqual(longcat.segments_for_duration(3.72), 1)
        # 4s needs more than one segment's 3.72s.
        self.assertEqual(longcat.segments_for_duration(4.0), 2)
        self.assertEqual(longcat.segments_for_duration(7.5), 3)

    def test_segments_for_duration_never_renders_short_of_the_audio(self):
        for seconds in (0.5, 3.0, 3.8, 6.9, 7.5, 10.0, 12.0, 15.0):
            with self.subTest(seconds=seconds):
                segments = longcat.segments_for_duration(seconds)
                self.assertGreaterEqual(
                    longcat.clip_seconds(segments), seconds - 1e-9
                )

    def test_segments_for_duration_rejects_non_positive_or_non_finite(self):
        for bad in (0, -1.0, math.inf, math.nan):
            with self.subTest(bad=bad):
                with self.assertRaises(longcat.LongCatError):
                    longcat.segments_for_duration(bad)

    def test_clip_seconds_rejects_less_than_one_segment(self):
        with self.assertRaises(longcat.LongCatError):
            longcat.clip_seconds(0)

    def test_clip_seconds_rejects_more_than_the_ceiling(self):
        # The ceiling is what the Modal endpoint accepts; asking for more here
        # would fail after a paid submit instead of before it.
        with self.assertRaises(longcat.LongCatError):
            longcat.clip_seconds(longcat.MAX_SEGMENTS + 1)

    def test_duration_past_the_ceiling_is_rejected_before_a_paid_submit(self):
        # The message must name the offending duration: an operator reading the
        # log needs to know which hook was too long, not just that one was.
        with self.assertRaises(longcat.LongCatError) as raised:
            longcat.segments_for_duration(longcat.clip_seconds(longcat.MAX_SEGMENTS) + 5)
        self.assertIn("segment LongCat ceiling", str(raised.exception))

    def test_max_segments_covers_the_production_gpu_ceiling(self):
        # PERSONA_LIPSYNC_MAX_SECONDS is the hard hook ceiling in task.py. If
        # that ceiling ever grows past what MAX_SEGMENTS can render, the client
        # would silently ask for a clip shorter than the narration.
        from app.services import task

        self.assertGreaterEqual(
            longcat.clip_seconds(longcat.MAX_SEGMENTS),
            task.PERSONA_LIPSYNC_MAX_SECONDS,
        )


class TestResolutionMapping(unittest.TestCase):
    def test_quality_maps_to_the_benchmarked_resolutions(self):
        self.assertEqual(longcat.resolution_for_quality(LipSyncQuality.ok), "480p")
        self.assertEqual(
            longcat.resolution_for_quality(LipSyncQuality.very_good), "720p"
        )

    def test_unsupported_quality_fails_loudly(self):
        with self.assertRaises(longcat.LongCatError):
            longcat.resolution_for_quality("ultra")


class TestGenerateIntro(unittest.TestCase):
    def _run(self, responses, quality=LipSyncQuality.ok, trimmed_duration=5.0,
             output_subpath="intro.mp4"):
        """Drive generate_intro over canned responses.

        Returns (result, calls, output_path, output_bytes). The bytes are read
        inside the temp dir, which is gone by the time the caller inspects the
        path.
        """
        calls: list[dict[str, object]] = []
        queue = list(responses)

        def request(*args: object, **kwargs: object) -> requests.Response:
            calls.append(kwargs)
            return queue.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            with _inputs(temp_dir, output_subpath) as (image, audio, output):
                with _stubs(trimmed_duration):
                    result = longcat.generate_intro(
                        image, audio, quality, output, request=request
                    )
            written = Path(output).read_bytes() if Path(output).exists() else None
            return result, calls, output, written

    def test_generate_intro_polls_and_downloads_completed_job(self):
        result, calls, output_path, written = self._run(
            [SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK]
        )

        self.assertEqual(written, b"valid-mp4")
        self.assertEqual(result[0], output_path)
        # 5s of trimmed audio rounds up to 2 segments (6.92s rendered).
        self.assertEqual(
            calls[0]["data"], {"quality": "ok", "num_segments": "2"}
        )
        # Every request must carry the configured bearer secret.
        for call in calls:
            self.assertEqual(call["headers"], {"Authorization": "Bearer test-secret"})

    def test_trailing_padding_does_not_buy_an_extra_segment(self):
        # Segment granularity is 3.2s and the trim appends INTRO_PADDING_SECONDS
        # of silence, so a narration landing within that padding of a boundary
        # would be billed for a whole extra segment (~80 more frames of H200).
        # 6.75s of speech + 0.2s padding measures 6.95s: padding-derived rounds
        # up to 3 segments (10.12s clip), speech-derived stays at 2 (6.92s).
        _, calls, _, _ = self._run(
            [SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK], trimmed_duration=6.95
        )
        self.assertEqual(calls[0]["data"]["num_segments"], "2")

    def test_padding_is_never_subtracted_below_one_segment(self):
        # Audio shorter than the padding itself still has to render something;
        # the guard must not turn a valid measurement into a hard failure.
        _, calls, _, _ = self._run(
            [SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK], trimmed_duration=0.15
        )
        self.assertEqual(calls[0]["data"]["num_segments"], "1")

    def test_clip_still_covers_the_speech_when_padding_is_ignored(self):
        # The invariant that matters: whatever segment count is sent, the
        # rendered clip must be at least as long as the actual narration.
        for speech in (3.0, 3.6, 6.75, 6.9, 7.4, 10.0, 13.2, 15.9):
            with self.subTest(speech=speech):
                measured = speech + longcat.INTRO_PADDING_SECONDS
                _, calls, _, _ = self._run(
                    [SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK],
                    trimmed_duration=measured,
                )
                segments = int(calls[0]["data"]["num_segments"])
                self.assertGreaterEqual(
                    longcat.clip_seconds(segments), speech - 1e-9
                )

    def test_submit_posts_the_image_and_trimmed_audio(self):
        _, calls, _, _ = self._run([SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK])
        files = calls[0]["files"]
        self.assertEqual(sorted(files), ["audio", "image"])

    def test_generate_intro_creates_missing_output_parent_dir(self):
        # The task storage dir can vanish between utils.task_dir() creating it
        # and the Modal job finishing its (multi-minute) poll, e.g. a cleanup
        # between stage retries. The download must recreate it instead of
        # crashing with FileNotFoundError.
        _, _, output_path, written = self._run(
            [SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK],
            output_subpath="vanished-task-dir/intro.mp4",
        )
        self.assertEqual(written, b"valid-mp4")

    def test_generate_intro_requires_http_secret(self):
        # No bearer secret: fail fast on the env var, not on the config.
        with tempfile.TemporaryDirectory() as temp_dir:
            with _inputs(temp_dir) as (image, audio, output):
                with patch.object(longcat, "trim_audio"):
                    with patch.dict(os.environ, _LONGCAT_ENV):
                        os.environ.pop("LONGCAT_HTTP_SECRET", None)
                        with patch.object(longcat.config, "longcat", _LONGCAT_CONFIG):
                            with self.assertRaises(longcat.LongCatError):
                                longcat.generate_intro(
                                    image, audio, LipSyncQuality.ok, output
                                )

    def test_missing_url_env_var_fails_loudly(self):
        env = {k: v for k, v in _LONGCAT_ENV.items() if k != "LONGCAT_SUBMIT_URL"}
        with tempfile.TemporaryDirectory() as temp_dir:
            with _inputs(temp_dir) as (image, audio, output):
                with patch.object(longcat, "trim_audio"):
                    with patch.dict(os.environ, env):
                        # patch.dict only adds keys: an ambient value from the
                        # real .env would otherwise satisfy the lookup.
                        os.environ.pop("LONGCAT_SUBMIT_URL", None)
                        with patch.object(longcat.config, "longcat", _LONGCAT_CONFIG):
                            with self.assertRaises(longcat.LongCatError):
                                longcat.generate_intro(
                                    image, audio, LipSyncQuality.ok, output
                                )

    def test_submit_http_error_raises(self):
        with self.assertRaises(longcat.LongCatError):
            self._run([_response(500, b"boom")])

    def test_submit_without_job_id_raises(self):
        with self.assertRaises(longcat.LongCatError):
            self._run([_response(200, b'{"status":"queued"}')])

    def test_non_object_submit_payload_raises(self):
        with self.assertRaises(longcat.LongCatError):
            self._run([_response(200, b"[1, 2, 3]")])

    def test_failed_job_surfaces_the_reported_reason(self):
        status = _response(200, b'{"status":"failed","error":"cuda oom"}')
        with self.assertRaises(longcat.LongCatError) as raised:
            self._run([SUBMIT_OK, status])
        self.assertIn("cuda oom", str(raised.exception))

    def test_polls_until_done_rather_than_giving_up_after_one_call(self):
        queued = _response(200, b'{"status":"queued"}')
        _, calls, _, _ = self._run([SUBMIT_OK, queued, STATUS_DONE, DOWNLOAD_OK])
        # submit + one queued poll + one done poll + download.
        self.assertEqual(len(calls), 4)

    def test_job_that_never_completes_times_out(self):
        # The submit must succeed first: a stub that answers every call with a
        # queued STATUS body would fail on the missing job_id instead of ever
        # reaching the poll loop this test names.
        queued = _response(200, b'{"status":"queued"}')
        calls: list[int] = []

        def request(*args: object, **kwargs: object) -> requests.Response:
            calls.append(1)
            return SUBMIT_OK if len(calls) == 1 else queued

        with tempfile.TemporaryDirectory() as temp_dir:
            with _inputs(temp_dir) as (image, audio, output):
                with _stubs():
                    with patch.object(
                        longcat.config, "longcat", {**_LONGCAT_CONFIG, "timeout_seconds": 0}
                    ):
                        with self.assertRaises(longcat.LongCatError) as raised:
                            longcat.generate_intro(
                                image, audio, LipSyncQuality.ok, output,
                                request=request,
                            )
        self.assertIn("timed out", str(raised.exception))

    def test_empty_download_is_an_error(self):
        with self.assertRaises(longcat.LongCatError):
            self._run([SUBMIT_OK, STATUS_DONE, _response(200, b"")])

    def test_download_http_error_raises(self):
        with self.assertRaises(longcat.LongCatError):
            self._run([SUBMIT_OK, STATUS_DONE, _response(404, b"missing")])


class TestGenerateIntroCost(unittest.TestCase):
    """The Modal done payload carries the GPU cost (USD) for unit economics."""

    def _run_with_status(self, status_body: bytes):
        responses = [
            SUBMIT_OK,
            _response(200, status_body),
            DOWNLOAD_OK,
        ]
        queue = list(responses)

        with tempfile.TemporaryDirectory() as temp_dir:
            with _inputs(temp_dir) as (image, audio, output):
                with _stubs():
                    return longcat.generate_intro(
                        image, audio, LipSyncQuality.ok, output,
                        request=lambda *a, **k: queue.pop(0),
                    )

    def test_returns_cost_usd_from_done_payload(self):
        _, cost_usd, _ = self._run_with_status(b'{"status":"done","cost_usd":0.1234}')
        self.assertEqual(cost_usd, 0.1234)

    def test_returns_job_id(self):
        _, _, job_id = self._run_with_status(b'{"status":"done","cost_usd":0.1234}')
        self.assertEqual(job_id, "job-1")

    def test_returns_none_when_cost_absent(self):
        # Unknown, not zero: a missing cost must never read as "free".
        _, cost_usd, _ = self._run_with_status(b'{"status":"done"}')
        self.assertIsNone(cost_usd)

    def test_returns_none_for_non_numeric_cost(self):
        _, cost_usd, _ = self._run_with_status(b'{"status":"done","cost_usd":"free"}')
        self.assertIsNone(cost_usd)

    def test_returns_none_for_boolean_cost(self):
        # bool is an int subclass; True must not become $1.
        _, cost_usd, _ = self._run_with_status(b'{"status":"done","cost_usd":true}')
        self.assertIsNone(cost_usd)

    def test_returns_none_for_non_finite_cost(self):
        _, cost_usd, _ = self._run_with_status(b'{"status":"done","cost_usd":Infinity}')
        self.assertIsNone(cost_usd)


class TestGenerateIntroTracking(unittest.TestCase):
    """One ai_request per call: backend=modal, operation=generate_intro."""

    def _run(self, responses):
        queue = list(responses)

        def request(*args: object, **kwargs: object) -> requests.Response:
            return queue.pop(0)

        with tempfile.TemporaryDirectory() as temp_dir:
            with _inputs(temp_dir) as (image, audio, output):
                with _stubs():
                    return longcat.generate_intro(
                        image, audio, LipSyncQuality.ok, output, request=request
                    )

    def test_success_is_tracked_with_the_job_id(self):
        with patch.object(longcat, "track_ai_request") as track:
            self._run([SUBMIT_OK, STATUS_DONE, DOWNLOAD_OK])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertEqual(props["backend"], "modal")
        self.assertEqual(props["operation"], "generate_intro")
        self.assertEqual(props["job_id"], "job-1")
        self.assertTrue(props["success"])
        self.assertEqual(props["error"], "")
        self.assertGreaterEqual(props["duration_ms"], 0)

    def test_failure_is_tracked_and_still_raises(self):
        with patch.object(longcat, "track_ai_request") as track:
            with self.assertRaises(longcat.LongCatError):
                self._run([_response(500, b"boom")])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertFalse(props["success"])
        self.assertIn("500", props["error"])

    def test_failure_after_submit_still_reports_the_job_id(self):
        # Post-submit failures stay correlatable in PostHog.
        status = _response(200, b'{"status":"failed","error":"cuda oom"}')
        with patch.object(longcat, "track_ai_request") as track:
            with self.assertRaises(longcat.LongCatError):
                self._run([SUBMIT_OK, status])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertFalse(props["success"])
        self.assertEqual(props["job_id"], "job-1")

    def test_success_tracks_cost_usd_when_reported(self):
        # Cost visibility must not depend on the full pipeline finishing.
        status = _response(200, b'{"status":"done","cost_usd":0.07}')
        with patch.object(longcat, "track_ai_request") as track:
            self._run([SUBMIT_OK, status, DOWNLOAD_OK])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertTrue(props["success"])
        self.assertEqual(props["cost_usd"], 0.07)

    def test_success_omits_cost_usd_when_absent(self):
        status = _response(200, b'{"status":"done"}')
        with patch.object(longcat, "track_ai_request") as track:
            self._run([SUBMIT_OK, status, DOWNLOAD_OK])

        track.assert_called_once()
        props = track.call_args[0][0]
        self.assertTrue(props["success"])
        self.assertNotIn("cost_usd", props)


class ModalSourceMixin:
    """The deployed app is two modules; read both when pinning its literals.

    ``modal_longcat.py`` owns the HTTP surface and ``modal_longcat_gpu.py`` the
    image/weights/renderer. Which half a literal lives in is an implementation
    detail -- the contract these tests protect is "the deployed app says this",
    so they search both files rather than pinning a filename.
    """

    MODAL_MODULES = ("modal_longcat.py", "modal_longcat_gpu.py")

    def _modal_source(self, module: str | None = None) -> str:
        names = (module,) if module else self.MODAL_MODULES
        return "\n".join(
            (ENGINE_DIR / name).read_text() for name in names
        )


class TestGpuFallbackList(ModalSourceMixin, unittest.TestCase):
    """The renderer asks for a PREFERRED LIST, so capacity shortages can't stall a video."""

    def test_app_requests_a_list_not_a_single_card(self):
        # A bare gpu="H100" leaves the job queued indefinitely when that card
        # has no capacity; a list lets Modal fall back.
        source = self._modal_source()
        self.assertIn("gpu=GPU_PREFERENCE", source)
        self.assertNotIn("gpu=GPU,", source)

    def test_preference_list_leads_with_the_cheapest_proven_card(self):
        from modal_longcat_gpu import GPU_PREFERENCE

        # H100 measured ~1.5x cheaper per render than A100 despite A100's
        # 37% cheaper rate, so it must be preferred.
        self.assertEqual(GPU_PREFERENCE[0], "H100")

    def test_preference_only_lists_cards_the_model_fits_on(self):
        from modal_longcat_gpu import GPU_PREFERENCE, GPU_RATES

        for gpu in GPU_PREFERENCE:
            with self.subTest(gpu=gpu):
                self.assertIn(gpu, GPU_RATES)
                self.assertNotIn("L40S", gpu)

    def test_cost_is_priced_on_the_gpu_that_actually_ran(self):
        # With a fallback list the card is not known ahead of time, so pricing
        # on the first preference would mis-report every H200 fallback.
        source = self._modal_source()
        self.assertIn("active_gpu_name()", source)
        self.assertIn("rate_for_active_gpu", source)

    def test_fallback_ordering_is_only_effective_when_it_is_ordered(self):
        # Modal honours list order; an unsorted set would silently randomise
        # which card we pay for.
        from modal_longcat_gpu import GPU_PREFERENCE

        self.assertEqual(GPU_PREFERENCE, sorted(GPU_PREFERENCE, key=GPU_PREFERENCE.index))


class TestActiveGpuDetection(unittest.TestCase):
    """Map torch's device name back onto a priced card."""

    def _detect(self, reported):
        import modal_longcat_gpu as gpu_mod

        class _FakeCuda:
            @staticmethod
            def is_available():
                return True

            @staticmethod
            def get_device_name(_index):
                return reported

        class _FakeTorch:
            cuda = _FakeCuda

        with unittest.mock.patch.dict(
            "sys.modules", {"torch": _FakeTorch}
        ):
            return gpu_mod.active_gpu_name()

    def test_maps_common_device_names_back_to_priced_cards(self):
        for reported, expected in (
            ("NVIDIA H100 80GB HBM3", "H100"),
            ("NVIDIA H200", "H200"),
            ("NVIDIA A100-SXM4-80GB", "A100-80GB"),
        ):
            with self.subTest(reported=reported):
                self.assertEqual(self._detect(reported), expected)

    def test_unknown_device_name_is_reported_verbatim_not_guessed(self):
        # A card we have no rate for must surface as-is. "NVIDIA B200" contains
        # "200", so a naive substring test would price it as an H200.
        self.assertEqual(self._detect("NVIDIA B200"), "NVIDIA B200")

    def test_rate_falls_back_to_preference_when_detection_fails(self):
        import modal_longcat_gpu as gpu_mod

        class _NoCuda:
            @staticmethod
            def is_available():
                return False

        class _FakeTorch:
            cuda = _NoCuda

        with unittest.mock.patch.dict("sys.modules", {"torch": _FakeTorch}):
            self.assertEqual(
                gpu_mod.rate_for_active_gpu(), gpu_mod.GPU_RATES[gpu_mod.GPU_PREFERENCE[0]]
            )


class TestGpuRateSync(ModalSourceMixin, unittest.TestCase):
    """Pin the price the client reports against the price Modal actually bills.

    cost_usd is what makes unit economics visible at all; a rate that drifts
    from the deployed app silently mis-prices every persona video.
    """

    def test_h200_rate_literal_matches_the_rate_table(self):
        rate = longcat.GPU_RATES_USD_S["H200"]
        self.assertIn(f'"H200": {rate}', self._modal_source())

    def test_every_priced_gpu_is_accepted_by_the_app(self):
        # The app reads LONGCAT_GPU and rejects anything outside GPU_RATES, so
        # the client table and the app's table must name the same cards.
        source = self._modal_source()
        for gpu, rate in longcat.GPU_RATES_USD_S.items():
            with self.subTest(gpu=gpu):
                self.assertIn(f'"{gpu}": {rate}', source)

    def test_rate_table_covers_only_gpus_that_fit_the_weights(self):
        # 48GB (L40S) OOMs on this model; only >=80GB cards may be priced.
        for gpu in longcat.GPU_RATES_USD_S:
            with self.subTest(gpu=gpu):
                self.assertNotEqual(gpu, "L40S")
                self.assertNotIn("40GB", gpu)

    def test_production_rate_literal_is_pinned_not_trusted(self):
        # Guards the sync test above: if the module constant is renamed the
        # comparison must fail loudly rather than pass by omission.
        self.assertIn('"H200": 0.001261', self._modal_source())


class TestModalAppContractSync(ModalSourceMixin, unittest.TestCase):
    """Pin the literals the client and the deployed app each hold a copy of.

    The client and the Modal app are separate processes with separate copies of
    these constants, so nothing but a test stops one from being edited and the
    other silently keeping the old value. The failure mode is a 400 AFTER the
    audio was trimmed, or a resolution nobody asked for.
    """

    def test_segment_ceiling_matches_the_endpoint(self):
        self.assertIn(f"MAX_SEGMENTS = {longcat.MAX_SEGMENTS}", self._modal_source())

    def test_resolution_map_matches_the_endpoint_presets(self):
        # Compare resolved VALUES, not the literal spelling: the endpoint keys
        # off the enum value ("very-good") and the client off the enum member.
        expected = {
            quality.value: resolution
            for quality, resolution in longcat.QUALITY_RESOLUTIONS.items()
        }
        for quality_value, resolution in expected.items():
            with self.subTest(quality=quality_value):
                self.assertIn(f'"{quality_value}": "{resolution}"', self._modal_source())

    def test_every_client_quality_is_accepted_by_the_endpoint(self):
        source = self._modal_source()
        for quality in longcat.QUALITY_RESOLUTIONS:
            with self.subTest(quality=quality.value):
                self.assertIn(f'"{quality.value}":', source)

    def test_endpoint_upload_cap_matches_the_client_side_media_limit(self):
        # MAX_UPLOAD_BYTES mirrors the engine's persona media limit; the client
        # trims the audio to a few seconds, so the cap only guards the image.
        self.assertIn("MAX_UPLOAD_BYTES = 20 * 1024 * 1024", self._modal_source())


class TestTrimAudio(unittest.TestCase):
    def _capture_ffmpeg_args(self, **kwargs):
        captured: list[list[str]] = []

        class FakeCompleted:
            returncode = 0
            stdout = ""
            stderr = ""

        def fake_run(argv, **_kwargs):
            captured.append(list(argv))
            return FakeCompleted()

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = str(Path(temp_dir) / "audio.mp3")
            output_path = str(Path(temp_dir) / "trimmed.mp3")
            Path(audio_path).write_bytes(b"audio")
            with (
                patch.object(longcat.subprocess, "run", side_effect=fake_run),
                patch("os.path.isfile", return_value=True),
            ):
                longcat.trim_audio(audio_path, output_path, **kwargs)
        return captured[0]

    def test_trim_audio_passes_exactly_one_duration_flag(self):
        # Regression: a second "-t" silently overrides the first, so the
        # output length becomes duration + padding instead of the intended
        # duration (OpenCode review on a24e322).
        args = self._capture_ffmpeg_args(duration_seconds=5, padding_seconds=0.75)
        self.assertEqual(args.count("-t"), 1)
        self.assertEqual(args[args.index("-t") + 1], str(5 + 0.75))

    def test_trim_audio_seeks_before_input_for_start_offset(self):
        args = self._capture_ffmpeg_args(
            duration_seconds=2, padding_seconds=0.5, start_seconds=1.5
        )
        self.assertLess(args.index("-ss"), args.index("-i"))
        self.assertEqual(args[args.index("-ss") + 1], "1.5")
        self.assertEqual(args.count("-t"), 1)
        self.assertEqual(args[args.index("-t") + 1], str(2 + 0.5))

    def test_trim_audio_failure_surfaces_the_ffmpeg_stderr(self):
        class Failed:
            returncode = 1
            stdout = ""
            stderr = "codec not found"

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = str(Path(temp_dir) / "audio.mp3")
            output_path = str(Path(temp_dir) / "trimmed.mp3")
            Path(audio_path).write_bytes(b"audio")
            with patch.object(longcat.subprocess, "run", return_value=Failed()):
                with self.assertRaises(longcat.LongCatError) as raised:
                    longcat.trim_audio(audio_path, output_path, 5)
        self.assertIn("codec not found", str(raised.exception))


class TestAudioDuration(unittest.TestCase):
    def test_reads_the_duration_ffprobe_reports(self):
        class Completed:
            stdout = "7.5\n"
            stderr = ""

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = str(Path(temp_dir) / "audio.mp3")
            Path(audio_path).write_bytes(b"audio")
            with patch.object(longcat.subprocess, "run", return_value=Completed()):
                self.assertEqual(longcat.audio_duration_seconds(audio_path), 7.5)

    def test_rejects_an_unparsable_ffprobe_output(self):
        class Completed:
            stdout = "N/A"
            stderr = ""

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = str(Path(temp_dir) / "audio.mp3")
            Path(audio_path).write_bytes(b"audio")
            with patch.object(longcat.subprocess, "run", return_value=Completed()):
                with self.assertRaises(longcat.LongCatError):
                    longcat.audio_duration_seconds(audio_path)

    def test_rejects_a_non_positive_duration(self):
        class Completed:
            stdout = "0"
            stderr = ""

        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = str(Path(temp_dir) / "audio.mp3")
            Path(audio_path).write_bytes(b"audio")
            with patch.object(longcat.subprocess, "run", return_value=Completed()):
                with self.assertRaises(longcat.LongCatError):
                    longcat.audio_duration_seconds(audio_path)


class TestWorkspaceDisabledClassification(unittest.TestCase):
    """The 2026-10 outage: an HTTP 404 whose body is the Modal gateway's
    'workspace disabled' verdict (slot 0d88790d, run 39320019610). Classified
    as UNAVAILABLE — the fallback trigger — never as a generic failure."""

    def _response(self, status_code: int, body: str) -> MagicMock:
        response = MagicMock()
        response.status_code = status_code
        response.text = body
        return response

    def test_modal_workspace_disabled_raises_unavailable(self):
        with self.assertRaises(LongCatUnavailableError) as ctx:
            longcat._raise_for_status(
                self._response(404, "modal-http: workspace ac-H0vJnhfnXhxZw0VlvCne9f is disabled\n"),
                "submit",
            )
        self.assertIn("workspace", str(ctx.exception))
        self.assertIn("is disabled", str(ctx.exception))
        # The upstream verdict is pinned for the fallback's log (production
        # evidence, format confirmed — never guessed).
        self.assertIn("modal-http:", str(ctx.exception))

    def test_generic_404_body_stays_a_plain_failure(self):

        with self.assertRaises(longcat.LongCatError) as ctx:
            longcat._raise_for_status(self._response(404, "job not found"), "status")
        self.assertNotIsInstance(ctx.exception, LongCatUnavailableError)
        self.assertNotIn("modal-http", str(ctx.exception))

    def test_disabled_body_is_not_enough_without_the_gateway_marker(self):

        with self.assertRaises(longcat.LongCatError) as ctx:
            longcat._raise_for_status(
                self._response(404, "workspace disabled for maintenance"), "submit"
            )
        self.assertNotIsInstance(ctx.exception, LongCatUnavailableError)

    def test_disabled_body_on_a_non_404_stays_a_plain_failure(self):
        with self.assertRaises(longcat.LongCatError) as ctx:
            longcat._raise_for_status(
                self._response(500, "modal-http: workspace ac-X is disabled\n"),
                "submit",
            )
        self.assertNotIsInstance(ctx.exception, LongCatUnavailableError)

    def test_unavailable_message_scrubs_credential_fragments(self):
        with self.assertRaises(LongCatUnavailableError) as ctx:
            longcat._raise_for_status(
                self._response(
                    404,
                    "modal-http: workspace ac-X is disabled https://user:pw@modal.com/x\n",
                ),
                "submit",
            )
        self.assertNotIn("user:pw", str(ctx.exception))
        self.assertNotIn("user:pw", getattr(ctx.exception, "response_body", ""))


if __name__ == "__main__":
    unittest.main()