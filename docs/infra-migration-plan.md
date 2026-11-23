# Infrastructure plan: what stays on Modal, and where the rest should live

Date: 2026-11-23. Recommendation only. This document does not change
application code, database migrations, or the production deploy.

Secret values from `Ryan-Carloso/post-enginner-repos` and
`Ryan-Carloso/post-engineer-image-api` are not copied here. Only secret
and variable names appear.

## Recommendation

Do not move the non-GPU platform onto Google Cloud. That work is already
off Modal. It runs as Docker Compose on one VPS (web, engine, CPU TTS,
remote MCP, Caddy). The only production GPU workload is LongCat lip-sync,
and it should stay on Modal.

If the current box is already a small VPS and the bill is comfortable,
leave it. The cheap, easy-to-operate target is the same Compose stack on
one x86 VPS in the Hetzner CX43 class: 8 shared vCPU, 16 GB RAM, about
€16–18/month before VAT (about $20) including a primary IPv4. Low usage
and moderate usage cost the same on that box, because the processes stay
up and the CPU cap is one video at a time.

Runner-up, if the goal is to stop administering Caddy and a cron deploy:
one Fly.io Machine, `shared-cpu-8x` plus enough RAM to reach 16 GB, about
$102/month in Ashburn, plus a volume for model weights. Still one machine,
same containers, no Cloud Run rewrite.

Google Cloud Run is a poor fit and the expensive one. The engine and the
TTS server do CPU work after the HTTP request has returned, and they keep
models resident. Cloud Run only gives them CPU for that if you turn on
instance-based billing ("CPU always allocated"), which prices an always-on
split of this stack at about $440/month before egress. A single Compute
Engine `e2-standard-4` (4 vCPU, 16 GB, about $98/month in us-central1) is
the least-bad Google option, and it is still about five times the Hetzner
box for the same shape.

GPU stays on Modal either way. At the low volume this beta actually has,
LongCat should fit inside Modal's Starter $30/month compute credit. A
moderate month of lip-sync (assumption below) can run past that credit.
That is a GPU bill, not a reason to re-host ffmpeg.

## What is already true

The question was framed as "everything runs on Modal, move the non-GPU
parts off." The current tree and the production deploy repo do not match
that picture.

| Layer | Where it runs today | On Modal? |
| --- | --- | --- |
| Lip-sync (LongCat-Video-Avatar 1.5) | Modal app `moneyprint-longcat` | Yes, GPU |
| Qwen-Image-2.1 (internal image API, not wired into the product) | Modal app `moneyprint-qwen-image-21`, front door on Vercel | GPU yes, HTTP front no |
| Chatterbox Nano, Phonon, Kokoro | Container `mpt-tts-cpu` from `apps/engine/Dockerfile.tts` | No. The server module says it replaces the old Modal Chatterbox app |
| ffmpeg render, concat, subtitles, Whisper | Container `mpt-engine-cpu` from `apps/engine/Dockerfile` | No |
| Next.js, billing, OAuth, in-process cron | Container `post-engineer-web` | No |
| Remote MCP | Container `post-engineer-mcp` | No |
| TLS and routing | systemd Caddy, `caddy/Caddyfile` in the deploy repo | No |
| Postgres | Hosted Supabase | No |
| Final videos | Cloudflare R2 bucket `videos` | No |
| Deploy | `deploy.sh` on the VPS, cron every 5 minutes | No |

`apps/engine/docker-compose.yml` states the sizing in comments: the engine
is capped at 3 CPU and 8 GB, TTS at 3 CPU and 7 GB, on a 16 GB host.
Phonon and Kokoro stay resident at about 1.5 GB together. Chatterbox Nano
adds about 3 GB and is unloaded after 5 idle minutes. Compose points the
engine at `http://tts:4123` and overrides any stale Modal URL left in
`config.toml`.

