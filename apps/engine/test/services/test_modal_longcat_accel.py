"""Tests for the LONGCAT_ACCEL parser and its wiring into the Modal app."""

import unittest
from pathlib import Path

import modal_longcat_accel as accel

ENGINE_DIR = Path(__file__).resolve().parents[2]


class ParseAccelTests(unittest.TestCase):
    def test_empty_and_none_keep_the_original_renderer(self):
        for value in ("", "  ", "none"):
            with self.subTest(value=value):
                self.assertEqual(accel.parse_accel(value), accel.AccelConfig())

    def test_flags_turn_on_exactly_what_they_name(self):
        config = accel.parse_accel("compile_dit+compile_vae")
        self.assertEqual(
            config,
            accel.AccelConfig(compile_dit=True, compile_vae=True),
        )

    def test_every_flag_together_parses(self):
        config = accel.parse_accel("bf16+merge_lora+compile_dit+compile_vae")
        self.assertTrue(all(config))

    def test_unknown_flag_is_rejected_not_ignored(self):
        with self.assertRaisesRegex(ValueError, "'fp8' is not one of"):
            accel.parse_accel("bf16+fp8")

    def test_empty_flag_between_separators_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "'' is not one of"):
            accel.parse_accel("bf16++merge_lora")

    def test_repeated_flag_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "repeats a flag"):
            accel.parse_accel("compile_dit+compile_dit")

    def test_merge_lora_without_bf16_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "merge_lora needs bf16"):
            accel.parse_accel("merge_lora")


class AccelLabelTests(unittest.TestCase):
    def test_no_flags_label_is_none(self):
        self.assertEqual(accel.AccelConfig().label, "none")

    def test_label_is_canonical_regardless_of_input_order(self):
        config = accel.parse_accel("compile_vae+merge_lora+bf16")
        self.assertEqual(config.label, "bf16+merge_lora+compile_vae")

    def test_label_round_trips_through_the_parser(self):
        config = accel.parse_accel("bf16+compile_dit")
        self.assertEqual(accel.parse_accel(config.label), config)


class AccelWiringTests(unittest.TestCase):
    def test_gpu_image_ships_the_accel_module_and_env(self):
        source = (ENGINE_DIR / "modal_longcat_gpu.py").read_text()
        self.assertIn('"/root/modal_longcat_accel.py"', source)
        self.assertIn("ACCEL_ENV: os.environ.get(ACCEL_ENV", source)

    def test_api_image_ships_the_accel_module(self):
        source = (ENGINE_DIR / "modal_longcat.py").read_text()
        self.assertIn('"/root/modal_longcat_accel.py"', source)

    def test_app_parses_accel_at_import_so_a_typo_fails_the_deploy(self):
        source = (ENGINE_DIR / "modal_longcat.py").read_text()
        self.assertIn('ACCEL = parse_accel(os.environ.get(ACCEL_ENV, ""))', source)
        self.assertIn("AVATAR_WEIGHTS_DIR, BASE_WEIGHTS_DIR, ACCEL", source)

    def test_done_status_reports_the_accel_label(self):
        source = (ENGINE_DIR / "modal_longcat.py").read_text()
        self.assertIn('"accel": self.renderer.accel.label', source)

    def test_upstream_checkout_is_pinned_to_a_commit(self):
        source = (ENGINE_DIR / "modal_longcat_gpu.py").read_text()
        self.assertRegex(source, r'LONGCAT_REPO_COMMIT = "[0-9a-f]{40}"')
        self.assertNotIn("git clone --depth 1", source)


if __name__ == "__main__":
    unittest.main()
