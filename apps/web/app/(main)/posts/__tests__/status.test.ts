import { describe, expect, it } from 'vitest';
import { enDictionary } from '@/lib/i18n/en';
import { ptDictionary } from '@/lib/i18n/pt';
import { postsCalendarStrings } from '@/lib/i18n/posts-calendar-i18n';
import {
  CALENDAR_GROUP_KEY,
  STATUS_KEY,
  calendarGroupOf,
  slotDisplayStatus,
} from '../status';

describe('posts status mapping', () => {
  it('maps expired to its own calendar group', () => {
    expect(calendarGroupOf('expired')).toBe('expired');
    expect(calendarGroupOf('expired')).not.toBe('failed');
  });

  it('maps paused to its own calendar group', () => {
    expect(calendarGroupOf('paused')).toBe('paused');
  });

  it('shows ready and publishing as paused only when the account is inactive', () => {
    expect(slotDisplayStatus('ready', false)).toBe('paused');
    expect(slotDisplayStatus('publishing', false)).toBe('paused');
    expect(slotDisplayStatus('ready', true)).toBe('ready');
    expect(slotDisplayStatus('published', false)).toBe('published');
    expect(slotDisplayStatus('expired', false)).toBe('expired');
    expect(slotDisplayStatus('failed', false)).toBe('failed');
  });

  it('has formatted English labels for expired and paused', () => {
    expect(enDictionary.posts[STATUS_KEY.expired.replace('posts.', '') as keyof typeof enDictionary.posts]).toBe('Expired');
    expect(enDictionary.posts[STATUS_KEY.paused.replace('posts.', '') as keyof typeof enDictionary.posts]).toBe('Paused');
    expect(postsCalendarStrings.en.posts[CALENDAR_GROUP_KEY.expired.replace('posts.', '') as keyof typeof postsCalendarStrings.en.posts]).toBe('Expired');
    expect(postsCalendarStrings.en.posts[CALENDAR_GROUP_KEY.paused.replace('posts.', '') as keyof typeof postsCalendarStrings.en.posts]).toBe('Paused');
  });

  it('has formatted Portuguese labels for expired and paused', () => {
    expect(ptDictionary.posts[STATUS_KEY.expired.replace('posts.', '') as keyof typeof ptDictionary.posts]).toBe('Expirado');
    expect(ptDictionary.posts[STATUS_KEY.paused.replace('posts.', '') as keyof typeof ptDictionary.posts]).toBe('Pausado');
    expect(postsCalendarStrings.pt.posts[CALENDAR_GROUP_KEY.expired.replace('posts.', '') as keyof typeof postsCalendarStrings.pt.posts]).toBe('Expirado');
    expect(postsCalendarStrings.pt.posts[CALENDAR_GROUP_KEY.paused.replace('posts.', '') as keyof typeof postsCalendarStrings.pt.posts]).toBe('Pausado');
  });
});