Production env names that the running engine still needs for Modal are
`LONGCAT_MODAL_APP_NAME`, `LONGCAT_SUBMIT_URL`, `LONGCAT_STATUS_URL`,
`LONGCAT_DOWNLOAD_URL`, and `LONGCAT_HTTP_SECRET`. `LONGCAT_MODAL_APP_NAME`
is `moneyprint-longcat`. The three URLs are the deployed Modal web
endpoints. The engine calls them with `requests` (`app/services/longcat.py`).
It does not import the Modal SDK on the request path.

The production engine env still also contains `INFINITETALK_SUBMIT_URL`,
`INFINITETALK_STATUS_URL`, `INFINITETALK_DOWNLOAD_URL`, and
`INFINITETALK_HTTP_SECRET`. Current code does not read those names. They
are the retired lip-sync app. Do not carry them to a new host. Confirm in
the Modal dashboard that the old app is stopped, so a forgotten warm
container is not eating the $30 credit.

`MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` are in the production engine env
file. Nothing in this repository reads them. Compose injects the whole
file into `mpt-engine-cpu`, so those tokens sit in the app container
anyway. They belong with the operator who runs `modal deploy`, not in the
engine process. Drop them from the env file that Compose loads. Do that
in the private deploy repo, not in this one.

`BUGSINK_DSN`, `TAVILY_API_KEY`, `EXA_AI_API_KEY`, and
`TEST_ACCOUNT_USER_IDS` are also set on the production engine env and are
not referenced by the current tree. Treat them as unused until a caller
appears. Do not build a service around them.

The private deploy repo documents that `secrets/dev/` is still a
byte-identical copy of `secrets/prod/`, and that `dev.sh` refuses to inject
it until that is fixed. A host move must not "solve" that by copying
production values into a new dev project.

## Architecture map

```text
Internet
  │
  ▼
Caddy (systemd, :443)
  ├── post-engineer.com          → web :3000, and /mcp → mcp :8081
  ├── www                        → redirect to apex
  └── engine.post-engineer.com   → engine :8080
                                      │
                                      ├── http://tts:4123     CPU TTS
                                      ├── Supabase            task + schedule state
                                      ├── R2                  final MP4
                                      └── HTTPS + bearer      Modal LongCat only
```

Public hostnames are `post-engineer.com`, `www.post-engineer.com`, and
`engine.post-engineer.com`. The web's `MONEYPRINT_API_URL` is the engine
hostname. Containers publish only on `127.0.0.1`.

### Modal app: `moneyprint-longcat`

Deploy entry point: `modal deploy modal_longcat.py` (once per Modal
account; dev and prod are separate accounts). One-shot weight pull:
`modal run modal_longcat.py::download_weights`.

| Piece | Kind | GPU | Runtime | How it is called |
| --- | --- | --- | --- | --- |
| `download_weights` | `@app.function`, timeout 4 h | No. CPU image, Hugging Face download | Rare. About 54 GB into volume `longcat-models` | Operator, not the product |
| `GenerateAvatar` | `@app.cls`, `gpu=["H100","H200"]` unless `LONGCAT_GPU` pins one card, `max_containers=1`, `scaledown_window=60`, timeout 4 h | Yes | One container, jobs in series. A 7.5 s hook is described as about 6 minutes of H200. Cold start is dominated by the weight load; a warm clip is described as about half the price of a cold one | Spawned by the submit endpoint |
| `submit_generation` | FastAPI web endpoint, slim Debian image, timeout 120 s | No | Milliseconds, then returns a job id | Engine `POST` with image, audio, `quality`, `num_segments` |
| `job_status` | Same slim image, timeout 120 s | No | Dict read | Engine polls every 5 s, gives up at 1800 s |
| `download_result` | Slim image plus results volume, timeout 120 s | No | Reads one MP4 | Engine `POST`, client timeout 300 s |

Modal resources: volume `longcat-models`, volume `longcat-results`, Dict
`longcat-job-status`. Secrets: `huggingface` (`HF_TOKEN`), `longcat-http`
(`LONGCAT_HTTP_SECRET`).

Clip length is not the audio length. Upstream renders 93 frames at 25 fps
for the first segment (3.72 s) and 80 new frames per extra segment (3.2 s).
`num_segments` is 1..5, so a clip is at most about 16.5 s. The engine
rounds the segment count up so the clip covers the narration, then trims
the surplus when it splices the hook in.

