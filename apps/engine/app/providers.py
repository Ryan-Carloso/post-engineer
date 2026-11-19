"""The social networks the engine publishes to.

The one list is ``shared/contracts/providers.ts`` (SOCIAL_PROVIDERS). The
engine cannot import TypeScript, so it keeps this one mirror, and the
provider-lists lint (``.github/scripts/provider-lists``) fails when the
mirror drifts from the shared list or when another engine module types a
provider list of its own. Every engine module imports from here.
"""

from __future__ import annotations

from typing import Literal, get_args

SocialProvider = Literal[
    "youtube",
    "instagram",
    "bluesky",
    "linkedin",
    "threads",
    "facebook",
    "pinterest",
    "3speak",
    "rumble",
    "fanvue",
    "telegram",
]
SOCIAL_PROVIDERS: tuple[str, ...] = get_args(SocialProvider)

# Display names, the same as PROVIDER_LABELS in apps/web/lib/account-options.ts
# (pinned by test/services/test_owner_alert_lookups.py).
PROVIDER_LABELS: dict[str, str] = {
    "youtube": "YouTube",
    "instagram": "Instagram",
    "bluesky": "Bluesky",
    "linkedin": "LinkedIn",
    "threads": "Threads",
    "facebook": "Facebook",
    "pinterest": "Pinterest",
    "3speak": "3Speak",
    "rumble": "Rumble",
    "fanvue": "Fanvue",
    "telegram": "Telegram",
}

# The account-id column of each network in public.schedules, the same as
# SCHEDULE_ACCOUNT_COLUMNS in shared/contracts/providers.ts.
SCHEDULE_ACCOUNT_COLUMNS: dict[str, str] = {
    "youtube": "youtube_account_ids",
    "instagram": "instagram_account_ids",
    "bluesky": "bluesky_account_ids",
    "linkedin": "linkedin_account_ids",
    "threads": "threads_account_ids",
    "facebook": "facebook_account_ids",
    "pinterest": "pinterest_account_ids",
    "3speak": "threespeak_account_ids",
    "rumble": "rumble_account_ids",
    "fanvue": "fanvue_account_ids",
    "telegram": "telegram_account_ids",
}

# Networks whose publish can send the video as a storage path the web
# fetches (``videoStoragePath``) instead of the multipart bytes: the web
# hands those networks a URL to pull the video from.
URL_MEDIA_PROVIDERS: frozenset[str] = frozenset({"instagram", "threads", "facebook"})
