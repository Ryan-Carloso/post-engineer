import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VideoParams

# Measured on the published HabitLoom video (issue #534, YouTube zBkJoczF7HA):
# the music sat 8 dB below the voice at the old default gain of 0.2. The
# user wants the voice clearly audible: music 15 dB below the voice, i.e.
# 7 dB more attenuation than the old default.
MEASURED_NET_BALANCE_DB = -8.0
TARGET_NET_BALANCE_DB = -15.0
OLD_DEFAULT_BGM_VOLUME = 0.2
NEW_DEFAULT_BGM_VOLUME = 0.09


def gain_db(gain: float) -> float:
    return 20 * math.log10(gain)


class TestBgmVolumeDefault(unittest.TestCase):
    def test_default_is_0_09(self):
        self.assertEqual(VideoParams(video_subject="test").bgm_volume, 0.09)

    def test_new_default_attenuates_7_db_vs_old_default(self):
        delta = gain_db(NEW_DEFAULT_BGM_VOLUME) - gain_db(OLD_DEFAULT_BGM_VOLUME)
        self.assertAlmostEqual(delta, -7.0, delta=0.1)

    def test_new_default_puts_measured_track_at_minus_15_db(self):
        delta = gain_db(NEW_DEFAULT_BGM_VOLUME) - gain_db(OLD_DEFAULT_BGM_VOLUME)
        self.assertAlmostEqual(MEASURED_NET_BALANCE_DB + delta, TARGET_NET_BALANCE_DB, delta=0.1)

    def test_explicit_override_still_honoured(self):
        self.assertEqual(VideoParams(video_subject="test", bgm_volume=0.2).bgm_volume, 0.2)
        self.assertEqual(VideoParams(video_subject="test", bgm_volume=0.3).bgm_volume, 0.3)


if __name__ == "__main__":
    unittest.main()
