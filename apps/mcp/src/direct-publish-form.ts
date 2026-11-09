// direct-publish-form — provider-specific fields and the multipart form
// for publish_video_direct.
//
// Extracted from client.ts so client.ts stays under the file-size ratchet.
// Rumble takes title + description (like YouTube, minus tags and
// privacyStatus); Instagram takes a file + caption; the rest take a video
// + caption.
import type { PublishVideoDirectInput } from './client-types.js';

export interface DirectPublishFields {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: string;
  caption: string;
}

function requireTitleAndDescription(input: PublishVideoDirectInput): { title: string; description: string } {
  if (input.title === undefined || input.title.trim().length === 0) {
    throw new Error(`title is required for ${input.provider}.`);
  }
  if (input.description === undefined || input.description.trim().length === 0) {
    throw new Error(`description is required for ${input.provider}.`);
  }
  return { title: input.title.trim(), description: input.description.trim() };
}

// Provider-specific required fields, validated before any fetch so the
// agent gets a named failure instead of a server 400 after uploading.
export function requireDirectPublishFields(input: PublishVideoDirectInput): DirectPublishFields {
  let title = '';
  let description = '';
  let tags: string[] = [];
  let privacyStatus = '';
  let caption = '';
  if (input.provider === 'youtube' || input.provider === 'rumble') {
    ({ title, description } = requireTitleAndDescription(input));
    if (input.provider === 'youtube') {
      if (input.tags === undefined || input.tags.length === 0) {
        throw new Error('tags is required for youtube.');
      }
      const validPrivacy = ['public', 'private', 'unlisted'];
      if (input.privacyStatus === undefined || !validPrivacy.includes(input.privacyStatus)) {
        throw new Error('privacyStatus is required for youtube.');
      }
      tags = input.tags;
      privacyStatus = input.privacyStatus;
    }
  } else {
    if (input.caption === undefined || input.caption.trim().length === 0) {
      throw new Error(`caption is required for ${input.provider}.`);
    }
    caption = input.caption.trim();
  }
  return { title, description, tags, privacyStatus, caption };
}

export function buildDirectPublishForm(
  input: PublishVideoDirectInput,
  fields: DirectPublishFields,
  videoBlob: Blob,
  filename: string,
): FormData {
  const formData = new FormData();
  formData.append('provider', input.provider);
  if (input.provider === 'youtube') {
    formData.append('video', videoBlob, filename);
    formData.append('title', fields.title);
    formData.append('description', fields.description);
    formData.append('tags', fields.tags.join(','));
    formData.append('privacyStatus', fields.privacyStatus);
    for (const accountId of input.accountIds) {
      formData.append('accountIds', accountId);
    }
  } else if (input.provider === 'instagram') {
    formData.append('file', videoBlob, filename);
    formData.append('caption', fields.caption);
    for (const accountId of input.accountIds) {
      formData.append('igAccountIds', accountId);
    }
  } else {
    const accountField = { bluesky: 'did', linkedin: 'linkedinAccountIds', threads: 'threadsAccountIds', facebook: 'facebookAccountIds', rumble: 'rumbleAccountIds' }[input.provider];
    formData.append('video', videoBlob, filename);
    // Rumble takes title + description, not a caption.
    if (input.provider === 'rumble') {
      formData.append('title', fields.title);
      formData.append('description', fields.description);
    } else {
      formData.append('caption', fields.caption);
    }
    for (const accountId of input.accountIds) {
      formData.append(accountField, accountId);
    }
  }
  return formData;
}
