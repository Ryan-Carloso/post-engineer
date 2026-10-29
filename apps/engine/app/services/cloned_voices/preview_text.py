"""Validation for the optional cloned-voice preview text.

The preview endpoint accepts ``{"text": "..."}`` so the clone speaks the
caller's words instead of the fixed sample. The cap is one constant per
app with the same literal — engine here, web preview-route sibling
(``apps/web/app/api/persona/cloned-voices/[cloneId]/preview/preview-text.ts``)
and the MCP limits module (``apps/mcp/src/limits.ts``) — pinned across
the three by ``apps/mcp/src/__tests__/clone-preview-text-sync.test.ts``.
"""

CLONE_PREVIEW_TEXT_MAX_CHARS = 300

# Stable client-facing message: it carries only the bound, never the
# submitted text, so a rejection can never echo what was typed.
_PREVIEW_TEXT_INVALID = (
    "preview text must be 1 to "
    f"{CLONE_PREVIEW_TEXT_MAX_CHARS} characters after trimming"
)


def validate_preview_text(raw: str | None) -> str | None:
    """Validate optional preview text; the trimmed text, or None when absent.

    Raises ValueError (stable message, never the text itself) when the
    value is empty after trimming or longer than
    CLONE_PREVIEW_TEXT_MAX_CHARS. Never truncates. The string type is
    enforced earlier by the endpoint's pydantic body model.
    """
    if raw is None:
        return None
    text = raw.strip()
    if not text or len(text) > CLONE_PREVIEW_TEXT_MAX_CHARS:
        raise ValueError(_PREVIEW_TEXT_INVALID)
    return text
