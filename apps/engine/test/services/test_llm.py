import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import call, patch

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.config import config
from app.models.schema import VideoScriptRequest, VideoSocialMetadataRequest
from app.services import llm


def _auth_headers() -> dict[str, str]:
    """Test shared secret — same contract as the Next proxy."""
    os.environ["MONEYPRINT_API_SECRET"] = "test-shared-secret"
    return {
        "authorization": "Bearer test-shared-secret",
        "x-user-id": "test-user",
    }

RUN_INTEGRATION_TESTS = os.environ.get("MPT_RUN_INTEGRATION_TESTS", "").lower() in {
    "1",
    "true",
    "yes",
}


class TestScriptPromptOptions(unittest.TestCase):
    def test_music_mood_is_selected_from_catalog_options(self):
        with patch.object(llm, "_generate_response_with_fallback", return_value="romantic") as generate:
            result = llm.generate_music_mood(
                "A calm story about two people meeting by the sea.",
                ("energetic", "romantic"),
            )

        self.assertEqual(result, "romantic")
        prompt = generate.call_args.kwargs["prompt"]
        self.assertIn("energetic, romantic, none", prompt)

    def test_music_mood_rejects_mood_not_in_catalog(self):
        with patch.object(
            llm,
            "_generate_response_with_fallback",
            side_effect=["sad", "none"],
        ):
            result = llm.generate_music_mood("A neutral news report.", ("neutral",))

        self.assertEqual(result, "none")

    def test_normalize_text_response_removes_think_blocks(self):
        """
        Reasoning models may return `<think>...</think>`. The script pipeline
        must keep only the final body text so the reasoning trace never
        reaches subtitles or voiceover.
        """
        result = llm._normalize_text_response(
            "<think>\nI should reason here.\n</think>\n测试成功",
            "minimax",
        )

        self.assertEqual(result, "测试成功")

    def test_normalize_text_response_rejects_think_only_response(self):
        """
        If the model returns only a think block with no final answer, treat
        it as empty content and trigger a retry or a clear error.
        """
        with self.assertRaises(ValueError):
            llm._normalize_text_response("<think>hidden reasoning</think>", "minimax")

    def test_normalize_text_response_removes_unclosed_think_block(self):
        """
        Some gateways may return a truncated, unclosed `<think>`. Such content
        must also stay out of the final script; if nothing readable remains
        after cleanup, handle it as an empty response.
        """
        with self.assertRaises(ValueError):
            llm._normalize_text_response("<think>hidden reasoning", "minimax")

    def test_build_script_prompt_appends_advanced_requirements(self):
        """
        Advanced copy requirements only add constraints; they never replace
        the default system prompt. Plain users without configuration keep the
        stable default rules, while advanced users can still refine style.
        """
        prompt = llm.build_script_prompt(
            video_subject="咖啡",
            language="zh-CN",
            paragraph_number=3,
            video_script_prompt="语气轻松，面向程序员",
        )

        self.assertIn("# Role: Video Script Generator", prompt)
        self.assertIn("- video subject: 咖啡", prompt)
        self.assertIn("- number of paragraphs: 3", prompt)
        self.assertIn("- language: zh-CN", prompt)
        self.assertIn("# Additional User Requirements:", prompt)
        self.assertIn("语气轻松，面向程序员", prompt)

    def test_build_script_prompt_uses_word_target_without_forcing_paragraphs(self):
        prompt = llm.build_script_prompt(video_subject="Short story")

        self.assertIn("- target length: 80 to 110 words", prompt)
        self.assertNotIn("number of paragraphs", prompt)

    def test_build_script_prompt_accepts_internal_word_target_override(self):
        prompt = llm.build_script_prompt(
            video_subject="Short hook",
            target_words_min=8,
            target_words_max=16,
        )

        self.assertIn("- target length: 8 to 16 words", prompt)

    def test_custom_system_prompt_keeps_runtime_context(self):
        """
        A custom system prompt replaces the default script rules, but the
        video subject, language, and paragraph count are still appended by
        the service layer so advanced users can't drop required context.
        """
        prompt = llm.build_script_prompt(
            video_subject="露营",
            language="en",
            paragraph_number=2,
            custom_system_prompt="Only write cinematic narration.",
        )

        self.assertNotIn("# Role: Video Script Generator", prompt)
        self.assertIn("Only write cinematic narration.", prompt)
        self.assertIn("- video subject: 露营", prompt)
        self.assertIn("- number of paragraphs: 2", prompt)
        self.assertIn("- language: en", prompt)

    def test_generate_script_sends_custom_prompt_to_llm(self):
        captured = {}

        def fake_generate_response(prompt, llm_provider):
            captured["prompt"] = prompt
            return "第一段。\n\n第二段。"

        with patch.object(llm, "_generate_response_inner", side_effect=fake_generate_response):
            result = llm.generate_script(
                video_subject="咖啡",
                language="zh-CN",
                paragraph_number=2,
                video_script_prompt="开头更有悬念",
            )

        self.assertEqual(result, "第一段。\n\n第二段。")
        self.assertIn("- number of paragraphs: 2", captured["prompt"])
        self.assertIn("开头更有悬念", captured["prompt"])

    def test_generate_terms_can_request_script_ordered_keywords(self):
        """
        Script-ordered material matching needs the LLM to return ordered
        keywords. No real model is called here; the test only verifies the
        service layer writes the "output in script narrative order"
        constraint into the prompt, so later ordered downloads don't end up
        paired with unordered global theme keywords.
        """
        captured = {}

        def fake_generate_response(prompt, llm_provider):
            captured["prompt"] = prompt
            return '["opening city", "middle office", "final sunset"]'

        with patch.object(llm, "_generate_response_inner", side_effect=fake_generate_response):
            result = llm.generate_terms(
                video_subject="startup story",
                video_script="First city. Then office. Finally sunset.",
                amount=3,
                match_script_order=True,
            )

        self.assertEqual(result, ["opening city", "middle office", "final sunset"])
        self.assertIn("chronological stock-video search terms", captured["prompt"])
        self.assertIn("same order as the script narration", captured["prompt"])

    def test_video_script_request_rejects_invalid_advanced_options(self):
        """
        The API request model must clamp advanced prompt parameters so
        external callers can't bypass the WebUI with absurd paragraph counts
        or oversized prompts that blow up model cost and results.
        """
        with self.assertRaises(ValidationError):
            VideoScriptRequest(video_subject="咖啡", paragraph_number=0)

        with self.assertRaises(ValidationError):
            VideoScriptRequest(
                video_subject="咖啡",
                video_script_prompt="x" * (llm.MAX_SCRIPT_PROMPT_LENGTH + 1),
            )


