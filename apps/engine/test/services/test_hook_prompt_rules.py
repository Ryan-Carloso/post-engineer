"""The script hook must be concrete, picturable and clear at once.

"Stop chasing the 90-year-old institution if you hate waiting two hours"
named nothing: the viewer cannot tell which place, and no drawing can
show it. The script hook rule demands the concrete thing (dish, place,
object, number), bans vague stand-ins, and never lets the model invent
names or facts to sound concrete.
"""

from app.services.script_prompts import DEFAULT_SCRIPT_SYSTEM_PROMPT


def _hook_rule() -> str:
    lines = DEFAULT_SCRIPT_SYSTEM_PROMPT.splitlines()
    return next(line for line in lines if line.startswith("1. hook:"))


def test_hook_names_the_concrete_thing():
    rule = _hook_rule()
    assert "Name the concrete thing" in rule
    assert "picture" in rule


def test_hook_bans_vague_stand_ins():
    rule = _hook_rule()
    assert "the 90-year-old institution" in rule
    assert "never heard of the topic" in rule


def test_hook_never_invents_names_or_facts():
    rule = _hook_rule()
    assert "Never invent" in rule
    # "Zé do Peixe" and a "5 sqm basement in Campo Alegre" came from nowhere:
    # proper names only when the subject or the user's request gives them.
    assert (
        "Proper names (places, brands, people) only when the subject, the user requirements "
        "or the web search results give them"
    ) in rule


def test_whole_script_never_invents_numbers():
    # "twenty euros" and "ten euros less" reached the body: the rule covers it all.
    assert "never invent names, prices, times, numbers, dates or facts anywhere in the script" in (
        DEFAULT_SCRIPT_SYSTEM_PROMPT
    )
    assert "the subject, angle, user requirements or web search results give" in (
        DEFAULT_SCRIPT_SYSTEM_PROMPT
    )


def test_script_never_reads_out_addresses_or_contacts():
    # "Rua do Bandardim" was read out, copying a typo from the source.
    assert "never read out street addresses, phone numbers, emails or web addresses" in (
        DEFAULT_SCRIPT_SYSTEM_PROMPT
    )


def test_script_adds_nothing_about_a_place_beyond_its_search_result():
    # "hours of heat in line at Café Santiago" was the model's own embellishment.
    assert "never add waiting times, crowds or ratings the results do not state" in (
        DEFAULT_SCRIPT_SYSTEM_PROMPT
    )

