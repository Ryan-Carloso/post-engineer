"""stock_terms: the weak-term filter is stock-only.

Svg terms carry "a | b | c" alternatives that score against the subject
token by token; filtering them as stock terms would drop exactly the
generic fallbacks ("food") that keep a sparse catalog on topic.
"""

from unittest.mock import patch

from app.models.schema import VideoParams
from app.services import llm, stock_terms


def _params(material):
    return VideoParams(video_subject="portagens europa", faceless_material=material)


def test_svg_terms_are_never_filtered():
    terms = ["gato selado | animal", "portagens europa"]
    assert stock_terms.filter_weak_stock_terms(_params("svg"), terms) == terms


def test_stock_terms_drop_the_weak_ones():
    terms = ["gato selado", "portagens europa"]
    assert stock_terms.filter_weak_stock_terms(_params("broll"), terms) == ["portagens europa"]


def test_adhesion_is_the_share_of_term_tokens_in_the_subject():
    assert stock_terms.stock_adhesion_score("portagens gato", "portagens europa") == 0.5
    assert stock_terms.stock_adhesion_score("a o", "portagens europa") == 0.0


# ---- filmable terms: stock search needs what a camera sees, not the script's words


def test_abstract_meta_and_numeric_words_make_a_term_unfilmable():
    # These echoed the script and returned a 1953 poster, a statue and a cosplayer.
    for term in (
        "Porto Save Video",
        "francesinha original producer",
        "Porto 1953 Location",
        "Porto Birthplace History",
        "francesinha tourist trap",
        "HISTORY of porto",
    ):
        assert not stock_terms.is_filmable(term), term


def test_a_year_or_number_alone_makes_a_term_unfilmable():
    # "1953" matched a Picasso poster: stock has no idea what happened in a year.
    assert not stock_terms.is_filmable("Porto 1953 street")
    assert not stock_terms.is_filmable("top 10 plates")


def test_concrete_scene_terms_are_filmable():
    for term in ("francesinha plate", "Porto old street", "Porto restaurant kitchen", "waiter serving"):
        assert stock_terms.is_filmable(term), term


def test_generated_unfilmable_terms_are_dropped_and_concrete_ones_kept_in_order():
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto")
    terms = ["francesinha plate", "Porto Save Video", "Porto street", "francesinha original producer"]
    assert stock_terms.filter_weak_stock_terms(params, terms) == ["francesinha plate", "Porto street"]


def test_terms_the_user_wrote_are_never_dropped_for_being_abstract():
    params = VideoParams(
        video_subject="Where to eat the best francesinha in Porto",
        video_terms="porto history, porto plate",
    )
    terms = ["porto history", "porto plate"]
    assert stock_terms.filter_weak_stock_terms(params, terms) == terms


def test_when_every_generated_term_is_unfilmable_the_list_is_kept():
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto")
    terms = ["Porto Save Video", "francesinha original producer"]
    assert stock_terms.filter_weak_stock_terms(params, terms) == terms


# ---- adhesion is measured against the subject AND the script


_SCRIPT = "Locals queue at the small cafe for the sandwich plate and the crowded street."


def test_a_term_that_repeats_the_script_is_not_off_topic():
    # The model wrote "small cafe interior" and "sandwich plate": filmable and
    # on topic, yet dropped because they did not repeat a word of the SUBJECT.
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto")
    terms = ["small cafe interior", "sandwich plate", "Porto street"]
    assert stock_terms.filter_weak_stock_terms(params, terms, _SCRIPT) == terms


def test_without_the_script_the_subject_only_rule_stands():
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto")
    assert stock_terms.filter_weak_stock_terms(params, ["small cafe interior", "Porto street"]) == ["Porto street"]


def test_a_term_unrelated_to_subject_and_script_is_still_dropped():
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto")
    terms = ["gato selado", "Porto street"]
    assert stock_terms.filter_weak_stock_terms(params, terms, _SCRIPT) == ["Porto street"]


def test_a_term_that_repeats_the_script_is_still_dropped_when_it_is_unfilmable():
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto")
    script = "Save this video for later."
    assert stock_terms.filter_weak_stock_terms(params, ["Porto Save Video", "Porto street"], script) == ["Porto street"]


# ---- the prompt


def _prompt(ordered=True, amount=8):
    return stock_terms.terms_prompt("best ramen in Tokyo", "script text", amount, ordered)


def test_prompt_asks_for_what_the_camera_sees_anchored_on_the_subject():
    prompt = _prompt()
    assert "one word taken from the video subject" in prompt
    assert "what the camera sees" in prompt


def test_prompt_bans_abstract_meta_words_years_and_business_names():
    prompt = _prompt()
    assert "never use abstract or meta words" in prompt
    assert "never years or numbers" in prompt
    assert "never use the name of a specific business or person" in prompt


def test_every_unfilmable_word_is_named_in_the_prompt():
    # The filter and the prompt must agree on the list: one source, two uses.
    prompt = _prompt()
    for word in stock_terms.UNFILMABLE_WORDS:
        assert word in prompt, word


def test_an_abstract_sentence_is_to_be_filmed_as_the_subject_itself():
    assert "film the subject itself" in _prompt()


def test_ordered_prompt_keeps_the_script_order_contract():
    prompt = _prompt(ordered=True, amount=3)
    assert "chronological stock-video search terms" in prompt
    assert "same order as the script narration" in prompt
    assert "Generate 3 " in prompt


def test_unordered_prompt_has_the_same_constraints_without_the_ordering_rule():
    prompt = _prompt(ordered=False, amount=5)
    assert "search terms for stock videos" in prompt
    assert "same order as the script narration" not in prompt
    assert "never use abstract or meta words" in prompt


def test_generate_terms_builds_its_prompt_through_the_stock_terms_module():
    captured = {}

    def fake_generate_response(prompt, llm_provider):
        captured["prompt"] = prompt
        return '["ramen bowl", "Tokyo street"]', {}

    with patch.object(llm, "_generate_response_inner", side_effect=fake_generate_response):
        result = llm.generate_terms("best ramen in Tokyo", "script text", amount=2, match_script_order=True)
    assert result == ["ramen bowl", "Tokyo street"]
    assert captured["prompt"] == stock_terms.terms_prompt("best ramen in Tokyo", "script text", 2, True)
