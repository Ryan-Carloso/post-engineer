import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import requests

from app.services.publisher.scheduler import PublishScheduler

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


def _scheduler(publish_due) -> PublishScheduler:
    scheduler = PublishScheduler(store=MagicMock(), publish_video=MagicMock(), notify=MagicMock())
    scheduler.publisher.run = publish_due
    return scheduler


class RunOnceTests(unittest.TestCase):
    def test_runs_only_the_publish_stage(self) -> None:
        scheduler = _scheduler(MagicMock(return_value=2))
        self.assertEqual(scheduler.run_once(NOW), {"published": 2})
        scheduler.publisher.run.assert_called_once_with(NOW)
        scheduler.store.set_connect_retries.assert_called_once()

    def test_a_failing_stage_reports_minus_one_and_drops_the_retry_budget(self) -> None:
        scheduler = _scheduler(MagicMock(side_effect=ValueError("bad row")))
        with patch("app.services.publisher.scheduler.logger") as logger:
            self.assertEqual(scheduler.run_once(NOW), {"published": -1})
        logger.error.assert_called_once()
        self.assertIn("stage published failed", logger.error.call_args.args[0])
        scheduler.store.set_connect_retries.assert_called_with(0)

    def test_connection_outage_is_one_incident_until_it_recovers(self) -> None:
        stage = MagicMock(side_effect=requests.exceptions.ConnectionError("dns"))
        scheduler = _scheduler(stage)
        with patch("app.services.publisher.scheduler.logger") as logger:
            scheduler.run_once(NOW)
            scheduler.run_once(NOW + timedelta(minutes=1))
            self.assertEqual(logger.error.call_count, 1)
            logger.warning.assert_called_once()
            scheduler.run_once(NOW + timedelta(minutes=31))
            self.assertEqual(logger.error.call_count, 2)
            self.assertIn("ongoing", logger.error.call_args.args[0])
            stage.side_effect = None
            stage.return_value = 0
            scheduler.run_once(NOW + timedelta(minutes=32))
        self.assertIn("connection outage over", logger.warning.call_args.args[0])
        self.assertIsNone(scheduler._outage_since)


if __name__ == "__main__":
    unittest.main()
