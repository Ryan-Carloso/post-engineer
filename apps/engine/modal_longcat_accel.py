"""Inference accelerations for the resident LongCat renderer.

Every acceleration is opt-in, named, and reported with each clip, so the cost
of a clip can always be traced back to the exact renderer build that made it.
``LONGCAT_ACCEL`` holds a ``+``-joined list of flags (``bf16+merge_lora``);
empty or ``none`` keeps the original renderer.

* ``bf16``: load ``base_model`` (bf16) instead of ``base_model_int8``. The INT8
  ``QuantizedLinear`` dequantizes its whole weight on every forward call, which
  saves VRAM the 80 GB cards do not need and costs time on every step.
* ``merge_lora``: fold the DMD distillation LoRA into the weights once at load,
  instead of running the LoRA branch next to every Linear on every step. It
  needs ``bf16``: upstream only merges into ``nn.Linear``, never into
  ``QuantizedLinear``.
* ``compile_dit``: ``torch.compile`` each DiT block (upstream's
  ``--compile_dit`` options). The first clip of each shape pays the compile.
* ``compile_vae``: upstream's ``--compile_vae`` (fused padding, cache views,
  compiled encoder/decoder).

This module imports nothing outside the standard library: the engine tests and
the bench report load it without torch or Modal.
"""

from __future__ import annotations

from typing import Final, NamedTuple

ACCEL_ENV: Final = "LONGCAT_ACCEL"
ACCEL_FLAGS: Final[tuple[str, ...]] = ("bf16", "merge_lora", "compile_dit", "compile_vae")
NO_ACCEL_LABEL: Final = "none"


class AccelConfig(NamedTuple):
    """Which accelerations a renderer was built with."""

    bf16: bool = False
    merge_lora: bool = False
    compile_dit: bool = False
    compile_vae: bool = False

    @property
    def label(self) -> str:
        """Canonical ``+``-joined flag list in ACCEL_FLAGS order, or ``none``."""
        enabled = [flag for flag in ACCEL_FLAGS if getattr(self, flag)]
        return "+".join(enabled) if enabled else NO_ACCEL_LABEL


def parse_accel(value: str) -> AccelConfig:
    """Parse a ``LONGCAT_ACCEL`` value strictly.

    Unknown, empty-between-separators and repeated flags are rejected rather
    than ignored: a typo would otherwise deploy the slow renderer while the
    operator believes the fast one is live.
    """
    text = value.strip()
    if text in ("", NO_ACCEL_LABEL):
        return AccelConfig()
    flags = text.split("+")
    for flag in flags:
        if flag not in ACCEL_FLAGS:
            raise ValueError(
                f"{ACCEL_ENV} flag {flag!r} is not one of {', '.join(ACCEL_FLAGS)}"
            )
    if len(set(flags)) != len(flags):
        raise ValueError(f"{ACCEL_ENV} repeats a flag: {value!r}")
    config = AccelConfig(**{flag: True for flag in flags})
    if config.merge_lora and not config.bf16:
        raise ValueError(f"{ACCEL_ENV} merge_lora needs bf16: INT8 layers cannot merge a LoRA")
    return config
