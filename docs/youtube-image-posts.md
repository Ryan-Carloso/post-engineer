# YouTube image posts

**Status: workaround. Revalidate in 2027.**

## What happens today

An image (JPEG or PNG, up to 8 MB) published to YouTube becomes an 8-second
vertical Short. The other image networks receive the image itself.

- The engine renders the Short (`POST /api/v1/media/image-short`,
  `apps/engine/app/services/image_short.py`): 1080×1920, the whole image
  centred over a blurred copy of itself, a slow 6% zoom, and a track from the
  background-music catalog that fades out over the last second.
- The web YouTube publish handler (`apps/web/lib/upload/handlers.ts`) calls the
  engine when the file it must publish is an image. Every publish path ends in
  that handler: publish now, scheduled slots, signed uploads and the MCP.
- The render is free. It is not a generation, so no tokens are charged.

## Why not a real image post

The YouTube Data API `posts` resource (text and image posts on the channel's
Posts tab, formerly Community) exists, but it is a pilot:

> The `posts` resource and its methods are in a pilot phase with access limited
> to select launch partners (approved Google Cloud projects). Broader public API
> access is planned for General Availability in 2027.

- Reference: https://developers.google.com/youtube/data/reference/rest/v3/posts
- `posts.insert`: https://developers.google.com/youtube/data/reference/rest/v3/posts/insert
- `posts.imageUpload`: https://developers.google.com/youtube/data/reference/rest/v3/posts/imageUpload
- Revision history (16 Nov 2026 entry): https://developers.google.com/youtube/v3/revision_history

Access is granted per Google Cloud project, and this project is not in the
pilot. There is no public form to apply. Automating YouTube Studio in a browser
breaks YouTube's terms and is not an option.

## Revalidate in 2027

When `posts.insert` is open to every project:

1. Add the `https://www.googleapis.com/auth/youtube.force-ssl` (or `youtube`)
   scope to the YouTube OAuth flow (`apps/web/lib/youtube.ts`). It requests
   only `youtube.upload` and `youtube.readonly` today, so every account must
   reconnect.
2. Publish images with `posts.imageUpload` + `posts.insert` instead of the
   Short. `posts.insert` publishes immediately, so scheduled posts keep going
   through the slot scheduler.
3. Delete `image_short.py`, its endpoint, `apps/web/lib/engine/image-short.ts`
   and `IMAGE_AS_SHORT_PROVIDERS` / `IMAGE_AS_SHORT_NOTE` in
   `shared/contracts/providers.ts`.

Context and decision: https://github.com/Ryan-Carloso/post-engineer/pull/760
