"""Direct unit tests for app.utils.secret_redaction.

The module is pure helpers with no endpoint of its own, so mutmut
attributes no TestClient/endpoint test to it: without this file the
per-file mutation shard exits 1 with "could not find any test case for
any mutant". These tests pin the redaction contract directly.
"""

from app.utils.secret_redaction import redact_text, redact_url, redact_value


class TestRedactUrl:
    def test_redacts_sensitive_query_param_value(self):
        assert (
            redact_url("https://cdn.test/video.mp4?key=abc123&other=1")
            == "https://cdn.test/video.mp4?key=***&other=1"
        )

    def test_redacts_each_sensitive_param_name(self):
        for name in (
            "api_key",
            "apikey",
            "token",
            "access_token",
            "auth_token",
            "id_token",
            "refresh_token",
            "signature",
            "sig",
            "secret",
            "client_secret",
        ):
            assert redact_url(f"https://x.test/?{name}=v") == f"https://x.test/?{name}=***"

    def test_param_name_match_is_case_insensitive(self):
        assert redact_url("https://x.test/?KEY=abc") == "https://x.test/?KEY=***"
        assert redact_url("https://x.test/?Token=abc") == "https://x.test/?Token=***"

    def test_url_without_sensitive_params_is_unchanged(self):
        url = "https://x.test/video.mp4?width=1080&height=1920"
        assert redact_url(url) == url

    def test_fragment_and_path_survive_redaction(self):
        assert (
            redact_url("https://x.test/v.mp4?token=abc#t=10")
            == "https://x.test/v.mp4?token=***#t=10"
        )

    def test_non_url_string_is_unchanged(self):
        assert redact_url("just some text") == "just some text"
        assert redact_url("") == ""

    def test_non_string_is_returned_as_is(self):
        assert redact_url(None) is None  # type: ignore[arg-type]
        assert redact_url(42) == 42  # type: ignore[arg-type]

    def test_invalid_ipv6_url_is_returned_as_is(self):
        assert redact_url("http://[::1") == "http://[::1"

    def test_malformed_url_is_returned_as_is(self):
        assert redact_url("https://") == "https://"


class TestRedactText:
    def test_redacts_url_inside_free_text(self):
        assert redact_text(
            "fetch failed for https://x.test/v.mp4?token=abc123 retrying"
        ) == "fetch failed for https://x.test/v.mp4?token=*** retrying"

    def test_trailing_comma_after_url_is_consumed_by_the_url_matcher(self):
        # The URL matcher swallows trailing punctuation, so the comma after
        # the URL does not survive redaction. Pinned as-is; a future fix
        # to the matcher updates this test.
        assert redact_text(
            "fetch failed for https://x.test/v.mp4?token=abc123, retrying"
        ) == "fetch failed for https://x.test/v.mp4?token=*** retrying"

    def test_text_without_url_is_unchanged(self):
        assert redact_text("nothing secret here") == "nothing secret here"

    def test_non_string_is_returned_as_is(self):
        assert redact_text(None) is None  # type: ignore[arg-type]


class TestRedactValue:
    def test_dict_with_sensitive_key_is_redacted(self):
        assert redact_value({"api_key": "abc", "name": "x"}) == {
            "api_key": "***",
            "name": "x",
        }

    def test_dict_key_match_is_case_insensitive(self):
        assert redact_value({"TOKEN": "abc"}) == {"TOKEN": "***"}

    def test_nested_structures_are_walked(self):
        assert redact_value(
            {"nested": {"secret": "s"}, "items": ["https://x.test/?key=v", 1]}
        ) == {"nested": {"secret": "***"}, "items": ["https://x.test/?key=***", 1]}

    def test_tuple_becomes_list_and_set_is_walked(self):
        assert redact_value(("https://x.test/?key=v",)) == ["https://x.test/?key=***"]
        assert redact_value({"https://x.test/?key=v"}) == {"https://x.test/?key=***"}

    def test_plain_values_pass_through(self):
        assert redact_value(42) == 42
        assert redact_value(None) is None

    def test_input_is_never_mutated(self):
        value = {"api_key": "abc", "nested": {"token": "t"}}
        redact_value(value)
        assert value == {"api_key": "abc", "nested": {"token": "t"}}
