"""Tests for the image-build vocal-separation patch.

The patch runs inside the Modal image build, not at request time, so nothing in
the normal test suite would notice it silently breaking. These tests exercise
it against a local copy of the upstream script and pin the two properties that
matter: the separator is genuinely NOT invoked, and the result still parses.
"""

import ast
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch as mock_patch

from app.utils import longcat_vocal_patch

# The upstream call site this patch targets, copied from
# run_demo_avatar_single_audio_to_video.py at the revision the image clones.
# Wrapped in a function so the snippet is a valid module on its own: the real
# call site is nested under `if cp_rank == 0:`, and the test asserts the patch
# preserves that indentation. Parsing the snippet is therefore part of the test.
UPSTREAM_CALL_SITE = (
    "def run(raw_speech_path, vocal_separator, audio_output_dir_temp):\n"
    "    if cp_rank == 0:\n"
    "        # extract vocal\n"
    "        temp_vocal_path = extract_vocal_from_speech(raw_speech_path,"
    " f\"/tmp/vocal.wav\", vocal_separator, audio_output_dir_temp)\n"
    "        assert temp_vocal_path is not None\n"
    "        speech_array, sr = librosa.load(temp_vocal_path, sr=16000)\n"
    "        return speech_array\n"
    "\n"
    "\n"
    'if __name__ == "__main__":\n'
    "    run(None, None, None)\n"
)


class TestVocalSeparationPatch(unittest.TestCase):
    def _patch(self, source: str) -> str:
        """Run the patch against a temp copy and return the patched source."""
        with tempfile.TemporaryDirectory() as work:
            target = Path(work) / "run_demo_avatar_single_audio_to_video.py"
            target.write_text(source)
            with mock_patch.dict("os.environ", {"LONGCAT_PATCH_TARGET": str(target)}):
                self.assertEqual(longcat_vocal_patch.main(), 0)
            return target.read_text()

    def test_separator_call_is_removed_not_merely_renamed(self):
        # The patch must REPLACE the separator call. A mere rename to an unused
        # variable would still run the separator while looking like it skipped.
        patched = self._patch(UPSTREAM_CALL_SITE)
        self.assertNotIn("= extract_vocal_from_speech(", patched)
        self.assertIn("= _lc_direct_vocal(", patched)

    def test_helper_is_defined_in_the_patched_script(self):
        patched = self._patch(UPSTREAM_CALL_SITE)
        self.assertIn("def _lc_direct_vocal(", patched)

    def test_helper_reproduces_the_separator_output_format(self):
        # The separator produced a 16 kHz mono WAV. Handing the pipeline the
        # raw MP3 instead killed the child process silently (no traceback), so
        # the decode parameters are part of the contract, not a detail.
        patched = self._patch(UPSTREAM_CALL_SITE)
        self.assertIn('"-ac", "1"', patched)
        self.assertIn('"-ar", "16000"', patched)

    def test_marker_does_not_swallow_the_next_source_line(self):
        # The marker is appended to the call line. If it lands AFTER the
        # trailing newline it becomes the prefix of the FOLLOWING line, and
        # the comment swallows that statement -- which is how the upstream
        # `assert temp_vocal_path is not None` silently disappeared. A
        # comment-only edit still parses, so `test_patched_script_still_parses`
        # cannot catch this; assert on the surviving text instead.
        patched = self._patch(UPSTREAM_CALL_SITE)
        self.assertIn(
            "\n        assert temp_vocal_path is not None\n", patched
        )
        self.assertNotIn(
            f"# {longcat_vocal_patch.MARKER}        assert", patched
        )

    def test_marker_stays_on_the_call_line_it_documents(self):
        patched = self._patch(UPSTREAM_CALL_SITE)
        marker_line = next(
            line
            for line in patched.splitlines()
            if longcat_vocal_patch.MARKER in line
        )
        self.assertIn("_lc_direct_vocal(", marker_line)
        self.assertEqual(marker_line.count("#"), 1)

    def test_upstream_arguments_are_preserved_verbatim(self):
        # Only the function name changes; the generated temp path argument must
        # survive so the later os.remove still targets a real file.
        patched = self._patch(UPSTREAM_CALL_SITE)
        self.assertIn('f"/tmp/vocal.wav"', patched)
        self.assertIn("vocal_separator, audio_output_dir_temp)", patched)

    def test_patched_script_still_parses(self):
        # An indentation slip here breaks the whole image build.
        patched = self._patch(UPSTREAM_CALL_SITE)
        ast.parse(patched)

    def test_indentation_is_preserved(self):
        # The call site sits inside an `if cp_rank == 0:` block nested in a
        # function; an indentation slip breaks the whole image build.
        patched = self._patch(UPSTREAM_CALL_SITE)
        self.assertIn("\n        temp_vocal_path = _lc_direct_vocal(", patched)

    def test_patch_is_idempotent(self):
        once = self._patch(UPSTREAM_CALL_SITE)
        twice = self._patch(once)
        self.assertEqual(once, twice)

    def test_missing_call_site_fails_loudly(self):
        # A silent no-op would leave separation enabled while the build log
        # claims otherwise, so an upstream rename must break the build.
        with tempfile.TemporaryDirectory() as work:
            target = Path(work) / "run_demo_avatar_single_audio_to_video.py"
            target.write_text("x = 1\n")
            with mock_patch.dict("os.environ", {"LONGCAT_PATCH_TARGET": str(target)}):
                self.assertEqual(longcat_vocal_patch.main(), 1)

    def test_ambiguous_multiple_call_sites_fails_loudly(self):
        doubled = UPSTREAM_CALL_SITE + UPSTREAM_CALL_SITE
        with tempfile.TemporaryDirectory() as work:
            target = Path(work) / "run_demo_avatar_single_audio_to_video.py"
            target.write_text(doubled)
            with mock_patch.dict("os.environ", {"LONGCAT_PATCH_TARGET": str(target)}):
                self.assertEqual(longcat_vocal_patch.main(), 1)

    def test_missing_target_file_fails_loudly(self):
        with tempfile.TemporaryDirectory() as work:
            missing = Path(work) / "nope.py"
            with mock_patch.dict("os.environ", {"LONGCAT_PATCH_TARGET": str(missing)}):
                self.assertEqual(longcat_vocal_patch.main(), 1)