Rates baked into `modal_longcat_gpu.py`, matching Modal's published
per-second prices as of this writing: H100 $0.001097/s ($3.95/h), H200
$0.001261/s ($4.54/h), A100-80GB $0.000694/s ($2.50/h). Preference order
is H100 then H200. The GPU container also bills Modal CPU and memory on
top of the card. A published example of one H100 plus one physical core
plus 8 GiB host RAM is about $4.06/h, not $3.95/h.

ffmpeg inside this GPU container: after inference, `run_longcat` runs
`ffmpeg` (`libx264`, 1080x1920, timeout 900 s) to normalize the MP4.
That CPU pass is billed as GPU time because the container still holds the
card. It is the one non-GPU slice still living on the GPU worker. Moving
it is a small code change (download the raw MP4, normalize on the engine),
not a new host. Do it only if GPU invoices show `normalize_s` as a real
share of `total_gpu_s`. Leave it until then.

### Modal app: `moneyprint-qwen-image-21` (not the product)

Private repo `post-engineer-image-api`. A Next.js API on Vercel (Hobby)
checks a client bearer and forwards edits to Modal. The GPU classes are
`EditImage` (H100, then A100-80GB), `EditImageH100`, and `EditImageA100`.
`max_containers=1`, `scaledown_window=60`, timeout 2 h. Weights are about
33 GB on volume `qwen-image-21-models`. A 40-step edit is described as
about 10–60 s of H100, roughly $0.01–0.05 of GPU before cold start.
Secrets: `huggingface`, `qwen-image-edit-http` (`QWEN_IMAGE_EDIT_HTTP_SECRET`).
The Vercel side also has `IMAGE_API_BEARER` and
`QWEN_IMAGE_21_MODAL_APP_NAME`.

Qwen-Image-2.1 is under the Qwen Research License, non-commercial. The
image-api README says it must not be offered to users or wired into the
product until Alibaba grants a commercial license. Nothing in
`post-engineer` calls it. Leave the GPU on Modal. Leave the Next front on
Vercel. The status and download hosts in `modal_qwen_image_21.py` are
hardcoded to one workspace, unlike LongCat, which builds them from the
app name. Fix that only if this API is kept.

### CPU TTS (already off Modal)

`local_tts/server.py`, container `mpt-tts-cpu`, not published on the host.
Contract: `POST /v1/audio/speech`, `POST /v1/voices`, `DELETE /v1/voices/{voice}`,
`GET /health`, bearer `CHATTERBOX_HTTP_SECRET`.

| Model | Role | Device | Memory |
| --- | --- | --- | --- |
| Phonon-31m-en (q8) | House presets | CPU | Resident, shared ~1.5 GB with Kokoro |
| Kokoro-82M | House presets | CPU | Resident |
| Chatterbox Nano (110M), `device="cpu"`, `nano=True` | Per-user clones from a reference WAV | CPU | ~3 GB, dropped after 300 s idle, reloaded from the local cache |

There is no GPU path in this server. Generation is one lock, one job at
a time, because the VPS has a few cores. ffmpeg in this container is only
wav-to-mp3 (`libmp3lame`, timeout 120 s). Weights and clone references
are Docker volumes `tts_models` and `tts_voices`. Losing `tts_voices`
makes every clone re-register.

The modules `modal_chatterbox_auth.py` and
`modal_chatterbox_registry_routes.py` are the bearer check and the
voice-registry routes. The names are historical. They are copied into the
CPU image. They are not a Modal app.

### Engine (already off Modal)

`mpt-engine-cpu`. Python 3.11, system ffmpeg, no CUDA. Listens on
`127.0.0.1:8080`.

What it does on a video: accept a task, call the LLM and the search keys
configured in `config.toml`, call TTS over HTTP, run faster-whisper
(`model_size = "small"`, `device = "CPU"`, `compute_type = "int8"`) for
caption timing, then ffmpeg (`libx264`, preset `veryfast` in the example
config) for concat, overlays, and the final file. A production note in
`config.example.toml` records a lip-sync splice that took about 13 minutes
under a slower preset. The task HTTP call returns before that work
finishes. The worker is in-process.

