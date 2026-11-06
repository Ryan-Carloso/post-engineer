import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/youtube', () => ({
  getYouTubeClient: vi.fn(() => ({ channels: { list } })),
}));

import { fetchYouTubeChannel } from '@/lib/youtube-channel';
import { getYouTubeClient } from '@/lib/youtube';

const client = {} as never;

describe('fetchYouTubeChannel', () => {
  beforeEach(() => list.mockReset());

  it('reads the granted channel with mine and prefers the medium thumbnail', async () => {
    list.mockResolvedValue({
      data: {
        items: [{
          id: 'UC1',
          snippet: {
            title: 'Chan',
            customUrl: '@chan',
            thumbnails: { default: { url: 'https://yt3.ggpht.com/s' }, medium: { url: 'https://yt3.googleusercontent.com/m' } },
          },
          statistics: { subscriberCount: '1', viewCount: '2', videoCount: '3', hiddenSubscriberCount: true },
        }],
      },
    });

    const channel = await fetchYouTubeChannel(client, { mine: true });

    expect(list).toHaveBeenCalledWith({ part: ['snippet', 'statistics'], mine: true });
    expect(channel).toEqual({
      id: 'UC1',
      title: 'Chan',
      thumbnail: 'https://yt3.googleusercontent.com/m',
      customUrl: '@chan',
      statistics: { subscriberCount: '1', viewCount: '2', videoCount: '3', hiddenSubscriberCount: true },
    });
  });

  it('reads a channel by id and falls back to the default thumbnail', async () => {
    list.mockResolvedValue({ data: { items: [{ id: 'UC2', snippet: { title: '', thumbnails: { default: { url: 'https://yt3.ggpht.com/s' } } } }] } });

    const channel = await fetchYouTubeChannel(client, { id: 'UC2' });

    expect(list).toHaveBeenCalledWith({ part: ['snippet', 'statistics'], id: ['UC2'] });
    expect(channel).toEqual({ id: 'UC2', title: null, thumbnail: 'https://yt3.ggpht.com/s', customUrl: null, statistics: null });
  });

  it('maps empty statistics strings to undefined and hidden to false', async () => {
    list.mockResolvedValue({ data: { items: [{ id: 'UC3', statistics: { subscriberCount: '', viewCount: null } }] } });
    const channel = await fetchYouTubeChannel(client, { id: 'UC3' });
    expect(channel?.statistics).toEqual({
      subscriberCount: undefined,
      viewCount: undefined,
      videoCount: undefined,
      hiddenSubscriberCount: false,
    });
    expect(channel?.thumbnail).toBeNull();
  });

  it('returns null when the account has no channel or the item has no id', async () => {
    list.mockResolvedValue({ data: {} });
    expect(await fetchYouTubeChannel(client, { mine: true })).toBeNull();
    list.mockResolvedValue({ data: { items: [{ snippet: { title: 'x' } }] } });
    expect(await fetchYouTubeChannel(client, { mine: true })).toBeNull();
  });

  it('propagates API failures', async () => {
    const failure = new Error('quota');
    const failingList = vi.fn(() => Promise.reject(failure));
    vi.mocked(getYouTubeClient).mockReturnValueOnce({ channels: { list: failingList } } as never);
    await expect(fetchYouTubeChannel(client, { mine: true })).rejects.toBe(failure);
    expect(failingList).toHaveBeenCalledTimes(1);
  });
});
