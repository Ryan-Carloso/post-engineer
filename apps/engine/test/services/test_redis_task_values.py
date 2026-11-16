"""Direct tests for the Redis task-value decoder.

mutmut attributes coverage to the module a test imports. This file is the
one that executes ``redis_task_values`` on purpose.
"""

from app.services.redis_task_values import convert_redis_task_value


def test_literal_list_round_trips():
    assert convert_redis_task_value(b"['clip.mp4']") == ["clip.mp4"]


def test_plain_integer_round_trips():
    assert convert_redis_task_value(b"42") == 42


def test_leading_zero_numeral_uses_the_digit_branch():
    # ast.literal_eval rejects "08" (invalid octal). The digit branch
    # still has to return an int, or progress stored that way stays a string.
    assert convert_redis_task_value(b"08") == 8


def test_non_literal_text_stays_a_string():
    assert convert_redis_task_value(b"ready") == "ready"
