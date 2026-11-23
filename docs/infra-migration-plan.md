# Infrastructure plan: one container per video

Date: 2026-11-23, revised the same day. Recommendation only. This
document does not change application code, migrations, or the deploy.

The first draft of this file recommended leaving the CPU stack on one
VPS. That is the wrong shape for the goal that replaced it: about 30
image-only videos rendering at the same time, each in its own
container, instead of waiting on one box. Web, the MCP server, and
Postgres stay where they are. LongCat stays on Modal.

Secret values are not in this file. Only secret and variable names.

## Recommendation

Run each image-only video as one Modal CPU function. Bundle TTS,
Whisper, and ffmpeg in that container. `max_containers` defaults to
30 and can be raised; `min_containers` is 0, with no warm pool, so
idle time scales to zero and costs nothing. One container per video
in flight, never a standing fleet. Do not put a GPU on it. Leave
LongCat as the only GPU app.

This is the cheapest serious option and the one with the least new
machinery. A planning-case video (below) is about **$0.004** on Modal
CPU. Thirty of them at once are about **$0.12**. A moderate month of
300 videos is about **$1.20** of CPU, which is noise next to lip-sync
and fits inside the Starter credit with room to spare only when
LongCat is quiet.

Runner-up: Google Cloud Run Jobs, one task per video, parallelism at
least 30. Same shape, about **$0.008** per video and **$0.24** per
burst of 30. The Cloud Run free tier (240,000 vCPU-seconds and
450,000 GiB-seconds per month) covers a low month and a 300-video
month at this size, so the CPU bill there is **$0** until the month
gets busier. Pick Jobs if the $30 Modal credit should be reserved
for LongCat only. It is a new GCP project, an image registry, and a
quota check before the first burst of 30.

Do not keep a separate autoscaled TTS service. The current TTS
process holds one lock for every voice. Each container loads Kokoro
or Phonon for a house voice, and Chatterbox Nano only for a
``chatterbox_nano:`` clone. The container requests 10 GiB so a clone
fits. Clone WAVs live on the Modal volume ``cpu-worker-voices``.

## The concurrency limit is ours, not Modal's plan

`GenerateAvatar` in `apps/engine/modal_longcat.py` sets
`max_containers=1`. That is why lip-sync runs one GPU container at a
time. It is an argument on that class. It is not a workspace cap, and
it does not apply to a CPU function.

Modal's Starter plan, from the pricing page, allows **100 concurrent
containers** and **10 concurrent GPUs**. Those are different counters.
Thirty CPU containers plus one LongCat GPU container fit on Starter.
The Team plan ($250/month, 5,000 containers) is not required for this
target. A CPU function scales to zero when `min_containers` is 0.
30 is the default ceiling (`MPT_CPU_WORKER_MAX_CONTAINERS`), not a
number of containers to keep warm. Set a short `scaledown_window`
so an idle container does not sit for Modal's default 60 seconds.

LongCat's `max_containers=1` stays until the owner changes it. This
plan does not.

## Unit of work today

An image-only video does not call LongCat. The product calls that
mode `faceless`: the agent's images on a neutral canvas, a voice, and
ffmpeg. The cap in `config.example.toml` is 40 seconds and 600
characters of script. The script is the segments the caller already
sent. The engine no longer runs an LLM to write it.

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
                 5. neutral canvas + the agent's images (ffmpeg)
                 6. ffmpeg libx264 veryfast: concat, panels, subs, music
                 7. upload the MP4 to R2
                 8. Supabase row: progress, then complete or failed
