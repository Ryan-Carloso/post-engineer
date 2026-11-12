"""Email the owner when a post fails to generate or publish.

Resend is called directly from the engine. Discord alerts stay in
``notify.py`` and are unchanged. A missing ``RESEND_API_KEY`` or
``ACCOUNT_BREAK_FROM`` is a no-op. Under the engine test suite the sender
returns before any HTTP unless the caller injects a session, so pytest
never hits the key loaded from the tracked ``.env``.

The body carries a scrubbed reason, never a token. Dedup is
``claim_owner_alert`` (migration 059): one email per slot (or per direct
task). A failed send releases the claim.
"""

from __future__ import annotations

import html
import os
import threading
from typing import Any, Callable

from loguru import logger

from app.services.analytics import scrub_error_text
from app.services.notify import running_under_test
from app.services.owner_alert_lookups import (
    TIMEOUT_SECONDS,
    lookup_account_names,
    lookup_persona_name,
    provider_label,
    supabase_rest,
)

RESEND_URL = "https://api.resend.com/emails"
USER_AGENT = "post-engineer/owner-alert"
DEFAULT_ORIGIN = "https://post-engineer.com"
REASON_CHARS = 300


def direct_task_email_user(task: dict | None) -> str | None:
    """User to email for a task that is not a batch slot.

    Slot failures are emailed by the scheduler (generate / reconcile),
    not from the task failure path, so a row with ``slot_id`` returns
    None. ``unknown`` is the tracking sentinel, not an account.
    """
    if not isinstance(task, dict):
        return None
    slot_id = task.get("slot_id")
    if isinstance(slot_id, str) and slot_id.strip():
        return None
    user_id = task.get("user_id")
    if not isinstance(user_id, str):
        return None
    user_id = user_id.strip()
    if not user_id or user_id == "unknown":
        return None
    return user_id


