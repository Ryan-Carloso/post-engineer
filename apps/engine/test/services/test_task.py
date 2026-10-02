import unittest
import os
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

# add project root to python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import task as tm
from app.models.schema import MaterialInfo, VideoParams
from app.utils import utils

resources_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "resources")
RUN_INTEGRATION_TESTS = os.environ.get("MPT_RUN_INTEGRATION_TESTS", "").lower() in {
    "1",
    "true",
    "yes",
}

class TestTaskService(unittest.TestCase):
    def setUp(self):
        pass
    
    def tearDown(self):
        pass


    def test_generate_script_forwards_advanced_prompt_options(self):
        """
        The task generation entry and the WebUI/API share VideoParams. This
        verifies advanced prompt params still reach the LLM service layer
        when copy is auto-generated, instead of only taking effect on the
        /scripts endpoint.
        """
        params = VideoParams(
            video_subject="咖啡",
            video_script="",
            video_language="zh-CN",
            paragraph_number=2,
            video_script_prompt="语气轻松",
            custom_system_prompt="Only write short narration.",
        )

        with patch.object(tm.llm, "generate_script", return_value="生成的文案") as generate:
            result = tm.generate_script("task-id", params)

        self.assertEqual(result, "生成的文案")
        generate.assert_called_once_with(
            video_subject="咖啡",
            language="zh-CN",
            paragraph_number=2,
            video_script_prompt="语气轻松",
            custom_system_prompt="Only write short narration.",
        )

    def test_generate_final_videos_does_not_rerecord_old_bgm(self):
        task_id = "bgm-history-no-selection"
        params = VideoParams(video_subject="test")
        with patch.object(tm.sm.state, "get_task", return_value={"user_id": "alice"}), \
            patch.object(tm.history_repository, "recent", return_value=["old.mp3"]), \
            patch.object(tm.history_repository, "record") as record, \
            patch.object(tm.video, "combine_videos"), \
            patch.object(tm.video, "generate_video"):
            tm.generate_final_videos(
                task_id, params, ["clip.mp4"], "voice.mp3", "sub.srt", "script", "none"
            )

        record.assert_not_called()

    def test_generate_terms_uses_script_order_mode_when_enabled(self):
        """
        Default mode is unaffected; only when the user explicitly enables
        script-order material matching does the task layer ask the LLM for
        ordered keywords, bumping the keyword count to cover more script
        segments.
        """
        params = VideoParams(
            video_subject="城市通勤",
            video_script="",
            match_materials_to_script=True,
        )

        with patch.object(tm.llm, "generate_terms", return_value=["city", "train"]) as generate:
            result = tm.generate_terms("task-id", params, "先城市，再地铁")

        self.assertEqual(result, ["city", "train"])
        generate.assert_called_once_with(
            video_subject="城市通勤",
            video_script="先城市，再地铁",
            amount=8,
            match_script_order=True,
        )
    
    def test_generate_audio_uses_custom_file_inside_task_directory(self):
        task_id = "test-custom-audio-safe"
        task_dir = utils.task_dir(task_id)
        custom_audio_file = os.path.join(task_dir, "custom-audio.mp3")
        with open(custom_audio_file, "wb") as audio:
            audio.write(b"fake audio")

        params = VideoParams(
            video_subject="custom audio",
            video_script="",
            # Basename-only contract: the file lives in the task directory
            # and is referenced by name, never by absolute path.
            custom_audio_file="custom-audio.mp3",
            voice_name="test-voice",
        )

        try:
            with (
                patch.object(tm.voice, "tts") as tts,
                patch.object(tm.voice, "get_audio_duration", return_value=7),
            ):
                audio_file, audio_duration, sub_maker = tm.generate_audio(
                    task_id, params, "script"
                )
        finally:
            shutil.rmtree(task_dir, ignore_errors=True)

        self.assertEqual(audio_file, os.path.realpath(custom_audio_file))
        self.assertEqual(audio_duration, 7)
        self.assertIsNone(sub_maker)
        tts.assert_not_called()

    def test_generate_audio_rejects_absolute_custom_file_outside_allowed_dirs(self):
        # Absolute server-side paths outside the task dir / local_videos are
        # rejected (path containment): the old behavior accepted any existing
        # absolute path, which let callers read arbitrary server files.
        task_id = "test-custom-audio-absolute-rejected"
        task_dir = utils.task_dir(task_id)

        with tempfile.NamedTemporaryFile(suffix=".mp3") as server_audio:
            server_audio.write(b"fake audio")
            server_audio.flush()
            params = VideoParams(
                video_subject="custom audio",
                video_script="",
                custom_audio_file=server_audio.name,
                voice_name="test-voice",
            )

            try:
                with (
                    patch.object(tm.voice, "tts") as tts,
                    patch.object(tm.sm.state, "update_task") as update_task,
                    # Simulate the full-suite condition: importing app.asgi during
                    # collection loads the tracked .env with the real
                    # DISCORD_WEBHOOK_URL. The failure path must not ping Discord.
                    patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "https://discord/hook"}),
                    patch("app.services.notify._default_post") as default_post,
                ):
                    audio_file, audio_duration, result_sub_maker = tm.generate_audio(
                        task_id, params, "script"
                    )
            finally:
                shutil.rmtree(task_dir, ignore_errors=True)

        self.assertIsNone(audio_file)
        self.assertIsNone(audio_duration)
        self.assertIsNone(result_sub_maker)
        tts.assert_not_called()
        default_post.assert_not_called()
        error = update_task.call_args.kwargs["error"]
        self.assertEqual(update_task.call_args.kwargs["state"], tm.const.TASK_STATE_FAILED)
        self.assertTrue(
            error.startswith("custom audio file is invalid: "),
            f"unexpected error: {error!r}",
        )
        self.assertIn("local_videos", error)

    def test_generate_audio_rejects_missing_custom_file_without_tts(self):
        task_id = "test-custom-audio-missing"
        task_dir = utils.task_dir(task_id)
        params = VideoParams(
            video_subject="custom audio",
            video_script="",
            # Basename-only contract: a missing base name inside the task
            # directory must surface "does not exist", not an absolute path.
            custom_audio_file="missing.mp3",
            voice_name="test-voice",
        )

        try:
            with (
                patch.object(tm.voice, "tts") as tts,
                patch.object(tm.sm.state, "update_task") as update_task,
                # Simulate the full-suite condition: importing app.asgi during
                # collection loads the tracked .env with the real
                # DISCORD_WEBHOOK_URL. The failure path must not ping Discord.
                patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": "https://discord/hook"}),
                patch("app.services.notify._default_post") as default_post,
            ):
                audio_file, audio_duration, result_sub_maker = tm.generate_audio(
                    task_id, params, "script"
                )
        finally:
            shutil.rmtree(task_dir, ignore_errors=True)

        self.assertIsNone(audio_file)
        self.assertIsNone(audio_duration)
        self.assertIsNone(result_sub_maker)
        tts.assert_not_called()
        default_post.assert_not_called()
        error = update_task.call_args.kwargs["error"]
        self.assertEqual(update_task.call_args.kwargs["state"], tm.const.TASK_STATE_FAILED)
        self.assertTrue(
            error.startswith("custom audio file is invalid: "),
            f"unexpected error: {error!r}",
        )
        self.assertIn("does not exist", error)

    def test_generate_subtitle_uses_whisper_for_custom_audio_without_sub_maker(self):
        """
        Custom audio never goes through TTS, so there is no sub_maker.
        Whisper can transcribe straight from the audio file, so the empty
        sub_maker guard must not skip it early.
        """
        task_id = "test-custom-audio-whisper-subtitle"
        task_dir = utils.task_dir(task_id)
        audio_file = os.path.join(task_dir, "custom-audio.mp3")
        Path(audio_file).write_bytes(b"fake audio")
        params = VideoParams(
            video_subject="custom audio",
            video_script="Hello world.",
            subtitle_enabled=True,
        )

        def fake_whisper_create(audio_file, subtitle_file):
            Path(subtitle_file).write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nHello world.\n\n",
                encoding="utf-8",
            )

        try:
            with (
                patch.object(
                    tm.config,
                    "app",
                    dict(tm.config.app, subtitle_provider="whisper"),
                ),
                patch.object(
                    tm.subtitle, "create", side_effect=fake_whisper_create
                ) as create,
                patch.object(tm.subtitle, "correct") as correct,
            ):
                subtitle_path = tm.generate_subtitle(
                    task_id=task_id,
                    params=params,
                    video_script="Hello world.",
                    sub_maker=None,
                    audio_file=audio_file,
                )
        finally:
            shutil.rmtree(task_dir, ignore_errors=True)

        self.assertTrue(subtitle_path.endswith("subtitle.srt"))
        create.assert_called_once_with(audio_file=audio_file, subtitle_file=subtitle_path)
        correct.assert_called_once_with(
            subtitle_file=subtitle_path, video_script="Hello world."
        )

    def test_generate_subtitle_skips_edge_provider_without_sub_maker(self):
        """
        Edge subtitles depend on the sub_maker timeline returned by TTS.
        Custom audio lacks that object, so it should keep being skipped to
        avoid producing an untrustworthy subtitle timeline.
        """
        task_id = "test-custom-audio-edge-no-submaker"
        task_dir = utils.task_dir(task_id)
        audio_file = os.path.join(task_dir, "custom-audio.mp3")
        Path(audio_file).write_bytes(b"fake audio")
        params = VideoParams(
            video_subject="custom audio",
            video_script="Hello world.",
            subtitle_enabled=True,
        )

        try:
            with (
                patch.object(
                    tm.config,
                    "app",
                    dict(tm.config.app, subtitle_provider="edge"),
                ),
                patch.object(tm.voice, "create_subtitle") as create_subtitle,
                patch.object(tm.subtitle, "create") as whisper_create,
            ):
                subtitle_path = tm.generate_subtitle(
                    task_id=task_id,
                    params=params,
                    video_script="Hello world.",
                    sub_maker=None,
                    audio_file=audio_file,
                )
        finally:
            shutil.rmtree(task_dir, ignore_errors=True)

        self.assertEqual(subtitle_path, "")
        create_subtitle.assert_not_called()
        whisper_create.assert_not_called()

    @unittest.skipUnless(
        RUN_INTEGRATION_TESTS,
        "MPT_RUN_INTEGRATION_TESTS not set",
    )
    def test_task_local_materials(self):
        task_id = "00000000-0000-0000-0000-000000000000"
        video_materials=[]
        for i in range(1, 4):
            video_materials.append(MaterialInfo(
                provider="local",
                url=os.path.join(resources_dir, f"{i}.png"),
                duration=0
            ))

        params = VideoParams(
            video_subject="金钱的作用",
            video_script="金钱不仅是交换媒介，更是社会资源的分配工具。它能满足基本生存需求，如食物和住房，也能提供教育、医疗等提升生活品质的机会。拥有足够的金钱意味着更多选择权，比如职业自由或创业可能。但金钱的作用也有边界，它无法直接购买幸福、健康或真诚的人际关系。过度追逐财富可能导致价值观扭曲，忽视精神层面的需求。理想的状态是理性看待金钱，将其作为实现目标的工具而非终极目的。",
            video_terms="money importance, wealth and society, financial freedom, money and happiness, role of money",
            video_aspect="9:16",
            video_concat_mode="random",
            video_transition_mode="None",
            video_clip_duration=3,
            video_materials=video_materials,
            video_language="",
            voice_name="zh-CN-XiaoxiaoNeural-Female",
            voice_volume=1.0,
            voice_rate=1.0,
            bgm_volume=0.2,
            subtitle_enabled=True,
            subtitle_position="bottom",
            custom_position=70.0,
            font_name="MicrosoftYaHeiBold.ttc",
            text_fore_color="#FFFFFF",
            text_background_color=True,
            font_size=60,
            stroke_color="#000000",
            stroke_width=1.5,
            n_threads=2,
            paragraph_number=1
        )
        result = tm.start(task_id=task_id, params=params)
        print(result)
    

