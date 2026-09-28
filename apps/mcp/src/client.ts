import { validateScheduleAdvance } from './validator.js';
import { getErrorMessage, ImageTooLargeError } from './errors.js';
import { MAX_LIBRARY_IMAGE_BYTES, MAX_LIBRARY_IMAGE_MB } from './limits.js';

// Re-exported so existing import sites (`../client.js`) keep working.
export { MAX_LIBRARY_IMAGE_BYTES, MAX_LIBRARY_IMAGE_MB };
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

export interface PostEngineerClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Clock override used by schedule validation (tests); defaults to the real clock. */
  now?: () => Date;
}

/** One image for a persona's image library, read from a local file. */
export interface PersonaLibraryImageInput {
  /** Local file path (JPG/JPEG, PNG, or WebP, max 10MB). */
  path: string;
  /** Short tag for deterministic per-video matching (e.g. casual, formal). */
  tag?: string;
  /** Description of the photo for keyword matching. */
  description?: string;
}

export interface CreatePersonaInput {
  name: string;
  avatarUrl?: string | null;
  voiceId?: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  faceMixPercent?: number;
  faceQuality?: 'ok' | 'very_good';
  /** Up to 10 local images of the same person for the image library. */
  images?: PersonaLibraryImageInput[];
  /** Index into images[] marking the primary library image. */
  imagePrimaryIndex?: number;
}

export interface GenerateVideoJobInput {
  personaId: string;
  scriptPrompt?: string;
  audioUrl?: string;
  /** Library image ID overriding the deterministic per-video selection. */
  imageId?: string;
}

export interface UpdatePersonaInput {
  personaId: string;
  name?: string;
  avatarUrl?: string;
  voiceId?: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
}

export interface CreateScheduleInput {
  personaId: string;
  providers: ('youtube' | 'instagram' | 'linkedin')[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  scheduledAt?: string | Date;
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  postsPerDay?: number;
  timezone?: string;
}

const PRODUCTION_API_URL = 'https://post-engineer.com';
// Hung requests must not block the stdio tool call (and the agent session) forever.
const REQUEST_TIMEOUT_MS = 30_000;
// Multipart uploads can legitimately exceed the default budget: up to 10
// 10MB library images on one request.
const UPLOAD_TIMEOUT_MS = 120_000;
// Bound how much of an upstream error body can flow into agent-visible output.
const MAX_ERROR_BODY_CHARS = 200;
// Shared with tools.ts so the client-side guards, the Zod schema limits,
// and the field description strings can't drift apart.
export const MAX_LIBRARY_IMAGES = 10;

// Mirrors the server-side addLibraryImages limits: checked in createPersona
// so an oversized tag/description fails locally before the multipart upload.
export const MAX_LIBRARY_TAG_LENGTH = 100;
export const MAX_LIBRARY_DESCRIPTION_LENGTH = 500;

/**
 * Shared size guard for both image-read call sites (the stat pre-check and
 * the post-read check) so the limit and the message text can't drift apart.
 * Throws the typed ImageTooLargeError carrying the full path.
 */
export function assertImageSize(sizeBytes: number, path: string): void {
  if (sizeBytes > MAX_LIBRARY_IMAGE_BYTES) {
    throw new ImageTooLargeError(path, sizeBytes);
  }
}

function mimeTypeForImagePath(path: string): string {
  const extension = extname(path).toLowerCase();
  // No special hidden-file check needed: Node's extname('.PNG') is ''
  // (a leading dot with no other dots is not an extension), so dotfiles
  // fall through to the unsupported-extension rejection below.
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  throw new Error(
    `Unsupported image extension "${extension || '(none)'}": use JPG/JPEG, PNG, or WebP.`,
  );
}

async function imageFormFile(path: string): Promise<Blob> {
  // Validate before uploading: the API rejects the file anyway, so an
  // oversized or unsupported image fails fast locally instead of wasting an
  // upload. A stat() pre-check bounds memory before readFile — a multi-GB
  // file misnamed .png would otherwise load fully into this stdio process.
  // The TOCTOU window is benign: the authoritative size check still runs on
  // the buffer after read. Any failure surfaces with the full path for a
  // consistent, actionable message.
  // Note: the extension is trusted as a hint only; the server re-validates
  // content via magic bytes, so a mislabeled file still fails server-side
  // (duplicating magic-byte sniffing locally would be a second source of
  // truth that can drift).
  const mimeType = mimeTypeForImagePath(path);
  try {
    const fileStat = await stat(path);
    assertImageSize(fileStat.size, path);
  } catch (error) {
    // Discriminate by type, not by message text: the typed size error
    // passes through untouched, while stat failures become the actionable
    // "Failed to read image" wrapper. Message sniffing would misclassify
    // any future error whose prose happens to match.
    if (error instanceof ImageTooLargeError) throw error;
    throw new Error(`Failed to read image "${path}": ${getErrorMessage(error)}`);
  }
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    throw new Error(`Failed to read image "${path}": ${getErrorMessage(error)}`);
  }
  if (buffer.length === 0) {
    // A 0-byte file would pass the local gate but shift the index-aligned
    // imageTags/imageDescriptions (the server 400s when the tag/description
    // counts don't match the file count), so reject it here with a clear
    // message instead of a confusing server 400.
    throw new Error(`Image "${path}" is empty.`);
  }
  // The post-read check reuses the shared guard: same limit, same message,
  // full path — and it covers the (benign) TOCTOU window after stat.
  assertImageSize(buffer.length, path);
  return new Blob([buffer], { type: mimeType });
}