def _from_address() -> str:
    raw = os.getenv("ACCOUNT_BREAK_FROM", "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {'"', "'"}:
        raw = raw[1:-1].strip()
    return raw


def _origin() -> str:
    raw = os.getenv("MPT_UPLOAD_API_BASE_URL", "").strip().rstrip("/")
    return raw or DEFAULT_ORIGIN


def _post_link(slot_id: str | None) -> str:
    origin = _origin()
    if slot_id:
        return f"{origin}/posts/{slot_id}"
    return f"{origin}/posts"


def _accounts_link() -> str:
    return f"{_origin()}/accounts"


def _clean(value: str) -> str:
    return " ".join(value.replace("\r", " ").replace("\n", " ").split())


def _render(subject: str, heading_bits: list[str], links: list[tuple[str, str]]) -> tuple[str, str]:
    """HTML card plus a plain-text twin. User text is escaped."""
    html_parts = [
        "<!DOCTYPE html><html><body style=\"margin:0;background:#f4f4f5;",
        "font-family:Georgia,serif;\">",
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" ",
        "cellspacing=\"0\"><tr><td align=\"center\" style=\"padding:32px 16px;\">",
        "<table role=\"presentation\" width=\"100%\" style=\"max-width:480px;",
        "background:#ffffff;border-radius:12px;padding:32px;\"><tr><td>",
        "<p style=\"margin:0 0 8px;font-size:13px;color:#71717a;\">Post Engineer</p>",
        f"<h1 style=\"margin:0 0 16px;font-size:22px;color:#18181b;\">{html.escape(subject)}</h1>",
    ]
    text_parts = [subject, ""]
    for bit in heading_bits:
        clean = _clean(bit)
        if not clean:
            continue
        html_parts.append(
            f"<p style=\"margin:0 0 12px;color:#18181b;\">{html.escape(clean)}</p>"
        )
        text_parts.append(clean)
    text_parts.append("")
    for label, url in links:
        html_parts.append(
            f"<p style=\"margin:0 0 8px;\"><a href=\"{html.escape(url, quote=True)}\">"
            f"{html.escape(label)}</a></p>"
        )
        text_parts.append(f"{label}: {url}")
    html_parts.append("</td></tr></table></td></tr></table></body></html>")
    return "".join(html_parts), "\n".join(text_parts)


def _reason(reason: str, fallback: str) -> str:
    cleaned = _clean(scrub_error_text(reason or "", max_chars=REASON_CHARS))
    return cleaned or fallback


def _failure_lines(
    failures: list[dict[str, Any]] | None,
    account_names: dict[tuple[str, str], str],
) -> list[str]:
    """One line per failed provider: network — account — scrubbed reason.

    The account shows its display name when the lookup found one, else the
    raw provider account id. A failure without a reason still names the
    account, so the owner knows which one to reconnect.
    """
    lines: list[str] = []
    for item in failures or []:
        if not isinstance(item, dict):
            continue
        provider = item.get("provider")
        account = item.get("account_id")
        label = provider_label(provider) if isinstance(provider, str) else "Unknown"
        name = None
        if isinstance(provider, str) and isinstance(account, str):
            name = account_names.get((provider, account))
        who = name or (account if isinstance(account, str) and account else label)
        reason = item.get("reason")
        detail = _reason(reason, "") if isinstance(reason, str) else ""
        line = f"{label} — {who}"
        if detail:
            line = f"{line} — {detail}"
        lines.append(_clean(line))
    return lines


def _claim(session: Any, base: str, headers: dict[str, str], user_id: str, dedup_key: str) -> bool:
    response = session.request(
        "POST",
        f"{base}/rest/v1/rpc/claim_owner_alert",
        headers=headers,
        json={
            "p_user_id": user_id,
            "p_dedup_key": dedup_key,
            "p_window_days": None,
        },
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        logger.warning(f"owner alert claim status {response.status_code}")
        return False
    return response.json() is True


def _release(
    session: Any, base: str, headers: dict[str, str], user_id: str, dedup_key: str,
) -> None:
    response = session.request(
        "POST",
        f"{base}/rest/v1/rpc/release_owner_alert",
        headers=headers,
        json={"p_user_id": user_id, "p_dedup_key": dedup_key},
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        logger.warning(f"owner alert release status {response.status_code}")


def _owner_email(session: Any, base: str, headers: dict[str, str], user_id: str) -> str:
    response = session.request(
        "GET",
        f"{base}/auth/v1/admin/users/{user_id}",
        headers=headers,
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        return ""
    payload = response.json()
    if not isinstance(payload, dict):
        return ""
    email = payload.get("email")
    if not isinstance(email, str):
        user = payload.get("user")
        if isinstance(user, dict):
            email = user.get("email")
    if not isinstance(email, str):
        return ""
    return email.strip()


def _post_resend(
    session: Any,
    api_key: str,
    sender: str,
    email: str,
    subject: str,
    html_body: str,
    text: str,
) -> bool:
    response = session.request(
        "POST",
        RESEND_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
        json={"from": sender, "to": [email], "subject": subject, "html": html_body, "text": text},
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        logger.warning(f"owner alert resend status {response.status_code}")
        return False
    return True


def send_owner_email(
    *,
    user_id: str,
    dedup_key: str,
    subject: str,
    html_body: str,
    text: str,
    session: Any = None,
) -> None:
    """Send one deduped email. Never raises.

    ``session`` is a ``requests``-like object (``.request``). Tests inject
    one. Production opens its own. With no session during the test suite
    this returns before any network call.
    """
    if session is None and running_under_test():
        return
    try:
        _deliver(user_id, dedup_key, subject, html_body, text, session)
    except Exception as exc:  # noqa: BLE001 — an email must not fail the tick
        logger.warning(f"owner alert failed: {type(exc).__name__}")


def _deliver(
    user_id: str,
    dedup_key: str,
    subject: str,
    html_body: str,
    text: str,
    session: Any,
) -> None:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    sender = _from_address()
    if not api_key or not sender or not user_id or not dedup_key:
        logger.warning("owner alert skipped: resend is not configured")
        return
    supabase = supabase_rest()
    if supabase is None:
        return
    base, headers = supabase
    own_session = session is None
    if session is None:
        import requests

        session = requests.Session()
    claimed = False
    try:
        if not _claim(session, base, headers, user_id, dedup_key):
            return
        claimed = True
        email = _owner_email(session, base, headers, user_id)
        sent = bool(email) and _post_resend(
            session, api_key, sender, email, subject, html_body, text,
        )
        if not sent:
            _release(session, base, headers, user_id, dedup_key)
            claimed = False
    except Exception:
        if claimed:
            try:
                _release(session, base, headers, user_id, dedup_key)
            except Exception as release_exc:  # noqa: BLE001
                logger.warning(
                    f"owner alert release failed: {type(release_exc).__name__}"
                )
        raise
    finally:
        if own_session:
            session.close()


def notify_owner_async(target: Callable[..., None], /, *args: Any, **kwargs: Any) -> None:
    """Fire-and-forget an owner email off the scheduler tick.

    One delivery is up to three sequential HTTP calls with a 10s timeout
    each; a slow Supabase or Resend must not stall the tick and delay
    publishing of other due slots. The target never raises, and the dedup
    claim is atomic, so a detached daemon thread is safe.
    """
    threading.Thread(target=target, args=args, kwargs=kwargs, daemon=True).start()


def notify_generation_failed(
    user_id: str | None,
    *,
    slot_id: str | None,
    title: str,
    reason: str,
    persona: str | None = None,
    schedule_id: str | None = None,
    dedup_key: str | None = None,
    session: Any = None,
) -> None:
    """Email once for a generation that will not be retried.

    The persona rides along when the caller knows it; the reconciler only
    has the schedule id, so the name is looked up best-effort instead.
    """
    key = dedup_key or (f"generate:{slot_id}" if slot_id else "")
    if not user_id or not key:
        return
    label = _clean(title) or "A scheduled post"
    subject = "A post could not be generated"
    detail = _reason(reason, "The video could not be generated.")
    if persona is None and schedule_id:
        persona = lookup_persona_name(session, schedule_id)
    bits = [label]
    if isinstance(persona, str) and _clean(persona):
        bits.append(f"Persona: {_clean(persona)}")
    bits.append(f"What happened: {detail}")
    html_body, text = _render(
        subject,
        bits,
        [("Open the post", _post_link(slot_id))],
    )
    send_owner_email(
        user_id=user_id,
        dedup_key=key,
        subject=subject,
        html_body=html_body,
        text=text,
        session=session,
    )


def notify_publish_failed(
    user_id: str | None,
    *,
    slot_id: str,
    title: str,
    reason: str,
    persona: str | None = None,
    failures: list[dict[str, Any]] | None = None,
    session: Any = None,
) -> None:
    """Email once when a slot will not be published again.

    ``failures`` is the failed outcomes (provider, account id, reason):
    each gets its own line — network, account name, reason — so the owner
    sees which account on which network failed and why.
    """
    if not user_id or not slot_id:
        return
    label = _clean(title) or "A scheduled post"
    subject = "A post could not be published"
    detail = _reason(reason, "The post could not be published.")
    bits = [label]
    if isinstance(persona, str) and _clean(persona):
        bits.append(f"Persona: {_clean(persona)}")
    bits.append(f"What happened: {detail}")
    names = lookup_account_names(session, user_id) if failures else {}
    bits.extend(_failure_lines(failures, names))
    html_body, text = _render(
        subject,
        bits,
        [
            ("Open the post", _post_link(slot_id)),
            ("Reconnect accounts", _accounts_link()),
        ],
    )
    send_owner_email(
        user_id=user_id,
        dedup_key=f"publish:{slot_id}",
        subject=subject,
        html_body=html_body,
        text=text,
        session=session,
    )


def notify_publish_partial(
    user_id: str | None,
    *,
    slot_id: str,
    title: str,
    failures: list[dict[str, Any]] | None = None,
    persona: str | None = None,
    session: Any = None,
) -> None:
    """Email once when a post went out but some accounts did not get it."""
    if not user_id or not slot_id:
        return
    names = lookup_account_names(session, user_id) if failures else {}
    lines = _failure_lines(failures, names)
    if not lines:
        return
    label = _clean(title) or "A scheduled post"
    subject = "A post did not reach every account"
    bits = [label]
    if isinstance(persona, str) and _clean(persona):
        bits.append(f"Persona: {_clean(persona)}")
    bits.append("These accounts did not get the post:")
    bits.extend(lines)
    html_body, text = _render(
        subject,
        bits,
        [
            ("Open the post", _post_link(slot_id)),
            ("Reconnect accounts", _accounts_link()),
        ],
    )
    send_owner_email(
        user_id=user_id,
        dedup_key=f"publish-partial:{slot_id}",
        subject=subject,
        html_body=html_body,
        text=text,
        session=session,
    )


def _email_direct_generation_failure(task_id: str, error: str, params: Any) -> None:
    from app.services import state as state_module

    try:
        task = state_module.state.get_task(task_id) or {}
    except Exception as exc:  # noqa: BLE001 — email must not hide the failure
        logger.warning(f"owner alert task read failed: {type(exc).__name__}")
        return
    user_id = direct_task_email_user(task if isinstance(task, dict) else None)
    if user_id is None:
        return
    title = ""
    if params is not None:
        raw_title = getattr(params, "video_title", "")
        if isinstance(raw_title, str):
            title = raw_title
    notify_generation_failed(
        user_id,
        slot_id=None,
        title=title,
        reason=str(error),
        dedup_key=f"generate-task:{task_id}",
    )


def alert_failed_task(
    task_id: str,
    error: str,
    params: Any,
    should_alert: Any,
    release: Any,
    send: Any,
    message: Any,
) -> None:
    """Discord alert extracted from ``_fail_task`` so that file does not grow.

    ``send`` and ``message`` are the task module's ``send_discord`` and
    ``task_failed_msg``, passed in so tests that patch those names still
    intercept the alert. A direct generation (no slot) also emails the
    owner. Slot failures are emailed by the scheduler instead.
    """
    if not running_under_test():
        _email_direct_generation_failure(task_id, error, params)
    if not should_alert(task_id):
        return
    subject = params.video_title if params else ""
    if not send(message(task_id, error, subject)):
        release(task_id)