class TestLiteLLMProvider(unittest.TestCase):
    def setUp(self):
        self.original_app_config = dict(config.app)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)

    def _use_litellm_provider(self, model_name="openai/gpt-4o-mini"):
        config.app["llm_provider"] = "litellm"
        config.app["litellm_model_name"] = model_name

    def test_litellm_provider_returns_normalized_text(self):
        """
        Verify the LiteLLM provider's main path needs no real network or
        private API key.

        A fake module is injected into `sys.modules`, directly shadowing the
        dynamically imported `litellm.completion()`, so the test stably
        covers the litellm branch of `_generate_response()`.
        """
        self._use_litellm_provider()

        fake_litellm = types.SimpleNamespace()

        def _completion(**kwargs):
            self.assertEqual(kwargs["model"], "openai/gpt-4o-mini")
            self.assertEqual(
                kwargs["messages"], [{"role": "user", "content": "Say hello"}]
            )
            self.assertTrue(kwargs["drop_params"])
            message = types.SimpleNamespace(content="hello\nworld")
            choice = types.SimpleNamespace(message=message)
            return types.SimpleNamespace(choices=[choice])

        fake_litellm.completion = _completion

        with patch.dict(sys.modules, {"litellm": fake_litellm}):
            result = llm._generate_response("Say hello")

        self.assertEqual(result, "hello world")

    def test_litellm_provider_requires_model_name(self):
        self._use_litellm_provider(model_name="")

        result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("model_name is not set", result)

    def test_litellm_provider_handles_empty_response(self):
        self._use_litellm_provider()

        fake_litellm = types.SimpleNamespace(
            completion=lambda **kwargs: types.SimpleNamespace(choices=[])
        )

        with patch.dict(sys.modules, {"litellm": fake_litellm}):
            result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("returned empty response", result)

    def test_litellm_provider_handles_empty_message(self):
        """
        Some OpenAI-compatible gateways return HTTP 200 with
        `choices[0].message` set to None on content-filter or safety
        intercepts. A diagnosable error must come back here, not an
        AttributeError.
        """
        self._use_litellm_provider()

        fake_litellm = types.SimpleNamespace(
            completion=lambda **kwargs: types.SimpleNamespace(
                choices=[types.SimpleNamespace(message=None)]
            )
        )

        with patch.dict(sys.modules, {"litellm": fake_litellm}):
            result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("returned empty message", result)

    def test_sanitize_error_message_redacts_url_credentials_and_query_tokens(self):
        message = (
            "request failed for "
            "https://myuser:mypassword@proxy.example.com/v1/chat"
            "?api_key=secret-key&token=secret-token&safe=value"
        )

        result = llm._sanitize_error_message(message)

        self.assertIn("https://***:***@proxy.example.com", result)
        self.assertIn("api_key=***", result)
        self.assertIn("token=***", result)
        self.assertIn("safe=value", result)
        self.assertNotIn("myuser", result)
        self.assertNotIn("mypassword", result)
        self.assertNotIn("secret-key", result)
        self.assertNotIn("secret-token", result)

    def test_openai_provider_error_redacts_embedded_base_url_credentials(self):
        """
        A custom OpenAI-compatible base_url may carry a proxy gateway's
        user:pass. SDKs often paste the URL into the exception text, so this
        verifies the `Error:` copy returned to the WebUI/API leaks none of
        those credentials.
        """
        config.app["llm_provider"] = "groq"
        config.app["groq_api_key"] = "groq-key"
        config.app["groq_model_name"] = "llama-3.3-70b-versatile"
        config.app["groq_base_url"] = "https://myuser:mypassword@proxy.example.com/openai/v1"

        class FakeCompletions:
            def create(self, **kwargs):
                raise RuntimeError(
                    "connection failed: "
                    "https://myuser:mypassword@proxy.example.com/openai/v1"
                    "?access_token=secret-token"
                )

        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=FakeCompletions())
        )

        with patch.object(llm, "OpenAI", return_value=fake_client):
            result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("https://***:***@proxy.example.com", result)
        self.assertIn("access_token=***", result)
        self.assertNotIn("myuser", result)
        self.assertNotIn("mypassword", result)
        self.assertNotIn("secret-token", result)

    def test_openai_provider_still_uses_existing_path(self):
        config.app["llm_provider"] = "openai"
        config.app["openai_api_key"] = ""
        config.app["openai_base_url"] = "https://api.openai.com/v1"
        config.app["openai_model_name"] = "gpt-4o-mini"

        result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("api_key is not set", result)
        self.assertNotIn("litellm", result.lower())

    def _use_qwen_provider(self):
        config.app["llm_provider"] = "qwen"
        config.app["qwen_api_key"] = "qwen-key"
        config.app["qwen_model_name"] = "qwen-max"

    def _patch_dashscope_generation(self, response):
        class FakeGenerationResponse(dict):
            pass

        fake_response = FakeGenerationResponse(response)
        fake_response.status_code = response.get("status_code", 200)
        fake_dashscope = types.SimpleNamespace(
            api_key="",
            Generation=types.SimpleNamespace(call=lambda **kwargs: fake_response),
        )
        fake_dashscope_response = types.SimpleNamespace(
            GenerationResponse=FakeGenerationResponse
        )

        return patch.dict(
            sys.modules,
            {
                "dashscope": fake_dashscope,
                "dashscope.api_entities": types.SimpleNamespace(),
                "dashscope.api_entities.dashscope_response": fake_dashscope_response,
            },
        )

    def test_qwen_provider_reads_chat_choices_content(self):
        """
        DashScope chat mode puts the text in
        `output.choices[0].message.content`. This covers the `output.text is
        None` case from issue #966, so `'NoneType' object has no attribute
        'replace'` can't regress.
        """
        self._use_qwen_provider()
        response = {
            "output": {
                "text": None,
                "choices": [{"message": {"content": "你好\n世界"}}],
            }
        }

        with self._patch_dashscope_generation(response):
            result = llm._generate_response("Say hello")

        self.assertEqual(result, "你好 世界")

    def test_qwen_provider_falls_back_to_output_text(self):
        """Keep the compat path for the legacy DashScope completion response shape."""
        self._use_qwen_provider()
        response = {"output": {"text": "旧格式\n响应"}}

        with self._patch_dashscope_generation(response):
            result = llm._generate_response("Say hello")

        self.assertEqual(result, "旧格式 响应")

    def test_qwen_provider_reports_empty_text(self):
        """A Qwen empty response should yield a diagnosable error, not a low-level AttributeError."""
        self._use_qwen_provider()
        response = {"output": {"text": None, "choices": [{"message": {"content": None}}]}}

        with self._patch_dashscope_generation(response):
            result = llm._generate_response("Say hello")

        self.assertIn("Error:", result)
        self.assertIn("returned empty text content", result)
        self.assertNotIn("NoneType", result)

    def test_qwen_provider_reports_empty_choices(self):
        """Empty choices in a Qwen chat response should yield a clear error."""
        self._use_qwen_provider()
        response = {"output": {"text": None, "choices": []}}

        with self._patch_dashscope_generation(response):
            result = llm._generate_response("Say hello")

        self.assertIn("Error:", result)
        self.assertIn("returned empty choices", result)
        self.assertNotIn("NoneType", result)

    def test_aihubmix_provider_uses_openai_compatible_client(self):
        """
        AIHubMix is an OpenAI-compatible gateway. A fake OpenAI client
        verifies the dedicated provider uses the partner default endpoint and
        recommended model, without real network or a private API key
        affecting test stability.
        """
        config.app["llm_provider"] = "aihubmix"
        config.app["aihubmix_api_key"] = "aihubmix-key"
        config.app["aihubmix_base_url"] = ""
        config.app["aihubmix_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\naihubmix")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="aihubmix-key",
            base_url="https://aihubmix.com/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "gpt-5.4-mini",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello aihubmix")

    def test_aimlapi_provider_uses_openai_compatible_client(self):
        config.app["llm_provider"] = "aimlapi"
        config.app["aimlapi_api_key"] = "aimlapi-key"
        config.app["aimlapi_base_url"] = ""
        config.app["aimlapi_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\naimlapi")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="aimlapi-key",
            base_url="https://api.aimlapi.com/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "openai/gpt-4o-mini",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello aimlapi")

    def test_evolink_provider_uses_openai_compatible_client(self):
        """
        EvoLink exposes OpenAI-compatible Chat Completions at direct.evolink.ai.
        The provider should keep its own default endpoint and model instead of
        requiring users to overload the generic OpenAI settings.
        """
        config.app["llm_provider"] = "evolink"
        config.app["evolink_api_key"] = "evolink-key"
        config.app["evolink_base_url"] = ""
        config.app["evolink_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nevolink")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="evolink-key",
            base_url="https://direct.evolink.ai/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "gpt-5.5",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello evolink")

    def test_volcengine_provider_uses_openai_compatible_client(self):
        """
        VolcEngine Ark exposes OpenAI-compatible Chat Completions. A fake
        OpenAI client covers the provider defaults for address and model, so
        no real network or private API key affects test stability.
        """
        config.app["llm_provider"] = "volcengine"
        config.app["volcengine_api_key"] = "volcengine-key"
        config.app["volcengine_base_url"] = ""
        config.app["volcengine_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nvolcengine")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="volcengine-key",
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "doubao-seed-2-1-turbo-260628",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello volcengine")

    def test_grok_provider_still_uses_existing_path(self):
        config.app["llm_provider"] = "grok"
        config.app["grok_api_key"] = ""
        config.app["grok_base_url"] = "https://api.x.ai/v1"
        config.app["grok_model_name"] = "grok-4.3"

        result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("api_key is not set", result)
        self.assertNotIn("litellm", result.lower())

    def test_groq_provider_requires_api_key(self):
        config.app["llm_provider"] = "groq"
        config.app["groq_api_key"] = ""
        config.app["groq_base_url"] = "https://api.groq.com/openai/v1"
        config.app["groq_model_name"] = "llama-3.3-70b-versatile"

        result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("api_key is not set", result)
        self.assertNotIn("litellm", result.lower())

    def test_groq_provider_uses_default_base_url(self):
        config.app["llm_provider"] = "groq"
        config.app["groq_api_key"] = "groq-test-key"
        config.app["groq_base_url"] = ""
        config.app["groq_model_name"] = "llama-3.3-70b-versatile"

        fake_response = types.SimpleNamespace(
            choices=[
                types.SimpleNamespace(
                    message=types.SimpleNamespace(content="hello\ngroq")
                )
            ]
        )
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(
                completions=types.SimpleNamespace(create=lambda **kwargs: fake_response)
            )
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="groq-test-key",
            base_url="https://api.groq.com/openai/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(result, "hello groq")

    def _use_ollama_provider(self, base_url=""):
        config.app["llm_provider"] = "ollama"
        config.app["ollama_api_key"] = ""
        config.app["ollama_base_url"] = base_url
        config.app["ollama_model_name"] = "llama3"

    def _assert_ollama_base_url(self, expected_base_url: str):
        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nollama")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="ollama",
            base_url=expected_base_url,
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "llama3",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello ollama")

    def test_ollama_default_base_url_uses_localhost_outside_container(self):
        """
        On a plain host runtime, Ollama still defaults to localhost so
        existing users are unaffected.
        """
        self._use_ollama_provider()

        with patch.object(config, "is_running_in_container", return_value=False):
            self._assert_ollama_base_url("http://localhost:11434/v1")

    def test_ollama_default_base_url_uses_host_gateway_inside_container(self):
        """
        Inside a container, localhost points at the container itself; the
        default becomes host.docker.internal so Docker Desktop users can
        reach the host's Ollama.
        """
        self._use_ollama_provider()

        with (
            patch.object(config, "is_running_in_container", return_value=True),
            patch.object(config, "_can_resolve_hostname", return_value=True),
        ):
            self._assert_ollama_base_url("http://host.docker.internal:11434/v1")

    def test_ollama_default_base_url_falls_back_to_container_gateway(self):
        """
        Native Linux Docker may not resolve host.docker.internal. The
        container's default gateway is used as the fallback address, which is
        more robust than returning an unresolvable hostname.
        """
        self._use_ollama_provider()

        with (
            patch.object(config, "is_running_in_container", return_value=True),
            patch.object(config, "_can_resolve_hostname", return_value=False),
            patch.object(config, "get_container_default_gateway_ip", return_value="172.17.0.1"),
        ):
            self._assert_ollama_base_url("http://172.17.0.1:11434/v1")

    def test_ollama_explicit_base_url_takes_precedence(self):
        """
        A user-configured ollama_base_url takes top precedence and is not
        affected by container detection.
        """
        self._use_ollama_provider(base_url="http://ollama:11434/v1")

        with patch.object(config, "is_running_in_container", return_value=True):
            self._assert_ollama_base_url("http://ollama:11434/v1")

    def test_mimo_provider_uses_openai_compatible_client(self):
        """
        MiMo's official API is compatible with the OpenAI Chat Completions
        protocol. A fake OpenAI client verifies the provider uses MiMo's
        dedicated config and default base_url, with no real network or
        private API key.
        """
        config.app["llm_provider"] = "mimo"
        config.app["mimo_api_key"] = "mimo-key"
        config.app["mimo_base_url"] = ""
        config.app["mimo_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nmimo")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="mimo-key",
            base_url="https://api.xiaomimimo.com/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "mimo-v2.5-pro",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello mimo")

    def test_azure_provider_uses_azure_client_directly(self):
        """
        Azure OpenAI auth, endpoint, and api-version are all handled by the
        AzureOpenAI client. This test covers issue #892: the azure branch
        must call the AzureOpenAI-built client directly and not fall through
        to the generic OpenAI-compatible branch, or the Azure-specific
        request config would be lost.
        """
        config.app["llm_provider"] = "azure"
        config.app["azure_api_key"] = "azure-key"
        config.app["azure_base_url"] = "https://example.openai.azure.com"
        config.app["azure_model_name"] = "gpt-4o-mini"
        config.app["azure_api_version"] = "2024-02-15-preview"

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nazure")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "AzureOpenAI", return_value=fake_client) as azure_client,
            patch.object(llm, "OpenAI") as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        azure_client.assert_called_once_with(
            api_key="azure-key",
            api_version="2024-02-15-preview",
            azure_endpoint="https://example.openai.azure.com",
        )
        openai_client.assert_not_called()
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello azure")

    def test_g4f_provider_requires_explicit_opt_in(self):
        """
        g4f carries supply-chain and stability risks: setting the provider to
        g4f must not load third-party packages and hit reverse-engineered
        endpoints by default — it requires explicit opt-in.
        """
        config.app["llm_provider"] = "g4f"
        config.app["enable_g4f"] = False

        result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("g4f provider is disabled", result)

    def test_g4f_provider_uses_lazy_import_after_opt_in(self):
        config.app["llm_provider"] = "g4f"
        config.app["enable_g4f"] = True
        config.app["g4f_model_name"] = "gpt-3.5-turbo"

        fake_g4f = types.SimpleNamespace()
        fake_g4f.ChatCompletion = types.SimpleNamespace(
            create=lambda **kwargs: "hello from g4f"
        )

        with patch.dict(sys.modules, {"g4f": fake_g4f}):
            result = llm._generate_response("test")

        self.assertEqual(result, "hello from g4f")

    def test_g4f_provider_reports_missing_optional_dependency(self):
        config.app["llm_provider"] = "g4f"
        config.app["enable_g4f"] = True
        config.app["g4f_model_name"] = "gpt-3.5-turbo"

        with patch.dict(sys.modules, {"g4f": None}):
            result = llm._generate_response("test")

        self.assertIn("Error:", result)
        self.assertIn("g4f package is not installed by default", result)

    def test_omniroute_provider_uses_openai_compatible_client(self):
        """
        OmniRoute is a local OpenAI-compatible gateway (Docker, port 20128).
        Without explicit config it must use the default endpoint, the "auto"
        model, and a placeholder api_key, since the gateway accepts keyless
        calls until the real providers are connected on the dashboard.
        """
        config.app["llm_provider"] = "omniroute"
        config.app["omniroute_api_key"] = ""
        config.app["omniroute_base_url"] = ""
        config.app["omniroute_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nomniroute")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="omniroute",
            base_url="http://localhost:20128/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "auto",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello omniroute")

    def test_zai_provider_uses_openai_compatible_client(self):
        """
        Z.ai (Zhipu GLM) exposes an OpenAI-compatible endpoint. Without
        base_url/model configured, it must use the defaults (api.z.ai +
        glm-5.3-flash) and the config.toml key.
        """
        config.app["llm_provider"] = "zai"
        config.app["zai_api_key"] = "zai-key"
        config.app["zai_base_url"] = ""
        config.app["zai_model_name"] = ""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nzai")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )

        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")

        openai_client.assert_called_once_with(
            api_key="zai-key",
            base_url="https://api.z.ai/api/paas/v4",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "glm-5.3-flash",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello zai")

    def _run_openrouter(self):
        """Run one openrouter generation against a fake OpenAI client."""

        class FakeCompletions:
            def create(self, **kwargs):
                self.kwargs = kwargs
                message = types.SimpleNamespace(content="hello\nopenrouter")
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        fake_completions = FakeCompletions()
        fake_client = types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=fake_completions)
        )
        with (
            patch.object(llm, "OpenAI", return_value=fake_client) as openai_client,
            patch.object(llm, "ChatCompletion", types.SimpleNamespace),
        ):
            result = llm._generate_response("Say hello")
        return result, openai_client, fake_completions

    def test_openrouter_provider_uses_defaults(self):
        """
        OpenRouter without explicit base_url/model must use the public
        endpoint default, the default model, and the config.toml key.
        """
        config.app["llm_provider"] = "openrouter"
        config.app["openrouter_api_key"] = "or-key"
        config.app["openrouter_base_url"] = ""
        config.app["openrouter_model_name"] = ""
        config.app["openrouter_site_url"] = ""
        config.app["openrouter_app_name"] = ""

        result, openai_client, fake_completions = self._run_openrouter()

        openai_client.assert_called_once_with(
            api_key="or-key",
            base_url="https://openrouter.ai/api/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
            default_headers=None,
        )
        self.assertEqual(
            fake_completions.kwargs,
            {
                "model": "openai/gpt-4o-mini",
                "messages": [{"role": "user", "content": "Say hello"}],
            },
        )
        self.assertEqual(result, "hello openrouter")

    def test_openrouter_provider_sends_attribution_headers(self):
        """
        OpenRouter attribution headers (HTTP-Referer / X-Title) are only
        sent when configured — they identify the app in the dashboard.
        """
        config.app["llm_provider"] = "openrouter"
        config.app["openrouter_api_key"] = "or-key"
        config.app["openrouter_base_url"] = ""
        config.app["openrouter_model_name"] = "openai/gpt-4o"
        config.app["openrouter_site_url"] = "https://post-engineer.com"
        config.app["openrouter_app_name"] = "Post Engineer"

        _, openai_client, _ = self._run_openrouter()

        openai_client.assert_called_once_with(
            api_key="or-key",
            base_url="https://openrouter.ai/api/v1",
            timeout=llm.LLM_CLIENT_TIMEOUT_SECONDS,
            max_retries=llm.LLM_CLIENT_MAX_RETRIES,
            default_headers={
                "HTTP-Referer": "https://post-engineer.com",
                "X-Title": "Post Engineer",
            },
        )

    def test_default_provider_is_omniroute(self):
        """
        Without an explicit llm_provider, the engine defaults to the local
        OmniRoute gateway (the primary), not OpenAI.
        """
        config.app.pop("llm_provider", None)
        config.app["openrouter_api_key"] = "or-key"

        with patch.object(
            llm, "_generate_response_inner", return_value="ok"
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        generate.assert_called_once_with("test", "omniroute")
        self.assertEqual(result, "ok")

    def test_fallback_to_openrouter_triggers_on_any_error(self):
        """
        The OpenRouter fallback must cover any primary-provider failure —
        including non-retryable errors like a 401 from an invalid key. The
        provider is passed as an explicit argument on every call.
        """
        config.app["llm_provider"] = "omniroute"
        config.app["openrouter_api_key"] = "or-key"

        with patch.object(
            llm,
            "_generate_response_inner",
            side_effect=[Exception("401 invalid api key"), "script from openrouter"],
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        self.assertEqual(result, "script from openrouter")
        self.assertEqual(generate.call_count, 2)
        generate.assert_any_call("test", "omniroute")
        generate.assert_any_call("test", "openrouter")
        self.assertEqual(config.app["llm_provider"], "omniroute")

    def test_fallback_does_not_mutate_global_provider_config(self):
        """
        Race-condition regression: concurrent requests share config.app.
        The fallback must pass the provider as an argument instead of
        mutating global state — mutating would make a parallel request read
        "openrouter" as the primary provider and lose its own fallback.
        """
        config.app["llm_provider"] = "omniroute"
        config.app["openrouter_api_key"] = "or-key"

        with patch.object(
            llm,
            "_generate_response_inner",
            side_effect=[Exception("boom"), "recovered"],
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        self.assertEqual(result, "recovered")
        self.assertEqual(
            generate.call_args_list,
            [call("test", "omniroute"), call("test", "openrouter")],
        )
        self.assertEqual(config.app["llm_provider"], "omniroute")

    def test_successful_response_with_error_prefix_is_not_retried(self):
        """
        False-positive regression: a valid model response starting with
        "Error: " is not a failure — it must not trigger the fallback nor
        be replaced by another generation.
        """
        config.app["llm_provider"] = "omniroute"
        config.app["openrouter_api_key"] = "or-key"

        with patch.object(
            llm,
            "_generate_response_inner",
            return_value="Error: this is a legit model answer",
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        self.assertEqual(result, "Error: this is a legit model answer")
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(config.app["llm_provider"], "omniroute")

    def test_fallback_skipped_when_primary_provider_is_openrouter(self):
        """
        If OpenRouter is already the primary provider, repeating the same call
        on the fallback wouldn't fix the error — it would only double cost
        and latency.
        """
        config.app["llm_provider"] = "openrouter"
        config.app["openrouter_api_key"] = "or-key"

        with patch.object(
            llm,
            "_generate_response_inner",
            side_effect=Exception("connection refused"),
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        self.assertEqual(result, "Error: connection refused")
        self.assertEqual(generate.call_count, 1)
        generate.assert_called_once_with("test", "openrouter")
        self.assertEqual(config.app["llm_provider"], "openrouter")

    def test_fallback_skipped_without_openrouter_api_key(self):
        config.app["llm_provider"] = "omniroute"
        config.app["openrouter_api_key"] = ""

        with patch.object(
            llm,
            "_generate_response_inner",
            side_effect=Exception("gateway unreachable"),
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        self.assertEqual(result, "Error: gateway unreachable")
        self.assertEqual(generate.call_count, 1)
        generate.assert_called_once_with("test", "omniroute")
        self.assertEqual(config.app["llm_provider"], "omniroute")

    def test_fallback_returns_openrouter_error_when_both_fail(self):
        """
        If OpenRouter (the fallback) fails too, its error is returned — no
        loop, and no masking that the whole call failed.
        """
        config.app["llm_provider"] = "omniroute"
        config.app["openrouter_api_key"] = "or-key"

        with patch.object(
            llm,
            "_generate_response_inner",
            side_effect=[Exception("primary down"), Exception("openrouter down")],
        ) as generate:
            result = llm._generate_response_with_fallback("test")

        self.assertEqual(result, "Error: openrouter down")
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(config.app["llm_provider"], "omniroute")


class TestRuntimeEnvironmentDetection(unittest.TestCase):
    def test_container_detection_ignores_plain_linux_cgroup_file(self):
        """
        Plain Linux also has /proc/1/cgroup — its mere existence must not
        imply a container.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            cgroup_path = Path(tmp_dir) / "cgroup"
            cgroup_path.write_text("0::/init.scope\n", encoding="utf-8")

            self.assertFalse(
                config.is_running_in_container(
                    dockerenv_path=str(Path(tmp_dir) / "missing-dockerenv"),
                    containerenv_path=str(Path(tmp_dir) / "missing-containerenv"),
                    cgroup_path=str(cgroup_path),
                )
            )

    def test_container_detection_accepts_dockerenv_marker(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            dockerenv_path = Path(tmp_dir) / ".dockerenv"
            dockerenv_path.write_text("", encoding="utf-8")

            self.assertTrue(
                config.is_running_in_container(
                    dockerenv_path=str(dockerenv_path),
                    containerenv_path=str(Path(tmp_dir) / "missing-containerenv"),
                    cgroup_path=str(Path(tmp_dir) / "missing-cgroup"),
                )
            )

    def test_container_detection_accepts_cgroup_container_marker(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            cgroup_path = Path(tmp_dir) / "cgroup"
            cgroup_path.write_text(
                "0::/system.slice/docker-abcdef.scope\n",
                encoding="utf-8",
            )

            self.assertTrue(
                config.is_running_in_container(
                    dockerenv_path=str(Path(tmp_dir) / "missing-dockerenv"),
                    containerenv_path=str(Path(tmp_dir) / "missing-containerenv"),
                    cgroup_path=str(cgroup_path),
                )
            )

    def test_container_gateway_ip_decodes_default_route(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            route_path = Path(tmp_dir) / "route"
            route_path.write_text(
                "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n"
                "eth0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0\n",
                encoding="utf-8",
            )

            self.assertEqual(
                config.get_container_default_gateway_ip(str(route_path)),
                "172.17.0.1",
            )

    def test_container_gateway_ip_ignores_missing_default_route(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            route_path = Path(tmp_dir) / "route"
            route_path.write_text(
                "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n"
                "eth0\t0011AC0A\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n",
                encoding="utf-8",
            )

            self.assertEqual(config.get_container_default_gateway_ip(str(route_path)), "")


class TestSocialMetadata(unittest.TestCase):
    """Generic short-video publishing copy metadata generation."""

    def test_build_prompt_auto_language_uses_source_language(self):
        """
        With language left at the auto default, don't pin it to a country or
        language — let the model follow the video subject and script's
        language, widening the API's applicability.
        """
        prompt = llm.build_social_metadata_prompt(
            video_subject="上海一日游",
            video_script="今天带你快速看完上海经典路线。",
            language="auto",
            platform="tiktok",
        )

        self.assertIn("TikTok", prompt)
        self.assertIn("Use the same language as the video subject and script", prompt)
        self.assertIn("上海一日游", prompt)
        self.assertIn("array of exactly 5 strings", prompt)

    def test_build_prompt_accepts_explicit_language(self):
        prompt = llm.build_social_metadata_prompt(
            video_subject="Coffee tips",
            language="en-US",
            platform="youtube_shorts",
        )

        self.assertIn("YouTube Shorts", prompt)
        self.assertIn('Write "title" and "caption" in this language: en-US', prompt)
        self.assertIn("array of exactly 3 strings", prompt)

    def test_unknown_platform_falls_back_to_tiktok(self):
        prompt = llm.build_social_metadata_prompt(
            video_subject="x",
            platform="unsupported-platform",
        )

        self.assertIn("TikTok", prompt)

    def test_normalize_hashtags_from_string_dedupes_and_clamps(self):
        tags = llm._normalize_hashtags("#fyp fyp, trending #Trending viral", count=2)

        self.assertEqual(tags, ["#fyp", "#trending"])

    def test_normalize_hashtags_from_list_keeps_unicode_letters(self):
        tags = llm._normalize_hashtags(
            ["上海 旅行", "#việt nam", "  ", "@bad!chars"], count=5
        )

        self.assertEqual(tags, ["#上海旅行", "#việtnam", "#badchars"])

    def test_parse_social_metadata_recovers_embedded_json(self):
        raw = 'Sure: {"title":"T","caption":"C","hashtags":["#x"]} thanks'
        result = llm._parse_social_metadata(raw, "tiktok")

        self.assertEqual(result["title"], "T")
        self.assertEqual(result["caption"], "C")
        self.assertEqual(result["hashtags"], ["#x"])

    def test_parse_social_metadata_requires_title_or_caption(self):
        with self.assertRaises(ValueError):
            llm._parse_social_metadata('{"hashtags":["#x"]}', "tiktok")

    def test_generate_social_metadata_uses_llm_response(self):
        payload = (
            '{"title":"上海一日游","caption":"收藏这条路线，下次直接出发！",'
            '"hashtags":["#上海","#旅行","#shorts"]}'
        )
        with patch.object(llm, "_generate_response_inner", return_value=payload):
            result = llm.generate_social_metadata(
                video_subject="上海一日游",
                video_script="今天带你快速看完上海经典路线。",
                language="zh-CN",
                platform="tiktok",
            )

        self.assertEqual(result["title"], "上海一日游")
        self.assertEqual(result["caption"], "收藏这条路线，下次直接出发！")
        self.assertEqual(result["hashtags"], ["#上海", "#旅行", "#shorts"])

    def test_generate_social_metadata_falls_back_to_generic_hashtags(self):
        with patch.object(
            llm, "_generate_response_with_fallback", return_value="Error: api_key is not set"
        ):
            result = llm.generate_social_metadata(
                video_subject="Coffee tips",
                video_script="Save these three coffee tips.",
                platform="instagram_reels",
            )

        self.assertEqual(result["title"], "Coffee tips")
        self.assertEqual(result["caption"], "Save these three coffee tips.")
        self.assertEqual(len(result["hashtags"]), 8)
        self.assertEqual(result["hashtags"][0], "#shorts")

    def test_request_model_defaults_to_auto_language_tiktok(self):
        body = VideoSocialMetadataRequest(video_subject="Test")

        self.assertEqual(body.language, "auto")
        self.assertEqual(body.platform, "tiktok")

    def test_request_model_rejects_oversized_social_metadata_fields(self):
        """
        External APIs can't accept unbounded script and language params, or
        LLM token costs multiply directly. The schema layer intercepts
        first; the service layer guards internal calls as a backstop.
        """
        with self.assertRaises(ValidationError):
            VideoSocialMetadataRequest(video_subject="x" * 501)

        with self.assertRaises(ValidationError):
            VideoSocialMetadataRequest(video_subject="x", video_script="x" * 8001)

        with self.assertRaises(ValidationError):
            VideoSocialMetadataRequest(video_subject="x", language="x" * 65)

    def test_build_prompt_clamps_direct_service_inputs(self):
        prompt = llm.build_social_metadata_prompt(
            video_subject="x" * 600,
            video_script="y" * 9000,
            language="en",
        )

        self.assertIn("x" * llm.MAX_SOCIAL_SUBJECT_LENGTH, prompt)
        self.assertNotIn("x" * (llm.MAX_SOCIAL_SUBJECT_LENGTH + 1), prompt)
        self.assertIn("y" * llm.MAX_SOCIAL_SCRIPT_LENGTH, prompt)
        self.assertNotIn("y" * (llm.MAX_SOCIAL_SCRIPT_LENGTH + 1), prompt)

    def test_social_metadata_endpoint_response_shape(self):
        from fastapi.testclient import TestClient

        from app.asgi import app

        request_body = {
            "video_subject": "Tokyo coffee shops",
            "video_script": "Three quiet coffee shops for your next Tokyo morning.",
            "language": "en",
            "platform": "youtube_shorts",
        }
        llm_response = (
            '{"title":"3 Quiet Tokyo Coffee Shops",'
            '"caption":"Save these spots for your next Tokyo morning.",'
            '"hashtags":["#Tokyo","#Coffee","#Shorts"]}'
        )

        with patch.object(llm, "_generate_response_with_fallback", return_value=llm_response):
            response = TestClient(app, headers=_auth_headers()).post(
                "/api/v1/social-metadata",
                json=request_body,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": 200,
                "message": "success",
                "data": {
                    "title": "3 Quiet Tokyo Coffee Shops",
                    "caption": "Save these spots for your next Tokyo morning.",
                    "hashtags": ["#Tokyo", "#Coffee", "#Shorts"],
                },
            },
        )


FOUNDRY_KEY = os.environ.get("ANTHROPIC_FOUNDRY_API_KEY", "")
FOUNDRY_BASE = "https://amanrai-test-resource.services.ai.azure.com/anthropic"
FOUNDRY_MODEL = "azure_ai/claude-sonnet-4-6"


@unittest.skipUnless(
    RUN_INTEGRATION_TESTS and FOUNDRY_KEY,
    "MPT_RUN_INTEGRATION_TESTS and ANTHROPIC_FOUNDRY_API_KEY not set",
)
class TestLiteLLMLiveIntegration(unittest.TestCase):
    def setUp(self):
        self.original_app_config = dict(config.app)
        config.app["llm_provider"] = "litellm"
        config.app["litellm_model_name"] = FOUNDRY_MODEL
        os.environ["AZURE_AI_API_KEY"] = FOUNDRY_KEY
        os.environ["AZURE_AI_API_BASE"] = FOUNDRY_BASE

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app_config)

    def test_live_litellm_completion(self):
        result = llm._generate_response("What is 2+2? Reply with just the number.")

        self.assertNotIn("Error:", result)
        self.assertIn("4", result)


class TestCloudflareResultLogging(unittest.TestCase):
    """Only a redacted size-level summary is logged for the Cloudflare
    response; neither the raw result dict nor its nested credentials may
    reach the logs."""

    def test_cloudflare_result_log_redacts_nested_secrets(self):
        fake_result = {
            "result": {"response": "hello"},
            "meta": {"access_token": "CF-SECRET-TOKEN"},
        }
        fake_response = types.SimpleNamespace(json=lambda: fake_result)
        with (
            patch.dict(
                config.app,
                {
                    "cloudflare_api_key": "k",
                    "cloudflare_model_name": "m",
                    "cloudflare_account_id": "a",
                },
            ),
            patch.object(llm.requests, "post", return_value=fake_response),
            patch.object(llm, "logger") as mock_logger,
        ):
            text = llm._generate_response_inner("Say hello", "cloudflare")

        self.assertEqual(text, "hello")
        logged = " ".join(
            str(arg)
            for call in mock_logger.info.call_args_list
            for arg in call.args
        )
        # Neither the secret nor the generated content may appear in the logs.
        self.assertNotIn("CF-SECRET-TOKEN", logged)
        self.assertNotIn("hello", logged)

    def test_ernie_access_token_not_embedded_in_logged_url(self):
        # The token must travel as a request param, never inside a URL string
        # that could be logged.
        token_response = types.SimpleNamespace(
            json=lambda: {"access_token": "ERNIE-SECRET-TOKEN"}
        )
        chat_response = types.SimpleNamespace(json=lambda: {"result": "hi"})

        posted = {}

        def fake_request(method, url, **kwargs):
            posted["url"] = url
            posted["params"] = kwargs.get("params")
            return chat_response

        with (
            patch.dict(
                config.app,
                {
                    "ernie_api_key": "k",
                    "ernie_secret_key": "s",
                    "ernie_base_url": "https://example.test/rpc",
                },
            ),
            patch.object(
                llm.requests, "post", return_value=token_response
            ),
            patch.object(llm.requests, "request", side_effect=fake_request),
        ):
            llm._generate_response_inner("Say hello", "ernie")

        self.assertNotIn("ERNIE-SECRET-TOKEN", posted["url"])
        self.assertEqual(
            posted["params"], {"access_token": "ERNIE-SECRET-TOKEN"}
        )


if __name__ == "__main__":
    unittest.main()
