"""Per-photo on-screen seconds for a full-frame photo (segment pacing).

A segment photo may carry `duration`: how many seconds it stays on
screen, so the agent can hold the turning-point photo longer or flash
one briefly instead of every photo ticking at the same 2s pace. The
bounds are the contract: the validators reject anything outside them
before charging, and the layout falls back to the default pace for
anything that reaches it unchecked.
"""

import math

import pytest

from app.services.image_coverage import MAX_PHOTO_SECONDS
from app.services.segment_photo_duration import (
    MAX_REQUESTED_PHOTO_SECONDS,
    MIN_REQUESTED_PHOTO_SECONDS,
    duration_error,
    photo_cap,
)


def test_the_bounds_are_half_a_second_to_six_seconds():
    assert MIN_REQUESTED_PHOTO_SECONDS == 0.5
    assert MAX_REQUESTED_PHOTO_SECONDS == 6.0


@pytest.mark.parametrize("value", [None, 0.5, 1, 2.0, 3, 6.0])
def test_a_missing_or_in_range_duration_is_usable(value):
    assert duration_error(value) is None


@pytest.mark.parametrize("value", [0, -1, 0.49, 6.01, 60])
def test_an_out_of_range_duration_reports_the_bounds(value):
    rule, fix = duration_error(value)
    assert "0.5" in rule and "6" in rule
    assert fix


@pytest.mark.parametrize("value", ["3", True, False, float("nan"), float("inf")])
def test_a_non_number_duration_is_rejected(value):
    rule, fix = duration_error(value)
    assert "number" in rule
    assert fix


def test_a_number_that_is_not_a_bool_passes_the_type_check():
    # bool is an int subclass: True must not slip through as 1 second.
    assert duration_error(True) is not None
    assert duration_error(1) is None


def test_photo_cap_returns_the_request_when_it_is_valid():
    assert photo_cap(3.0, MAX_PHOTO_SECONDS) == 3.0
    assert photo_cap(0.5, MAX_PHOTO_SECONDS) == 0.5
    assert photo_cap(6.0, MAX_PHOTO_SECONDS) == 6.0


def test_photo_cap_falls_back_to_the_default_pace_when_unusable():
    default = MAX_PHOTO_SECONDS
    assert photo_cap(None, default) == default
    assert photo_cap(0, default) == default
    assert photo_cap(7.0, default) == default
    assert photo_cap("3", default) == default
    assert photo_cap(True, default) == default
    assert photo_cap(math.nan, default) == default
