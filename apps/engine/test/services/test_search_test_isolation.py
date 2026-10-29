"""Term filtering is mechanical: no LLM core is left to reach.

The pre-script fact lookup is deleted (Phase 5 PR 5) and the LLM core
itself is deleted (Phase 5 PR 6). What remains here is the
term-filtering guard: task.generate_terms filters stock terms
mechanically, and the task module no longer carries an llm attribute
at all, so no test can spend real tokens on a model call.
"""


def test_term_filtering_is_mechanical_without_any_llm():
    from app.models.schema import VideoParams
    from app.services import stock_terms
    from app.services import task as tm

    assert not hasattr(tm, "llm")
    assert not hasattr(tm, "stock_term_judge")
    params = VideoParams(video_subject="Where to eat the best francesinha in Porto", faceless_material="broll")
    kept = stock_terms.filter_weak_stock_terms(params, ["Porto street", "gato selado"], "script")
    assert kept == ["Porto street"]
