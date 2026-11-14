// direct-publish-form — provider-specific fields and the multipart form
// for publish_video (action: from_file).
//
// Extracted from client.ts so client.ts stays under the file-size ratchet.
// Rumble and Fanvue take title + description (like YouTube, minus tags and
// privacyStatus) — the Fanvue web handler rejects a request without a title;
// Pinterest takes a boardId plus a description that falls
// back to the caption; Instagram takes a file + caption; the rest take a
// video + caption.
import { randomUUID } from 'node:crypto';
import type { PublishUploadedVideoInput, PublishVideoDirectInput } from './client-types.js';

// The provider-field rules are shared by the local-path publish
// (PublishVideoDirectInput) and the signed-upload publish by id
// (PublishUploadedVideoInput): they differ only in how the bytes arrive.
export type DirectPublishFieldInput = PublishVideoDirectInput | PublishUploadedVideoInput;

export interface DirectPublishFields {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: string;
  caption: string;
  boardId: string;
}

function requireTitleAndDescription(input: DirectPublishFieldInput): { title: string; description: string } {
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
export function requireDirectPublishFields(input: DirectPublishFieldInput): DirectPublishFields {
  let title = '';
  let description = '';
  let tags: string[] = [];
  let privacyStatus = '';
  let caption = '';
  let boardId = '';
  if (input.provider === 'youtube' || input.provider === 'rumble' || input.provider === 'fanvue') {
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
  } else if (input.provider === 'pinterest') {
    if (input.boardId === undefined || input.boardId.trim().length === 0) {
      throw new Error('boardId is required for pinterest.');
    }
    boardId = input.boardId.trim();
    const explicitDescription = input.description?.trim() ?? '';
    description = explicitDescription !== '' ? explicitDescription : (input.caption?.trim() ?? '');
    if (description.length === 0) {
      throw new Error('description or caption is required for pinterest.');
    }
    caption = input.caption?.trim() ?? '';
    title = input.title?.trim() ?? '';
  } else {
    if (input.caption === undefined || input.caption.trim().length === 0) {
      throw new Error(`caption is required for ${input.provider}.`);
    }
    caption = input.caption.trim();
  }
  return { title, description, tags, privacyStatus, caption, boardId };
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
    const accountField = { bluesky: 'did', linkedin: 'linkedinAccountIds', threads: 'threadsAccountIds', facebook: 'facebookAccountIds', pinterest: 'pinterestAccountIds', fanvue: 'fanvueAccountIds', '3speak': 'threespeakAccountIds', rumble: 'rumbleAccountIds' }[input.provider];
    formData.append('video', videoBlob, filename);
    // Rumble and Fanvue take title + description, not a caption.
    if (input.provider === 'rumble' || input.provider === 'fanvue') {
      formData.append('title', fields.title);
      formData.append('description', fields.description);
    } else {
      formData.append('caption', fields.caption);
      // Pinterest also carries the pin title, description and board.
      if (input.provider === 'pinterest') {
        formData.append('title', fields.title);
        formData.append('description', fields.description);
        formData.append('boardId', fields.boardId);
      }
    }
    for (const accountId of input.accountIds) {
      formData.append(accountField, accountId);
    }
  }
  // The web route replays the recorded publish for a retried key instead of
  // posting again; a fresh key per call keeps a new publish a new one.
  const key = input.idempotencyKey !== undefined && input.idempotencyKey.trim().length > 0
    ? input.idempotencyKey.trim()
    : randomUUID();
  formData.append('publishScopeKey', `direct:${key}`);
  return formData;
}