```

Two independent caps sit on that path:

| Cap | Where | What 30 videos do today |
| --- | --- | --- |
| `max_concurrent_tasks` | `InMemoryTaskManager` in the engine process. The example config sets 1. If the key is missing, the code uses 5. Redis is off, so the queue is RAM in that process | The rest wait in memory, up to `max_queued_tasks` (example: 100), then the API returns 429 |
| TTS lock | `local_tts/backends.py`, one lock around every synthesis | Even if the engine ran several threads, speech would still be one at a time. Phonon and Kokoro stay resident (~1.5 GB). Chatterbox Nano adds ~3 GB and unloads after 5 idle minutes |

The fill scheduler is a thread in the same process (tick every 60
seconds) and uses the same manager. Web cron (metrics, billing,
uploads, token refresh) does not render video.

Task state is already in Supabase when `MPT_STATE_BACKEND=supabase`,
which is how production runs. Polls survive an engine restart. The
boot path calls `reconcile_orphaned_tasks` and the comment in
`config.example.toml` says the engine is a single writer: two
overlapping processes can fail and refund a video the other process
is still making. A fleet of workers must not run that boot reconcile.

Status writes are already the callback. `task.start` updates the
Supabase row at each phase (script, audio, subtitle, materials,
render, archive). A worker that calls the same update path does not
need a new status protocol.

R2 upload is already the archive step (`upload_final_video_r2`). The
object key is
`{user_id}/{persona_id or faceless}/{task_id}/final-1.mp4`. Temp
files live under the task directory on local disk and are cleaned up
after the run. Nothing in the render needs a disk that outlives the
container, except clone reference audio, which today sits on the
`tts_voices` Docker volume.

## What has to change so one container is one video

No code in this PR. The next implementation PR has to do the
following, and nothing fancier.

1. A worker entrypoint that receives the task id and the validated
   `VideoParams` (the queued row does not store them today; the
   dispatcher persists `job_params` on the task and passes the same
   payload into the spawn). It runs `task.start(task_id, params)` and
   exits. It must not start the fill scheduler, the heartbeat autopsy,
   or `reconcile_orphaned_tasks`. Those stay on the always-on engine
   or move only when they are taught to ignore a live remote worker.
2. A dispatcher in front of the in-memory queue. The web and the MCP
   keep calling the engine. Every faceless job, house voice or clone,
   is spawned. There is no feature flag. The only fallback to the
   local thread is a failed spawn. Lip-sync is not dispatched.
3. TTS in-process inside the worker, not an HTTP call to a single
   locked server. House voices load Phonon or Kokoro. A clone loads
   Chatterbox Nano. The lock can stay; it only protects that one
   container.
4. Weights baked into the image, or on a store many containers can
   read at once. Do not download them from Hugging Face on the hot
   path. Chatterbox Nano is a gated repo (`HF_TOKEN`). Whisper
   `small` is the subtitle model.
5. Fonts and the BGM catalog baked into the same image. They are
   already files the engine image expects.
6. Clone WAVs live on the Modal volume `cpu-worker-voices`, mounted
   at `/voices`. Registration writes new clones there.
   `scripts/migrate_clone_voices.py` copies the WAVs that already
   sit on the VPS `tts_voices` volume. The local volume is still
   written so a spawn failure can render.
7. Secrets the worker needs, by name: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `CHATTERBOX_HTTP_SECRET`, and `HF_TOKEN`
   only if a weight file is still gated at build time. The container
   must set `MPT_STATE_BACKEND=supabase` or `task.start` writes into
   `MemoryState` and the archive path loses `user_id`. It does not
   need `LONGCAT_*` for an image-only job. It does not need
   `MODAL_TOKEN_ID` or `MODAL_TOKEN_SECRET` inside the worker; the
   dispatcher process does, because that is what calls `spawn`.
8. The always-on engine's boot reconcile must skip tasks that have a
   live remote worker. Generation-stage orphans are not all refunded:
   a batch slot is put back to pending and a direct task with
   persisted params is redispatched, so a live Modal render would
   start a second time. Only a dead call (no longer running) may
   fall through to that triage. This is the hazard that blocks
   turning the flag on in production.

Web, MCP, Caddy, Postgres, and LongCat's HTTP contract stay. The
engine process remains the dispatcher and the fill scheduler until a
later phase. It stops being the renderer.

## Planning numbers

These are not measurements. Nothing in the repo records a wall-clock
time for a faceless render. The 13-minute figure in
`config.example.toml` is a lip-sync splice on a slower preset, and it
does not apply here. Replace the numbers with one real faceless run
(the phase tracker already wraps script, audio, subtitle, materials,
and render) before anyone treats them as a bill.

Planning case, image-only, house voice, at the product cap:

| Input | Value | Why |
| --- | --- | --- |
| Narration | 40 s, ≤ 600 characters | `max_video_duration_seconds`, `max_video_script_characters` |
| Voice | Kokoro or Phonon, not Chatterbox Nano | House catalog. Nano is the clone path |
| CPU | 2 vCPU, which Modal calls 1 physical core | Enough for `veryfast` libx264 on a short vertical video |
| RAM | 4 GiB | ~1.5 GB for Phonon+Kokoro resident, Whisper small on top, ffmpeg peak, headroom. The TTS compose note puts Nano at ~3 GB extra, so a clone job wants 8 GiB |
| Warm wall clock | 3 minutes (range 2–4) | TTS tens of seconds, Whisper tens of seconds, ffmpeg the rest. Not the 13-minute lip-sync splice |
| Cold start, weights in the image | +30–90 s, billed | Image pull plus loading a few GB into RAM |
| Cold start, weights from Hugging Face | several minutes | Do not do this on the hot path |
| Clone (Chatterbox Nano) | about 8 minutes, 8 GiB | The chunking module records RTF 3–10 on CPU, so 40 s of audio is a few minutes of speech before ffmpeg |

Thirty concurrent house-voice videos are then 60 vCPU and 120 GiB for
about 3 minutes, then they exit. Temp disk is the task directory,
well under a few GB, and it dies with the container.

Per-video arithmetic, 180 s, 2 vCPU, 4 GiB. Rates from each vendor's
page on 23 Nov 2026.

| Host | Formula | One video | Burst of 30 |
| --- | --- | --- | --- |
| Modal CPU | 1 physical core × $0.0000131/s × 180 + 4 GiB × $0.00000222/s × 180 | $0.004 | $0.12 |
| Cloud Run Jobs | 2 × $0.000018/vCPU-s × 180 + 4 × $0.000002/GiB-s × 180 | $0.008 | $0.24 |
| AWS Fargate, us-east-1 | 2 × $0.000011244/vCPU-s × 180 + 4 × $0.000001235/GB-s × 180 | $0.005 | $0.15 |
| Fly.io `performance-2x` (4 GB dedicated, $66 per 30 days) | $66 / (30 × 24) × 180/3600 | $0.005 | $0.14 |
| Cloudflare Containers, CPU treated as fully active | 2 × $0.000020/vCPU-s × 180 + 4 × $0.0000025/GiB-s × 180 | $0.009 | $0.27 |

A cold start of 60 s at the same size adds roughly a third on top.
Modal's default 60 s scaledown, if all 30 containers sit idle after
the burst, adds about $0.04. Set the window short.

Month, house voice, warm, no cold-start adder:

| Month | Videos | Modal CPU | Cloud Run Jobs |
| --- | --- | --- | --- |
| Low (beta) | 20 | $0.08 | $0. The free tier covers it |
| Moderate | 300 | $1.20 | $0. 108,000 vCPU-s and 216,000 GiB-s, both under the free tier |
| Busy: a burst of 30, twice a day | 1,800 | $7.20 | about $9 after the free tier |

Clone videos cost more like $0.02–0.04 each because they run longer
and ask for 8 GiB. They are not the 30-wide target.

LongCat is unchanged and is still the expensive line. A moderate
lip-sync month was estimated in the first draft at roughly $45–70 of
GPU, against a $30 Starter credit. CPU at the moderate column does
not change that picture. CPU at the busy column ($7) does take a bite
of the same credit if the worker stays on Modal.

## Comparison

| | Modal CPU function | Cloud Run Jobs | Cloud Run service, concurrency 1 | AWS Batch on Fargate | Fly Machines, one per job | Cloudflare Containers |
| --- | --- | --- | --- | --- | --- | --- |
| How a burst of 30 starts | `.spawn` 30 inputs. The autoscaler opens containers up to `max_containers` | One execution, `taskCount=30`, `parallelism=30`. Each task is a container that exits | 30 HTTP requests, max instances ≥ 30, concurrency 1. The request has to stay open until render ends, or CPU is frozen | Submit 30 array tasks. Each task is a Fargate task that exits | `POST /v1/apps/.../machines` thirty times, then destroy | A Worker starts 30 containers. You write the queue |
| Parallel cap | Starter: 100 containers in the workspace, shared with every other app. 30 is fine. Team: 5,000 | Up to 10,000 tasks in one execution. Parallelism is a regional quota, not a fixed 30. Check it before the test. Default task timeout is 10 minutes; raise it (max 168 hours) | Max instances default is often 100 and can be raised. Request timeout max is 60 minutes, which covers this video | No hard product cap. A new account's Fargate vCPU quota is often too small for 60 vCPU until you request a raise | No documented machine cap. Creating 30 at once can fail on regional capacity; the caller retries | Account limits are far above 30 (concurrent memory is on the order of terabytes). Per container: 4 vCPU, 12 GiB, 20 GB disk |
| Weights | A Modal volume can be mounted by many containers at once, or the weights ship in the image | Ship in the image, or read a bucket at start. No shared writable disk | Same as Jobs | Ship in the image, or pull from S3 at start. Image-pull time is billed | A volume attaches to one machine only. Thirty jobs means thirty copies. Bake the weights into the image | Bake into the image. Disk per instance tops out at 20 GB, which is enough |
| Cold start | Billed, including import. Tens of seconds if the image is local to Modal and weights are on a volume or in the image | Tens of seconds from Artifact Registry for a multi-GB image, then model load | Same, and the client holds the connection through it | Often the slowest pull. Billed from pull start | Machine boot is quick; the multi-GB pull is the wait | Same class of wait. Inactivity timeout max is 6 hours, which does not matter if the container exits |
| Free tier | Starter $30/month of compute, shared with LongCat GPU, CPU, and RAM | 240,000 vCPU-s and 450,000 GiB-s per month. Covers the low and moderate columns above | Request-based free tier is smaller (180,000 vCPU-s). Only a fit if the HTTP call stays open for the whole render | None that covers this | $5/month of usage, and the free plan allows 3 machines. It does not cover a burst of 30 | Workers Paid is $5/month and includes 375 vCPU-minutes and 25 GiB-hours, on the order of ~90 of these videos, then the rates above |
| Per burst of 30 | $0.12 | $0.24 | about $0.30 if billed at the request-based active rate ($0.000024/vCPU-s, $0.0000025/GiB-s) | $0.15 plus pull time | $0.14 on dedicated CPU | $0.27 |
| Effort from here | Lowest. Modal deploy already exists for LongCat. A second app, CPU only | New project, registry, IAM, a caller for the Jobs API, a quota look | Same, plus a request-timeout and billing-mode trap. A Job matches "run and exit" better | New AWS account, a queue, a quota ticket before 30-wide works | You operate the orchestrator. Weights cannot be one shared volume | You operate the orchestrator. Default outbound request body is 100 MB, which a finished MP4 can exceed if the upload is proxied through the Worker. Upload to R2 from the container instead |
| Verdict | Use this | Use this if CPU must not share the GPU credit | Do not prefer it over Jobs | Capable, more account setup than the burst is worth | Capable, worse weight story | Capable, more to build, tighter upload limits |

Cloud Run Jobs are instance-based billing for the whole task, which is
what you want: CPU stays on until the process exits. That is a
different bill from the always-on Cloud Run services rejected in the
first draft (~$440/month to pin the current VPS services). Do not
confuse the two. The web app is not moving to Cloud Run.

## TTS stays inside the job container

A separate TTS fleet only pays off if one loaded model serves many
videos at once. This TTS cannot. Kokoro and Phonon are fast enough
that the synthesis is a fraction of a 3-minute render, and the models
are 1.5 GB, which fits in the 4 GiB request. A shared service would
need its own autoscale, its own cold start, no global lock, and a
network hop, to save a load that is smaller than the ffmpeg that
follows.

Chatterbox Nano is the exception in size and speed, not in topology.
The worker loads it only when the voice is a clone. The same
function requests 10 GiB so that load fits, and the reference WAV
is read from `cpu-worker-voices`. House voices do not import it.

## Phased move

Spawn failure is the rollback: the job runs on the local thread.

1. Time one faceless house-voice video on the current VPS and write
   down the phase durations. If render is 90 seconds or 8 minutes, the
   dollar table scales linearly and the recommendation does not.
2. Build a worker image: engine plus the TTS stack plus Whisper
   `small`, Phonon, and Kokoro. Entrypoint: task id plus params, then
   exit. No ASGI startup. `MPT_STATE_BACKEND=supabase`. Publish it
   with a Modal function, `cpu=1.0`, `memory=10240`,
   `min_containers=0`, `max_containers=30` (raise via
   `MPT_CPU_WORKER_MAX_CONTAINERS`), `timeout` at least 1800,
   `scaledown_window` as short as Modal allows. Prove it with one
   task id and its params against a scratch Supabase row, uploading
   to R2.
3. Deploy `modal_cpu_worker.py`. Web and MCP stay callers of the
   engine. Every faceless job spawns. Run two overlapping videos,
   one house voice and one clone. Confirm boot reconcile does not
   requeue or refund a live call.
4. Point the fill scheduler at the same spawn path (it is the same
   dispatcher). Watch Supabase connection count and R2. The database
   is the first real limit, not the CPU quota.
5. Run `scripts/migrate_clone_voices.py` once so clones recorded
   before the volume existed are visible to the worker.

The VPS containers stay
installed the whole time. LongCat's deploy does not change.

Web, MCP, Caddy, and Postgres do not move. A bigger VPS does not
meet the goal: 30 copies of a 4 GiB worker do not fit in 16 GB, and
the TTS lock would still serialize speech.

## What stays on the VPS and on Modal GPU

| Piece | Where | Change in this plan |
| --- | --- | --- |
| Next.js, OAuth, Stripe, web cron | VPS container `post-engineer-web` | None |
| Remote MCP | VPS container `post-engineer-mcp` | None |
| Caddy | systemd on the VPS | None |
| Postgres | Hosted Supabase | None, except 30 writers during a burst |
| Engine process | VPS container `mpt-engine-cpu` | Becomes the dispatcher for faceless jobs. Lip-sync still renders here |
| TTS container | VPS `mpt-tts-cpu` | Fallback when a spawn fails. New clones are also written to `cpu-worker-voices` |
| LongCat | Modal app `moneyprint-longcat`, GPU, `max_containers=1` | None |
| Qwen image API | Modal GPU plus a Vercel front. Not called by this product. Non-commercial license | None |

Production still has `INFINITETALK_*` in the engine env. Current code
does not read those names. Do not give them to the worker. Confirm
the old Modal app is stopped so it is not using the Starter credit.
`MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` are in the engine env and
are not read by this repository. They should not be injected into the
worker. `BUGSINK_DSN`, `TAVILY_API_KEY`, `EXA_AI_API_KEY`, and
`TEST_ACCOUNT_USER_IDS` are set on the production engine env and are
not referenced by the current tree.

## Sources

- Modal prices, Starter limits (100 containers, 10 GPU concurrency,
  $30 credit), CPU $0.0000131 per physical-core-second, memory
  $0.00000222 per GiB-second, one physical core = 2 vCPU:
  <https://modal.com/pricing>. Autoscaler and `max_containers`:
  <https://modal.com/docs/guide/scale>.
- The LongCat `max_containers=1` is `apps/engine/modal_longcat.py`.
  The in-memory queue is `app/controllers/manager/base_manager.py`.
  The TTS lock is `local_tts/backends.py`. The single-writer boot
  note is `apps/engine/config.example.toml`.
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