Queue: `max_concurrent_tasks = 1`, `max_queued_tasks = 100` in the example
config. The queue object is in-memory. Task records go to Supabase
(`MPT_STATE_BACKEND=supabase` in production). Redis is off in the example.
The engine is documented as a single writer: deploys are stop-then-start,
not rolling. Two engine replicas would each run their own queue.

Fill scheduler: a thread in the engine process, tick every 60 s. It
generates pending batch slots inside the horizon (default 24 h),
reconciles, and publishes. It is not a separate queue service.

Outbound: Supabase, R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `MPT_VIDEO_STORAGE=r2`), the web publish-back URL
(`MPT_UPLOAD_API_BASE_URL`), Discord (`DISCORD_WEBHOOK_URL`), PostHog
(`POSTHOG_API_KEY`), Resend (`RESEND_API_KEY`, `ACCOUNT_BREAK_FROM`), and
LongCat.

### Web and MCP (already off Modal)

`post-engineer-web` on `127.0.0.1:3000`. Next.js. Owns auth, personas,
schedules, OAuth, Stripe, and the API the MCP calls. In production the
scheduler starts because `NODE_ENV=production`. Tick every 60 minutes.
Jobs, with a Supabase lease so two replicas would not double-run:

| Job | Period |
| --- | --- |
| `post-metrics` | 1 h |
| `billing-reconcile` | 24 h |
| `video-upload-sweep` | 1 h |
| `social-token-refresh` | 24 h |

`post-engineer-mcp` on `127.0.0.1:8081`. OAuth bearer, talks to the web
API. Small, always on. No GPU, no ffmpeg.

Deploy mechanism, from the private repo: cron
`*/5 * * * *` runs `deploy.sh` under `flock`. It pulls `main`, injects
`secrets/prod/`, rebuilds only the app whose files changed, waits for
health, and reloads Caddy when the Caddyfile changed. The web container
starts only after npm is serving the one MCP version the web accepts.
Rollback of a bad commit is a revert on `main`. The script will not stay
on a local checkout that is not `origin/main`.

### Classification

| Workload | Decision |
| --- | --- |
| LongCat GPU class, its weights volume, its HTTP endpoints, its Dict and results volume | Stay on Modal |
| ffmpeg normalize inside the LongCat container | Stay for now. Optional follow-up, still not a new host |
| Qwen GPU and its Vercel front | Stay. Not part of the product move |
| TTS, engine ffmpeg, Whisper, web, MCP, Caddy, both schedulers | Already off Modal. Keep them together on one machine |
| Supabase, R2, Stripe, OAuth apps, PostHog, Resend, Apify actor | Leave where they are |
| Retired InfiniteTalk endpoints and unused env names | Do not migrate. Remove after the old Modal app is confirmed stopped |

## Why this shape does not want a serverless split

1. CPU continues after the HTTP response. A Cloud Run service on
   request-based billing freezes CPU when the request ends. Encodes and
   the 60-second fill tick would stall. Instance-based billing fixes that
   by charging for the whole life of the instance.
2. Models want to stay warm. TTS keeps Phonon and Kokoro resident. Whisper
   `small` downloads on first use (hundreds of MB, persisted on
   `whisper_models`). A scale-to-zero replica reloads them on the next
   video and makes the first request of the day slow.
3. The engine is one process with an in-memory queue and
   `max_concurrent_tasks = 1`. Autoscaling it does not add throughput
   until the queue is external and the single-writer rule is lifted.
   That is a product change, not a hosting change.
4. Memory is the bill. The compose limits are 8 GB and 7 GB because peaks
   are real (Nano plus a render). A platform that reserves that RAM
   around the clock costs like a large VM. A platform that bills only
   measured RAM is cheaper only while the processes stay small, and it
   still has to allow the peak or the kernel kills ffmpeg (exit 137).
