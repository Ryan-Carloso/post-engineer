# Infrastructure plan: one container per video

Date: 2026-11-23, revised the same day. Recommendation only. This
document does not change application code, migrations, or the deploy.

The first draft of this file recommended leaving the CPU stack on one
VPS. That is the wrong shape for the goal that replaced it: every
video renders in its own container instead of waiting on one box.
About 30 image-only videos must be able to render at the same time.
Web, the MCP server, and Postgres stay where they are. LongCat stays
on Modal GPU, and its `max_containers=1` does not change.

Secret values are not in this file. Only secret and variable names.

Names in this plan that do not exist in the repository yet are marked
**(new)**. They are proposals for the implementation PR.

## Recommendation

Every video, of every type, renders in one Modal CPU container. That
container runs TTS, Whisper, and ffmpeg. For a lip-sync video it also
calls LongCat for the face and waits for it. The VPS engine stops
rendering. It accepts tasks and spawns containers.

| Video type | Modal CPU function **(new)** | CPU | RAM | `max_containers` |
| --- | --- | --- | --- | --- |
| `faceless`, house voice | `render_faceless` | 1 physical core (2 vCPU) | 4 GiB | 30 |
| `faceless`, `chatterbox_nano:` clone | `render_faceless_clone` | 1 physical core | 10 GiB | 30 |
| `hook_lipsync` and `full_lipsync`, any voice | `render_lipsync` | 2 physical cores | 10 GiB | 2 |

All three functions use one image and one entrypoint. They differ
only in resources, so a house-voice video does not pay for 10 GiB.
`min_containers` is 0 on all three, with no warm pool, so idle time
costs nothing. Do not put a GPU on any of them. LongCat stays the only
GPU app.

`render_lipsync` is capped at 2 because LongCat renders one face at a
time. One container waits on the GPU while the next one does its
TTS and Whisper. A third lip-sync job waits in Modal's input queue,
which is not billed, instead of in a container that is billed while
it waits.

Planning cost per video (numbers below, not measured):

| Video | CPU container | LongCat GPU |
| --- | --- | --- |
| Faceless, house voice | $0.004 | none |
| Faceless, clone | $0.017 | none |
| Hook lip-sync | $0.03 | ~$0.45 |
| Full lip-sync, 40 s | $0.12 | ~$2.10 |

Thirty faceless house-voice videos at once cost about **$0.12** of CPU.
A month of 300 is about **$1.20**. For lip-sync, the CPU container
adds about 5% to the GPU bill.

Runner-up for the faceless functions: Google Cloud Run Jobs, one task
per video, parallelism at least 30. Same shape, about **$0.008** per
house-voice video. Its free tier (240,000 vCPU-seconds and 450,000
GiB-seconds per month) covers a 300-video month. Pick it if the $30
Modal credit must go only to LongCat. It needs a new GCP project, an
image registry, and a quota check before the first burst of 30.
Lip-sync stays on Modal either way, next to the GPU it calls.

Do not keep a separate autoscaled TTS service. The current TTS
process holds one lock for every voice. Each container loads Kokoro
or Phonon for a house voice, and Chatterbox Nano only for a clone.

## The concurrency limit is ours, not Modal's plan

`GenerateAvatar` in `apps/engine/modal_longcat.py` sets
`max_containers=1`. That is why lip-sync runs one GPU container at a
time. It is an argument on that class. It is not a workspace cap, and
it does not apply to a CPU function.

Modal's Starter plan, from the pricing page, allows **100 concurrent
containers** and **10 concurrent GPUs**. Those are different counters.
At the peak of this plan, 30 faceless plus 30 clone plus 2 lip-sync
CPU containers plus 1 LongCat GPU container is 63 containers, which
fits on Starter. The Team plan ($250/month) is not required.

Set a short `scaledown_window` on the CPU functions so an idle
container does not sit for Modal's default 60 seconds.

## Unit of work today

The engine renders three video types (`video_type` on `VideoParams`):

- `faceless`: the agent's images on a neutral canvas, a voice, and
  ffmpeg. No LongCat.
- `hook_lipsync`: the persona speaks the hook (at most 12 s,
  `PERSONA_LIPSYNC_MAX_SECONDS`). LongCat renders that clip, then
  `compose_lipsync_layout` joins it to the rest of the video.
- `full_lipsync`: the whole narration is the persona talking.
  `full_lipsync.render_full_lipsync` cuts it into windows of at most
  12 s, calls LongCat once per window, one after another, and
  concatenates them.

The cap in `config.example.toml` is 40 seconds and 600 characters of
script. The script is the segments the caller already sent.

