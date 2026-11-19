"""Decode Redis task hashes back into Python values.

Extracted from ``state.py`` so that grandfathered module can take the
cancel/delete lock without growing past the file-size ratchet.
"""

import ast


def convert_redis_task_value(value: bytes) -> object:
    """Convert a value this application wrote back to a common Python type.

    Redis is inside the application's trust boundary. If untrusted clients
    can write the hash, task state should move to a strict JSON parser
    instead of open-ended literal conversion.
    """
    value_str = value.decode("utf-8")

    try:
        return ast.literal_eval(value_str)
    except (ValueError, SyntaxError):
        pass

    if value_str.isdigit():
        return int(value_str)
    return value_str
