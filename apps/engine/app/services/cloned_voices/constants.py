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
ERROR_REGISTRY_NOT_CONFIGURED = "registry_not_configured"
ERROR_REGISTRY_FAILED = "registry_failed"
ERROR_NOT_FOUND = "not_found"
ERROR_NOT_READY = "not_ready"
ERROR_PREVIEW_FAILED = "preview_failed"

MAX_REFERENCE_BYTES = PERSONA_VOICE_MAX_BYTES
MAX_REFERENCE_SECONDS = PERSONA_VOICE_MAX_SECONDS

# Catalog id prefix for clones: new clones are chatterbox_nano:<engine_voice_key>
# (Nano, local CPU). The legacy chatterbox: prefix stays valid for routing so
# personas stored before the rename keep speaking.
CHATTERBOX_VOICE_PREFIX = "chatterbox:"
CHATTERBOX_NANO_VOICE_PREFIX = "chatterbox_nano:"
