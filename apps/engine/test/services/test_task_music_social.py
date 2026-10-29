"""Phase 5 PR 3: music mood and social metadata without any LLM call.

``tm.start()`` used to ask the LLM which BGM mood fits the script and
used to ask it for YouTube cross-post copy. Both are now mechanical:
the mood is always "none" (no BGM — the LLM function's own failure
fallback) and the YouTube metadata is the subject-only mechanical
fallback. The tests below drive ``start()`` to the cross-post stage
with every other stage mocked, and fail loudly if an LLM function is
called at all.
"""

import ast
import re
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import MaterialInfo, VideoParams
from app.services import task as tm
from app.services.intro_cost import IntroCostReport


def _params():
    return VideoParams(
        video_subject="Lisbon trams",
        video_materials=[MaterialInfo(provider="local", url="/tmp/a.mp4", duration=0)],
    )


class StartMusicSocialTests(unittest.TestCase):
    def _run_start(self, platforms):
        """Run start() to the cross-post stage; return (result, mocks)."""
        service = tm.upload_post.upload_post_service
        with ExitStack() as stack:
            stack.enter_context(patch.object(tm, "_update_task"))
            stack.enter_context(patch.object(tm, "_complete_task"))
            stack.enter_context(patch.object(tm, "track_generation_started"))
            stack.enter_context(patch.object(tm, "track_event"))
            stack.enter_context(patch.object(tm, "send_discord", return_value=True))
            stack.enter_context(patch.object(tm.sm, "persist_state_update"))
            stack.enter_context(
                patch.object(
                    tm.sm.state,
                    "get_task",
                    return_value={"video_storage_path": "videos/final.mp4"},
                )
            )
            stack.enter_context(patch.object(tm, "save_script_data"))
            stack.enter_context(patch.object(tm, "generate_script", return_value="script text"))
            stack.enter_context(
                patch.object(
                    tm,
                    "generate_audio",
                    return_value=("audio.mp3", 10, None),
                )
            )
            stack.enter_context(patch.object(tm, "generate_subtitle", return_value="sub.srt"))
            stack.enter_context(
                patch.object(
                    tm,
                    "_ensure_persona_hook_fits",
                    side_effect=lambda tid, p, s, a, d, m, sub: (s, a, d, m, sub),
                )
            )
            stack.enter_context(patch.object(tm.audio_trim, "task_local_copy", return_value=None))
            stack.enter_context(
                patch.object(tm.utils, "task_dir", return_value="/tmp/fake-task-dir")
            )
            stack.enter_context(patch.object(tm, "get_video_materials", return_value=["clip.mp4"]))
            stack.enter_context(
                patch.object(
                    tm.user_media,
                    "apply_segment_media",
                    return_value=(["clip.mp4"], []),
                )
            )
            stack.enter_context(
                patch.object(
                    tm,
                    "generate_final_videos",
                    return_value=(
                        ["final.mp4"],
                        ["combined.mp4"],
                        IntroCostReport(ran=False, cost_usd=None, job_id=None),
                    ),
                )
            )
            stack.enter_context(patch.object(tm, "archive_final_videos"))
            stack.enter_context(patch.object(tm, "completion_cost_kwargs", return_value={}))
            stack.enter_context(patch.object(tm, "cleanup_task_intermediates"))
            stack.enter_context(patch.object(tm.video_storage, "require_r2_configuration"))
            stack.enter_context(
                patch.object(tm.video_storage, "read_final_video_r2", return_value=b"fake")
            )
            stack.enter_context(patch.object(service, "is_configured", return_value=True))
            stack.enter_context(patch.object(service, "auto_upload", True))
            stack.enter_context(patch.object(service, "platforms", platforms))
            stack.enter_context(patch.object(service, "youtube_privacy_status", "public"))
            cross_post = stack.enter_context(
                patch.object(
                    tm.upload_post,
                    "cross_post_video",
                    return_value={"success": True},
                )
            )
            music_mood_llm = stack.enter_context(
                patch.object(
                    tm.llm,
                    "generate_music_mood",
                    side_effect=AssertionError("LLM music mood must not be called"),
                )
            )
            social_llm = stack.enter_context(
                patch.object(
                    tm.llm,
                    "generate_social_metadata",
                    side_effect=AssertionError("LLM social metadata must not be called"),
                )
            )
            moods_catalog = stack.enter_context(
                patch.object(
                    tm.video,
                    "get_available_music_moods",
                    side_effect=AssertionError("BGM catalog must not be consulted"),
                )
            )
            complete = tm._complete_task
            result = tm.start(task_id="task-music-social", params=_params())
            return result, complete, cross_post, music_mood_llm, social_llm, moods_catalog

    def test_music_mood_is_none_without_any_llm_call(self):
        result, complete, _, music_llm, _, moods_catalog = self._run_start(["youtube"])
        self.assertEqual(result["music_mood"], "none")
        music_llm.assert_not_called()
        moods_catalog.assert_not_called()
        complete_kwargs = complete.call_args.kwargs
        self.assertEqual(complete_kwargs["music_mood"], "none")

    def test_youtube_cross_post_uses_mechanical_subject_only_metadata(self):
        _, _, cross_post, _, social_llm, _ = self._run_start(["youtube"])
        social_llm.assert_not_called()
        cross_post.assert_called_once()
        youtube_extra = cross_post.call_args.kwargs["youtube_extra"]
        self.assertEqual(
            youtube_extra,
            {
                "youtube_title": "Lisbon trams",
                "youtube_description": "",
                "tags": [],
                "privacyStatus": "public",
                "containsSyntheticMedia": True,
            },
        )

    def test_cross_post_without_youtube_gets_no_youtube_extra(self):
        # The mechanical fallback applies only to the YouTube metadata
        # path; other platforms cross-post without youtube_extra.
        _, _, cross_post, _, social_llm, _ = self._run_start(["tiktok"])
        social_llm.assert_not_called()
        cross_post.assert_called_once()
        self.assertIsNone(cross_post.call_args.kwargs["youtube_extra"])


# The behavioural tests above prove the runtime path. This structural pin
# guards the call sites directly: no llm music/social call may reappear
# inside start(), even if a refactor re-routes the mocks.
_START_RE = re.compile(r"^(start|x__start__mutmut_(?:orig|\d+))$")


def _llm_music_social_calls_in_start(source: str) -> list[str]:
    tree = ast.parse(source)
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        if _START_RE.match(node.name) is None:
            continue
        for child in ast.walk(node):
            if not isinstance(child, ast.Call):
                continue
            func = child.func
            if (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "llm"
                and func.attr in ("generate_music_mood", "generate_social_metadata")
            ):
                offenders.append(f"{node.name}:{child.lineno}:{func.attr}")
    return offenders


class StartNoLlmMusicSocialScanTests(unittest.TestCase):
    def test_start_never_calls_llm_music_or_social(self):
        src = Path(tm.__file__).read_text()
        self.assertEqual(_llm_music_social_calls_in_start(src), [])

    def test_scan_flags_llm_calls_inside_start(self):
        src = "def start(task_id):\n    music_mood = llm.generate_music_mood(script, moods)\n"
        offenders = _llm_music_social_calls_in_start(src)
        self.assertEqual(len(offenders), 1)
        self.assertIn("generate_music_mood", offenders[0])

    def test_scan_ignores_llm_calls_outside_start(self):
        # generate_terms still calls the LLM (later PR's scope): only
        # start() is pinned here.
        src = "def generate_terms(task_id):\n    return llm.generate_social_metadata(subject='x')\n"
        self.assertEqual(_llm_music_social_calls_in_start(src), [])
