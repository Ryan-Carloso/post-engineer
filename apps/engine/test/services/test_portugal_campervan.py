"""
End-to-end flow test for the Portugal campervan theme.

Runs the FULL MoneyPrinterTurbo pipeline in-process (no HTTP server, no Docker):
    subject → z.ai GLM-5.2 script → search terms → Pexels footage download
            → edge-tts narration → subtitles → moviepy/ffmpeg render → final .mp4

Gated behind MPT_RUN_INTEGRATION_TESTS=1 because it calls real providers
(z.ai, Pexels, edge-tts) and takes several minutes. Run with:

    MPT_RUN_INTEGRATION_TESTS=1 uv run python -m unittest \
        test.services.test_portugal_campervan -v

The finished video is copied to storage/portugal_campervan.mp4 for easy viewing.
"""
import os
import shutil
import sys
import unittest
from pathlib import Path

# add project root to python path (matches the other test files)
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VideoParams
from app.services import task as tm
from app.utils import utils

RUN_INTEGRATION_TESTS = os.environ.get("MPT_RUN_INTEGRATION_TESTS", "").lower() in {
    "1",
    "true",
    "yes",
}

# ────────────────────────────────────────────────────────────────────────── #
# Configurable test parameters — edit these to retarget the test.
# ────────────────────────────────────────────────────────────────────────── #
SUBJECT = "Viagem de Portugal com campervan"
LANGUAGE = "pt-BR"                     # script + narration language
VOICE = "pt-BR-FranciscaNeural"        # Brazilian female voice.
ASPECT = "9:16"             
OUTPUT_COPY_NAME = "portugal_campervan_2.mp4"
# NOTE: this test must NOT override video-generation logic (script prompt,
# subtitle styling, etc.). Those live as production defaults in config.toml
# and app/models/schema.py. The test only sets subject/language/voice/aspect.

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STORAGE_DIR = PROJECT_ROOT / "storage"


class TestPortugalCampervanE2E(unittest.TestCase):
    """Full-pipeline integration test for the Portugal campervan subject."""

    @unittest.skipUnless(
        RUN_INTEGRATION_TESTS, "set MPT_RUN_INTEGRATION_TESTS=1 to run"
    )
    def test_generate_portugal_campervan_video(self):
        # storage/ is auto-created by the task service, but ensure it exists
        # before we copy the friendly-named output there.
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)

        task_id = utils.get_uuid()
        print(f"\n[task_id] {task_id}")
        print(f"[subject] {SUBJECT}  (lang={LANGUAGE}, voice={VOICE})")

        params = VideoParams(
            video_subject=SUBJECT,
            video_script="",                 # let GLM-5.2 generate the script
            video_language=LANGUAGE,
            video_aspect=ASPECT,
            voice_name=VOICE,
            voice_volume=1.0,
            voice_rate=1.0,
            bgm_volume=0.2,
            subtitle_enabled=True,
            n_threads=2,
            paragraph_number=1,
            # subtitle styling deliberately omitted → uses config.toml [ui] defaults
        )

        # ── Run the whole pipeline in-process ──
        result = tm.start(task_id=task_id, params=params)

        # ── Assert the pipeline returned a non-empty result ──
        self.assertIsNotNone(result, "tm.start returned None — pipeline failed")
        print(f"[result]  {result}")

        # ── Locate the rendered final-*.mp4 under the task directory ──
        task_dir = STORAGE_DIR / "tasks" / task_id
        final_videos = sorted(task_dir.glob("final-*.mp4"))
        self.assertGreater(
            len(final_videos),
            0,
            f"no final-*.mp4 found in {task_dir} — render did not complete",
        )

        primary_video = final_videos[0]
        size_bytes = primary_video.stat().st_size
        size_mb = size_bytes / (1024 * 1024)
        # A real rendered vertical short is at least a few hundred KB.
        self.assertGreater(
            size_bytes,
            100_000,
            f"rendered video is only {size_mb:.2f} MB — render likely failed",
        )
        print(f"[video]   {primary_video}  ({size_mb:.2f} MB)")

        # ── Copy to a stable, friendly filename so it's easy to open ──
        friendly = STORAGE_DIR / OUTPUT_COPY_NAME
        shutil.copy2(primary_video, friendly)
        print(f"[copy]    {friendly}")
        print(f'\nDONE → open the video:\n  open "{friendly}"')


if __name__ == "__main__":
    unittest.main()
