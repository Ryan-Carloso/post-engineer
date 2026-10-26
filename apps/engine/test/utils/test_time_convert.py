"""SRT timestamps round to the millisecond instead of truncating floats."""

import pytest

from app.utils.utils import time_convert_seconds_to_hmsm


@pytest.mark.parametrize(
    "seconds, expected",
    [
        (24.8, "00:00:24,800"),
        (0.08, "00:00:00,080"),
        (59.9996, "00:01:00,000"),
        (3661.5, "01:01:01,500"),
        (0, "00:00:00,000"),
    ],
)
def test_seconds_format_as_rounded_srt_timestamps(seconds, expected):
    assert time_convert_seconds_to_hmsm(seconds) == expected