5. Videos are minutes, not milliseconds. A lip-sync hook is minutes of
   GPU plus minutes of CPU splice. Any host with a 15-minute request cap
   is safe only because the engine's HTTP call returns a task id. The
   worker still has to be allowed to run for the rest of the splice.
6. Egress is small at this volume but not free on every cloud. Final
   files go to R2, and R2 does not charge egress to the internet. The
   host still pays to upload them. Hetzner includes 20 TB in the EU.
   Fly, GCP, and AWS bill egress. At the moderate assumption below
   (about 12 GB of uploads) that line is a few dollars, not the decision.

## Host comparison

Prices checked 23 Nov 2026 against each vendor's page or a page that
cites it with a date. Figures are list price, before tax, and they are
estimates. They are not a quote and not an invoice. "Month" for the
arithmetic below is 730 hours (2,628,000 seconds), which is what the GCE
price pages use. Fly's own table is 30 days and is quoted from that table.

### Usage assumptions

Both levels assume the GPU mix the code prefers (H100, about $3.95/h for
the card, about $4.06/h with a little host CPU and RAM). A 7.5 s hook is
taken as 6 minutes of GPU, from the LongCat module comment, plus the 60 s
scaledown hold ($0.07). A cold container adds a weight load; the comment
says a cold clip costs about twice a warm one. The moderate column
assumes clips are batched enough that most of them are warm. These are
not measured production timings. Replace them with `total_gpu_s` from
real job records before signing a bill.

| | Low (beta: owner + test account) | Moderate (still one machine) |
| --- | --- | --- |
| Videos finished | 20 / month | 300 / month |
| Of which have a lip-sync hook | 8 | 100 |
| CPU time implied | 20 × ~10 min ≈ 3 h | 300 × ~10 min ≈ 50 h |
| GPU time implied | 8 × ~7 min ≈ 1 h ≈ $4–8 | 100 × ~7 min ≈ 12 h ≈ $45–70 |
| Upload to R2 | ~1 GB | ~12 GB (40 MB × 300) |
| Concurrent renders | 1, the configured cap | 1, unless `max_concurrent_tasks` is raised |

Fifty hours of ffmpeg fits in one 8-vCPU box with a large idle margin.
Moderate does not require a second machine. It can require paying Modal
past the $30 credit. Qwen test jobs spend that same credit. Count them.

### Always-on CPU host