```text
web or fill scheduler
  └─ HTTP to the engine (create task, or the 60s fill tick)
       └─ Supabase row: state=queued
       └─ InMemoryTaskManager.add_task          ← the queue
            └─ one thread, task.start
                 1. preflight
                 2. script from the segments
                 3. POST http://tts:4123/v1/audio/speech
                      Phonon / Kokoro / Chatterbox Nano
                      one process-wide lock, one synthesis at a time
                 4. faster-whisper small, CPU int8, for subtitle timing
                 5. lip-sync only: LongCat on Modal GPU, polled over
                    HTTP until done (hook: 1 clip, full: 1 per window)
                 6. ffmpeg libx264 veryfast: canvas, panels, lip-sync
                    splice, subs, music
                 7. upload the MP4 to R2
                 8. Supabase row: progress, then complete or failed
```

Two independent caps sit on that path:

| Cap | Where | What 30 videos do today |
| --- | --- | --- |
| `max_concurrent_tasks` | `InMemoryTaskManager` in the engine process. The example config sets 1. If the key is missing, the code uses 5. Redis is off, so the queue is RAM in that process | The rest wait in memory, up to `max_queued_tasks` (example: 100), then the API returns 429 |
| TTS lock | `local_tts/backends.py`, one lock around every synthesis | Even if the engine ran several threads, speech would still be one at a time |

A lip-sync task holds the engine's only slot while it waits on the
GPU (about 6 minutes of H200 for a hook) and then while ffmpeg
splices on the VPS (a ~13-minute splice was observed in production on
a slower preset). Every faceless video queued behind it waits that
long.

Task state is already in Supabase (`engine_task_state`) when
`MPT_STATE_BACKEND=supabase`, which is how production runs. The boot
path calls `reconcile_orphaned_tasks`, and `config.example.toml` says
the engine is a single writer: two overlapping processes can fail and
refund a video the other process is still making. A fleet of workers
must not run that boot reconcile.

Status writes are already the callback. `task.start` updates the
Supabase row at each phase. A worker that calls the same update path
does not need a new status protocol. The LongCat cost that
`task.start` records today is recorded the same way from the worker.

R2 upload is already the archive step (`upload_final_video_r2`).
Temp files live under the task directory and die with the container.

## What has to change so one container is one video

No code in this PR. The implementation PR does the following.

1. **A worker entrypoint (new)** that receives the task id and the
   validated `VideoParams`, runs `task.start(task_id, params)`, and
   exits. The queued row does not store the params today, so the
   dispatcher persists them on the task row and passes the same
   payload into the spawn. The worker does not start the fill
   scheduler, the heartbeat autopsy, or `reconcile_orphaned_tasks`.
2. **A dispatcher (new)** in front of the in-memory queue. The web and
   the MCP keep calling the engine. Every task, of every video type,
   is spawned on the function in the table above. There is no feature
   flag. The only fallback to the local thread is a failed spawn.
3. **A migration (new)** that adds `modal_call_id text` to
   `engine_task_state`. The dispatcher writes it after a spawn
   succeeds. Update `supabase/README.md` and regenerate
   `supabase/schema.snapshot.json` in the same PR.
4. **The boot reconcile skips live calls.** A generation-stage orphan
   is not always refunded: a batch slot goes back to pending, and a
   direct task with persisted params is redispatched. Without this
   step a live Modal render starts a second time, and a lip-sync
   render pays for the GPU twice. For a row with `modal_call_id`, the
   reconcile asks Modal for that call (`modal.FunctionCall.from_id`)
   and leaves the row alone while the call is running. Only a call
   that has ended without writing a terminal state falls through to
   the triage. This must ship in the same PR as the dispatcher.
5. **TTS in-process inside the worker**, not an HTTP call to the
   locked server. House voices load Phonon or Kokoro. A clone loads
   Chatterbox Nano. The lock can stay; it protects only that one
   container.
6. **Weights, fonts, and the BGM catalog baked into the image.** Do
   not download weights from Hugging Face on the hot path. Chatterbox
   Nano is a gated repo (`HF_TOKEN` at build time). Whisper `small` is
   the subtitle model. Face detection uses OpenCV's bundled cascade,
   which ships with the package.
7. **Clone audio from Supabase Storage.** The original clone WAV is
   already in the `personas` bucket at `cloned_voices.storage_path`.
   The worker downloads it by `engine_voice_key` and caches it for
   that container. The VPS `tts_voices` volume stays the local TTS
   copy. A one-time check **(new script)** lists VPS WAVs with no
   storage object and uploads them, before the first clone is
   spawned.