class TestGpuCostAccounting(unittest.TestCase):
    """cost_usd must be the marginal cost of THIS clip, not container uptime.

    The GPU class holds the model for the container's whole life
    (``max_containers=1``, ``scaledown_window=60``), so a cost measured from
    module import accumulates: the second clip in a warm container is billed for
    the first clip's runtime plus the idle hold between them. That number feeds
    PostHog unit economics via ``intro_cost_usd``, so it has to be per-clip.
    """

    def _handler_source(self) -> str:
        engine_dir = Path(__file__).resolve().parents[2]
        tree = ast.parse((engine_dir / "modal_longcat.py").read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.FunctionDef)
                and node.name == "generate_bytes"
            ):
                return ast.get_source_segment(
                    (engine_dir / "modal_longcat.py").read_text(), node
                ) or ""
        self.fail("generate_bytes not found in modal_longcat.py")

    def _names_in_cost_fields(self, source: str) -> tuple[set[str], set[str]]:
        """Names feeding ``cost_usd`` and ``container_cost_usd`` respectively.

        Both are keys of the status payload dict passed to ``_write_job_status``,
        so this reads dict keys (not call keywords) and collects every ``Name``
        in the value expression.
        """
        tree = ast.parse(textwrap.dedent(source))
        found: dict[str, set[str]] = {}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            for key, value in zip(node.keys, node.values):
                if (
                    isinstance(key, ast.Constant)
                    and key.value in ("cost_usd", "container_cost_usd")
                ):
                    found[key.value] = {
                        child.id
                        for child in ast.walk(value)
                        if isinstance(child, ast.Name)
                    }
        return found.get("cost_usd", set()), found.get(
            "container_cost_usd", set()
        )

    def test_cost_usd_is_derived_from_the_per_job_span(self):
        # Mutation guard: reverting cost_usd to the container-uptime span
        # (_CONTAINER_START) makes cost_usd reference the container clock
        # instead of the handler clock, and this fails.
        cost_names, _ = self._names_in_cost_fields(self._handler_source())
        self.assertTrue(cost_names, "no cost_usd keyword found in generate_bytes")
        self.assertNotIn(
            "_CONTAINER_START",
            cost_names,
            "cost_usd must not be billed from container start: it accumulates "
            "across every clip the warm container serves",
        )
        self.assertIn(
            "job_gpu_s",
            cost_names,
            "cost_usd must be computed from the per-clip span",
        )

    def test_container_amortised_spend_is_still_reported(self):
        # The cold-start weight load and idle hold are real money; dropping the
        # container view entirely would hide them. It is reported under its own
        # key so the two numbers are never confused.
        _, container_names = self._names_in_cost_fields(self._handler_source())
        self.assertTrue(
            container_names,
            "container_cost_usd disappeared: the amortised spend (cold start, "
            "idle hold) is no longer observable",
        )
        self.assertIn("uptime_s", container_names)
        self.assertNotIn(
            "job_gpu_s",
            container_names,
            "container_cost_usd must use the container clock, not the per-clip one",
        )

    def test_per_job_and_container_spans_are_distinct_measurements(self):
        source = self._handler_source()
        self.assertIn("handler_started = time.monotonic()", source)
        self.assertIn("time.monotonic() - handler_started", source)
        self.assertIn("time.monotonic() - _CONTAINER_START", source)