class TestGetVideoMaterialsRandomSourceCascade(unittest.TestCase):
    """
    Source selection is fixed by the engine: remote download ALWAYS uses the
    3 sources (pexels, pixabay, coverr) in shuffled order — starting source
    drawn per task, rest in cascade. No API field and no
    configuration; local materials (video_materials) replace the download.
    """

    def test_remote_download_always_uses_shuffled_three_sources(self):
        params = VideoParams(video_subject="cidade ao pôr do sol")

        with (
            patch.object(tm.random, "shuffle", side_effect=lambda seq: seq.reverse()),
            patch.object(tm.material, "download_videos", return_value=["v.mp4"]) as dv,
        ):
            result = tm.get_video_materials(
                task_id="random-cascade",
                params=params,
                video_terms=["cidade ao pôr do sol"],
                audio_duration=10,
            )

        self.assertEqual(result, ["v.mp4"])
        self.assertEqual(
            dv.call_args.kwargs.get("source_mix"),
            ["coverr", "pixabay", "pexels"],
        )
        self.assertNotIn("source", dv.call_args.kwargs)

    def test_source_order_follows_shuffle_result(self):
        with patch.object(tm.material, "download_videos", return_value=["v.mp4"]) as dv:
            with patch.object(
                tm.random, "shuffle", side_effect=lambda seq: seq.reverse()
            ):
                tm.get_video_materials(
                    task_id="shuffled",
                    params=VideoParams(video_subject="x"),
                    video_terms=["x"],
                    audio_duration=10,
                )
                shuffled_order = tuple(dv.call_args.kwargs.get("source_mix"))
            with patch.object(tm.random, "shuffle", side_effect=lambda seq: None):
                tm.get_video_materials(
                    task_id="original",
                    params=VideoParams(video_subject="x"),
                    video_terms=["x"],
                    audio_duration=10,
                )
                original_order = tuple(dv.call_args.kwargs.get("source_mix"))

        self.assertNotEqual(shuffled_order, original_order)
        self.assertEqual(sorted(original_order), ["coverr", "pexels", "pixabay"])
        self.assertEqual(sorted(shuffled_order), ["coverr", "pexels", "pixabay"])

    def test_provided_materials_skip_download(self):
        material_info = MaterialInfo(provider="local", url="/tmp/a.mp4", duration=0)
        params = VideoParams(video_subject="x", video_materials=[material_info])

        with (
            patch.object(tm.video, "preprocess_video", return_value=[material_info]) as preprocess,
            patch.object(tm.material, "download_videos") as dv,
        ):
            result = tm.get_video_materials(
                task_id="local-materials",
                params=params,
                video_terms=["x"],
                audio_duration=10,
            )

        self.assertEqual(result, ["/tmp/a.mp4"])
        preprocess.assert_called_once()
        dv.assert_not_called()