// Normalize library metadata: trim; empty/whitespace-only values normalize
// to ''. Both upload paths (the create-persona imageTags/imageDescriptions
// arrays and the add-persona-image tag/description fields) send '' for empty
// metadata, and the server stores '' verbatim (the tag column is text not
// null default ''), so the stored values are identical on both paths.
// Lengths are checked here so an oversized tag fails before the multipart
// upload, not server-side after all bytes transfer. The label (e.g.
// filename) is included in the error when available.
function checkLibraryMetadataLengths(
  tag: string | undefined,
  description: string | undefined,
  label?: string,
): void {
  const where = label ? ` for "${label}"` : '';
  if (tag !== undefined && tag.length > MAX_LIBRARY_TAG_LENGTH) {
    throw new Error(`Image tag${where} exceeds ${MAX_LIBRARY_TAG_LENGTH} characters.`);
  }
  if (description !== undefined && description.length > MAX_LIBRARY_DESCRIPTION_LENGTH) {
    throw new Error(
      `Image description${where} exceeds ${MAX_LIBRARY_DESCRIPTION_LENGTH} characters.`,
    );
  }
}

function normalizeLibraryMetadata(
  image: { tag?: string; description?: string },
  label?: string,
): { tag: string; description: string } {
  const tag = image.tag?.trim() ?? '';
  const description = image.description?.trim() ?? '';
  checkLibraryMetadataLengths(tag, description, label);
  return { tag, description };
}

