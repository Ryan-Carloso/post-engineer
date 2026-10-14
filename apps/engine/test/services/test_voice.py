import asyncio
import subprocess
import os
import unittest
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

# add project root to python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.utils import utils
from app.services import voice as vs
from app.services import voice_common
from app.services import voice_fishaudio

temp_dir = utils.storage_dir("temp")

text_en = """
What is the meaning of life? 
This question has puzzled philosophers, scientists, and thinkers of all kinds for centuries. 
Throughout history, various cultures and individuals have come up with their interpretations and beliefs around the purpose of life. 
Some say it's to seek happiness and self-fulfillment, while others believe it's about contributing to the welfare of others and making a positive impact in the world. 
Despite the myriad of perspectives, one thing remains clear: the meaning of life is a deeply personal concept that varies from one person to another. 
It's an existential inquiry that encourages us to reflect on our values, desires, and the essence of our existence.
"""

text_zh = """
预计未来3天深圳冷空气活动频繁，未来两天持续阴天有小雨，出门带好雨具；
10-11日持续阴天有小雨，日温差小，气温在13-17℃之间，体感阴凉；
12日天气短暂好转，早晚清凉；
"""

voice_rate=1.0
voice_volume=1.0
RUN_INTEGRATION_TESTS = os.environ.get("MPT_RUN_INTEGRATION_TESTS", "").lower() in {
    "1",
    "true",
    "yes",
}


def _sub_maker(fragments: list[str], *end_seconds: float) -> "vs.SubMaker":
    """A SubMaker carrying the sentences a provider actually spoke.

    Real shape since edge_tts went away: fragments in `subs`, their
    (start, end) positions in 100ns units in `offset`. The previous tests
    hand-rolled a `cues` namespace, which no provider ever populated.
    """
    sub_maker = vs.SubMaker()
    sub_maker.subs = list(fragments)
    starts = [0.0] + list(end_seconds[:-1])
    sub_maker.offset = [
        (int(start * vs.SUB_TIME_UNITS_PER_SECOND), int(end * vs.SUB_TIME_UNITS_PER_SECOND))
        for start, end in zip(starts, end_seconds)
    ]
    return sub_maker


