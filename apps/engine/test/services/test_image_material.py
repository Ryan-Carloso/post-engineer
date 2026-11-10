"""image_material: rendering a still image to a video clip.

The still-to-clip error paths are shared with the images mode (issue #542).
"""

import unittest
from unittest.mock import patch


class RenderImageFileToMp4ErrorTests(unittest.TestCase):
    """The still-to-clip error paths return "" instead of raising.

    These pin the cleanup contract: the finally block must tolerate a clip
    that was never constructed (the original UnboundLocalError), so an
    unreadable image can never crash the material phase.
    """

    @patch("app.services.video._open_image_clip_with_fallback")
    def test_unreadable_image_returns_empty(self, mock_open):
        from app.services import image_material

        mock_open.side_effect = OSError("no such file")
        self.assertEqual(image_material.render_image_file_to_mp4("/nope.png"), "")