class TestGenerateFinalVideosSingleOutput(unittest.TestCase):
    """
    The engine always generates exactly 1 video per task — video_count left
    the API. Same script/narration, a single combined/final in the output.
    """

    def _run(self, **params_kwargs):
        params = VideoParams(video_subject="x", **params_kwargs)
        with (
            patch.object(tm.sm.state, "get_task", return_value={"user_id": "u1"}),
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm.history_repository, "recent", return_value=[]),
            patch.object(tm.video, "combine_videos") as combine,
            patch.object(tm.video, "generate_video") as generate,
        ):
            final_paths, combined_paths = tm.generate_final_videos(
                task_id="single-video",
                params=params,
                downloaded_videos=["c1.mp4", "c2.mp4"],
                audio_file="a.mp3",
                subtitle_path="s.srt",
                video_script="script",
                music_mood="calm",
            )
        return final_paths, combined_paths, combine, generate

    def test_produces_exactly_one_combined_and_final_video(self):
        final_paths, combined_paths, combine, generate = self._run(
            video_concat_mode="sequential"
        )

        task_dir = tm.utils.task_dir("single-video")
        self.assertEqual(final_paths, [os.path.join(task_dir, "final-1.mp4")])
        self.assertEqual(combined_paths, [os.path.join(task_dir, "combined-1.mp4")])
        self.assertEqual(combine.call_count, 1)
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(
            generate.call_args.kwargs.get("output_file"),
            os.path.join(task_dir, "final-1.mp4"),
        )

    def test_match_materials_to_script_forces_sequential(self):
        _, _, combine, _ = self._run(
            video_concat_mode="random", match_materials_to_script=True
        )
        self.assertEqual(
            combine.call_args.kwargs.get("video_concat_mode"),
            tm.VideoConcatMode.sequential,
        )

    def test_concat_mode_passthrough_without_match(self):
        _, _, combine, _ = self._run(
            video_concat_mode="random", match_materials_to_script=False
        )
        self.assertEqual(
            combine.call_args.kwargs.get("video_concat_mode"),
            tm.VideoConcatMode.random,
        )