class TestImageWiring(unittest.TestCase):
    """The patch must be applied in the image, not merely present on disk."""

    # The deployed app is two modules (HTTP surface + GPU/renderer); the image
    # build lives in the GPU half, but search both so a future move of the
    # image definition does not silently un-pin the wiring.
    MODAL_MODULES = ("modal_longcat.py", "modal_longcat_gpu.py")

    def _modal_source(self) -> str:
        engine_dir = Path(__file__).resolve().parents[2]
        return "\n".join(
            (engine_dir / name).read_text() for name in self.MODAL_MODULES
        )

    def test_modal_image_applies_the_patch(self):
        # The patch ships in the image and the apply step must be present,
        # uncommented, in the image definition.
        source = self._modal_source()
        self.assertIn("longcat_vocal_patch.py", source)
        apply_lines = [
            line.strip()
            for line in source.splitlines()
            if "longcat_vocal_patch.py" in line and line.strip().startswith(".run_commands")
        ]
        self.assertTrue(
            apply_lines,
            "the image no longer runs longcat_vocal_patch.py; the vocal-separation "
            "saving is silently disabled",
        )

    def test_scaledown_window_matches_the_production_app(self):
        # 300s of idle H200 hold costs ~$0.38 per invocation against ~$0.08 at
        # 60s, so the production app must stay at 60s.
        source = self._modal_source()
        self.assertIn("scaledown_window=60", source)
        self.assertNotIn("scaledown_window=300", source)

    def test_gpu_module_stays_under_the_file_size_cap(self):
        # modal_longcat.py was split to satisfy the 500-line file-size ratchet.
        # A future edit that grows the GPU half back over the cap fails CI, so
        # the split cannot quietly undo itself.
        engine_dir = Path(__file__).resolve().parents[2]
        for name in self.MODAL_MODULES:
            with self.subTest(module=name):
                lines = (engine_dir / name).read_text().splitlines()
                self.assertLessEqual(
                    len(lines),
                    500,
                    f"{name} grew past the 500-line cap the split was for",
                )

    def test_modal_entry_module_keeps_every_decorated_function(self):
        # `modal deploy modal_longcat.py` and
        # `modal run modal_longcat.py::download_weights` resolve against THIS
        # module, so no @app.function / @app.cls may live only in the GPU half.
        engine_dir = Path(__file__).resolve().parents[2]
        gpu_source = (engine_dir / "modal_longcat_gpu.py").read_text()
        for decorator in ("@app.function", "@app.cls", "@modal.fastapi_endpoint"):
            self.assertNotIn(
                decorator,
                gpu_source,
                f"{decorator} in modal_longcat_gpu.py would not be picked up by "
                "`modal deploy modal_longcat.py`",
            )


if __name__ == "__main__":
    unittest.main()