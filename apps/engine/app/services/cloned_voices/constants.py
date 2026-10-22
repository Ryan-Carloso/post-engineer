"""Shared constants for per-user Chatterbox voice cloning."""

from app.services.task import PERSONA_VOICE_MAX_BYTES, PERSONA_VOICE_MAX_SECONDS

CLONED_VOICES_STORAGE_BUCKET = "personas"

STATUS_PENDING = "pending"
STATUS_READY = "ready"
STATUS_FAILED = "failed"

# Stable failure / analytics reason codes (never ship raw provider text to clients).
ERROR_AUDIO_TOO_LARGE = "audio_too_large"
ERROR_AUDIO_TOO_LONG = "audio_too_long"
ERROR_INVALID_AUDIO = "invalid_audio"
ERROR_CONSENT_REQUIRED = "consent_required"
ERROR_STORAGE_UPLOAD_FAILED = "storage_upload_failed"
ERROR_REGISTRY_FAILED = "registry_failed"
ERROR_NOT_FOUND = "not_found"
ERROR_NOT_READY = "not_ready"
ERROR_PREVIEW_FAILED = "preview_failed"

MAX_REFERENCE_BYTES = PERSONA_VOICE_MAX_BYTES
MAX_REFERENCE_SECONDS = PERSONA_VOICE_MAX_SECONDS

# Display name for a clone (picker list); mirrors the web form limit.
MAX_CLONE_NAME_LENGTH = 60
ERROR_NAME_TOO_LONG = "name_too_long"

# Catalog id prefix: full voice_id stored on personas is chatterbox:<engine_voice_key>.
CHATTERBOX_VOICE_PREFIX = "chatterbox:"