class _FakeStreamResponse:
    """Fake requests.get(stream=True) response for download_persona_voice."""

    def __init__(self, content_type="audio/mpeg", chunks=(b"\x00" * 1024,), status_code=200, headers=None):
        self.status_code = status_code
        self.headers = {"content-type": content_type, **(headers or {})}
        self._chunks = chunks

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size=8192):
        yield from self._chunks

    def close(self):
        pass


def _fake_probe(duration="30.0", streams=("audio",)):
    import json
    import subprocess

    payload = {
        "streams": [{"codec_type": s} for s in streams],
        "format": {"duration": duration},
    }
    return subprocess.CompletedProcess(
        args=["ffprobe"], returncode=0, stdout=json.dumps(payload), stderr=""
    )


class TestDownloadPersonaVoice(unittest.TestCase):
    """
    download_persona_voice: only accepts a real audio file (audio stream
    detected by ffprobe), with duration <= 60s and size <= 20MB.
    Any violation returns None and leaves no partial file behind.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="persona-voice-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def _download(
        self,
        url="https://cdn.test/voz.mp3",
        response=None,
        probe=None,
        probe_side_effect=None,
        resolved_ips=("93.184.216.34",),
        getaddrinfo_side_effect=None,
    ):
        import socket

        get_patcher = patch("requests.get", return_value=response or _FakeStreamResponse())
        self.get_mock = get_patcher.start()
        self.addCleanup(get_patcher.stop)
        getaddrinfo_patch = (
            patch("socket.getaddrinfo", side_effect=getaddrinfo_side_effect)
            if getaddrinfo_side_effect is not None
            else patch(
                "socket.getaddrinfo",
                return_value=[
                    (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))
                    for ip in resolved_ips
                ],
            )
        )
        patches = [
            patch.object(tm.utils, "task_dir", return_value=self.tmp),
            getaddrinfo_patch,
        ]
        if probe_side_effect is not None:
            patches.append(patch("subprocess.run", side_effect=probe_side_effect))
        else:
            patches.append(patch("subprocess.run", return_value=probe or _fake_probe()))
        with patches[0], patches[1], patches[2]:
            return tm.download_persona_voice("task-1", url)

    def test_accepts_valid_audio_within_limits(self):
        result = self._download()

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result.startswith(self.tmp))
        self.assertTrue(os.path.exists(result))

    def test_rejects_non_audio_content_type(self):
        result = self._download(response=_FakeStreamResponse(content_type="text/html"))

        self.assertIsNone(result)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_oversized_download(self):
        def big_chunks():
            for _ in range(25):
                yield b"\x00" * (1024 * 1024)

        result = self._download(response=_FakeStreamResponse(chunks=big_chunks()))

        self.assertIsNone(result)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_audio_longer_than_60_seconds(self):
        result = self._download(probe=_fake_probe(duration="90.0"))

        self.assertIsNone(result)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_file_without_audio_stream(self):
        result = self._download(probe=_fake_probe(streams=("video",)))

        self.assertIsNone(result)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_when_ffprobe_fails(self):
        import subprocess

        result = self._download(
            probe_side_effect=subprocess.CalledProcessError(1, ["ffprobe"])
        )

        self.assertIsNone(result)
        self.assertEqual(os.listdir(self.tmp), [])

    #---------------
    # SSRF: the URL must resolve to a public address. Literal private IP,
    # hostname resolving to a private IP, unresolvable host, and redirect
    # to a private destination are rejected without any fetch.
    #---------------

    def test_rejects_private_ip_literal(self):
        result = self._download(url="http://127.0.0.1/voz.mp3")

        self.assertIsNone(result)
        self.get_mock.assert_not_called()
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_link_local_metadata_ip(self):
        result = self._download(url="http://169.254.169.254/latest/meta-data/")

        self.assertIsNone(result)
        self.get_mock.assert_not_called()

    def test_rejects_hostname_resolving_to_private_ip(self):
        result = self._download(resolved_ips=("10.0.0.5",))

        self.assertIsNone(result)
        self.get_mock.assert_not_called()
        self.assertEqual(os.listdir(self.tmp), [])

    def test_rejects_unresolvable_host(self):
        import socket

        result = self._download(
            getaddrinfo_side_effect=socket.gaierror("Name or service not known")
        )

        self.assertIsNone(result)
        self.get_mock.assert_not_called()

    def test_rejects_redirect_to_private_ip(self):
        redirect = _FakeStreamResponse(
            status_code=302, headers={"location": "http://127.0.0.1/voz.mp3"}
        )
        result = self._download(response=redirect)

        self.assertIsNone(result)
        # only the initial GET happened; the redirect target was never fetched
        self.assertEqual(self.get_mock.call_count, 1)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_generate_audio_reports_rejection_reason_to_user(self):
        params = VideoParams(video_subject="voz rejeitada", video_script="")
        persona = {"voice_audio_url": "http://127.0.0.1/voz.mp3"}

        with (
            patch.object(tm, "resolve_persona_audio", return_value=(None, persona["voice_audio_url"])),
            patch.object(tm.sm.state, "update_task") as update_task,
        ):
            audio_file, audio_duration, sub_maker = tm.generate_audio(
                "task-ssrf", params, "script"
            )

        self.assertIsNone(audio_file)
        self.assertIsNone(audio_duration)
        self.assertIsNone(sub_maker)
        update_task.assert_called_once()
        kwargs = update_task.call_args.kwargs
        self.assertEqual(kwargs.get("state"), tm.const.TASK_STATE_FAILED)
        self.assertIn("public", str(kwargs.get("error", "")).lower())


class TestFailTaskDiscordDedupe(unittest.TestCase):
    """_fail_task marks the task FAILED and sends one Discord alert per task,
    even when several phases notice the same failure."""

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_fail_task_marks_failed_and_alerts_once(self):
        with (
            patch.object(tm.sm.state, "update_task") as update_task,
            patch.object(tm, "send_discord") as send_discord,
        ):
            tm._fail_task("task-1", "boom")
            tm._fail_task("task-1", "boom again")
        self.assertEqual(update_task.call_count, 2)
        send_discord.assert_called_once()
        message = send_discord.call_args.args[0]
        self.assertIn("task-1", message)
        self.assertIn("boom", message)

    def test_fail_task_alert_includes_subject(self):
        params = VideoParams(video_subject="Lisbon trams")
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord") as send_discord,
        ):
            tm._fail_task("task-2", "boom", params)
        message = send_discord.call_args.args[0]
        self.assertIn("Lisbon trams", message)

    def test_fail_task_passes_extra_kwargs_to_state(self):
        with (
            patch.object(tm.sm.state, "update_task") as update_task,
            patch.object(tm, "send_discord"),
        ):
            tm._fail_task("task-3", "boom", music_mood="pending")
        kwargs = update_task.call_args.kwargs
        self.assertEqual(kwargs.get("state"), tm.const.TASK_STATE_FAILED)
        self.assertEqual(kwargs.get("music_mood"), "pending")


class TestFailTaskDiscordRetry(unittest.TestCase):
    """A task id genuinely evicted from the bounded cache alerts again."""

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_fail_task_alerts_again_after_real_eviction(self):
        # Review MINOR: fill the bounded cache past its limit with other
        # task ids — the first id is genuinely evicted (not via a manual
        # .remove()) and a later failure for it re-alerts.
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord", return_value=True) as send_discord,
        ):
            tm._fail_task("task-retry", "boom")
            for i in range(tm.MAX_FAILED_ALERTS):
                tm._should_send_failure_alert(f"task-filler-{i}")
            self.assertNotIn("task-retry", tm._discord_notified_failed_tasks)
            tm._fail_task("task-retry", "boom again")
        self.assertEqual(send_discord.call_count, 2)


class TestFailTaskAlertCacheBounded(unittest.TestCase):
    """The notified-ids cache can't grow without bound."""

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_failed_alert_cache_stays_bounded(self):
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord"),
        ):
            for i in range(tm.MAX_FAILED_ALERTS + 50):
                tm._fail_task(f"task-bounded-{i}", "boom")
        self.assertLessEqual(len(tm._discord_notified_failed_tasks), tm.MAX_FAILED_ALERTS)


