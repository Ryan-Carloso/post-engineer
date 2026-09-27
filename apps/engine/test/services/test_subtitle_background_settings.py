import json
import shutil
import subprocess
from pathlib import Path
import unittest

import numpy as np

from app.models.schema import VideoParams
from app.services import video


def _find_system_cjk_font():
    """Return a CJK-capable font file from the system, or None.

    The proprietary Chinese test fonts were removed from the public tree,
    so this test resolves an open CJK font via fontconfig instead.
    """
    if shutil.which("fc-match") is None:
        return None
    try:
        result = subprocess.run(
            ["fc-match", ":lang=zh", "--format=%{file}\n"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    font_file = result.stdout.strip().splitlines()
    if result.returncode != 0 or not font_file:
        return None
    return font_file[0]


class TestSubtitleBackgroundSettings(unittest.TestCase):
    def test_all_locales_include_subtitle_background_labels(self):
        """
        After the WebUI added the subtitle background toggle and color
        picker, every existing locale must include the matching translation
        keys so no language falls back to showing the raw English key.
        """
        i18n_dir = Path(__file__).parent.parent.parent / "webui" / "i18n"
        required_keys = {
            "Enable Subtitle Background",
            "Subtitle Background Color",
            "No Voice",
        }

        for locale_file in i18n_dir.glob("*.json"):
            with self.subTest(locale=locale_file.name):
                data = json.loads(locale_file.read_text(encoding="utf-8"))
                translations = data.get("Translation", {})
                missing_keys = required_keys - translations.keys()

                self.assertEqual(missing_keys, set())

    def test_video_params_accepts_disabled_and_colored_subtitle_background(self):
        """
        The UI passes False or a color string to the backend depending on
        the toggle. Verify the schema still accepts both values so future
        dependency or type changes don't break the WebUI/rendering contract.
        """
        base_params = {
            "video_subject": "subtitle background smoke",
        }

        disabled_params = VideoParams(
            **base_params,
            text_background_color=False,
        )
        colored_params = VideoParams(
            **base_params,
            text_background_color="#123456",
        )

        self.assertFalse(disabled_params.text_background_color)
        self.assertEqual(colored_params.text_background_color, "#123456")

    def test_visible_text_position_centers_actual_mask_bounds(self):
        """
        A TextClip canvas includes font line-height and baseline whitespace,
        so centering the canvas directly makes subtitles look too low inside
        the background. This uses a fake mask simulating "visible text pixels
        in the lower half of the canvas" to verify the helper recomputes y
        from the real visible bounds.
        """

        class FakeMask:
            def get_frame(self, _):
                mask = np.zeros((46, 100), dtype=float)
                mask[12:46, 10:90] = 1.0
                return mask

        class FakeTextClip:
            w = 100
            h = 46
            mask = FakeMask()

        x, y = video._get_visible_center_position(
            FakeTextClip(), container_width=100, container_height=93
        )

        self.assertEqual(x, 0)
        # Visible pixels are 34px tall, so in a 93px container there should be
        # ~29px above and below; because the mask starts at 12px from the
        # top, the TextClip itself must shift up to 18px.
        self.assertEqual(y, 18)

    def test_wrap_text_keeps_closing_punctuation_with_text(self):
        """
        When a long Chinese sentence wraps character by character, closing
        punctuation (e.g. 。) must not end up alone on a new line — a lone
        dot would stretch the subtitle background height. This reproduces
        the large-font-size boundary case.
        """
        font_path = _find_system_cjk_font()
        if font_path is None:
            self.skipTest("no CJK font available on this system")

        wrapped_text, _ = video.wrap_text(
            "如果你调整字号，中文笔画也不能被黑色背景遮挡。",
            max_width=1642,
            font=font_path,
            fontsize=72,
        )

        self.assertNotIn("\n。", wrapped_text)
        self.assertIn("挡。", wrapped_text)