| Host | Can run this stack | Low / month | Moderate / month | Why it is or is not the pick |
| --- | --- | --- | --- | --- |
| Hetzner CX43 (EU), 8 shared vCPU, 16 GB, 160 GB NVMe, 20 TB | Yes. Same Compose file. x86, so the current wheels stay valid | ~$20 | ~$20 | Cheapest box that matches the 16 GB sizing. Shared CPU is acceptable while concurrency is 1. CX43 stock is limited; the decision is "this price class", not one SKU. US locations are much more expensive (CPX41 in the US was listed near €120) |
| Current VPS, unknown vendor, sized as 16 GB in the compose comments | Yes, it is production | Whatever the invoice says | Same, until the queue cap is lifted | If this number is already near $20–40, do not migrate |
| GCP Compute Engine `e2-standard-4`, 4 vCPU, 16 GB, us-central1, on-demand $0.134/h | Yes, with the compose CPU limits sharing 4 vCPU. Add disk (~$8 for 50 GB pd-balanced) and an address | ~$110 | ~$110 + egress (~$1 at 12 GB) | The Google-shaped version of today's box. 1-year commit drops the VM to about $62. Still several times Hetzner |
| GCP Cloud Run, four services, instance-based billing, Tier 1 $0.000018/vCPU-s and $0.000002/GiB-s | Only if min instances stay at 1 and max stays at 1. Free tier (240,000 vCPU-s and 450,000 GiB-s) is about $5 | ~$440 | ~$440 | Engine 3 vCPU + 8 GiB ≈ $184. TTS 3 vCPU + 7 GiB ≈ $179. Web 1 vCPU + 1 GiB ≈ $53. MCP 0.5 vCPU + 0.5 GiB ≈ $26. Request-based billing is cheaper on paper and breaks background CPU |
| Fly.io one Machine, `shared-cpu-8x` (2 GB included, $17.55) + 14 GB at $6/GB | Yes. Volume for weights at $0.15/GB. Free plan is $5 of usage and 3 machines, which does not cover this | ~$102 + volume | ~$102 + a few dollars of egress ($0.02/GB in NA/EU on recent writeups) | Best PaaS that can hold one 16 GB machine and a disk. `performance-8x` (16 GB dedicated) is $264 and is unnecessary |
| Railway Hobby ($5) plus measured RAM at $10/GB-month and CPU at $20/vCPU-month | Maybe. Set the memory ceiling to the compose peaks or ffmpeg is OOM-killed. Hobby volumes cap at 5 GB, which is tight for Whisper plus TTS weights; Pro ($20) lifts that | ~$40–80 if idle RSS stays a few GB | ~$70–120 when encodes and Nano overlap | Usage billing helps only while RAM is actually low. Confirm the HTTP timeout (public writeups in 2026 still describe 15 minutes) before depending on it. The engine returns a task id, so the timeout hits clients who hold the connection, not the worker, as long as the service is not serverless-sleeping |
| Render, 4 vCPU / 16 GB at $225, or 8 vCPU / 16 GB at $300, plus $0.25/GB disk. Pro workspace $25 | Yes, one instance | $225–300 | Same | Clear and expensive. Free instance is 512 MB and sleeps |
| Northflank `nf-compute-800-16`, 8 vCPU / 16 GB, $192. Free allowance up to $20 of resources | Yes | $192 | $192 | Same class of bill as Render. Egress $0.06/GB |
| Koyeb `eco-2xlarge`, 8 vCPU / 16 GB, $85.71 (docs dated 27 May 2026). Standard `2xlarge` is $172 | Yes, one instance. Scale-to-zero would cold-start the models | $86 or $172 | Same | Between Fly and Hetzner on price, with less disk on the eco size (20 GB) than the model volumes want |
| AWS Lightsail Xlarge-16GB, 4 vCPU / 16 GB / 6 TB, $84 | Yes | $84 | $84 | A simple VM. Fine, not cheap |
| AWS Fargate, 4 vCPU + 16 GB always on, Linux us-east-1 $0.000011244/vCPU-s and $0.000001235/GB-s | Yes, plus a load balancer you would still have to run | ~$170 | ~$170 | $118 CPU + $52 memory. Lambda is out: 15-minute cap, and the models do not fit the deployment model |
| Cloudflare Containers | No as a single box. Account max is 4 vCPU and 12 GiB per instance (standard-4). Workers cannot host ffmpeg-class work | Two always-on 8 GiB instances ≈ $105 of memory alone, plus CPU, plus the $5 Workers plan | Higher when CPU is active | 12 GiB cannot hold the 8 GB + 7 GB limits together. Inactivity timeout tops out at 6 hours, so "always on" is a ping loop. Disk per instance tops out at 20 GB |

### GPU line, same for every row above

| | Low | Moderate |
| --- | --- | --- |
| Modal Starter | $0 platform, $30 compute credit | Same plan |
| LongCat, assumptions above | about $4–8, inside the credit | about $45–70, so about $15–40 past the credit |
| Qwen tests | Shares the same credit. A forgotten warm container bills until the 60 s scaledown | Same |

Do not buy a GPU VM to replace this. An always-on H100 is thousands of
dollars a month. Modal's scale-to-zero plus `max_containers=1` is the
right shape for a few clips a day. The $30 credit is Modal's, and the
README already warns that it can end.

## Migration plan

Do this only if the current VPS invoice, disk, or provider is the
problem. If it is not, the plan is: stop, delete the unused InfiniteTalk
env names after the old app is confirmed down, and take `MODAL_TOKEN_ID`
and `MODAL_TOKEN_SECRET` out of the engine env file.

### 0. Measure before buying