class TestFailTaskConcurrentDedupe(unittest.TestCase):
    """Concurrent _fail_task calls for one task send a single alert.

    The lock uses a short blocking acquire, so racing threads serialize on
    the check-and-add instead of every thread slipping through — exactly
    one alert is deterministic, not just likely.
    """

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_concurrent_fail_task_alerts_once(self):
        from concurrent.futures import ThreadPoolExecutor

        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord") as send_discord,
            ThreadPoolExecutor(max_workers=8) as pool,
        ):
            list(pool.map(lambda _: tm._fail_task("task-race", "boom"), range(32)))
        self.assertEqual(send_discord.call_count, 1)

    def test_failed_send_releases_alert_reservation(self):
        # Review MINOR: a transient Discord outage must not permanently
        # suppress the alert — when the send fails, the dedupe reservation
        # is released so the next failure notice re-alerts.
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord") as send_discord,
        ):
            send_discord.return_value = False
            tm._fail_task("task-retry", "boom")
            send_discord.return_value = True
            tm._fail_task("task-retry", "boom again")
        self.assertEqual(send_discord.call_count, 2)

    def test_successful_send_keeps_dedupe(self):
        # The release only happens on send failure — a delivered alert still
        # dedupes repeat notices for the same task.
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord", return_value=True) as send_discord,
        ):
            tm._fail_task("task-ok", "boom")
            tm._fail_task("task-ok", "boom again")
        self.assertEqual(send_discord.call_count, 1)

    def test_fail_task_keeps_first_specific_error(self):
        # Review MINOR: a later generic notice must not clobber the first,
        # most specific stored error.
        from app.services.state import MemoryState

        memory = MemoryState()
        with (
            patch.object(tm.sm, "state", memory),
            patch.object(tm, "send_discord", return_value=True),
        ):
            tm._fail_task("task-err", "custom audio file is invalid: too short")
            tm._fail_task("task-err", "failed to generate audio")
        task = memory.get_task("task-err")
        self.assertEqual(task["state"], tm.const.TASK_STATE_FAILED)
        self.assertEqual(task["error"], "custom audio file is invalid: too short")

    def test_fail_task_preserves_error_recorded_by_other_path(self):
        # task_publish.py records the detailed publish error + FAILED
        # itself, then start()'s handler calls _fail_task — the detailed
        # error must survive, and the alert still goes out once.
        from app.services.state import MemoryState

        memory = MemoryState()
        with (
            patch.object(tm.sm, "state", memory),
            patch.object(tm, "send_discord", return_value=True) as send_discord,
        ):
            memory.update_task(
                "task-pub",
                state=tm.const.TASK_STATE_FAILED,
                error="publish failed for video.mp4: 403",
            )
            tm._fail_task("task-pub", "publish failed for video.mp4: 403")
        task = memory.get_task("task-pub")
        self.assertEqual(task["error"], "publish failed for video.mp4: 403")
        send_discord.assert_called_once()


