"""In-process bridge to the InfiniteTalk pipeline.

Loads the Wan2.1/InfiniteTalk checkpoints once (callable from a Modal memory
snapshot via ``load_model``) and runs inference in-process via ``run_inference``
instead of shelling out to ``generate_infinitetalk.py``. The inference flow
mirrors the upstream ``generate()`` body for the single-speaker clip case.
"""

from __future__ import annotations

import sys
from argparse import Namespace
from pathlib import Path
from typing import Any

INFINITETALK_DIR = "/InfiniteTalk"
if INFINITETALK_DIR not in sys.path:
    sys.path.insert(0, INFINITETALK_DIR)

import torch  # noqa: E402  (must precede wan imports on some setups)

import generate_infinitetalk as upstream  # noqa: E402
import wan  # noqa: E402
from wan.configs import WAN_CONFIGS  # noqa: E402

TASK = "infinitetalk-14B"
SIZE_SHIFT = {"infinitetalk-480": 7.0, "infinitetalk-720": 11.0}

_pipeline: Any = None
_wav2vec_fe: Any = None
_wav2vec_enc: Any = None


def _base_args(
    ckpt_dir: str,
    wav2vec_dir: str,
    infinitetalk_dir: str,
    frames: int,
    sample_steps: int,
    teacache_thresh: float,
    save_file: str,
    input_json: str = "unused.json",
    size: str = "infinitetalk-480",
) -> Namespace:
    """Mirror the CLI defaults of upstream _parse_args for the clip path."""
    return Namespace(
        task=TASK,
        size=size,
        frame_num=frames,
        max_frame_num=1000,
        ckpt_dir=ckpt_dir,
        infinitetalk_dir=infinitetalk_dir,
        quant_dir=None,
        wav2vec_dir=wav2vec_dir,
        dit_path=None,
        lora_dir=None,
        lora_scale=[1.2],
        offload_model=False,
        ulysses_size=1,
        ring_size=1,
        t5_fsdp=False,
        t5_cpu=False,
        dit_fsdp=False,
        save_file=save_file,
        base_seed=42,
        input_json=input_json,
        motion_frame=9,
        mode="clip",
        sample_steps=sample_steps,
        sample_shift=SIZE_SHIFT[size],
        sample_text_guide_scale=5.0,
        sample_audio_guide_scale=4.0,
        num_persistent_param_in_dit=None,
        audio_mode="localfile",
        use_teacache=True,
        teacache_thresh=teacache_thresh,
        use_apg=False,
        apg_momentum=-0.75,
        apg_norm_threshold=55,
        color_correction_strength=1.0,
        scene_seg=False,
        quant=None,
    )


def load_model(
    ckpt_dir: str,
    wav2vec_dir: str,
    infinitetalk_dir: str,
    sample_steps: int,
    teacache_thresh: float,
    frames: int,
) -> None:
    """Build the pipeline and audio encoder once, before snapshotting."""
    global _pipeline, _wav2vec_fe, _wav2vec_enc
    args = _base_args(
        ckpt_dir, wav2vec_dir, infinitetalk_dir, frames,
        sample_steps, teacache_thresh, save_file="unused",
    )
    cfg = WAN_CONFIGS[args.task]
    _pipeline = wan.InfiniteTalkPipeline(
        config=cfg,
        checkpoint_dir=ckpt_dir,
        quant_dir=args.quant_dir,
        device_id=0,
        rank=0,
        t5_fsdp=args.t5_fsdp,
        dit_fsdp=args.dit_fsdp,
        use_usp=False,
        t5_cpu=args.t5_cpu,
        lora_dir=args.lora_dir,
        lora_scales=args.lora_scale,
        quant=args.quant,
        dit_path=args.dit_path,
        infinitetalk_dir=infinitetalk_dir,
    )
    _wav2vec_fe, _wav2vec_enc = upstream.custom_init("cpu", wav2vec_dir)


def run_inference(
    image_path: str,
    audio_path: str,
    output_base: str,
    work_dir: str,
    frames: int,
    sample_steps: int,
    teacache_thresh: float,
    size: str,
    ckpt_dir: str,
    wav2vec_dir: str,
    infinitetalk_dir: str,
) -> str:
    """Generate one clip in-process and return the written MP4 path."""
    if _pipeline is None:
        raise RuntimeError("load_model() must run before run_inference()")
    args = _base_args(
        ckpt_dir, wav2vec_dir, infinitetalk_dir, frames,
        sample_steps, teacache_thresh, save_file=output_base, size=size,
    )
    audio_save_dir = Path(work_dir) / "audio"
    audio_save_dir.mkdir(parents=True, exist_ok=True)

    human_speech = upstream.audio_prepare_single(audio_path)
    sum_audio = str(audio_save_dir / "sum_all.wav")
    import soundfile as sf

    sf.write(sum_audio, human_speech, 16000)
    audio_embedding = upstream.get_embedding(human_speech, _wav2vec_fe, _wav2vec_enc)
    if audio_embedding is None:
        raise RuntimeError("failed to extract audio embedding")
    emb_path = str(audio_save_dir / "1.pt")
    torch.save(audio_embedding, emb_path)

    input_clip = {
        "prompt": "A persona speaks naturally to camera with subtle head, facial, and upper-body movement.",
        "cond_video": image_path,
        "cond_audio": {"person1": emb_path},
        "video_audio": sum_audio,
    }
    video = _pipeline.generate_infinitetalk(
        input_clip,
        size_buckget=args.size,
        motion_frame=args.motion_frame,
        frame_num=args.frame_num,
        shift=args.sample_shift,
        sampling_steps=args.sample_steps,
        text_guide_scale=args.sample_text_guide_scale,
        audio_guide_scale=args.sample_audio_guide_scale,
        seed=args.base_seed,
        offload_model=args.offload_model,
        max_frames_num=args.frame_num if args.mode == "clip" else args.max_frame_num,
        color_correction_strength=args.color_correction_strength,
        extra_args=args,
    )
    upstream.save_video_ffmpeg(video, output_base, [sum_audio], high_quality_save=False)
    return f"{output_base}.mp4"
