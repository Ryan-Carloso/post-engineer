"""Ownership guard for per-user Chatterbox engine keys."""

import unittest

from app.services.cloned_voices.ownership import (
    chatterbox_voice_allowed_for_user,
    is_user_clone_engine_key,
    user_owns_clone_engine_key,
)


class CloneVoiceOwnershipTest(unittest.TestCase):
    def test_house_voice_always_allowed(self) -> None:
        self.assertTrue(chatterbox_voice_allowed_for_user("any-user", "ryan"))
        self.assertFalse(is_user_clone_engine_key("ryan"))

    def test_user_clone_key_shape(self) -> None:
        user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        key = "ua1b2c3d4e5f6_7890abcdef01"
        self.assertTrue(is_user_clone_engine_key(key))
        self.assertTrue(user_owns_clone_engine_key(user_id, key))
        self.assertFalse(user_owns_clone_engine_key("00000000-0000-0000-0000-000000000001", key))

    def test_wrong_user_rejected(self) -> None:
        owner = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        other = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee"
        key = "uaaaaaaaabbbb_cccccccccccc"
        self.assertTrue(user_owns_clone_engine_key(owner, key))
        self.assertFalse(chatterbox_voice_allowed_for_user(other, key))

    def test_clone_without_user_id_rejected(self) -> None:
        key = "uaaaaaaaabbbb_dddddddddddd"
        self.assertFalse(chatterbox_voice_allowed_for_user(None, key))
        self.assertFalse(chatterbox_voice_allowed_for_user("", key))


if __name__ == "__main__":
    unittest.main()
