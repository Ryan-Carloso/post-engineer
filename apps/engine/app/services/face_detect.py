import threading

from loguru import logger

from app.config import config

_FACE_MODULE_LOADED = False
_FACE_MODULE = None
_FACE_MODULE_LOCK = threading.Lock()


def _load_cv2():
    """Lazy-load cv2 (opencv-python-headless) to defer the import cost.

    Detection only runs when material_exclude_people=true; if the package
    is not installed, log it and treat the filter as inactive (don't fail
    the task).
    """
    global _FACE_MODULE, _FACE_MODULE_LOADED
    if _FACE_MODULE_LOADED:
        return _FACE_MODULE
    with _FACE_MODULE_LOCK:
        if _FACE_MODULE_LOADED:
            return _FACE_MODULE
        try:
            import cv2  # noqa: PLC0415

            _FACE_MODULE = cv2
            _FACE_MODULE_LOADED = True
            logger.info("face detection: opencv-python-headless loaded")
        except ImportError:
            _FACE_MODULE_LOADED = True
            logger.warning(
                "material_exclude_people=true but opencv-python-headless is not "
                "installed; face filtering disabled. Run `uv sync` to install it."
            )
    return _FACE_MODULE


def video_contains_face(
    video_path: str, frames_to_sample: int = 8, force_exclude: bool | None = None
) -> bool:
    """True if any decoded frame of the video contains a detected human face.

    Downscales to <w_max=360> before running the Haar cascade to keep the
    cost low on CPU workers. Any open/decode error makes the function
    return False (don't block the material over an unrelated failure).
    """
    cv2 = _load_cv2()
    if cv2 is None:
        return False

    enabled = (
        force_exclude
        if force_exclude is not None
        else config.app.get("material_exclude_people", False)
    )
    if not enabled:
        return False

    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    if cascade.empty():
        logger.warning("face detection: Haar cascade failed to load; filter inactive")
        return False

    cap = None
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return False
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            return False
        step = max(1, total_frames // frames_to_sample)
        frame_index = 0
        ok = True
        while ok:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % step != 0:
                frame_index += 1
                continue
            frame_index += 1
            height, width = frame.shape[:2]
            if width > 360:
                scale = 360 / width
                new_size = (360, max(1, int(height * scale)))
                frame = cv2.resize(frame, new_size, interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24)
            )
            if len(faces) > 0:
                logger.info(
                    f"face detection: '{video_path}' has {len(faces)} face(s); skipping"
                )
                return True
        return False
    except Exception as e:
        logger.warning(f"face detection failed for '{video_path}': {str(e)}")
        return False
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass