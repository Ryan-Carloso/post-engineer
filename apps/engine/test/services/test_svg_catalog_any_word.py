"""Catalog search falls back to any-word matching when all-words finds nothing.

FTS5 ANDs every token, and the search terms come from an LLM-written script
("queue at restaurant", "francesinha porto"): one word the catalog does not
know zeroed the whole search, so the svg-mode Ryan Porto video found no
artwork at all and rendered a single neutral background. The all-words
match still wins when it exists; only an empty result retries with any
word (ranked by relevance), ignoring filler words.
"""

import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app.services import svg_catalog
from test.services.test_svg_catalog import FakeR2Client, _build_index_bytes

PREFIX = "svg-catalog"


def _with_loose_tag(index: bytes) -> bytes:
    """Tag the hen drawing "crowd": a match only the tags carry, like the real catalog."""
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    try:
        with open(path, "wb") as handle:
            handle.write(index)
        db = sqlite3.connect(path)
        db.execute("UPDATE search SET tags = 'crowd' WHERE id = '4:2663187'")
        db.commit()
        db.close()
        with open(path, "rb") as handle:
            return handle.read()
    finally:
        os.unlink(path)


class SvgCatalogAnyWordTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        rows = [
            ("4:2663187", "Hen Standing on Money", "Animals 3/hen money.svg"),
            ("6:2683622", "Hen Throwing Up Money", "Animals 3/hen throw.svg"),
            ("9:1111111", "Waiter With Serving Tray", "People/waiter.svg"),
            ("7:2222222", "Business Maze", "Business/maze.svg"),
            ("8:3333333", "Arabian Rich Man", "Global/rich man.svg"),
            ("3:4444444", "Cafe", "Places/cafe.svg"),
            ("3:5555555", "Cafe", "Places 2/cafe copy.svg"),
            ("5:6666666", "Many Activities In A Building", "Misc/building.svg"),
            ("5:7777777", "Solutions Sign", "Misc/sign.svg"),
            ("5:8888888", "Flower On The Street", "Misc/flower.svg"),
            ("5:9999991", "Writing A Long List", "Misc/list.svg"),
            ("5:9999992", "Cameras And Battery Icon", "Misc/icon.svg"),
        ]
        objects = {f"{PREFIX}/_index/catalog.sqlite": _with_loose_tag(_build_index_bytes(rows))}
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

    def test_generic_words_alone_never_pick_a_drawing(self):
        # "business maze" in a francesinha video: only a generic word matched.
        self.assertEqual(svg_catalog.search("total structural collapse business"), [])

    def test_a_concrete_word_still_matches_next_to_generic_ones(self):
        titles = [a.title for a in svg_catalog.search("great business waiter")]
        self.assertEqual(titles, ["Waiter With Serving Tray"])

    def test_first_alternative_with_a_match_wins(self):
        titles = [a.title for a in svg_catalog.search_best(["francesinha", "waiter tray", "hen"])]
        self.assertEqual(titles, ["Waiter With Serving Tray"])

    def test_no_alternative_matching_returns_empty(self):
        self.assertEqual(svg_catalog.search_best(["francesinha", "porto"]), [])
        self.assertEqual(svg_catalog.search_best([]), [])

    def test_vague_people_words_never_pick_a_drawing(self):
        self.assertEqual(svg_catalog.search("person commenting man"), [])

    def test_line_alone_never_picks_a_drawing(self):
        # "waiting line" matched a road drawing on "line".
        self.assertIn("line", svg_catalog._GENERIC_WORDS)

    def test_tag_only_match_never_picks_a_drawing(self):
        self.assertEqual(svg_catalog.search("crowd"), [])

    def test_same_title_drawings_are_returned_once(self):
        titles = [a.title for a in svg_catalog.search("cafe")]
        self.assertEqual(titles, ["Cafe"])


class GenericContainerWordTests(unittest.TestCase):
    """"building", "sign" and "street" matched any drawing that merely contained one.

    The term generator closed each moment with a generic noun, and the catalog
    answered with "Many Activities In A Building" for a restaurant, "Solutions
    Sign" for "vintage sign" and "Flower On The Street" for a neighborhood. A
    container word alone says nothing about what the moment shows.
    """

    setUp = SvgCatalogAnyWordTests.setUp

    def test_a_generic_container_word_alone_matches_nothing(self):
        for word in ("building", "sign", "street", "object", "place", "city"):
            self.assertEqual(svg_catalog.search(word), [], word)

    def test_a_generic_alternative_no_longer_rescues_a_moment(self):
        self.assertEqual(svg_catalog.search_best(["regaleira", "restaurant", "building"]), [])
        self.assertEqual(svg_catalog.search_best(["vintage sign", "sign", "object"]), [])

    def test_a_concrete_word_next_to_a_container_word_still_matches(self):
        titles = [a.title for a in svg_catalog.search("waiter building")]
        self.assertEqual(titles, ["Waiter With Serving Tray"])


class CandidatesFromEveryAlternativeTests(unittest.TestCase):
    """search_best stopped at the first alternative with a match, so a moment
    whose specific alternative hit "Security Opening The Door" never offered
    the picker the "Cafe" its generic alternative would have found."""

    setUp = SvgCatalogAnyWordTests.setUp

    def test_candidates_of_all_alternatives_come_specific_first(self):
        titles = [a.title for a in svg_catalog.search_candidates(["waiter tray", "hen"])]
        self.assertEqual(titles[0], "Waiter With Serving Tray")
        self.assertEqual(sorted(titles[1:]), ["Hen Standing on Money", "Hen Throwing Up Money"])

    def test_a_drawing_found_twice_is_listed_once(self):
        titles = [a.title for a in svg_catalog.search_candidates(["hen", "hen money", "money"])]
        self.assertEqual(len(titles), len(set(titles)))

    def test_the_list_is_capped(self):
        found = svg_catalog.search_candidates(["hen", "waiter"], per_alternative=1, cap=1)
        self.assertEqual(len(found), 1)

    def test_no_alternative_matching_gives_an_empty_list(self):
        self.assertEqual(svg_catalog.search_candidates(["francesinha", "porto"]), [])
        self.assertEqual(svg_catalog.search_candidates([]), [])


class GenericAdjectiveTests(unittest.TestCase):
    """"long cafe queue" brought "Writing A Long List": an adjective carried the match."""

    setUp = SvgCatalogAnyWordTests.setUp

    def test_a_generic_adjective_never_carries_a_match(self):
        titles = [a.title for a in svg_catalog.search("long cafe queue")]
        self.assertEqual(titles, ["Cafe"])

    def test_generic_adjectives_and_ui_words_alone_match_nothing(self):
        for word in ("long", "old", "famous", "modern", "icon", "button"):
            self.assertEqual(svg_catalog.search(word), [], word)

    def test_an_icon_moment_finds_no_icon_drawing(self):
        self.assertEqual(svg_catalog.search_best(["save icon heart", "social media button", "phone"]), [])


class TitleGateTests(unittest.TestCase):
    """A match must show in the title: tags alone matched mosquitoes for "crowd"."""

    def test_title_word_matches_by_shared_stem(self):
        self.assertTrue(svg_catalog._title_matches("Restaurant Front", ["restaurants"]))
        self.assertTrue(svg_catalog._title_matches("Male Tourist", ["tourist", "trap"]))

    def test_tag_only_match_is_rejected(self):
        self.assertFalse(svg_catalog._title_matches("Mosquito And People", ["crowd"]))
        self.assertFalse(svg_catalog._title_matches("Mosquito And People", []))
