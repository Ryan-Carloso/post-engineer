import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));

import {
  ACCOUNT_PROFILE_FETCHED_EVENT,
  ACCOUNT_PROFILE_FETCH_FAILED_EVENT,
  pictureHost,
  profileErrorCode,
  reportProfileFetched,
  reportProfileFetchFailed,
} from '@/lib/account-profile-telemetry';
import { trackApiEvent } from '@/lib/analytics';

describe('account profile telemetry', () => {
  beforeEach(() => vi.mocked(trackApiEvent).mockReset());

  it('pictureHost returns the hostname, null, or invalid_url', () => {
    expect(pictureHost('https://yt3.googleusercontent.com/a.jpg')).toBe('yt3.googleusercontent.com');
    expect(pictureHost(null)).toBeNull();
    expect(pictureHost('nope')).toBe('invalid_url');
  });

  it('reports a connect read with presence flags and host, never the name or URL', () => {
    reportProfileFetched('youtube', 'connect', { accountName: 'Secret Name', pictureUrl: 'https://cdn.bsky.app/a.jpg?sig=x' });
    expect(trackApiEvent).toHaveBeenCalledWith(ACCOUNT_PROFILE_FETCHED_EVENT, {
      provider: 'youtube',
      trigger: 'connect',
      has_name: true,
      has_picture: true,
      picture_host: 'cdn.bsky.app',
    });
  });

  it('reports what changed on a sync read', () => {
    reportProfileFetched('instagram', 'sync', { accountName: 'new', pictureUrl: null }, { accountName: 'old', pictureUrl: 'p' });
    expect(trackApiEvent).toHaveBeenCalledWith(ACCOUNT_PROFILE_FETCHED_EVENT, {
      provider: 'instagram',
      trigger: 'sync',
      has_name: true,
      has_picture: false,
      picture_host: null,
      name_changed: true,
      picture_changed: false,
    });
  });

  it('treats an empty name as missing', () => {
    reportProfileFetched('threads', 'sync', { accountName: '', pictureUrl: 'https://x.test/p' }, { accountName: '', pictureUrl: 'https://x.test/p' });
    expect(vi.mocked(trackApiEvent).mock.calls[0][1]).toMatchObject({ has_name: false, name_changed: false, picture_changed: false });
  });

  it('profileErrorCode keeps the CODE prefix only, else the error name', () => {
    expect(profileErrorCode(new Error('THREADS_PROFILE_FAILED: user secret detail'))).toBe('THREADS_PROFILE_FAILED');
    expect(profileErrorCode(new TypeError('fetch failed'))).toBe('TypeError');
    expect(profileErrorCode('boom')).toBe('non_error_thrown');
  });

  it('reports a failure with code and status', () => {
    reportProfileFetchFailed('linkedin', 'sync', Object.assign(new Error('LINKEDIN_PROFILE_FAILED: status 401'), { status: 401 }));
    expect(trackApiEvent).toHaveBeenCalledWith(ACCOUNT_PROFILE_FETCH_FAILED_EVENT, {
      provider: 'linkedin',
      trigger: 'sync',
      error_code: 'LINKEDIN_PROFILE_FAILED',
      error_status: 401,
    });
  });

  it('reports a null status when the error carries none', () => {
    reportProfileFetchFailed('bluesky', 'connect', new Error('x'));
    expect(vi.mocked(trackApiEvent).mock.calls[0][1]).toMatchObject({ error_status: null, error_code: 'Error' });
  });
});