class TestPublishFailureDiscordAlert(unittest.TestCase):
    """A publish failure inside start() reaches the Discord alert path.

    publish_task_videos marks the task FAILED directly, but the raised
    PublishFailedError propagates to start()'s generic exception handler,
    which alerts via _fail_task. This test locks in that wiring — and that
    the alert carries the video basename, not the full local path.
    """

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_publish_failure_sends_single_alert_with_basename(self):
        from app.services.task_publish import PublishFailedError

        params = VideoParams(
            video_subject="Lisbon trams",
            video_materials=[{"provider": "local", "url": "x", "duration": 1}],
        )
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord") as send_discord,
            patch.object(tm, "generate_script", return_value="script"),
            patch.object(tm, "save_script_data"),
            patch.object(tm, "generate_audio", return_value=("audio.mp3", 10.0, None)),
            patch.object(tm, "generate_subtitle", return_value="sub.srt"),
            patch.object(tm, "get_video_materials", return_value=["v.mp4"]),
            patch.object(tm.video, "get_available_music_moods", return_value=[]),
            patch.object(tm.llm, "generate_music_mood", return_value="chill"),
            patch.object(tm, "generate_final_videos", return_value=(["/tmp/x/final.mp4"], [])),
            patch.object(
                tm.task_publish,
                "maybe_publish_finished_videos",
                side_effect=PublishFailedError("publish failed for final.mp4: 403"),
            ),
            patch.object(tm, "cleanup_task_intermediates"),
        ):
            tm.start(task_id="task-pub", params=params)
        send_discord.assert_called_once()
        message = send_discord.call_args.args[0]
        self.assertIn("task-pub", message)
        self.assertIn("final.mp4", message)
        self.assertNotIn("/tmp/", message)


