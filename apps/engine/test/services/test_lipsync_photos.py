"""Direct unit tests for the full lip-sync face photos (mutmut attribution).

Downloads go through user_media.resolve_photo_ref and the face detector is
patched, so no network or opencv is needed. Pins: every photo is loaded
and face-checked in window order, a cached file is reused, a repeated
image fails naming both indexes, and no reason carries a URL.
"""

import os
import tempfile
import unittest
from unittest.mock import patch

from app.models.schema import PersonaParams, VideoParams
from app.services import face_detect, lipsync_photos, longcat, user_media


def _params(photos):
    return VideoParams(
        video_title="Porto",
        video_description="Test description.",
        video_type="full_lipsync",
        video_script="Hook. Body. Call to action.",
        persona=PersonaParams(name="Ana", photo_url="https://img.test/p.png", voice_id="calm"),
        lipsync_photos=photos,
    )


class ResolveLipsyncPhotosTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.task_dir = self._tmp.name
        self._patches = [
            patch.object(lipsync_photos.utils, "task_dir", return_value=self.task_dir),
            patch.object(face_detect, "image_contains_face", return_value=True),
        ]
        for started in self._patches:
            started.start()

    def tearDown(self):
        for started in self._patches:
            started.stop()
        self._tmp.cleanup()

    def _fake_resolve(self, contents):
        calls = []

        def fake(media, token, task_dir, session=None):
            index = len(calls)
            calls.append((media, token))
            downloaded = os.path.join(task_dir, f"downloaded-{index}.raw")
            with open(downloaded, "wb") as handle:
                handle.write(contents[index])
            return downloaded, None

        return fake, calls

    def test_downloads_every_photo_in_window_order(self):
        fake, calls = self._fake_resolve([b"face-a", b"face-b", b"face-c"])
        photos = [
            {"url": "https://img.test/a.png"},
            {"mediaId": "0" * 32 + ".png"},
            {"url": "https://img.test/c.png"},
        ]
        with patch.object(user_media, "resolve_photo_ref", side_effect=fake):
            paths = lipsync_photos.resolve_lipsync_photos("t1", _params(photos))
        self.assertEqual(
            paths, [lipsync_photos.lipsync_photo_path(self.task_dir, i) for i in range(3)]
        )
        self.assertEqual([media for media, _token in calls], photos)
        self.assertEqual([token for _media, token in calls], ["lipsync-0", "lipsync-1", "lipsync-2"])
        with open(paths[1], "rb") as handle:
            self.assertEqual(handle.read(), b"face-b")
        for index in range(3):
            self.assertFalse(os.path.exists(os.path.join(self.task_dir, f"downloaded-{index}.raw")))

    def test_media_id_source_outside_the_task_dir_is_kept(self):
        with tempfile.TemporaryDirectory() as assets:
            asset = os.path.join(assets, "asset.png")
            with open(asset, "wb") as handle:
                handle.write(b"face-a")
            second = os.path.join(assets, "second.png")
            with open(second, "wb") as handle:
                handle.write(b"face-b")
            sources = iter([asset, second])
            with patch.object(
                user_media, "resolve_photo_ref", side_effect=lambda *a, **k: (next(sources), None)
            ):
                lipsync_photos.resolve_lipsync_photos(
                    "t1", _params([{"mediaId": "a" * 32 + ".png"}, {"mediaId": "b" * 32 + ".png"}])
                )
            self.assertTrue(os.path.exists(asset))
            self.assertTrue(os.path.exists(second))

    def test_reuses_files_the_preflight_already_downloaded(self):
        for index, content in enumerate([b"face-a", b"face-b"]):
            with open(lipsync_photos.lipsync_photo_path(self.task_dir, index), "wb") as handle:
                handle.write(content)
        with patch.object(user_media, "resolve_photo_ref") as resolve:
            paths = lipsync_photos.resolve_lipsync_photos(
                "t1", _params([{"url": "https://img.test/a.png"}, {"url": "https://img.test/b.png"}])
            )
        resolve.assert_not_called()
        self.assertEqual(len(paths), 2)

    def test_a_photo_that_cannot_load_fails_naming_its_index(self):
        fake, _calls = self._fake_resolve([b"face-a"])

        def resolve(media, token, task_dir, session=None):
            if token == "lipsync-1":
                return "", "download blocked"
            return fake(media, token, task_dir)

        with patch.object(user_media, "resolve_photo_ref", side_effect=resolve):
            with self.assertRaises(longcat.LongCatError) as caught:
                lipsync_photos.resolve_lipsync_photos(
                    "t1",
                    _params([{"url": "https://img.test/a.png"}, {"url": "https://secret.test/b.png?token=x"}]),
                )
        self.assertEqual(str(caught.exception), "lipsync photo 1 could not be loaded: download blocked")

    def test_a_photo_without_a_face_fails_naming_its_index(self):
        fake, _calls = self._fake_resolve([b"face-a", b"landscape"])
        verdicts = iter([True, False])
        with (
            patch.object(user_media, "resolve_photo_ref", side_effect=fake),
            patch.object(face_detect, "image_contains_face", side_effect=lambda _p: next(verdicts)),
        ):
            with self.assertRaises(longcat.LongCatError) as caught:
                lipsync_photos.resolve_lipsync_photos(
                    "t1", _params([{"url": "https://img.test/a.png"}, {"url": "https://img.test/b.png"}])
                )
        self.assertIn("lipsync photo 1 has no detectable face", str(caught.exception))

    def test_a_missing_detector_never_blocks(self):
        fake, _calls = self._fake_resolve([b"face-a", b"face-b"])
        with (
            patch.object(user_media, "resolve_photo_ref", side_effect=fake),
            patch.object(face_detect, "image_contains_face", return_value=None),
        ):
            paths = lipsync_photos.resolve_lipsync_photos(
                "t1", _params([{"url": "https://img.test/a.png"}, {"url": "https://img.test/b.png"}])
            )
        self.assertEqual(len(paths), 2)

    def test_the_same_image_under_two_refs_fails(self):
        fake, _calls = self._fake_resolve([b"face-a", b"face-b", b"face-a"])
        with patch.object(user_media, "resolve_photo_ref", side_effect=fake):
            with self.assertRaises(longcat.LongCatError) as caught:
                lipsync_photos.resolve_lipsync_photos(
                    "t1",
                    _params(
                        [
                            {"url": "https://img.test/a.png"},
                            {"url": "https://img.test/b.png"},
                            {"url": "https://mirror.test/a.png"},
                        ]
                    ),
                )
        self.assertEqual(
            str(caught.exception),
            "lipsync photo 2 is the same image as lipsync photo 0: send a different photo for each window",
        )

    def test_fewer_than_two_photos_fails_before_any_download(self):
        params = _params([{"url": "https://img.test/a.png"}, {"url": "https://img.test/b.png"}])
        params.lipsync_photos = None
        with patch.object(user_media, "resolve_photo_ref") as resolve:
            with self.assertRaises(longcat.LongCatError) as caught:
                lipsync_photos.resolve_lipsync_photos("t1", params)
        resolve.assert_not_called()
        self.assertIn("at least 2 different face photos", str(caught.exception))


