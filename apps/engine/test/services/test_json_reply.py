"""json_reply: the first JSON array of a model reply, wherever it sits."""

from app.services.json_reply import first_json_array


def test_a_bare_array_is_read():
    assert first_json_array("[0, 2]") == [0, 2]


def test_commentary_with_stray_brackets_does_not_hide_the_array():
    assert first_json_array("Sure [as asked]: [1, 3] Hope this helps!") == [1, 3]


def test_nested_arrays_are_returned_whole():
    assert first_json_array("answer: [[0, 1, 3], [2, 0, 2]]") == [[0, 1, 3], [2, 0, 2]]


def test_the_first_array_wins():
    assert first_json_array("[1] and later [2]") == [1]


def test_no_array_is_none():
    assert first_json_array("no list here") is None
    assert first_json_array("") is None
    assert first_json_array(None) is None


def test_an_object_or_scalar_is_not_an_array():
    assert first_json_array('{"keep": [4]}') == [4]
    assert first_json_array("42") is None
