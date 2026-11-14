//---------------
// Existing-media publish form (issue #384): the multipart body the
// provider handlers already consume. Mirrors buildPublishForm in
// lib/videos/publish-uploaded.ts — one field set per provider — but the
// bytes come from existing media (an engine task video, a claimed upload,
// or inline image bytes) instead of a signed-upload row.
//---------------

import type { SocialProvider } from '@/lib/providers/registry';

export interface ExistingMediaFormFields {
  title: string;
  description: string;
  caption: string;
  tags: string[];
  privacyStatus: string;
  boardId: string;
  accountIds: string[];
}

const ACCOUNT_FIELD: Partial<Record<SocialProvider, string>> = {
  bluesky: 'did',
  linkedin: 'linkedinAccountIds',
  threads: 'threadsAccountIds',
  facebook: 'facebookAccountIds',
  pinterest: 'pinterestAccountIds',
  fanvue: 'fanvueAccountIds',
  '3speak': 'threespeakAccountIds',
  rumble: 'rumbleAccountIds',
};

function fileName(contentType: string): string {
  if (contentType === 'image/png') return 'image.png';
  if (contentType === 'image/jpeg') return 'image.jpg';
  if (contentType === 'video/quicktime') return 'video.mov';
  return 'video.mp4';
}

export function buildExistingMediaForm(
  provider: SocialProvider,
  fields: ExistingMediaFormFields,
  buffer: Buffer,
  contentType: string,
): FormData {
  const file = new File([new Uint8Array(buffer)], fileName(contentType), { type: contentType });
  const formData = new FormData();
  formData.append('provider', provider);
  if (provider === 'youtube') {
    formData.append('video', file);
    formData.append('title', fields.title.trim());
    formData.append('description', fields.description.trim());
    formData.append('tags', fields.tags.join(','));
    formData.append('privacyStatus', fields.privacyStatus);
    for (const accountId of fields.accountIds) formData.append('accountIds', accountId);
    return formData;
  }
  if (provider === 'instagram') {
    formData.append('file', file);
    formData.append('caption', fields.caption.trim());
    for (const accountId of fields.accountIds) formData.append('igAccountIds', accountId);
    return formData;
  }
  formData.append('video', file);
  if (provider === 'rumble' || provider === 'fanvue') {
    formData.append('title', fields.title.trim());
    formData.append('description', fields.description.trim());
  } else {
    formData.append('caption', fields.caption.trim());
    if (provider === 'pinterest') {
      formData.append('title', fields.title.trim());
      formData.append('description', fields.description.trim());
      formData.append('boardId', fields.boardId.trim());
    }
  }
  const accountField = ACCOUNT_FIELD[provider] ?? 'accountIds';
  for (const accountId of fields.accountIds) formData.append(accountField, accountId);
  return formData;
}
