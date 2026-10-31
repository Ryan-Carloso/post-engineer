"""In-process LongCat-Video-Avatar renderer that keeps the model on the GPU.

Upstream's ``run_demo_avatar_single_audio_to_video.py`` is a one-shot CLI: every
run builds the tokenizer, text encoder, VAE, INT8 DiT + DMD LoRA, the Whisper
audio encoder and the vocal separator from scratch, renders one clip and exits.
Launching it through ``torchrun`` per job therefore re-read ~54 GB of weights
for every clip even though the Modal container stayed warm.

``ResidentRenderer`` is that script's ``generate()`` split in two: the model
construction happens once in ``__init__`` (called from the Modal class's
``@modal.enter()`` hook) and ``render`` runs only the per-clip part, so a warm
container pays the weight load once instead of once per job.

Deliberate differences from upstream, none of which change the rendered frames:

* The vocal separator is not built or run. Chatterbox narration is already a
  clean vocal stem, so separation was dead GPU time. The audio is still
  re-encoded to a 16 kHz mono WAV first: handing the raw upload (an MP3) to
  ``librosa.load`` killed the old child process silently.
* Single process, single GPU: no ``torchrun``, no context-parallel broadcasts.
  A one-rank NCCL group is still created because the pipeline's context-parallel
  helpers expect an initialised ``torch.distributed``.
* The generator is re-seeded before every clip, so a clip does not depend on
  how many clips the container rendered before it.
* Only the final concatenated clip is encoded; upstream also wrote one
  intermediate MP4 per segment.

Imports of ``torch`` / ``longcat_video`` live inside the methods: they exist
only in the GPU image, and the pure helpers below are unit-tested without them.

The literals shared with ``app/services/longcat.py`` (frame counts, fps) are
pinned by the sync tests in ``test/services/test_longcat_resident.py``.
"""

from __future__ import annotations

import math
import os
import socket
import subprocess
from pathlib import Path
from typing import Final

MODEL_TYPE: Final = "avatar-v1.5"
SAVE_FPS: Final = 25
NUM_FRAMES: Final = 93
NUM_COND_FRAMES: Final = 13
AUDIO_STRIDE: Final = 1
AUDIO_SAMPLE_RATE: Final = 16000
SEED: Final = 42

# --use_distill on avatar-v1.5: upstream overrides the step count and both
# guidance scales, so these are fixed rather than tunable.
DISTILL_STEPS: Final = 8
DISTILL_GUIDANCE_SCALE: Final = 1.0
# Upstream defaults that mitigate repeated gestures in longer clips.
REF_IMG_INDEX: Final = 10
MASK_FRAME_RANGE: Final = 3

SUPPORTED_RESOLUTIONS: Final = ("480p", "720p")
PROMPT: Final = "A person speaking directly to camera, natural head motion."
NEGATIVE_PROMPT: Final = (
    "Close-up, Bright tones, overexposed, static, blurred details, subtitles, "
    "style, works, paintings, images, static, overall gray, worst quality, low "
    "quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly "
    "drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, "
    "fused fingers, still picture, messy background, three legs, many people in "
    "the background, walking backwards"
)


def generate_seconds(num_segments: int) -> float:
    """Clip length: 93 frames, then 80 new frames per extra segment, at 25 fps."""
    return (
        NUM_FRAMES + (num_segments - 1) * (NUM_FRAMES - NUM_COND_FRAMES)
    ) / SAVE_FPS


def padding_samples(num_segments: int, source_samples: int) -> int:
    """Zero samples to append so the audio covers the whole generated clip."""
    source_seconds = source_samples / AUDIO_SAMPLE_RATE
    missing = math.ceil(
        (generate_seconds(num_segments) - source_seconds) * AUDIO_SAMPLE_RATE
    )
    return max(0, missing)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _to_pil_frames(output: object) -> list[object]:
    import numpy as np
    import PIL.Image

    return [
        PIL.Image.fromarray((frame * 255).astype(np.uint8))
        for frame in output  # type: ignore[attr-defined]
    ]


