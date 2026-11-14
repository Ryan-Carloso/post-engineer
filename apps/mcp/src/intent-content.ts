import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { actionDescription, actionShape, byAction, offeredSpecs, type ActionOptions } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { optionalPersonaRefShape, withOptionalPersona } from './refs.js';
import { withScriptOutcome, type RecipeSession } from './recipe-session.js';
import { CompleteVideoUploadShape, CreateVideoUploadShape, PublishUploadedVideoShape } from './publish-uploaded-shape.js';
import { DESTRUCTIVE, MUTATING, READ_ONLY } from './tool-annotations.js';
import { PublishVideoDirectShape, handlePublishVideoDirect } from './tools.js';
import { AddExperimentPairShape, CreateExperimentShape, GetExperimentResultsShape, ListExperimentsShape, handleAddExperimentPair, handleCreateExperiment, handleGetExperimentResults, handleListExperiments } from './tools-experiments.js';
import { CheckMediaShape, UploadMediaShape, handleCheckMedia, handleUploadMedia } from './tools-user-media.js';
import { ValidateScriptSchema } from './single-video-shape.js';
import { ScoreDraftShape, ValidateScriptShape, handleScoreDraft, handleValidateScript } from './tools-single-video.js';
import { handleCompleteVideoUpload, handleCreateVideoUpload, handlePublishUploadedVideo } from './tools-publish-uploaded.js';

//---------------
// experiments, media, check_script and publish_video (issue #566).
//---------------

const EXPERIMENTS_SPECS = {
  create: optionalPersonaRefShape(CreateExperimentShape),
  list: ListExperimentsShape,
  add_pair: AddExperimentPairShape,
  results: GetExperimentResultsShape,
};

const MEDIA_SPECS = { upload: UploadMediaShape, check: CheckMediaShape };

const CHECK_SCRIPT_SPECS = { validate: ValidateScriptShape, score: optionalPersonaRefShape(ScoreDraftShape) };

const PUBLISH_SPECS = {
  from_file: PublishVideoDirectShape,
  create_upload: CreateVideoUploadShape,
  complete_upload: CompleteVideoUploadShape,
  publish_upload: PublishUploadedVideoShape,
};

export function registerContentTools(server: McpServer, client: PostEngineerClient, session: RecipeSession, remote: boolean): void {
  server.tool(
    'experiments',
    actionDescription(
      'Paired A/B experiments that test ONE script variable, the hook, with two variants (each a slug variantId such as hook-aggressive, never "A"/"B", with a name and the style you will follow when writing its hooks). create: define it. add_pair: both videos of one pair (same title, content and delivery, one hook per variant; each is a normal charged video, the second starts spacingHours after the first; the server rejects a pair that differs in anything but the hook, before charging; calling it again with the same arguments replays). list / results: results compare per network for a window (default 7d) with a sign-test pValue and a label: pending, indicative or clear. Never call a variant the winner unless the label is clear.',
      EXPERIMENTS_SPECS,
    ),
    actionShape(EXPERIMENTS_SPECS),
    MUTATING,
    byAction(
      {
        create: (args) => withOptionalPersona(client, args, (resolved) => handleCreateExperiment(client, { ...resolved, targetPairs: resolved.targetPairs })),
        list: async () => handleListExperiments(client),
        add_pair: async (args) => handleAddExperimentPair(client, args),
        results: async (args) => handleGetExperimentResults(client, args),
      },
      EXPERIMENTS_SPECS,
      'experiments',
    ),
  );

  // upload reads a local file: only the stdio server offers it.
  const mediaOptions: ActionOptions<typeof MEDIA_SPECS> = remote ? { unavailable: ['upload'] } : {};
  server.tool(
    'media',
    actionDescription(
      `Images for video segments. check: mechanically check one public image URL (no LLM, relevance is for you to judge): returns one code (ok, blocked_403 when the host blocks the download — ${remote ? 'use another public URL for that photo' : 'then use upload with bytes fetched on your own machine'} — and the size, type and aspect failures)${remote ? '.' : '. upload: a local image becomes a mediaId for a segment (a temporary asset, 1 hour: upload shortly before generating).'}`,
      offeredSpecs(MEDIA_SPECS, mediaOptions),
    ),
    actionShape(offeredSpecs(MEDIA_SPECS, mediaOptions)),
    MUTATING,
    byAction(
      {
        upload: async (args) => handleUploadMedia(client, args),
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
      'Check a script before spending tokens. validate: the mechanical rules (hook first, exactly one hook, no placeholders/links/markdown/emoji/stage directions, hook terminal punctuation, word limits: total 60-200, content at least 30, hook 15-40 words; a CTA is a content take, placed anywhere), no tokens spent. score: a 0-100 score of a draft against your own measured posts, every point explained.',
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

  // from_file reads a local video: only the stdio server offers it.
  const publishOptions: ActionOptions<typeof PUBLISH_SPECS> = remote ? { unavailable: ['from_file'] } : {};
  server.tool(
    'publish_video',
    actionDescription(
      `Publish a ready-made video directly to social accounts: no generation, no schedule. ${remote ? '' : 'from_file: a local video (.mp4 or .mov) is read and published. '}create_upload → complete_upload → publish_upload: a signed upload (the bytes are PUT straight to storage, never through this server; the upload expires in 15 minutes; publishing consumes it). YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption. If a call times out, retry with the same idempotencyKey (the original result is replayed); a result with errorCode publish_unknown must NOT be retried: the post may be live, check the account first.`,
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
      },
      PUBLISH_SPECS,
      'publish_video',
      publishOptions,
    ),
  );
}