// The bearer key is sent to this URL, so fail fast on a malformed or
// non-https override instead of silently targeting it. Loopback http is
// allowed for local staging; anything else must be https so the key never
// travels in cleartext.
function resolveBaseUrl(override: string | undefined): string {
  const raw = override ?? PRODUCTION_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid POST_ENGINEER_API_URL: not an absolute URL (use https:)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid POST_ENGINEER_API_URL: protocol "${url.protocol}" is not allowed (use https:)`);
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol === 'http:' && !loopback) {
    throw new Error('Invalid POST_ENGINEER_API_URL: http: is only allowed for loopback hosts (use https:)');
  }
  // Never echo the raw value: it may embed credentials (userinfo/query).
  // Return the normalized form so the validated value and the used value are
  // identical: origin drops userinfo, trailing slashes are stripped so
  // `${baseUrl}${path}` never yields `//api/...`.
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export class PostEngineerClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly now: () => Date;

  constructor(options: PostEngineerClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? process.env.POST_ENGINEER_API_URL);
    this.apiKey = options.apiKey;
    this.now = options.now ?? (() => new Date());
  }

  private getHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request(
    path: string,
    init: RequestInit,
    action: string,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      // init.signal, if provided, intentionally wins over timeoutMs; no
      // current caller passes one, so UPLOAD_TIMEOUT_MS always applies on
      // the upload paths this parameter exists for.
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to ${action}: ${response.status} ${errorText.slice(0, MAX_ERROR_BODY_CHARS)}`);
    }

    // Some endpoints answer 204 No Content. An empty or non-JSON body on any
    // other status is a real failure: surfacing it beats reporting success
    // with an undefined payload (e.g. a paid video job the agent thinks started).
    // The { ok: true } sentinel keeps handlers from rendering "undefined".
    if (response.status === 204) return { ok: true };
    const successText = await response.text();
    if (successText.length === 0) return { ok: true };
    try {
      return JSON.parse(successText) as unknown;
    } catch {
      throw new Error(`Failed to ${action}: response was not valid JSON (status ${response.status}).`);
    }
  }

  async createPersona(input: CreatePersonaInput): Promise<unknown> {
    const formData = new FormData();
    const hasAvatar = input.avatarUrl !== undefined && input.avatarUrl !== null && input.avatarUrl.length > 0;
    formData.set('name', input.name);
    formData.set('personaMode', hasAvatar ? 'persona' : 'faceless');
    if (hasAvatar && input.avatarUrl) formData.set('avatarUrl', input.avatarUrl);
    formData.set('voiceId', input.voiceId ?? 'alloy');
    formData.set('language', input.language ?? 'en-US');
    formData.set('videoAspect', input.videoAspect ?? '9:16');
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    formData.set('paragraphNumber', String(input.paragraphNumber ?? 1));
    formData.set('niche', input.niche ?? 'General');
    formData.set('faceMixPercent', String(hasAvatar ? input.faceMixPercent ?? 50 : 0));
    formData.set('faceQuality', hasAvatar ? input.faceQuality ?? 'very_good' : 'ok');
    const images = input.images ?? [];
    // An imagePrimaryIndex without images is a caller bug (typo'd `images`
    // or a lone index): fail fast instead of a silent successful creation
    // with no primary image.
    if (input.imagePrimaryIndex !== undefined && images.length === 0) {
      throw new Error('imagePrimaryIndex requires images: provide at least one library image.');
    }
    if (images.length > 0) {
      if (!hasAvatar) {
        throw new Error('Library images require a persona avatar: provide avatarUrl together with images.');
      }
      if (images.length > MAX_LIBRARY_IMAGES) {
        throw new Error(`At most ${MAX_LIBRARY_IMAGES} library images are allowed per persona.`);
      }
      if (input.imagePrimaryIndex !== undefined) {
        // Fail fast before reading any file: pure-argument checks come first.
        if (input.imagePrimaryIndex < 0 || input.imagePrimaryIndex >= images.length) {
          throw new Error(
            `imagePrimaryIndex ${input.imagePrimaryIndex} is out of range: ${images.length} images provided.`,
          );
        }
        formData.set('imagePrimaryIndex', String(input.imagePrimaryIndex));
      }
      const tags: string[] = [];
      const descriptions: string[] = [];
      // Sequential reads bound memory: at most one 10MB image is resident at
      // a time (10 in parallel would hold ~100MB in this stdio process), and
      // upload time is dominated by network transfer anyway. Order is
      // preserved, so tags/descriptions stay aligned with the entries.
      for (const image of images) {
        const { tag, description } = normalizeLibraryMetadata(image, basename(image.path));
        formData.append('images', await imageFormFile(image.path), basename(image.path));
        tags.push(tag);
        descriptions.push(description);
      }
      formData.set('imageTags', JSON.stringify(tags));
      formData.set('imageDescriptions', JSON.stringify(descriptions));
    }
    return this.request(
      '/api/persona',
      { method: 'POST', headers: this.getHeaders(false), body: formData },
      'create persona',
      UPLOAD_TIMEOUT_MS,
    );
  }

  async listPersonas(): Promise<unknown> {
    return this.request(
      '/api/persona/list',
      { method: 'GET', headers: this.getHeaders() },
      'list personas'
    );
  }

  async listVoices(): Promise<unknown> {
    return this.request(
      '/api/persona/voices',
      { method: 'GET', headers: this.getHeaders() },
      'list voices'
    );
  }

  async listFaces(): Promise<unknown> {
    return this.request(
      '/api/persona/faces',
      { method: 'GET', headers: this.getHeaders() },
      'list faces'
    );
  }

  async updatePersona(input: UpdatePersonaInput): Promise<unknown> {
    const formData = new FormData();
    if (input.name !== undefined) formData.set('name', input.name);
    if (input.avatarUrl !== undefined && input.avatarUrl.length > 0) formData.set('avatarUrl', input.avatarUrl);
    if (input.voiceId !== undefined) formData.set('voiceId', input.voiceId);
    if (input.language !== undefined) formData.set('language', input.language);
    if (input.videoAspect !== undefined) formData.set('videoAspect', input.videoAspect);
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    if (input.paragraphNumber !== undefined) formData.set('paragraphNumber', String(input.paragraphNumber));
    if (input.niche !== undefined) formData.set('niche', input.niche);
    return this.request(
      `/api/persona?personaId=${encodeURIComponent(input.personaId)}`,
      { method: 'PATCH', headers: this.getHeaders(false), body: formData },
      'update persona'
    );
  }

  async listSocialAccounts(): Promise<unknown> {
    return this.request(
      '/api/account',
      { method: 'GET', headers: this.getHeaders() },
      'list social accounts'
    );
  }

  async getOAuthConnectUrl(provider: string): Promise<unknown> {
    return this.request(
      '/api/account/connect-url',
      { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ provider }) },
      'get OAuth connect URL'
    );
  }

  async connectBlueskyAccount(handle: string, appPassword: string): Promise<unknown> {
    try {
      return await this.request(
        '/api/bluesky-connect',
        { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ handle, appPassword }) },
        'connect Bluesky account'
      );
    } catch (error) {
      // The upstream error body may echo the request payload: never let the
      // app password surface in agent-visible error text — raw, percent-encoded,
      // or JSON-escaped.
      const message = error instanceof Error ? error.message : String(error);
      if (appPassword.length === 0) throw new Error(message);
      const variants = [
        appPassword,
        encodeURIComponent(appPassword),
        JSON.stringify(appPassword).slice(1, -1),
      ];
      throw new Error(variants.reduce((text, variant) => text.replaceAll(variant, '[redacted]'), message));
    }
  }

  async listSchedules(): Promise<unknown> {
    return this.request(
      '/api/schedule',
      { method: 'GET', headers: this.getHeaders() },
      'list schedules'
    );
  }

  async listPosts(limit = 20): Promise<unknown> {
    return this.request(
      `/api/schedule/status?limit=${encodeURIComponent(String(limit))}`,
      { method: 'GET', headers: this.getHeaders() },
      'list posts'
    );
  }

  async cancelSchedule(scheduleId: string): Promise<unknown> {
    return this.request(
      `/api/schedule?id=${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'cancel schedule'
    );
  }

  async getTokenBalance(): Promise<unknown> {
    return this.request(
      '/api/billing/tokens',
      { method: 'GET', headers: this.getHeaders() },
      'get token balance'
    );
  }

  async generateVideoJob(input: GenerateVideoJobInput): Promise<unknown> {
    return this.request(
      '/api/persona/video-job',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          personaId: input.personaId,
          video_script_prompt: input.scriptPrompt,
          audio_url: input.audioUrl,
          image_id: input.imageId,
        }),
      },
      'generate video job'
    );
  }

  async getVideoStatus(taskId: string): Promise<unknown> {
    return this.request(
      `/api/persona/video-status/${encodeURIComponent(taskId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'get video status'
    );
  }

  async listPersonaImages(personaId: string): Promise<unknown> {
    return this.request(
      `/api/persona/images?personaId=${encodeURIComponent(personaId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'list persona images'
    );
  }

  async addPersonaImage(
    personaId: string,
    image: PersonaLibraryImageInput & { isPrimary?: true }
  ): Promise<unknown> {
    const formData = new FormData();
    formData.set('personaId', personaId);
    formData.append('image', await imageFormFile(image.path), basename(image.path));
    // Empty/whitespace-only metadata normalizes to '' (see
    // normalizeLibraryMetadata): the server stores '' verbatim on both
    // upload paths, so the add path simply omits the keys — an empty tag
    // can never match the deterministic keyword selection.
    const { tag, description } = normalizeLibraryMetadata(image);
    if (tag) formData.set('tag', tag);
    if (description) formData.set('description', description);
    // isPrimary is typed as `true` only (swap-only, symmetric with
    // update_persona_image): an explicit false is rejected at schema parse
    // time and can never reach this branch.
    if (image.isPrimary) formData.set('isPrimary', 'true');
    return this.request(
      '/api/persona/images',
      { method: 'POST', headers: this.getHeaders(false), body: formData },
      'add persona image',
      UPLOAD_TIMEOUT_MS,
    );
  }

  async updatePersonaImage(input: {
    id: string;
    tag?: string;
    description?: string;
    isPrimary?: boolean;
  }): Promise<unknown> {
    if (
      input.tag === undefined &&
      input.description === undefined &&
      input.isPrimary === undefined
    ) {
      throw new Error('updatePersonaImage requires at least one of tag, description, or isPrimary.');
    }
    // The server PATCH is swap-only: isPrimary:false always 400s there.
    // The tool schema already rejects false (z.literal(true)); this guard
    // is for direct programmatic callers of the client library, where
    // isPrimary?: boolean still permits false. Fail fast with an
    // actionable message instead of the wasted round-trip.
    if (input.isPrimary === false) {
      throw new Error(
        'updatePersonaImage: isPrimary cannot be false — mark another image as primary instead (the swap atomically demotes the old one).'
      );
    }
    // Trim metadata like the add paths do: an untrimmed tag can never match
    // the deterministic keyword selection. undefined = leave unchanged (the
    // key is dropped by JSON.stringify); empty string = clear the stored
    // value (server convention). A whitespace-only value trims to '' and
    // therefore clears too — the field descriptions in tools.ts say so,
    // since a caller passing "   " likely did not intend to wipe the value.
    const tag = input.tag?.trim();
    const description = input.description?.trim();
    // Fail fast on oversized metadata before the round-trip, symmetric with
    // the add/create paths (undefined = leave unchanged, so the check must
    // skip undefined instead of defaulting to '').
    checkLibraryMetadataLengths(tag, description);
    return this.request(
      '/api/persona/images',
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({
          id: input.id,
          ...(tag !== undefined ? { tag } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        }),
      },
      'update persona image'
    );
  }

  async deletePersonaImage(id: string): Promise<unknown> {
    return this.request(
      `/api/persona/images?id=${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'delete persona image'
    );
  }

  async createSchedule(input: CreateScheduleInput): Promise<unknown> {
    if (input.scheduledAt) {
      const validation = validateScheduleAdvance(input.scheduledAt, this.now());
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
    }

    return this.request(
      '/api/schedule',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          personaId: input.personaId,
          providers: input.providers,
          youtubeAccountIds: input.youtubeAccountIds ?? [],
          instagramAccountIds: input.instagramAccountIds ?? [],
          linkedinAccountIds: input.linkedinAccountIds ?? [],
          scheduledAt: input.scheduledAt,
          daysOfWeek: input.daysOfWeek,
          startHour: input.startHour,
          endHour: input.endHour,
          postsPerDay: input.postsPerDay,
          timezone: input.timezone ?? 'UTC',
        }),
      },
      'create schedule'
    );
  }
}