class TestVoiceService(unittest.TestCase):
    def setUp(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
    
    def tearDown(self):
        self.loop.close()



    def test_no_voice_tts_generates_silent_audio_and_subtitle_timeline(self):
        """
        无配音模式不调用任何外部 TTS provider，只生成静音音频作为时间轴占位。
        这里 mock FFmpeg，验证请求参数、输出文件和 legacy 字幕结构都符合后续
        视频合成链路的预期。
        """

        def fake_run(command, capture_output, text, check):
            self.assertEqual(command[0], "/tmp/fake-ffmpeg")
            self.assertIn("anullsrc=r=44100:cl=mono", command)
            Path(command[-1]).write_bytes(b"fake-silent-mp3")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as tmp_dir, patch.object(
            vs.utils,
            "get_ffmpeg_binary",
            return_value="/tmp/fake-ffmpeg",
        ), patch.object(vs.subprocess, "run", side_effect=fake_run):
            voice_file = str(Path(tmp_dir) / "silent.mp3")
            sub_maker = vs.tts(
                text="第一句话。Second sentence.",
                voice_name=vs.NO_VOICE_NAME,
                voice_rate=1.0,
                voice_file=voice_file,
            )

            self.assertEqual(Path(voice_file).read_bytes(), b"fake-silent-mp3")

        self.assertIsNotNone(sub_maker)
        self.assertEqual(getattr(sub_maker, "subs", []), ["第一句话", "Second sentence"])
        self.assertEqual(len(getattr(sub_maker, "offset", [])), 2)
        self.assertGreater(vs.get_audio_duration(sub_maker), 0)

    def test_no_voice_alias_none_is_supported_temporarily(self):
        """
        兼容 PR #981 曾使用过的 none sentinel，避免少量直接调用 API 的用户
        升级后立即失效。新 UI 和新代码仍统一使用 no-voice。
        """
        self.assertTrue(vs.is_no_voice("none"))
        self.assertTrue(vs.is_no_voice(vs.NO_VOICE_NAME))
        self.assertFalse(vs.is_no_voice(""))

    def test_no_voice_duration_estimates_non_ascii_languages(self):
        """
        无配音没有真实 TTS 音频，只能根据脚本文字估算阅读时间。俄语、阿拉伯语、
        日文假名、韩文等非 ASCII 文本也必须参与估算，不能都落到最短 3 秒。
        """
        russian_text = (
            "Это длинный тестовый сценарий без озвучки. "
            "Он должен получить достаточно времени для чтения субтитров."
        )
        arabic_text = "هذا اختبار طويل بدون تعليق صوتي، ويجب أن يحصل على وقت كاف لقراءة الترجمة."

        self.assertGreater(vs.estimate_no_voice_duration(russian_text), 8.0)
        self.assertGreater(vs.estimate_no_voice_duration(arabic_text), 8.0)

    def test_generate_silent_audio_rejects_missing_output_file(self):
        """
        即使 FFmpeg 进程返回成功，也要确认输出文件真实存在且非空。这样可以把
        异常收敛在 TTS 阶段，而不是拖到后续视频合成阶段才暴露。
        """
        with tempfile.TemporaryDirectory() as tmp_dir, patch.object(
            vs.utils,
            "get_ffmpeg_binary",
            return_value="/tmp/fake-ffmpeg",
        ), patch.object(
            vs.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout="", stderr=""),
        ):
            voice_file = str(Path(tmp_dir) / "missing-silent.mp3")

            self.assertFalse(vs.generate_silent_audio(3.0, voice_file))

    def test_empty_voice_name_fails_loud_instead_of_guessing(self):
        """
        An empty voice usually means a missing config or a bad API call. It
        must NOT fall into no-voice mode (which would ship a "successful"
        silent video) and it must NOT silently pick a provider: with
        azure_tts_v1 gone there is nothing to default to, so it fails.
        """
        result = vs.tts(
            text="empty voice should still use the default TTS path",
            voice_name="",
            voice_rate=1.0,
            voice_file="/tmp/empty-voice.mp3",
        )

        self.assertIsNone(result)

    def test_unknown_voice_name_fails_loud(self):
        """
        A voice id from a removed provider must not be routed anywhere. The old
        code fell through to azure_tts_v1, which turned a stale id into a
        silent edge-tts request that looked like a network failure.
        """
        for voice_name in (
            "calm",
            "pt-BR-FranciscaNeural",
            "en-US-JennyNeural-V2",
            "siliconflow:model:alex-Male",
            "gemini:Zephyr-Female",
            "mimo:voice-Male",
        ):
            with self.subTest(voice_name=voice_name):
                result = vs.tts(
                    text="qualquer texto",
                    voice_name=voice_name,
                    voice_rate=1.0,
                    voice_file="/tmp/unknown-voice.mp3",
                )
                self.assertIsNone(result)

    @unittest.skipUnless(
        RUN_INTEGRATION_TESTS,
        "MPT_RUN_INTEGRATION_TESTS not set",
    )
    def test_siliconflow(self):
        # SiliconFlow 的 API Key 存在 [siliconflow].api_key 中，运行时代码也是从
        # config.siliconflow 读取；这里必须使用同一配置源，避免正确配置凭据时
        # 测试仍然被误跳过。
        if not vs.config.siliconflow.get("api_key"):
            self.skipTest("siliconflow_api_key is not configured")

        voice_name = "siliconflow:FunAudioLLM/CosyVoice2-0.5B:alex-Male"
        voice_name = vs.parse_voice_name(voice_name)
        
        async def _do():
            parts = voice_name.split(":")
            if len(parts) >= 3:
                model = parts[1]
                # 移除性别后缀，例如 "alex-Male" -> "alex"
                voice_with_gender = parts[2]
                voice = voice_with_gender.split("-")[0]
                # 构建完整的voice参数，格式为 "model:voice"
                full_voice = f"{model}:{voice}"
                voice_file = f"{temp_dir}/tts-siliconflow-{voice}.mp3"
                subtitle_file = f"{temp_dir}/tts-siliconflow-{voice}.srt"
                sub_maker = vs.siliconflow_tts(
                    text=text_zh, model=model, voice=full_voice, voice_file=voice_file, voice_rate=voice_rate, voice_volume=voice_volume
                )
                if not sub_maker:
                    self.fail("siliconflow tts failed")
                vs.create_subtitle(sub_maker=sub_maker, text=text_zh, subtitle_file=subtitle_file)
                audio_duration = vs.get_audio_duration(sub_maker)
                print(f"voice: {voice_name}, audio duration: {audio_duration}s")
            else:
                self.fail("siliconflow invalid voice name")

        self.loop.run_until_complete(_do())
    
    @unittest.skipUnless(
        RUN_INTEGRATION_TESTS,
        "MPT_RUN_INTEGRATION_TESTS not set",
    )
    def test_azure_tts_v1(self):
        voice_name = "zh-CN-XiaoyiNeural-Female"
        voice_name = vs.parse_voice_name(voice_name)
        print(voice_name)
        
        voice_file = f"{temp_dir}/tts-azure-v1-{voice_name}.mp3"
        subtitle_file = f"{temp_dir}/tts-azure-v1-{voice_name}.srt"
        sub_maker = vs.azure_tts_v1(
            text=text_zh, voice_name=voice_name, voice_file=voice_file, voice_rate=voice_rate
        )
        if not sub_maker:
            self.fail("azure tts v1 failed")
        vs.create_subtitle(sub_maker=sub_maker, text=text_zh, subtitle_file=subtitle_file)
        audio_duration = vs.get_audio_duration(sub_maker)
        print(f"voice: {voice_name}, audio duration: {audio_duration}s")



    @unittest.skipUnless(
        RUN_INTEGRATION_TESTS,
        "MPT_RUN_INTEGRATION_TESTS not set",
    )
    def test_azure_tts_v2(self):
        if not vs.config.azure.get("speech_key") or not vs.config.azure.get("speech_region"):
            self.skipTest("Azure speech key or region is not configured")

        voice_name = "zh-CN-XiaoxiaoMultilingualNeural-V2-Female"
        voice_name = vs.parse_voice_name(voice_name)
        print(voice_name)

        async def _do():
            voice_file = f"{temp_dir}/tts-azure-v2-{voice_name}.mp3"
            subtitle_file = f"{temp_dir}/tts-azure-v2-{voice_name}.srt"
            sub_maker = vs.azure_tts_v2(
                text=text_zh, voice_name=voice_name, voice_file=voice_file
            )
            if not sub_maker:
                self.fail("azure tts v2 failed")
            vs.create_subtitle(sub_maker=sub_maker, text=text_zh, subtitle_file=subtitle_file)
            audio_duration = vs.get_audio_duration(sub_maker)
            print(f"voice: {voice_name}, audio duration: {audio_duration}s")

        self.loop.run_until_complete(_do())



    def test_chatterbox_voice_helpers(self):
        """is_chatterbox_voice / get_chatterbox_voices basics and normalisation."""
        self.assertTrue(vs.is_chatterbox_voice("chatterbox:default-Female"))
        self.assertFalse(vs.is_chatterbox_voice("elevenlabs:abc:Rachel"))
        self.assertFalse(vs.is_chatterbox_voice(""))
        self.assertFalse(vs.is_chatterbox_voice(None))

        # list entries are normalised to the chatterbox:<name> dispatcher format,
        # and entries that are already prefixed are left untouched
        with patch.object(
            vs.config,
            "chatterbox",
            {"voices": ["narrator-Male", "chatterbox:host"]},
        ):
            self.assertEqual(
                vs.get_chatterbox_voices(),
                ["chatterbox:narrator-Male", "chatterbox:host"],
            )

        # a comma-separated string is also accepted (TOML-friendly)
        with patch.object(vs.config, "chatterbox", {"voices": "alpha, beta ,"}):
            self.assertEqual(
                vs.get_chatterbox_voices(),
                ["chatterbox:alpha", "chatterbox:beta"],
            )

        # with nothing configured the dropdown still gets a usable default
        with patch.object(vs.config, "chatterbox", {}):
            self.assertEqual(vs.get_chatterbox_voices(), ["chatterbox:default-Female"])

    def test_chatterbox_tts_posts_to_openai_compatible_endpoint(self):
        """Success path: POST /audio/speech, write audio, return legacy SubMaker."""

        class _FakeResponse:
            status_code = 200
            content = b"RIFF-fake-wav"
            text = ""

        class _FakeClip:
            duration = 3.5

            def close(self):
                pass

        captured = {}

        def _fake_post(url, json=None, headers=None, timeout=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse()

        with tempfile.TemporaryDirectory() as tmp_dir, patch.object(
            vs.config,
            "chatterbox",
            {
                "base_url": "http://localhost:4123/v1/",
                "api_key": "secret",
                "model_id": "chatterbox",
            },
        ), patch.object(
            vs.requests, "post", side_effect=_fake_post
        ) as post, patch.object(
            vs, "AudioFileClip", return_value=_FakeClip()
        ):
            voice_file = str(Path(tmp_dir) / "chatterbox.mp3")
            sub_maker = vs.chatterbox_tts(
                text="Hello world. Second sentence.",
                voice="default",
                voice_file=voice_file,
                voice_rate=1.2,
                voice_volume=1.0,
            )
            generated_audio = Path(voice_file).read_bytes()

        post.assert_called_once()
        # trailing slash on base_url is stripped before appending /audio/speech
        self.assertEqual(captured["url"], "http://localhost:4123/v1/audio/speech")
        self.assertEqual(captured["json"]["model"], "chatterbox")
        self.assertEqual(captured["json"]["voice"], "default")
        self.assertEqual(captured["json"]["input"], "Hello world. Second sentence.")
        self.assertAlmostEqual(captured["json"]["speed"], 1.2)
        # api_key is forwarded as a bearer token
        self.assertEqual(captured["headers"].get("Authorization"), "Bearer secret")
        # volume is intentionally not part of the OpenAI speech payload
        self.assertNotIn("volume", captured["json"])
        self.assertEqual(generated_audio, b"RIFF-fake-wav")
        self.assertIsNotNone(sub_maker)
        self.assertTrue(getattr(sub_maker, "subs", []))

    def test_chatterbox_tts_requires_base_url(self):
        """Missing base_url short-circuits without any network call."""
        with patch.object(
            vs.config, "chatterbox", {"base_url": ""}
        ), patch.object(vs.requests, "post") as post:
            result = vs.chatterbox_tts(
                text="hi", voice="default", voice_file="unused.mp3"
            )
        self.assertIsNone(result)
        post.assert_not_called()

    def test_chatterbox_tts_returns_none_on_http_error(self):
        """A non-200 response is retried up to 3 times, then fails to None."""

        class _FakeResponse:
            status_code = 500
            content = b""
            text = "boom"

        with tempfile.TemporaryDirectory() as tmp_dir, patch.object(
            vs.config, "chatterbox", {"base_url": "http://localhost:4123/v1"}
        ), patch.object(
            vs.requests, "post", return_value=_FakeResponse()
        ) as post:
            voice_file = str(Path(tmp_dir) / "chatterbox.mp3")
            result = vs.chatterbox_tts(
                text="hi", voice="default", voice_file=voice_file
            )
        self.assertIsNone(result)
        self.assertEqual(post.call_count, 3)



    def test_chatterbox_success_is_returned_as_is(self):
        """A successful Chatterbox result is returned untouched.

        It used to then go through the edge-tts fallback; with edge_tts gone
        the result IS the answer, and no other provider may be consulted.
        """
        chatterbox_marker = vs.SubMaker()
        with tempfile.TemporaryDirectory() as tmp_dir, patch.object(
            vs.config, "chatterbox", {}
        ), patch.object(
            vs, "chatterbox_tts", return_value=chatterbox_marker
        ), patch.object(
            vs, "elevenlabs_tts"
        ) as elevenlabs:
            result = vs.tts(
                "hello world", "chatterbox:ryan", 1.0, str(Path(tmp_dir) / "v.mp3")
            )
        self.assertIs(result, chatterbox_marker)
        elevenlabs.assert_not_called()




    def test_script_split_keeps_thousand_separator_comma(self):
        """
        Edge TTS 会把 "1,000 years" 作为连续文本返回。脚本断句时不能把
        数字中间的英文逗号当成句子边界，否则字幕聚合会出现 issue #894
        里的 sub_items 数量少于 script_lines，并错误回退 Whisper。
        """
        text = (
            "It takes about 1,000 years for a single drop of water to finish "
            "the whole trip!"
        )

        self.assertEqual(
            utils.split_string_by_punctuations(text),
            [
                (
                    "It takes about 1,000 years for a single drop of water to finish "
                    "the whole trip"
                )
            ],
        )


    def test_script_split_supports_arabic_punctuation(self):
        """
        阿拉伯语脚本常用 ، ؛ ؟ 作为自然断句标点。断句阶段必须识别这些
        标点，否则 edge-tts cue 的停顿边界和脚本行边界会错位。
        """
        text = "مرحبا بالعالم، كيف حالك؟ هذا اختبار؛ يعمل بشكل جيد."

        self.assertEqual(
            utils.split_string_by_punctuations(text),
            [
                "مرحبا بالعالم",
                "كيف حالك",
                "هذا اختبار",
                "يعمل بشكل جيد",
            ],
        )

    def test_match_script_line_normalizes_arabic_letter_forms(self):
        """
        edge-tts 可能把阿拉伯语中的不同字母形态归一化，或返回带变音符号、
        Tatweel 的 cue 文本。匹配时应容错，但最终字幕仍保留原始脚本文案。
        """
        script_lines = ["أهلاً وسهلاً بك في المدرسة"]

        matched = vs._match_script_line(
            script_lines,
            "اهلا وسهلا بك في المدرسه",
            0,
        )

        self.assertEqual(matched, script_lines[0])


    def test_create_subtitle_ignores_markdown_separator_lines(self):
        """
        用户手动脚本可能包含 `---` 这类 Markdown 分隔符。TTS 不会朗读
        这些符号行，字幕聚合也不应把它们当成目标字幕行，否则后续真实
        字幕会卡住并回退到 Whisper。
        """
        text = "第一段\n---\n第二段"
        sub_maker = _sub_maker(["第一段", "第二段"], 0.8, 1.8)

        with tempfile.TemporaryDirectory() as tmp_dir:
            subtitle_file = Path(tmp_dir) / "subtitle.srt"
            vs.create_subtitle(
                sub_maker=sub_maker,
                text=text,
                subtitle_file=str(subtitle_file),
            )

            subtitle_content = subtitle_file.read_text(encoding="utf-8")

        self.assertIn("第一段", subtitle_content)
        self.assertIn("第二段", subtitle_content)
        self.assertNotIn("---", subtitle_content)
        self.assertNotIn("00:00:00,000 --> 00:00:00,000", subtitle_content)

    def test_create_subtitle_ignores_markdown_underscore_marks(self):
        """
        `_` 常被用户用作 Markdown 强调标记，但 TTS 返回的 cue 通常不包含
        这些格式符。匹配时应忽略 `_`，避免生成空字幕或回退到 Whisper。
        """
        text = "这是_a_测试。"
        sub_maker = _sub_maker(["这是a测试"], 0.8)

        with tempfile.TemporaryDirectory() as tmp_dir:
            subtitle_file = Path(tmp_dir) / "subtitle.srt"
            vs.create_subtitle(
                sub_maker=sub_maker,
                text=text,
                subtitle_file=str(subtitle_file),
            )

            subtitle_content = subtitle_file.read_text(encoding="utf-8")

        self.assertIn("这是a测试", subtitle_content)
        self.assertNotIn("这是_a_测试", subtitle_content)
        self.assertNotIn("00:00:00,000 --> 00:00:00,000", subtitle_content)






if __name__ == "__main__":
    # python -m unittest test.services.test_voice.TestVoiceService.test_azure_tts_v1
    # python -m unittest test.services.test_voice.TestVoiceService.test_azure_tts_v2
    unittest.main() 




class TestGetAudioDuration(unittest.TestCase):
    """get_audio_duration must accept any audio file, not just .mp3.

    Regression: a custom_audio_file ending in .wav hit the "Invalid target
    type" branch and failed the whole task (caught by
    test_video_pipeline_e2e).
    """

    def _make_audio(self, path: Path, ext: str) -> Path:
        out = path / f"dur-test.{ext}"
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                str(out),
            ],
            check=True, capture_output=True,
        )
        return out

    def test_wav_file_returns_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            wav = self._make_audio(Path(tmp), "wav")
            self.assertGreater(vs.get_audio_duration(str(wav)), 0)

    def test_mp3_file_still_returns_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            mp3 = self._make_audio(Path(tmp), "mp3")
            self.assertGreater(vs.get_audio_duration(str(mp3)), 0)


