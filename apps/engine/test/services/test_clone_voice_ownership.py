"""Ownership guard for per-user Chatterbox engine keys."""

import unittest

from app.services.cloned_voices.ownership import (
    chatterbox_voice_allowed_for_user,
    is_user_clone_engine_key,
    user_id_prefix,
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

    def test_invalid_key_shape_is_not_user_clone(self) -> None:
        self.assertFalse(is_user_clone_engine_key("not_a_clone"))
        self.assertFalse(is_user_clone_engine_key("u_short_bad"))

    def test_user_id_prefix_strips_hyphens(self) -> None:
        user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        self.assertEqual(user_id_prefix(user_id), "a1b2c3d4e5f6")

    def test_whitespace_trimmed_on_engine_key(self) -> None:
        user_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        key = "  uaaaaaaaabbbb_cccccccccccc  "
        self.assertTrue(user_owns_clone_engine_key(user_id, key))

    def test_whitespace_trimmed_on_user_id(self) -> None:
        user_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        key = "uaaaaaaaabbbb_cccccccccccc"
        self.assertTrue(
            chatterbox_voice_allowed_for_user(f"  {user_id}  ", key),
        )

    def test_whitespace_trimmed_on_chatterbox_voice_name(self) -> None:
        user_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        key = "  uaaaaaaaabbbb_cccccccccccc  "
        self.assertTrue(chatterbox_voice_allowed_for_user(user_id, key))

    def test_user_owns_clone_returns_false_when_no_match(self) -> None:
        user_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        foreign_key = "ubbbbbbbbbbbb_dddddddddddd"
        self.assertFalse(user_owns_clone_engine_key(user_id, foreign_key))


if __name__ == "__main__":
    unittest.main()
