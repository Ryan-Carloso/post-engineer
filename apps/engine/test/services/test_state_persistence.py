"""Direct tests for the extracted persist_state_update helper.

The helper moved into its own module so state.py stays under the size
ratchet; these tests import it from its new home so mutation coverage
follows the code (mutmut rule in AGENTS.md).
"""

from unittest.mock import Mock

from app.services.state_persistence import persist_state_update


def test_persist_success_returns_true():
    backend = Mock()
    assert persist_state_update(backend, "t-1", progress=5) is True
    backend.update_task.assert_called_once_with("t-1", progress=5)


def test_persist_retries_once_then_returns_true():
    backend = Mock()
    backend.update_task.side_effect = [RuntimeError("boom"), None]
    assert persist_state_update(backend, "t-1", progress=5) is True
    assert backend.update_task.call_count == 2


def test_persist_gives_up_and_returns_false():
    backend = Mock()
    backend.update_task.side_effect = RuntimeError("down")
    assert persist_state_update(backend, "t-1", progress=5) is False
    assert backend.update_task.call_count == 2