class TestElevenLabsVoice(unittest.TestCase):

    def test_is_elevenlabs_voice_true(self):
        self.assertTrue(vs.is_elevenlabs_voice("elevenlabs:pNInz6obpgDQGcFmaJgB:Adam"))

    def test_is_elevenlabs_voice_false_azure(self):
        self.assertFalse(vs.is_elevenlabs_voice("zh-CN-XiaoxiaoNeural-Female"))

    def test_is_elevenlabs_voice_false_siliconflow(self):
        self.assertFalse(vs.is_elevenlabs_voice("siliconflow:model:voice-Male"))

    def test_is_elevenlabs_voice_empty(self):
        self.assertFalse(vs.is_elevenlabs_voice(""))

    def test_is_elevenlabs_voice_none(self):
        self.assertFalse(vs.is_elevenlabs_voice(None))

    def test_get_elevenlabs_voices_empty_api_key(self):
        result = vs.get_elevenlabs_voices("")
        self.assertEqual(result, [])

    @patch("app.services.voice.requests.get")
    def test_get_elevenlabs_voices_success(self, mock_get):
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "voices": [
                {"voice_id": "abc123", "name": "Adam"},
                {"voice_id": "def456", "name": "Rachel"},
            ]
        }
        result = vs.get_elevenlabs_voices("fake-api-key")
        self.assertEqual(result, [
            "elevenlabs:abc123:Adam",
            "elevenlabs:def456:Rachel",
        ])
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        self.assertIn("xi-api-key", call_kwargs.kwargs.get("headers", {}))

    @patch("app.services.voice.requests.get")
    def test_get_elevenlabs_voices_http_error(self, mock_get):
        mock_get.return_value.status_code = 401
        mock_get.return_value.text = "Unauthorized"
        result = vs.get_elevenlabs_voices("bad-key")
        self.assertEqual(result, [])

    @patch("app.services.voice.requests.get")
    def test_get_elevenlabs_voices_network_error(self, mock_get):
        import requests as req_lib
        mock_get.side_effect = req_lib.exceptions.ConnectionError("timeout")
        result = vs.get_elevenlabs_voices("fake-key")
        self.assertEqual(result, [])

    @patch("app.services.voice.requests.post")
    @patch("app.services.voice.AudioFileClip")
    @patch("app.services.voice.config")
    def test_elevenlabs_tts_success(self, mock_config, mock_clip_cls, mock_post):
        mock_config.elevenlabs.get.return_value = "fake-api-key"
        mock_post.return_value.status_code = 200
        mock_post.return_value.content = b"fake-mp3-bytes"
        mock_clip_cls.return_value.duration = 3.0
        mock_clip_cls.return_value.close = lambda: None

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            out_path = f.name

        try:
            result = vs.elevenlabs_tts("Hello world", "abc123", out_path)
            self.assertIsNotNone(result)
            self.assertTrue(hasattr(result, "subs"))
            self.assertTrue(hasattr(result, "offset"))
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)

    @patch("app.services.voice.config")
    def test_elevenlabs_tts_no_api_key(self, mock_config):
        mock_config.elevenlabs.get.return_value = ""
        result = vs.elevenlabs_tts("Hello", "abc123", "/tmp/test.mp3")
        self.assertIsNone(result)

    @patch("app.services.voice.config")
    def test_elevenlabs_tts_empty_text(self, mock_config):
        mock_config.elevenlabs.get.return_value = "fake-key"
        result = vs.elevenlabs_tts("  ", "abc123", "/tmp/test.mp3")
        self.assertIsNone(result)