class TestPublishFailureFunnelStageWiring(unittest.TestCase):
    """The _mark("publish") wiring pins stage="publish" on the funnel event.

    The generic handler reports stage=_last_phase; without the one-line
    _mark("publish") before maybe_publish_finished_videos, a publish-stage
    raise would emit video_generation_failed with stage="render" and every
    existing test would stay green. This test drives start() through a
    publish-stage raise and asserts the emitted event carries "publish".
    """

    def setUp(self):
        tm._failed_event_emitted_tasks.clear()
        tm._progress_milestones.clear()

    def tearDown(self):
        tm._failed_event_emitted_tasks.clear()
        tm._progress_milestones.clear()

    def test_publish_failure_inside_start_emits_failed_with_publish_stage(self):
        from app.services.task_publish import PublishFailedError

        params = VideoParams(
            video_subject="Lisbon trams",
            video_materials=[{"provider": "local", "url": "x", "duration": 1}],
        )
        with (
            patch.object(tm.sm.state, "update_task"),
            patch.object(tm, "send_discord", return_value=True),
            patch.object(tm, "track_event") as track,
            patch.object(tm, "generate_script", return_value="script"),
            patch.object(tm, "save_script_data"),
            patch.object(tm, "generate_audio", return_value=("audio.mp3", 10.0, None)),
            patch.object(tm, "generate_subtitle", return_value="sub.srt"),
            patch.object(tm, "get_video_materials", return_value=["v.mp4"]),
            patch.object(tm.video, "get_available_music_moods", return_value=[]),
            patch.object(tm.llm, "generate_music_mood", return_value="chill"),
            patch.object(tm, "generate_final_videos", return_value=(["/tmp/x/final.mp4"], [])),
            patch.object(
                tm.task_publish,
                "maybe_publish_finished_videos",
                side_effect=PublishFailedError("publish failed for final.mp4: 403"),
            ),
            patch.object(tm, "cleanup_task_intermediates"),
        ):
            tm.start(task_id="task-pub-stage", params=params)
        failed_calls = [
            c for c in track.call_args_list if c[0][0] == "video_generation_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertEqual(props["stage"], "publish")


class TestShouldSendFailureAlertLockFallback(unittest.TestCase):
    """If the dedupe lock can't be acquired in time, err on the side of alerting."""

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_lock_unavailable_sends_alert(self):
        tm._discord_notified_failed_tasks_lock.acquire()
        try:
            self.assertTrue(tm._should_send_failure_alert("task-locked"))
        finally:
            tm._discord_notified_failed_tasks_lock.release()


class TestReleaseFailureAlertLockBusy(unittest.TestCase):
    """A busy lock in _release_failure_alert warns and keeps the reservation."""

    def setUp(self):
        tm._discord_notified_failed_tasks.clear()

    def tearDown(self):
        tm._discord_notified_failed_tasks.clear()

    def test_lock_busy_keeps_reservation_and_warns(self):
        # Review MINOR: with the bounded acquire, a busy lock must warn and
        # leave the reservation in place — dropping the id would silently
        # suppress the re-alert this function exists to protect.
        tm._discord_notified_failed_tasks.append("task-lock-busy")
        tm._discord_notified_failed_tasks_lock.acquire()
        try:
            with patch.object(tm.logger, "warning") as warn:
                tm._release_failure_alert("task-lock-busy")
        finally:
            tm._discord_notified_failed_tasks_lock.release()
        warn.assert_called_once()
        (warning_text, warning_id), _ = warn.call_args
        self.assertIn("task-lock-busy", warning_id)
        self.assertIn("lock busy", warning_text)
        self.assertIn("task-lock-busy", tm._discord_notified_failed_tasks)


if __name__ == "__main__":
    unittest.main()
