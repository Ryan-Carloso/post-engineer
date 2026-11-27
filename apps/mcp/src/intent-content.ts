import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction, type ActionOptions, offeredSpecs } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { optionalPersonaRefShape, withOptionalPersona } from './refs.js';
import { CompleteVideoUploadShape, CreateVideoUploadShape, PublishUploadedVideoShape } from './publish-uploaded-shape.js';
import { PublishExistingLocalShape, PublishExistingRemoteShape, PublishExistingShape } from './publish-existing-shape.js';
import { IMAGE_PROVIDERS } from './contracts/providers.js';
import { handlePublishExisting } from './tools-publish-existing.js';
import { DESTRUCTIVE, READ_ONLY } from './tool-annotations.js';
import { PublishVideoDirectShape, handlePublishVideoDirect } from './tools.js';
import { PromptComparisonShape, handlePromptComparison } from './tools-experiments.js';
import { handleCompleteVideoUpload, handleCreateVideoUpload, handlePublishUploadedVideo } from './tools-publish-uploaded.js';

const EXPERIMENTS_SPECS = { results: PromptComparisonShape };

const PUBLISH_SPECS = {
  from_file: PublishVideoDirectShape,
  create_upload: CreateVideoUploadShape,
  complete_upload: CompleteVideoUploadShape,
  publish_upload: PublishUploadedVideoShape,
  publish_existing: optionalPersonaRefShape(PublishExistingShape),
};

export function registerContentTools(server: McpServer, client: PostEngineerClient, remote: boolean): void {
  server.tool(
    'experiments',
    actionDescription(
      'Experiments compare prompts. Every post scheduled with a promptVersionId (the versionId that prompts (action: get) returns) records that prompt version. results: per publishing account (never across accounts), each prompt version with its post count, median views, lift (views divided by the median of the account\'s other posts; above 1 beats the account) and a sign-test label: insufficient (fewer than 5 posts), no_signal, indicative or clear. Posts made without a prompt form the "no prompt" group. The clear and indicative thresholds are corrected for the number of prompts compared: they are divided by the number of groups of the account with at least 5 posts (the "no prompt" group included). Never call a prompt the winner unless the label is clear. To compare any number of prompts fairly, rotate them round-robin on the same account, swap their posting times, and schedule at least 10 posts per prompt: 5 posts only lift a prompt out of insufficient, and even a unanimous lead needs 6 posts to be clear with one group and 8 with five.',
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

  const publishOptions: ActionOptions<typeof PUBLISH_SPECS> = remote
    ? { unavailable: ['from_file'], variants: { publish_existing: optionalPersonaRefShape(PublishExistingRemoteShape) } }
    : { variants: { publish_existing: optionalPersonaRefShape(PublishExistingLocalShape) } };
  server.tool(
    'publish_video',
    actionDescription(
      `Publish media you made elsewhere. ${remote ? '' : 'from_file: a local video (.mp4 or .mov) is published now. '}create_upload → complete_upload → publish_upload: a signed upload, video or JPEG/PNG (PUT straight to storage, never via this server; expires in 15 min), published now; publishing consumes it. publish_existing: a completed upload (uploadId)${remote ? '' : ' or a local image (imagePath)'}, to every network of its accounts in one call (images: ${IMAGE_PROVIDERS.join('/')} only; YouTube and the other networks take video), with mode asap (now) or scheduled (once, at publishAt; scheduled posts accept a promptVersionId for experiments). Publishing needs an active account: after the 7-day free trial ends, or when the subscription is not active, the call fails with TRIAL_EXPIRED or SUBSCRIPTION_INACTIVE and names the contact link. YouTube needs title, description, tags and privacyStatus; Rumble and Fanvue title and description; the other networks a caption (publish_existing uses description). If a call times out, retry with the same idempotencyKey: the original result is replayed. A result with errorCode publish_unknown must NOT be retried: the post may be live, check the account first.`,
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