class TestFishAudioVoice(unittest.TestCase):
    """Fish Audio TTS provider (API-key based, like ElevenLabs)."""

    def test_is_fishaudio_voice_true(self):
        self.assertTrue(vs.is_fishaudio_voice("fishaudio:abc123:Narrator"))
        self.assertTrue(vs.is_fishaudio_voice("fishaudio:abc123"))

    def test_is_fishaudio_voice_false(self):
        self.assertFalse(vs.is_fishaudio_voice("elevenlabs:abc:Rachel"))
        self.assertFalse(vs.is_fishaudio_voice("chatterbox:default"))
        self.assertFalse(vs.is_fishaudio_voice(""))

    def test_is_fishaudio_voice_none(self):
        self.assertFalse(vs.is_fishaudio_voice(None))

    def test_get_fishaudio_voices_empty_api_key(self):
        self.assertEqual(voice_fishaudio.get_fishaudio_voices(""), [])

    @patch("app.services.voice_fishaudio.requests.get")
    def test_get_fishaudio_voices_success(self, mock_get):
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "total": 3,
            "items": [
                {"_id": "abc123", "title": "Narrator", "type": "tts", "state": "trained"},
                # still training: not usable yet
                {"_id": "def456", "title": "WIP", "type": "tts", "state": "training"},
                # SVC models are not TTS voices
                {"_id": "ghi789", "title": "Singer", "type": "svc", "state": "trained"},
            ],
        }
        result = voice_fishaudio.get_fishaudio_voices("fake-api-key")
        self.assertEqual(result, ["fishaudio:abc123:Narrator"])
        mock_get.assert_called_once()
        call = mock_get.call_args
        self.assertEqual(call.args[0], "https://api.fish.audio/model")
        self.assertEqual(
            call.kwargs["headers"]["Authorization"], "Bearer fake-api-key"
        )
        self.assertEqual(call.kwargs["params"]["self"], "true")

    @patch("app.services.voice_fishaudio.requests.get")
    def test_get_fishaudio_voices_http_error(self, mock_get):
        mock_get.return_value.status_code = 401
        mock_get.return_value.text = "Unauthorized"
        self.assertEqual(voice_fishaudio.get_fishaudio_voices("bad-key"), [])

    @patch("app.services.voice_fishaudio.requests.get")
    def test_get_fishaudio_voices_network_error(self, mock_get):
        import requests as req_lib

        mock_get.side_effect = req_lib.exceptions.ConnectionError("timeout")
        self.assertEqual(voice_fishaudio.get_fishaudio_voices("fake-key"), [])

    @patch("app.services.voice_fishaudio.requests.post")
    @patch("app.services.voice_fishaudio.AudioFileClip")
    @patch("app.services.voice_fishaudio.config")
    def test_fishaudio_tts_success(self, mock_config, mock_clip_cls, mock_post):
        def _cfg_get(key, default=""):
            return {"api_key": "fake-api-key", "model_id": "drama-3"}.get(key, default)

        mock_config.fishaudio.get.side_effect = _cfg_get
        mock_clip_cls.return_value.duration = 3.0
        mock_clip_cls.return_value.close = lambda: None

        captured = {}

        class _FakeResponse:
            status_code = 200
            content = b"fake-mp3-bytes"
            text = ""

        def _fake_post(url, json=None, headers=None, timeout=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse()

        mock_post.side_effect = _fake_post

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            out_path = f.name

        try:
            result = vs.fishaudio_tts("Hello world", "abc123", out_path)
            self.assertIsNotNone(result)
            self.assertTrue(hasattr(result, "subs"))
            self.assertTrue(hasattr(result, "offset"))
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)

        self.assertEqual(captured["url"], "https://api.fish.audio/v1/tts")
        self.assertEqual(
            captured["headers"]["Authorization"], "Bearer fake-api-key"
        )
        # the model travels in a header, not in the JSON body
        self.assertEqual(captured["headers"]["model"], "drama-3")
        self.assertEqual(captured["json"]["text"], "Hello world")
        self.assertEqual(captured["json"]["reference_id"], "abc123")
        self.assertEqual(captured["json"]["format"], "mp3")

    @patch("app.services.voice_fishaudio.config")
    def test_fishaudio_tts_no_api_key(self, mock_config):
        mock_config.fishaudio.get.return_value = ""
        self.assertIsNone(vs.fishaudio_tts("Hello", "abc123", "/tmp/test.mp3"))

    @patch("app.services.voice_fishaudio.config")
    def test_fishaudio_tts_empty_text(self, mock_config):
        mock_config.fishaudio.get.return_value = "fake-key"
        self.assertIsNone(vs.fishaudio_tts("  ", "abc123", "/tmp/test.mp3"))

    @patch("app.services.voice_fishaudio.requests.post")
    @patch("app.services.voice_fishaudio.config")
    def test_fishaudio_tts_non_retryable_401(self, mock_config, mock_post):
        mock_config.fishaudio.get.side_effect = (
            lambda k, d="": {"api_key": "bad-key", "model_id": "drama-3"}.get(k, d)
        )
        mock_post.return_value.status_code = 401
        mock_post.return_value.text = "Unauthorized"
        self.assertIsNone(vs.fishaudio_tts("Hello", "abc123", "/tmp/test.mp3"))
        # auth failures must not be retried
        mock_post.assert_called_once()

    @patch("app.services.voice_fishaudio.requests.post")
    @patch("app.services.voice_fishaudio.config")
    def test_fishaudio_tts_retryable_500_retries_three_times(self, mock_config, mock_post):
        mock_config.fishaudio.get.side_effect = (
            lambda k, d="": {"api_key": "fake-key", "model_id": "drama-3"}.get(k, d)
        )
        mock_post.return_value.status_code = 500
        mock_post.return_value.text = "Internal Server Error"
        self.assertIsNone(vs.fishaudio_tts("Hello", "abc123", "/tmp/test.mp3"))
        # retryable failures are retried, not failed fast
        self.assertEqual(mock_post.call_count, 3)

    @patch("app.services.voice_fishaudio.requests.post")
    @patch("app.services.voice_fishaudio.config")
    def test_fishaudio_tts_network_error_retries_three_times(self, mock_config, mock_post):
        import requests as req_lib

        mock_config.fishaudio.get.side_effect = (
            lambda k, d="": {"api_key": "fake-key", "model_id": "drama-3"}.get(k, d)
        )
        mock_post.side_effect = req_lib.exceptions.ConnectionError("timeout")
        self.assertIsNone(vs.fishaudio_tts("Hello", "abc123", "/tmp/test.mp3"))
        self.assertEqual(mock_post.call_count, 3)

    @patch("app.services.voice.fishaudio_tts")
    def test_tts_dispatches_fishaudio(self, mock_fish):
        mock_fish.return_value = "submaker"
        result = vs.tts("Hello", "fishaudio:abc123:Narrator", 1.0, "/tmp/x.mp3")
        self.assertEqual(result, "submaker")
        mock_fish.assert_called_once()
        # the display title is stripped; only the voice id reaches the provider
        self.assertEqual(mock_fish.call_args.args[1], "abc123")

    def test_tts_invalid_fishaudio_format(self):
        self.assertIsNone(vs.tts("Hello", "fishaudio:", 1.0, "/tmp/x.mp3"))


class TestVoiceCommon(unittest.TestCase):
    """Shared voice helpers (app.services.voice_common)."""

    def test_preprocess_empty_text(self):
        self.assertEqual(voice_common.preprocess_text_for_tts(""), "")

    def test_preprocess_protects_abbreviations(self):
        # abbreviation periods survive the placeholder round-trip with
        # their original capitalization intact
        self.assertEqual(
            voice_common.preprocess_text_for_tts("fale com o sr. silva, etc. ok"),
            "fale com o sr. silva, etc. ok",
        )

    def test_populate_blank_text_yields_no_subtitles(self):
        sub_maker = voice_common.populate_legacy_submaker_with_full_text(
            voice_common.SubMaker(), "   ", 5.0
        )
        self.assertEqual(sub_maker.subs, [])
        self.assertEqual(sub_maker.offset, [])

    def test_populate_punctuation_only_text_keeps_whole_text(self):
        # no sentence boundaries: the whole text becomes one fragment
        sub_maker = voice_common.populate_legacy_submaker_with_full_text(
            voice_common.SubMaker(), "...", 5.0
        )
        self.assertEqual(sub_maker.subs, ["..."])
        self.assertEqual(sub_maker.offset, [(0, 50000000)])