class ResolvePhotoRefTests(unittest.TestCase):
    def test_a_video_clip_is_never_a_photo(self):
        self.assertEqual(
            user_media.resolve_photo_ref({"mediaId": "0" * 32 + ".mp4"}, "x", "/tmp"),
            ("", "a video clip is not a photo"),
        )

    def test_a_ref_without_media_id_or_url_is_unusable(self):
        self.assertEqual(user_media.resolve_photo_ref({}, "x", "/tmp"), ("", "unusable media"))

    def test_media_id_resolves_through_the_temp_asset(self):
        with patch.object(user_media, "_resolve_media_id", return_value=("/assets/a.png", None)) as by_id:
            result = user_media.resolve_photo_ref({"mediaId": "0" * 32 + ".png"}, "x", "/tmp")
        self.assertEqual(result, ("/assets/a.png", None))
        by_id.assert_called_once_with("0" * 32 + ".png")

    def test_url_downloads_into_the_task_dir_with_the_token(self):
        with patch.object(user_media, "_resolve_url", return_value=("/t/x.raw", None)) as by_url:
            result = user_media.resolve_photo_ref({"url": "https://img.test/a.png"}, "lipsync-3", "/t")
        self.assertEqual(result, ("/t/x.raw", None))
        by_url.assert_called_once_with("https://img.test/a.png", "lipsync-3", "/t", session=None)


if __name__ == "__main__":
    unittest.main()