8. **Secrets, by name.** Every worker: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, and `MPT_STATE_BACKEND=supabase` (without
   it `task.start` writes into `MemoryState` and the archive path
   loses `user_id`). `render_lipsync` only: `LONGCAT_SUBMIT_URL`,
   `LONGCAT_STATUS_URL`, `LONGCAT_DOWNLOAD_URL`, and
   `LONGCAT_HTTP_SECRET`. No worker needs `CHATTERBOX_HTTP_SECRET`,
   because TTS is in-process, or `MODAL_TOKEN_ID` and
   `MODAL_TOKEN_SECRET`. The dispatcher on the VPS needs those two,
   because it calls `spawn` and `FunctionCall.from_id`.
9. **Timeouts.** The faceless functions: at least 1800 s.
   `render_lipsync`: 14400 s, the same as `GenerateAvatar`, because a
   full lip-sync video waits on several LongCat windows in a row, and
   the client allows 1800 s per window (`[longcat] timeout_seconds`).

Web, MCP, Caddy, Postgres, and LongCat's HTTP contract stay. The
engine process remains the dispatcher, the fill scheduler, and the
reconcile. It stops being the renderer.

## Planning numbers

These are not measurements. Nothing in the repo records a wall-clock
time for a faceless render. Replace the numbers with one real run of
each video type (the phase tracker already wraps script, audio,
subtitle, materials, and render) before anyone treats them as a bill.

Modal rates, from the pricing page on 23 Nov 2026: CPU $0.0000131 per
physical-core-second, memory $0.00000222 per GiB-second. Modal bills
the memory a function requests. H200: $0.001261 per second
(`modal_longcat_gpu.py`).

| Case | Container | Wall clock | Formula | CPU cost |
| --- | --- | --- | --- | --- |
| Faceless, house voice | 1 core, 4 GiB | 3 min (range 2–4) | 1 × 0.0000131 × 180 + 4 × 0.00000222 × 180 | $0.004 |
| Faceless, clone | 1 core, 10 GiB | 8 min (Nano runs at RTF 3–10 on CPU) | 1 × 0.0000131 × 480 + 10 × 0.00000222 × 480 | $0.017 |
| Hook lip-sync | 2 cores, 10 GiB | 10 min: 2 prep, ~6 on the GPU, 2 splice | (2 × 0.0000131 + 10 × 0.00000222) × 600 | $0.03 |
| Full lip-sync, 40 s | 2 cores, 10 GiB | 40 min: 4 windows of ≤12 s, ~7 min each, plus the splice | (2 × 0.0000131 + 10 × 0.00000222) × 2400 | $0.12 |

GPU, for comparison: a hook is about 6 minutes of H200 (the
`modal_longcat.py` docstring), about $0.45. A full 40 s video is
4 windows of about 7 minutes each, 28 minutes of H200, about $2.10,
plus a cold start when the GPU container was idle. The CPU container does not change that line.

Cold start, weights in the image: +30–90 s, billed. Weights from
Hugging Face: several minutes. Do not do that on the hot path.

Thirty concurrent house-voice videos are 60 vCPU and 120 GiB for
about 3 minutes, then they exit.

House-voice faceless video on other hosts, 180 s, 2 vCPU, 4 GiB:

| Host | Formula | One video | Burst of 30 |
| --- | --- | --- | --- |
| Modal CPU | 1 physical core × $0.0000131/s × 180 + 4 GiB × $0.00000222/s × 180 | $0.004 | $0.12 |
| Cloud Run Jobs | 2 × $0.000018/vCPU-s × 180 + 4 × $0.000002/GiB-s × 180 | $0.008 | $0.24 |
| AWS Fargate, us-east-1 | 2 × $0.000011244/vCPU-s × 180 + 4 × $0.000001235/GB-s × 180 | $0.005 | $0.15 |
| Fly.io `performance-2x` (4 GB dedicated, $66 per 30 days) | $66 / (30 × 24) × 180/3600 | $0.005 | $0.14 |
| Cloudflare Containers, CPU treated as fully active | 2 × $0.000020/vCPU-s × 180 + 4 × $0.0000025/GiB-s × 180 | $0.009 | $0.27 |

A cold start of 60 s adds roughly a third on top. Modal's default
60 s scaledown, if all 30 containers sit idle after the burst, adds
about $0.04. Set the window short.

Month of house-voice faceless videos, warm, no cold-start adder:

