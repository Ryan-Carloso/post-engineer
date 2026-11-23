"""The face photos of a full lip-sync video, one per narration window.

Full lip sync renders the narration as windows of at most 12s (see
full_lipsync.plan_windows). The job sends 2-5 different photos of the
persona in ``lipsync_photos``; window i shows photo i % len(photos), so the
video never stays on one photo of the same face for its whole length.

Every photo is downloaded and face-checked before any spend
(persona_preflight runs this at the start of the task), and the files land
in the task directory, so the render reuses them instead of downloading
twice. Two refs that resolve to the same bytes fail the task: a repeated
photo is exactly what this mode exists to avoid.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import shutil
from os import path

from app.models.schema import VideoParams
from app.models.segments import MIN_LIPSYNC_PHOTOS
from app.services import face_detect, longcat, user_media
from app.utils import utils


def lipsync_photo_path(task_dir: str, index: int) -> str:
    """Where photo ``index`` of the job lives in the task directory."""
    return path.join(task_dir, f"lipsync-photo-{index}.png")


def _file_digest(file_path: str) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(task_dir: str, index: int, media: dict, target: str) -> None:
    source, reason = user_media.resolve_photo_ref(media, f"lipsync-{index}", task_dir)
    if reason is not None:
        raise longcat.LongCatError(f"lipsync photo {index} could not be loaded: {reason}")
    shutil.copyfile(source, target)
    if source.startswith(task_dir + os.sep):
        with contextlib.suppress(OSError):
            os.remove(source)


def resolve_lipsync_photos(task_id: str, params: VideoParams) -> list[str]:
    """Local paths of the job's face photos, in window order.

    Raises ``longcat.LongCatError`` naming the photo index when a photo
    cannot be loaded, shows no detectable face, or repeats an earlier
    photo's bytes. A missing face detector never blocks. The reason never
    carries a URL, a path or a mediaId.
    """
    photos = params.lipsync_photos or []
    if len(photos) < MIN_LIPSYNC_PHOTOS:
        raise longcat.LongCatError(
            f"full lip sync needs at least {MIN_LIPSYNC_PHOTOS} different face photos in lipsync_photos"
        )
    task_dir = utils.task_dir(task_id)
    paths: list[str] = []
    seen: dict[str, int] = {}
    for index, photo in enumerate(photos):
        target = lipsync_photo_path(task_dir, index)
        if not (path.isfile(target) and path.getsize(target) > 0):
            _download(task_dir, index, photo.model_dump(exclude_none=True), target)
        if face_detect.image_contains_face(target) is False:
            raise longcat.LongCatError(
                f"lipsync photo {index} has no detectable face: "
                "full lip sync needs a photo of the persona's face"
            )
        digest = _file_digest(target)
        if digest in seen:
            raise longcat.LongCatError(
                f"lipsync photo {index} is the same image as lipsync photo {seen[digest]}: "
                "send a different photo for each window"
            )
        seen[digest] = index
        paths.append(target)
    return paths
