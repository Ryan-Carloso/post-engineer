"""Direct import of publish_tracking_context for mutmut.

Behavior of the helper is covered through fill_schedule.publish's alias in
test_fill_schedule_analytics.py. This file only pins that the extracted
module is the same function the publisher calls.
"""

from __future__ import annotations

from app.services.fill_schedule import publish as pub_module
from app.services.fill_schedule.publish_tracking import publish_tracking_context


def test_publish_module_alias_is_the_extracted_helper() -> None:
    assert pub_module._publish_tracking_context is publish_tracking_context
