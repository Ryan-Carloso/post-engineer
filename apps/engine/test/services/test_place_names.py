"""place_names: which named places get a photo, and where they land.

Pure logic, no network. A name qualifies when it is a proper name of the
script that the subject does not already cover ("Porto" is the video, not a
place to photograph); at most two per video, the most specific first. The
photo takes the clip whose start is nearest to the moment the voice says the
name, whatever the material is (drawings, stock footage, persona videos).
"""

import pytest

from app.services.place_names import (
    PHOTO_FILE_PREFIX,
    PreparedPhoto,
    assign_slots,
    candidate_names,
    mention_seconds,
    nearest_slot,
)

SUBJECT = "Where to eat the best francesinha in Porto"
SCRIPT = (
    "Ask a local in Porto for the best francesinha and shout Café Santiago in Ribeira. "
    "Then try Regaleira too."
)
WORDS = [
    ("Ask", 0.0, 0.3), ("a", 0.3, 0.4), ("café", 1.0, 1.3), ("tips", 1.3, 1.6),
    ("Café", 20.0, 20.4), ("Santiago,", 20.4, 21.0),
]


def _photo(seconds, name="a"):
    return PreparedPhoto(name=name, still_path=f"/t/{name}.jpg", seconds=seconds, source_host="h.example")


def test_the_two_most_specific_names_the_subject_does_not_cover():
    assert candidate_names(SCRIPT, SUBJECT) == ["Café Santiago", "Ribeira"]


def test_subject_words_nationalities_and_dates_are_not_places():
    assert candidate_names("The Portuguese love Porto on Sunday in July.", SUBJECT) == []


def test_a_name_counts_once_whatever_the_case():
    assert candidate_names("Try Regaleira, then REGALEIRA, then Regaleira.", SUBJECT) == ["Regaleira"]


def test_no_script_means_no_candidates():
    assert candidate_names("", SUBJECT) == []


def test_mention_is_the_start_of_the_word_sequence_matching_the_name():
    # "café" alone at 1.0s is not the place: "Café Santiago" starts at 20.0s.
    assert mention_seconds("Café Santiago", SCRIPT, WORDS, 30.0) == 20.0


def test_a_name_missing_from_the_words_is_placed_by_character_share():
    script = "xxxx Café Santiago yyyy"
    assert mention_seconds("Café Santiago", script, [], 10.0) == pytest.approx(10.0 * 5 / 23)


def test_a_name_that_is_nowhere_has_no_time():
    assert mention_seconds("Casa Bill", SCRIPT, WORDS, 30.0) is None


def test_the_nearest_clip_start_wins():
    assert nearest_slot(7.0, [4, 4, 4, 4]) == 2
    # Stock clips differ in length: the slots start at 0, 2, 4 and 9.
    assert nearest_slot(8.0, [2, 2, 5, 5]) == 3


def test_a_tie_goes_to_the_earlier_clip():
    assert nearest_slot(2.0, [4, 4]) == 0


def test_a_mention_past_the_end_is_the_last_clip():
    assert nearest_slot(99.0, [4, 4, 4]) == 2


def test_slots_never_collide_and_follow_the_input_order():
    # The later mention (7.5s) moves to the next free slot.
    assert assign_slots([7.5, 7.0], [4, 4, 4, 4]) == [3, 2]


def test_a_mention_with_no_free_slot_gets_none():
    assert assign_slots([0.0, 0.0], [4]) == [0, None]


def test_no_clips_means_no_slots():
    assert assign_slots([1.0], []) == [None]


def test_photo_files_carry_the_shared_prefix():
    assert PHOTO_FILE_PREFIX == "place-photo-"
    assert _photo(1.0).still_path.startswith("/t/")