| Month | Videos | Modal CPU | Cloud Run Jobs |
| --- | --- | --- | --- |
| Low (beta) | 20 | $0.08 | $0. The free tier covers it |
| Moderate | 300 | $1.20 | $0. 108,000 vCPU-s and 216,000 GiB-s, both under the free tier |
| Busy: a burst of 30, twice a day | 1,800 | $7.20 | about $9 after the free tier |

LongCat is still the expensive line. The first draft estimated a
moderate lip-sync month at $45–70 of GPU. That is already more than
the $30 Starter credit, so the credit does not cover the CPU workers
in any month with lip-sync. The CPU workers add $1–10 to a bill that
is already above the credit.

## Comparison

| | Modal CPU function | Cloud Run Jobs | Cloud Run service, concurrency 1 | AWS Batch on Fargate | Fly Machines, one per job | Cloudflare Containers |
| --- | --- | --- | --- | --- | --- | --- |
| How a burst of 30 starts | `.spawn` 30 inputs. The autoscaler opens containers up to `max_containers` | One execution, `taskCount=30`, `parallelism=30`. Each task is a container that exits | 30 HTTP requests, max instances ≥ 30, concurrency 1. The request has to stay open until render ends, or CPU is frozen | Submit 30 array tasks. Each task is a Fargate task that exits | `POST /v1/apps/.../machines` thirty times, then destroy | A Worker starts 30 containers. You write the queue |
| Parallel cap | Starter: 100 containers in the workspace, shared with every other app. Team: 5,000 | Up to 10,000 tasks in one execution. Parallelism is a regional quota. Default task timeout is 10 minutes; raise it (max 168 hours) | Max instances default is often 100 and can be raised. Request timeout max is 60 minutes | No hard product cap. A new account's Fargate vCPU quota is often too small for 60 vCPU until you request a raise | No documented machine cap. Creating 30 at once can fail on regional capacity; the caller retries | Account limits are far above 30. Per container: 4 vCPU, 12 GiB, 20 GB disk |
| Weights | A Modal volume can be mounted by many containers at once, or the weights ship in the image | Ship in the image, or read a bucket at start | Same as Jobs | Ship in the image, or pull from S3 at start. Image-pull time is billed | A volume attaches to one machine only. Bake the weights into the image | Bake into the image. 20 GB disk is enough |
| Cold start | Billed, including import. Tens of seconds with weights in the image | Tens of seconds from Artifact Registry for a multi-GB image, then model load | Same, and the client holds the connection through it | Often the slowest pull. Billed from pull start | Machine boot is quick; the multi-GB pull is the wait | Same class of wait |
| Free tier | Starter $30/month of compute, shared with LongCat | 240,000 vCPU-s and 450,000 GiB-s per month | Request-based free tier is smaller (180,000 vCPU-s) | None that covers this | $5/month of usage, 3 machines on the free plan | Workers Paid is $5/month and includes 375 vCPU-minutes and 25 GiB-hours |
| Per burst of 30 | $0.12 | $0.24 | about $0.30 at the request-based active rate | $0.15 plus pull time | $0.14 on dedicated CPU | $0.27 |
| Effort from here | Lowest. Modal deploy already exists for LongCat. A second app, CPU only | New project, registry, IAM, a caller for the Jobs API, a quota look | Same, plus a request-timeout and billing-mode trap | New AWS account, a queue, a quota ticket before 30-wide works | You operate the orchestrator | You operate the orchestrator. Upload to R2 from the container, not through the Worker (100 MB body limit) |
| Verdict | Use this | Use this for faceless if CPU must not share the GPU credit | Do not prefer it over Jobs | Capable, more setup than the burst is worth | Capable, worse weight story | Capable, more to build |

Cloud Run Jobs bill the whole task with instance-based billing: CPU
stays on until the process exits. That is a different bill from the
always-on Cloud Run services rejected in the first draft (~$440/month
to pin the current VPS services). The web app is not moving to Cloud
Run.

## TTS stays inside the job container

A separate TTS fleet only pays off if one loaded model serves many
videos at once. This TTS cannot. Kokoro and Phonon are fast enough
that the synthesis is a fraction of the render, and the models are
about 1.5 GB, which fits in 4 GiB. A shared service would need its own
autoscale, its own cold start, no global lock, and a network hop, to
save a load that is smaller than the ffmpeg that follows.

Chatterbox Nano is the exception in size and speed, not in topology.
Only `render_faceless_clone` and `render_lipsync` load it, and only
when the voice is a clone. Both request 10 GiB so it fits.

## Phased move

A failed spawn is the rollback: the task runs on the local thread.