On the current host, record the provider, the monthly price, RAM, disk
free, and one week of `docker stats` for `mpt-engine-cpu` and
`mpt-tts-cpu`. Record a handful of LongCat `total_gpu_s`, `normalize_s`,
and `container_overhead_usd` from real jobs. If the VPS is already near
$20–40 and RAM headroom is fine, do not move.

### 1. Keep Modal as the GPU API

No new GPU host. The engine keeps calling `LONGCAT_SUBMIT_URL`,
`LONGCAT_STATUS_URL`, and `LONGCAT_DOWNLOAD_URL` with bearer
`LONGCAT_HTTP_SECRET`. Those three stay in the engine env, and the
matching values stay in the Modal secret `longcat-http` and the Hugging
Face secret `huggingface`. Deploy is still `modal deploy modal_longcat.py`
from a machine that has the Modal CLI token, which should not be the
engine container.

### 2. Provision the replacement as a copy of today

Hetzner CX43 (or the in-stock EU type with 8 shared vCPU and 16 GB) in
Falkenstein or Helsinki, x86, Ubuntu LTS, Docker plus the Compose plugin,
Caddy from the distro packages. Do not use an ARM plan for the first
move: the TTS image installs CPU torch and chatterbox-tts from git, and
an architecture change is a separate test.

Install the private deploy repo the same way the current host has it.
`deploy.sh` already clones `post-engineer`, injects `secrets/prod/`, and
installs the crontab. Run it once by hand. Confirm
`/var/log/post-engineer-deploy.log` and the four containers healthy:
`post-engineer-web`, `mpt-engine-cpu`, `mpt-tts-cpu`, `post-engineer-mcp`.

### 3. Move the disks that are not in git

`docker compose` volumes, copied while the old stack is stopped or with
a short read-only window:

| Volume | Why it has to move |
| --- | --- |
| `tts_voices` | Clone reference WAVs and `voices.toml` |
| `tts_models` | Hugging Face cache. Re-download works, and Chatterbox Nano is a gated repo (`HF_TOKEN`) |
| `whisper_models` | faster-whisper `small`. Re-download works |
| `engine_storage` | In-flight task files. Empty is acceptable if no task is running |

Fonts and songs are injected from `secrets/prod/engine/resource/` by
`deploy.sh`. Do not put them in the public repo.

### 4. Secrets

Keep the private repo as the source of the env files. Do not introduce a
new secret store as part of the move. On the new host the same names
must be present:

- Engine: `MONEYPRINT_API_SECRET`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `CHATTERBOX_HTTP_SECRET`, `HF_TOKEN`,
  `LONGCAT_MODAL_APP_NAME`, `LONGCAT_SUBMIT_URL`, `LONGCAT_STATUS_URL`,
  `LONGCAT_DOWNLOAD_URL`, `LONGCAT_HTTP_SECRET`, plus the optional
  `DISCORD_WEBHOOK_URL`, `POSTHOG_API_KEY`, `RESEND_API_KEY`,
  `ACCOUNT_BREAK_FROM`.
- Web: the names in `apps/web/.env.example` (Supabase, R2, Stripe,
  OAuth client ids and secrets, `TOKEN_ENCRYPTION_KEY`,
  `MONEYPRINT_API_URL`, `MONEYPRINT_API_SECRET`, `MCP_OAUTH_PRIVATE_KEY_PEM`,
  PostHog, Resend). `MONEYPRINT_API_URL` stays
  `https://engine.post-engineer.com` across the DNS cut.
- MCP: `MCP_OAUTH_ISSUER`, `MCP_RESOURCE`. Those two are public
  identifiers. The production file sets both to the site origin. Do not
  append `/mcp` to the resource.

Leave Modal secrets in Modal. Leave Vercel env for the image API on
Vercel (`IMAGE_API_BEARER`, `QWEN_IMAGE_EDIT_HTTP_SECRET`,
`QWEN_IMAGE_21_MODAL_APP_NAME`).