def _decode_speech(audio_path: Path, work_dir: Path) -> Path:
    """Re-encode the upload to the 16 kHz mono WAV the pipeline was built for."""
    target = work_dir / "speech_16k.wav"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ac", "1", "-ar", str(AUDIO_SAMPLE_RATE), str(target),
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0 or not target.exists():
        raise RuntimeError(f"audio decode failed: {result.stderr[-2000:]}")
    return target


class ResidentRenderer:
    """Holds the LongCat pipeline in GPU memory and renders clips on demand."""

    def __init__(self, checkpoint_dir: str, base_dir: str) -> None:
        import torch
        import torch.distributed as dist
        from longcat_video.audio_process import (
            get_audio_encoder,
            get_audio_feature_extractor,
        )
        from longcat_video.context_parallel import context_parallel_util
        from longcat_video.modules.autoencoder_kl_wan import AutoencoderKLWan
        from longcat_video.modules.quantization import load_quantized_dit
        from longcat_video.modules.scheduling_flow_match_euler_discrete import (
            FlowMatchEulerDiscreteScheduler,
        )
        from longcat_video.pipeline_longcat_video_avatar import (
            LongCatVideoAvatarPipeline,
        )
        from transformers import AutoTokenizer, UMT5EncoderModel

        torch.cuda.set_device(0)
        dist.init_process_group(
            backend="nccl",
            init_method=f"tcp://127.0.0.1:{_free_port()}",
            rank=0,
            world_size=1,
        )
        context_parallel_util.init_context_parallel(
            context_parallel_size=1, global_rank=0, world_size=1
        )
        cp_split_hw = context_parallel_util.get_optimal_split(
            context_parallel_util.get_cp_size()
        )

        tokenizer = AutoTokenizer.from_pretrained(
            base_dir, subfolder="tokenizer", torch_dtype=torch.bfloat16
        )
        text_encoder = UMT5EncoderModel.from_pretrained(
            base_dir, subfolder="text_encoder", torch_dtype=torch.bfloat16
        )
        vae = AutoencoderKLWan.from_pretrained(
            base_dir, subfolder="vae", torch_dtype=torch.bfloat16
        )
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(
            checkpoint_dir, subfolder="scheduler", torch_dtype=torch.bfloat16
        )
        dit = load_quantized_dit(
            checkpoint_dir, subfolder="base_model_int8", cp_split_hw=cp_split_hw
        )
        distill_lora = os.path.join(checkpoint_dir, "lora", "dmd_lora.safetensors")
        if not os.path.exists(distill_lora):
            # Upstream silently skips a missing LoRA and renders at 8 steps with
            # no distillation, which looks like a quality regression, not an error.
            raise FileNotFoundError(f"DMD distill LoRA missing: {distill_lora}")
        dit.load_lora(
            distill_lora, "dmd", multiplier=1.0,
            lora_network_dim=128, lora_network_alpha=64,
        )
        dit.enable_loras(["dmd"])

        audio_checkpoint = os.path.join(checkpoint_dir, "whisper-large-v3")
        audio_encoder = get_audio_encoder(audio_checkpoint, MODEL_TYPE).to(0)
        audio_feature_extractor = get_audio_feature_extractor(
            audio_checkpoint, MODEL_TYPE
        )

        self._pipe = LongCatVideoAvatarPipeline(
            tokenizer=tokenizer,
            text_encoder=text_encoder,
            vae=vae,
            scheduler=scheduler,
            dit=dit,
            audio_encoder=audio_encoder,
            audio_feature_extractor=audio_feature_extractor,
            model_type=MODEL_TYPE,
        )
        self._pipe.to(0)

    def render(
        self,
        image_path: Path,
        audio_path: Path,
        resolution: str,
        num_segments: int,
        output_dir: Path,
    ) -> None:
        """Render one clip to ``output_dir/clip.mp4``."""
        if resolution not in SUPPORTED_RESOLUTIONS:
            raise ValueError(f"unsupported resolution: {resolution!r}")
        if num_segments < 1:
            raise ValueError(f"num_segments must be at least 1: {num_segments}")
        try:
            self._render(image_path, audio_path, resolution, num_segments, output_dir)
        finally:
            # A failed or finished clip must not leave its activations behind
            # for the next job in this long-lived process.
            import torch

            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()

    def _render(
        self,
        image_path: Path,
        audio_path: Path,
        resolution: str,
        num_segments: int,
        output_dir: Path,
    ) -> None:
        import librosa
        import numpy as np
        import torch
        from diffusers.utils import load_image
        from longcat_video.audio_process.torch_utils import save_video_ffmpeg

        pipe = self._pipe
        generator = torch.Generator(device=0)
        generator.manual_seed(SEED)

        speech_path = _decode_speech(audio_path, output_dir)
        speech, sample_rate = librosa.load(str(speech_path), sr=AUDIO_SAMPLE_RATE)
        pad = padding_samples(num_segments, len(speech))
        if pad > 0:
            speech = np.append(speech, [0.0] * pad)

        full_audio_emb = pipe.get_audio_embedding(
            speech,
            fps=SAVE_FPS * AUDIO_STRIDE,
            device=0,
            sample_rate=sample_rate,
            model_type=MODEL_TYPE,
        )
        if torch.isnan(full_audio_emb).any():
            raise ValueError("broken audio embedding with nan values")

        window = torch.arange(2 * 2 + 1) - 2

        def audio_window(start: int) -> torch.Tensor:
            end = start + AUDIO_STRIDE * NUM_FRAMES
            centers = (
                torch.arange(start, end, AUDIO_STRIDE).unsqueeze(1)
                + window.unsqueeze(0)
            )
            centers = torch.clamp(centers, min=0, max=full_audio_emb.shape[0] - 1)
            return full_audio_emb[centers][None, ...].to(0)

        audio_start = 0
        output, latent = pipe.generate_ai2v(
            image=load_image(str(image_path)),
            prompt=PROMPT,
            negative_prompt=NEGATIVE_PROMPT,
            resolution=resolution,
            num_frames=NUM_FRAMES,
            num_inference_steps=DISTILL_STEPS,
            text_guidance_scale=DISTILL_GUIDANCE_SCALE,
            audio_guidance_scale=DISTILL_GUIDANCE_SCALE,
            output_type="both",
            generator=generator,
            audio_emb=audio_window(audio_start),
            use_distill=True,
        )
        video = _to_pil_frames(output[0])
        del output

        width, height = video[0].size  # type: ignore[attr-defined]
        current_video = video
        ref_latent = latent[:, :, :1].clone()
        all_frames = video

        for _segment in range(1, num_segments):
            audio_start += AUDIO_STRIDE * (NUM_FRAMES - NUM_COND_FRAMES)
            output, latent = pipe.generate_avc(
                video=current_video,
                video_latent=latent,
                prompt=PROMPT,
                negative_prompt=NEGATIVE_PROMPT,
                height=height,
                width=width,
                num_frames=NUM_FRAMES,
                num_cond_frames=NUM_COND_FRAMES,
                num_inference_steps=DISTILL_STEPS,
                text_guidance_scale=DISTILL_GUIDANCE_SCALE,
                audio_guidance_scale=DISTILL_GUIDANCE_SCALE,
                generator=generator,
                output_type="both",
                use_kv_cache=True,
                offload_kv_cache=False,
                enhance_hf=False,
                audio_emb=audio_window(audio_start),
                ref_latent=ref_latent,
                ref_img_index=REF_IMG_INDEX,
                mask_frame_range=MASK_FRAME_RANGE,
                use_distill=True,
            )
            new_video = _to_pil_frames(output[0])
            del output
            all_frames.extend(new_video[NUM_COND_FRAMES:])
            current_video = new_video

        save_video_ffmpeg(
            torch.from_numpy(np.array(all_frames)),
            os.path.join(str(output_dir), "clip"),
            str(audio_path),
            fps=SAVE_FPS,
            quality=5,
        )