1. Time one video of each type (faceless house voice, faceless clone,
   hook lip-sync, full lip-sync) on the current VPS and write down the
   phase durations. The dollar tables scale linearly with them.
2. Build the worker image: engine, the TTS stack, Whisper `small`,
   Phonon, Kokoro, Chatterbox Nano, fonts, BGM. Entrypoint: task id
   plus params, then exit. No ASGI startup. Publish it as a Modal app
   **(new, for example `modal_cpu_worker.py`)** with the three
   functions from the recommendation. Prove each function with one
   task id and its params against a scratch Supabase row, uploading
   to R2.
3. Ship the dispatcher, the `modal_call_id` migration, and the
   reconcile change in one PR. Every task spawns. Run three
   overlapping videos: one house voice, one clone, one hook lip-sync.
   Restart the engine during the run and confirm the boot reconcile
   does not requeue, redispatch, or refund a live call.
4. Run one full lip-sync video end to end. Confirm the worker survives
   several LongCat windows and records the same LongCat cost that the
   VPS records today.
5. Point the fill scheduler at the same spawn path (it is the same
   dispatcher). Watch the Supabase connection count and R2. The
   database is the first real limit, not the CPU quota.

The VPS containers stay installed the whole time. LongCat's deploy
does not change.

A bigger VPS does not meet the goal: 30 copies of a 4 GiB worker do
not fit in 16 GB, and the TTS lock would still serialize speech.

## What stays on the VPS and on Modal GPU

| Piece | Where | Change in this plan |
| --- | --- | --- |
| Next.js, OAuth, Stripe, web cron | VPS container `post-engineer-web` | None |
| Remote MCP | VPS container `post-engineer-mcp` | None |
| Caddy | systemd on the VPS | None |
| Postgres | Hosted Supabase | One new column; 30+ writers during a burst |
| Engine process | VPS container `mpt-engine-cpu` | Becomes the dispatcher for every video type. Renders only when a spawn fails |
| TTS container | VPS `mpt-tts-cpu` | Fallback when a spawn fails |
| LongCat | Modal app `moneyprint-longcat`, GPU, `max_containers=1` | None. Called from `render_lipsync` instead of the VPS |
| Qwen image API | Modal GPU plus a Vercel front. Not called by this product. Non-commercial license | None |

Production still has `INFINITETALK_*` in the engine env. Current code
does not read those names. Do not give them to the worker. Confirm
the old Modal app is stopped so it is not using the Starter credit.
`BUGSINK_DSN`, `TAVILY_API_KEY`, `EXA_AI_API_KEY`, and
`TEST_ACCOUNT_USER_IDS` are set on the production engine env and are
not referenced by the current tree.

## Sources

- Modal prices, Starter limits (100 containers, 10 GPU concurrency,
  $30 credit), CPU $0.0000131 per physical-core-second, memory
  $0.00000222 per GiB-second, one physical core = 2 vCPU:
  <https://modal.com/pricing>. Autoscaler and `max_containers`:
  <https://modal.com/docs/guide/scale>.
- The LongCat `max_containers=1` is `apps/engine/modal_longcat.py`;
  the H200 rate is `apps/engine/modal_longcat_gpu.py`. The in-memory
  queue is `app/controllers/manager/base_manager.py`. The TTS lock is
  `local_tts/backends.py`. The single-writer boot note is
  `apps/engine/config.example.toml`. Hook and full lip-sync are
  `app/services/task.py` and `app/services/full_lipsync.py`.
- Cloud Run Jobs: up to 10,000 tasks, parallelism by regional quota,
  default task timeout 10 minutes, max 168 hours.
  <https://cloud.google.com/run/docs/create-jobs> and
  <https://cloud.google.com/run/quotas>. Instance-based rates
  $0.000018 per vCPU-second and $0.000002 per GiB-second, free tier
  240,000 vCPU-seconds and 450,000 GiB-seconds:
  <https://cloud.google.com/run/pricing>.
- Fargate Linux us-east-1 $0.000011244 per vCPU-second and
  $0.000001235 per GB-second:
  <https://aws.amazon.com/fargate/pricing/>.
- Fly Machines, `performance-2x` $66 per 30 days, volumes attach to
  one machine: <https://fly.io/pricing> and
  <https://fly.io/docs/volumes/overview>.
- Cloudflare Containers, per-instance max 4 vCPU / 12 GiB / 20 GB,
  memory $0.0000025 per GiB-second, CPU $0.000020 per vCPU-second:
  <https://developers.cloudflare.com/containers/platform/pricing/> and
  <https://developers.cloudflare.com/containers/platform/limits/>.
