import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { actionDescription, actionShape, byAction, offeredSpecs, type ActionOptions } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { optionalPersonaRefShape, withOptionalPersona } from './refs.js';
import { withScriptOutcome, type RecipeSession } from './recipe-session.js';
import { CompleteVideoUploadShape, CreateVideoUploadShape, PublishUploadedVideoShape } from './publish-uploaded-shape.js';
import { PublishExistingLocalShape, PublishExistingRemoteShape, PublishExistingShape } from './publish-existing-shape.js';
import { IMAGE_PROVIDERS } from './contracts/providers.js';
import { handlePublishExisting } from './tools-publish-existing.js';
import { DESTRUCTIVE, MUTATING, READ_ONLY } from './tool-annotations.js';
import { PublishVideoDirectShape, handlePublishVideoDirect } from './tools.js';
import { PromptComparisonShape, handlePromptComparison } from './tools-experiments.js';
import { UploadMediaRemoteShape } from './remote-shapes-images.js';
import { CheckMediaShape, UploadMediaRemoteSchema, UploadMediaShape, handleCheckMedia, handleUploadMedia, handleUploadMediaFromUrl } from './tools-user-media.js';
import { ValidateScriptSchema } from './single-video-shape.js';
import { ScoreDraftShape, ValidateScriptShape, handleScoreDraft, handleValidateScript } from './tools-single-video.js';
import { handleCompleteVideoUpload, handleCreateVideoUpload, handlePublishUploadedVideo } from './tools-publish-uploaded.js';

const EXPERIMENTS_SPECS = { results: PromptComparisonShape };

const MEDIA_SPECS = { upload: UploadMediaShape, check: CheckMediaShape };

const CHECK_SCRIPT_SPECS = { validate: ValidateScriptShape, score: optionalPersonaRefShape(ScoreDraftShape) };

const PUBLISH_SPECS = {
  from_file: PublishVideoDirectShape,
  create_upload: CreateVideoUploadShape,
  complete_upload: CompleteVideoUploadShape,
  publish_upload: PublishUploadedVideoShape,
  publish_existing: optionalPersonaRefShape(PublishExistingShape),
};

export function registerContentTools(server: McpServer, client: PostEngineerClient, session: RecipeSession, remote: boolean): void {
  server.tool(
    'experiments',
    actionDescription(
      'Experiments compare prompts. Every video generated with a promptVersionId (the versionId that prompts (action: get) returns) records that prompt version. results: per publishing account (never across accounts), each prompt version with its video count, median views, lift (each video\'s views divided by the median of the other videos of the same account; above 1 beats the account) and a sign-test label: insufficient (fewer than 5 videos), no_signal, indicative or clear. Videos made without a prompt form the "no prompt" group. Never call a prompt the winner unless the label is clear. To test two prompts fairly, alternate them on the same account and swap their posting times.',
      EXPERIMENTS_SPECS,
    ),
    actionShape(EXPERIMENTS_SPECS),
    READ_ONLY,
    byAction(
      {
        results: async (args) => handlePromptComparison(client, args),
      },
      EXPERIMENTS_SPECS,
      'experiments',
    ),
  );

  const mediaOptions: ActionOptions<typeof MEDIA_SPECS> = remote ? { variants: { upload: UploadMediaRemoteShape } } : {};
  server.tool(
    'media',
    actionDescription(
      `Images for video segments. check: mechanically check one public image URL (no LLM, relevance is for you to judge): returns one code (ok, blocked_403 when the host blocks the download — ${remote ? 'use another public URL for that photo' : 'then use upload with bytes fetched on your own machine'} — and the size, type and aspect failures). upload: ${remote ? 'a public https imageUrl is downloaded by the server' : 'a local image'} and becomes a mediaId for a segment (a temporary asset, 1 hour: upload shortly before generating).`,
      offeredSpecs(MEDIA_SPECS, mediaOptions),
    ),
    actionShape(offeredSpecs(MEDIA_SPECS, mediaOptions)),
    MUTATING,
    byAction(
      {
        upload: async (args) => (remote ? handleUploadMediaFromUrl(client, UploadMediaRemoteSchema.parse(args)) : handleUploadMedia(client, args)),
        check: async (args) => handleCheckMedia(client, args),
      },
      MEDIA_SPECS,
      'media',
      mediaOptions,
    ),
  );

  server.tool(
    'check_script',
    actionDescription(
      'Check a script before spending tokens. validate: the mechanical rules (hook first, exactly one hook, no placeholders/links/markdown/emoji/stage directions, hook terminal punctuation, word limits: total 60-200, content at least 30, hook 25-40 words; a CTA is a content take, placed anywhere), no tokens spent. score: a 0-100 score of a draft against your own measured posts, every point explained.',
      CHECK_SCRIPT_SPECS,
    ),
    actionShape(CHECK_SCRIPT_SPECS),
    READ_ONLY,
    byAction(
      {
        validate: withScriptOutcome<z.infer<typeof ValidateScriptSchema>>(session, 'check_script_validate', async (args) => handleValidateScript(client, args), (args) => [{ segments: args.segments, videoType: args.videoType }]),
        score: (args) => withOptionalPersona(client, args, (resolved) => handleScoreDraft(client, resolved)),
      },
      CHECK_SCRIPT_SPECS,
      'check_script',
    ),
  );

  const publishOptions: ActionOptions<typeof PUBLISH_SPECS> = remote
    ? { unavailable: ['from_file'], variants: { publish_existing: optionalPersonaRefShape(PublishExistingRemoteShape) } }
    : { variants: { publish_existing: optionalPersonaRefShape(PublishExistingLocalShape) } };
  server.tool(
    'publish_video',
    actionDescription(
      `Publish media that already exists, with no generation and no charge. ${remote ? '' : 'from_file: a local video (.mp4 or .mov) is published now. '}create_upload → complete_upload → publish_upload: a signed upload, video or JPEG/PNG (PUT straight to storage, never via this server; expires in 15 min), published now; publishing consumes it. publish_existing: a finished generated video (taskId), a completed upload (uploadId)${remote ? '' : ' or a local image (imagePath)'}, to every network of its accounts in one call (images: ${IMAGE_PROVIDERS.join('/')}), with mode asap (now) or scheduled (once, at publishAt). YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption (publish_existing uses description). If a call times out, retry with the same idempotencyKey: the original result is replayed. A result with errorCode publish_unknown must NOT be retried: the post may be live, check the account first.`,
      offeredSpecs(PUBLISH_SPECS, publishOptions),
    ),
    actionShape(offeredSpecs(PUBLISH_SPECS, publishOptions)),
    DESTRUCTIVE,
    byAction(
      {
        from_file: async (args) => handlePublishVideoDirect(client, args),
        create_upload: async (args) => handleCreateVideoUpload(client, args),
        complete_upload: async (args) => handleCompleteVideoUpload(client, args),
        publish_upload: async (args) => handlePublishUploadedVideo(client, args),
        publish_existing: (args) => withOptionalPersona(client, args, (resolved) => handlePublishExisting(client, resolved)),
      },
      PUBLISH_SPECS,
      'publish_video',
      publishOptions,
    ),
  );
}
