# Post Engineer: AI video generator and social scheduler

Turn a short script (hook, body, call to action) into a vertical video presented by an AI persona, or a faceless video, and publish it to YouTube, Instagram, LinkedIn, Threads or Bluesky. One run creates one video.

This Actor is a thin client for the [Post Engineer API](https://post-engineer.com/api-documentation.txt). Generation runs on Post Engineer and is paid with Post Engineer tokens, not Apify compute.

## Before you run it

1. Create an account at [post-engineer.com](https://post-engineer.com) and connect the social accounts you want to post to.
2. Create an API key at [post-engineer.com/api-keys](https://post-engineer.com/api-keys). It starts with `pe_live_`.
3. Make sure the account has tokens. A faceless video costs 1 token, a persona video 2 or 3, depending on face quality.

## Input

| Field | Required | What it does |
|---|---|---|
| `apiKey` | yes | Your Post Engineer API key. Stored as a secret input. |
| `title` | yes | Label of the scheduled post. |
| `hook`, `body`, `cta` | yes | The script. 60 to 200 words in total. It is validated before any token is spent. |
| `providers` | yes | Any of `youtube`, `instagram`, `linkedin`, `bluesky`, `threads`. |
| `personaId` | no | AI persona to present the video. Leave empty and set `faceless` for a faceless video. |
| `faceless` | no | `true` for a faceless video. |
| `accounts` | no | Account ids per provider, e.g. `{"youtube": ["<id>"]}`. Defaults to the persona's publishing accounts. |
| `mode` | no | `asap` (default) publishes when the video is ready; `scheduled` uses `schedule`. |
| `schedule` | for `scheduled` | `{"startAt": "2026-12-01T09:00:00Z", "times": ["18:00"], "timezone": "America/Sao_Paulo"}`. Slots must be 3 hours to 30 days ahead. |
| `waitForCompletion` | no | Default `true`: keep the run open until the video is generated or fails. |
| `timeoutMinutes` | no | How long to wait, 1 to 60 (default 30). |
| `apiUrl` | no | Only for self-hosted Post Engineer. Must be https. |

### Example

```json
{
  "apiKey": "pe_live_...",
  "title": "Why short videos win",
  "hook": "Most people scroll past your posts in under two seconds.",
  "body": "Short videos fix that. ...",
  "cta": "Follow for one tip a day.",
  "providers": ["youtube"],
  "faceless": true
}
```

## Output

One dataset item (also saved as the `OUTPUT` record):

```json
{
  "scheduleId": "6f1c...",
  "mode": "asap",
  "replayed": false,
  "warnings": [],
  "slots": [
    {
      "slotId": "a2b9...",
      "slotAt": "2026-11-02T18:00:00.000Z",
      "title": "Why short videos win",
      "taskId": "c41e...",
      "status": "generating",
      "videoStatus": "complete",
      "videos": ["https://post-engineer.com/api/persona/video-download/..."]
    }
  ]
}
```

`videoStatus` is one of:

- `complete`: the video was generated.
- `failed` (with `error`): generation failed; Post Engineer refunds the tokens.
- `unknown` (with `error`): the engine lost the task and the slot status could not confirm the outcome. Check the post in Post Engineer before re-running, so you do not pay for a second video.
- `timeout`: the video was still processing when `timeoutMinutes` ran out.

It is absent when `waitForCompletion` is `false`.

## Retries and failures

- The Apify run id is sent as the idempotency key, so a retried run replays the accepted job instead of charging twice (`replayed: true`).
- Invalid input, a rejected script, missing tokens and invalid keys fail the run with the API's message. The API key never appears in logs or output.

## Self-hosting

Post Engineer is open source (Apache-2.0): [github.com/Ryan-Carloso/post-engineer](https://github.com/Ryan-Carloso/post-engineer). Point `apiUrl` at your own deployment.