Before the first `docker compose up` on the new host, remove
`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, and the four `INFINITETALK_*`
names from the engine env file that Compose will load. Keep a copy of
the Modal token in the operator's own Modal config, outside the app
container.

### 5. Cut over and roll back

Lower DNS TTL on `post-engineer.com`, `www`, and `engine.post-engineer.com`
a day ahead. Point the A records at the new host. Caddy will issue
certificates once the records land.

Smoke, in order, with no real social publish and no token spend beyond
one cheap render: `GET /api/version` on the web, engine `/health`, TTS
`/health` from inside the compose network, one short faceless video, one
lip-sync hook that reaches LongCat and comes back, one clone register if
`tts_voices` was copied.

Rollback is the DNS A records back to the old host, which stays installed
and stopped-from-cron until the new host has survived a day. Do not
decommission the old box in the same hour. A bad application commit
rolls back by reverting `main`, on either host, because `deploy.sh`
resets the checkout to `origin/main` within five minutes.

### 6. What not to do in the same change

- Do not split web, engine, and TTS onto different Cloud Run services.
- Do not turn on Cloud Run request-based billing for the engine.
- Do not autoscale the engine past one replica.
- Do not move LongCat or Qwen off Modal.
- Do not put prompt text, tokens, or the env files into this public repo.
- Do not rebuild the queue on Cloud Tasks or Pub/Sub until
  `max_concurrent_tasks` is actually the bottleneck. At one video at a
  time and a few hundred videos a month, it is not.

### Later, only if the numbers say so

When one box is busy all day (`max_concurrent_tasks` raised, queue
sitting at the cap), the next step is a second engine container behind
a real queue, with TTS still a single warm process the engines call.
That is the moment a PaaS or a second Hetzner box earns its keep. It is
not this move.

Separately, and smaller: if LongCat job records show the ffmpeg
normalize taking a meaningful share of GPU seconds, do that scale/crop
on the engine after download. The GPU class and the HTTP API stay on
Modal.

## Sources

- Modal prices and the $30 Starter credit: <https://modal.com/pricing>.
  The H100, H200, and A100-80GB per-second rates match `GPU_RATES` in
  `apps/engine/modal_longcat_gpu.py`.
- Hetzner CX43, €15.99/month net in Germany, 8 vCPU, 16 GB, 20 TB,
  verified 10 Nov 2026 against Hetzner's price list:
  <https://cloudtally.eu/hetzner-cloud-prices> and
  <https://www.hetzner.com/cloud>.
- Fly Machines, Ashburn, retrieved from <https://fly.io/pricing>:
  `shared-cpu-8x` at $17.55/month for 2 GB, additional RAM $6/GB/month,
  Free plan $5 of usage.
- Cloud Run instance-based rates, Tier 1: $0.000018 per vCPU-second,
  $0.000002 per GiB-second, free tier 240,000 vCPU-seconds and 450,000
  GiB-seconds. <https://cloud.google.com/run/pricing>. Background CPU
  requires instance-based billing:
  <https://cloud.google.com/run/docs/configuring/billing-settings>.
- GCE `e2-standard-4` on-demand $0.134/hour, about $97.84/month in
  us-central1, price list read 21–23 Nov 2026.
- Railway: $10 per GB-month RAM, $20 per vCPU-month, Hobby $5, volume
  cap 5 GB on Hobby. <https://docs.railway.com/pricing/plans>.
- Render compute table: 4 vCPU / 16 GB $225, 8 vCPU / 16 GB $300.
  <https://render.com/pricing>.
- Northflank `nf-compute-800-16` $192/month.
  <https://northflank.com/pricing>.
- Koyeb instance table, page dated 27 May 2026:
  <https://www.koyeb.com/docs/reference/instances>.
- Lightsail Xlarge-16GB $84/month:
  <https://aws.amazon.com/lightsail/pricing/>.
- Fargate Linux rates used above are the us-east-1 figures on
  <https://aws.amazon.com/fargate/pricing/>.
- Cloudflare Containers, max 4 vCPU / 12 GiB / 20 GB disk, memory
  $0.0000025 per GiB-second provisioned:
  <https://developers.cloudflare.com/containers/platform/pricing/> and
  <https://developers.cloudflare.com/containers/platform/limits/>.
