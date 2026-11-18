"""Classify a requests ConnectionError by the phase it failed in.

A refused TCP connect must be retried on the next validated address,
but a failure after the request was transmitted must never be retried
for a non-idempotent method: the server may already have it.
"""

from urllib3.exceptions import (
    ConnectTimeoutError,
    NewConnectionError,
    ProtocolError,
    ReadTimeoutError,
)


def failed_before_anything_was_sent(exc: BaseException) -> bool:
    """True when *exc* failed during connect, before anything was sent.

    requests wraps urllib3 errors in ConnectionError: a refused connect
    surfaces as NewConnectionError/ConnectTimeoutError in the wrapped
    chain, while a failure after transmission (ProtocolError/
    ReadTimeoutError while reading the response) means the server may
    already have it — never retry those for a POST.
    """
    seen: set[int] = set()
    stack = [exc]
    connect_phase = False
    while stack:
        current = stack.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, (NewConnectionError, ConnectTimeoutError)):
            connect_phase = True
        if isinstance(current, (ProtocolError, ReadTimeoutError)):
            return False
        for attr in ("__cause__", "__context__", "reason"):
            nxt = getattr(current, attr, None)
            if nxt is not None:
                stack.append(nxt)
        stack.extend(arg for arg in getattr(current, "args", ()) if isinstance(arg, BaseException))
    return connect_phase
