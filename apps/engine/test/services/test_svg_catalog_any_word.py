"""Catalog search falls back to any-word matching when all-words finds nothing.

FTS5 ANDs every token, and the search terms come from an LLM-written script
("queue at restaurant", "francesinha porto"): one word the catalog does not
know zeroed the whole search, so the svg-mode Ryan Porto video found no
artwork at all and rendered a single neutral background. The all-words
match still wins when it exists; only an empty result retries with any
word (ranked by relevance), ignoring filler words.
"""

import os
import tempfile
import unittest
from unittest.mock import patch

from app.services import svg_catalog
from test.services.test_svg_catalog import FakeR2Client, _build_index_bytes

PREFIX = "svg-catalog"


class SvgCatalogAnyWordTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        rows = [
            ("4:2663187", "Hen Standing on Money", "Animals 3/hen money.svg"),
            ("6:2683622", "Hen Throwing Up Money", "Animals 3/hen throw.svg"),
            ("9:1111111", "Waiter With Serving Tray", "People/waiter.svg"),
        ]
        objects = {f"{PREFIX}/_index/catalog.sqlite": _build_index_bytes(rows)}
        for patcher in (
            patch.object(svg_catalog, "_r2_client", return_value=FakeR2Client(objects)),
            patch.object(svg_catalog, "_index_checked_at", None),
            patch.object(
                svg_catalog.config,
                "app",
                {
                    "svg_catalog_enabled": True,
                    "svg_r2_prefix": PREFIX,
                    "svg_cache_dir": os.path.join(tmp.name, "cache"),
                },
            ),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_unknown_word_no_longer_zeroes_the_search(self):
        titles = [a.title for a in svg_catalog.search("francesinha waiter porto")]
        self.assertEqual(titles, ["Waiter With Serving Tray"])

    def test_assets_matching_more_words_rank_first(self):
        titles = [a.title for a in svg_catalog.search("queue standing hen money")]
        self.assertEqual(titles[0], "Hen Standing on Money")
        self.assertIn("Hen Throwing Up Money", titles)

    def test_all_words_match_is_preferred_when_it_exists(self):
        titles = [a.title for a in svg_catalog.search("hen standing")]
        self.assertEqual(titles, ["Hen Standing on Money"])

    def test_filler_words_alone_match_nothing(self):
        self.assertEqual(svg_catalog.search("at the of a"), [])

    def test_no_known_word_still_returns_empty(self):
        self.assertEqual(svg_catalog.search("francesinha porto"), [])
