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
]
SOCIAL_PROVIDERS: tuple[str, ...] = get_args(SocialProvider)

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
}

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
}

URL_MEDIA_PROVIDERS: frozenset[str] = frozenset({"instagram", "threads", "facebook"})
