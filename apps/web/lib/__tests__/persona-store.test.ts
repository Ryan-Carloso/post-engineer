import { describe, it, expect, beforeEach } from 'vitest';

import { usePersonaStore } from '@/lib/store';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';

describe('usePersonaStore', () => {
  beforeEach(() => {
    usePersonaStore.getState().resetForm();
  });

  it('starts with an empty form', () => {
    const s = usePersonaStore.getState();
    expect(s.name).toBe('');
    expect(s.photo).toBeNull();
    expect(s.storedPhotoUrl).toBeNull();
    expect(s.result).toBeNull();
    expect(s.isSubmitting).toBe(false);
  });

  it('holds no generation fields', () => {
    const state = usePersonaStore.getState() as unknown as Record<string, unknown>;
    for (const key of ['voiceId', 'avatarUrl', 'faceQuality', 'niche', 'cta', 'videoLayout', 'hookPanel', 'extraPhotos']) {
      expect(state).not.toHaveProperty(key);
    }
  });

  it('buildPersonaFormData sends the trimmed name and the binding, and no photo when none is staged', () => {
    usePersonaStore.getState().setName('  Ana  ');
    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('name')).toBe('Ana');
    expect(formData.has('photo')).toBe(false);
    expect([...formData.keys()].sort()).toEqual(['name', 'publishingAccounts']);
  });

  it('buildPersonaFormData and buildPersonaEditFormData send the staged photo', () => {
    const photo = new File([new Uint8Array([1])], 'ana.png', { type: 'image/png' });
    usePersonaStore.getState().setName('Ana');
    usePersonaStore.getState().setPhoto(photo);
    expect(usePersonaStore.getState().buildPersonaFormData().get('photo')).toBeInstanceOf(File);
    const edit = usePersonaStore.getState().buildPersonaEditFormData();
    expect(edit.get('photo')).toBeInstanceOf(File);
    expect(edit.has('publishingAccounts')).toBe(false);
  });

  it('resetForm returns to the initial state', () => {
    const s = usePersonaStore.getState();
    s.setName('Ana');
    s.setPhoto(new File([new Uint8Array([1])], 'ana.png', { type: 'image/png' }));
    s.setStoredPhotoUrl('https://example.com/a.png');
    s.setSubmitting(true);
    usePersonaStore.getState().resetForm();
    const after = usePersonaStore.getState();
    expect(after.name).toBe('');
    expect(after.photo).toBeNull();
    expect(after.storedPhotoUrl).toBeNull();
    expect(after.isSubmitting).toBe(false);
  });

  it('holds no scheduling state', () => {
    const state = usePersonaStore.getState() as unknown as Record<string, unknown>;
    for (const key of [
      'scheduleDays',
      'scheduleTimes',
      'timezone',
      'youtubeSelectedIds',
      'instagramSelectedIds',
      'linkedinSelectedIds',
    ]) {
      expect(state).not.toHaveProperty(key);
    }
  });

  it('starts with no bound publishing accounts', () => {
    expect(usePersonaStore.getState().publishingAccounts).toEqual(emptyPersonaDefaultAccounts());
  });

  it('setPublishingAccounts stores the binding', () => {
    const s = usePersonaStore.getState();
    s.setPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['yt-1'] });

    expect(usePersonaStore.getState().publishingAccounts.youtube).toEqual(['yt-1']);
    expect(usePersonaStore.getState().publishingAccounts.instagram).toEqual([]);
  });

  it('buildPersonaFormData sends the bound accounts as JSON', () => {
    const s = usePersonaStore.getState();
    s.setName('Zé Persona');
    s.setPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['yt-1'], instagram: ['ig-1'] });

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(JSON.parse(String(formData.get('publishingAccounts')))).toEqual(
      expect.objectContaining({ youtube: ['yt-1'], instagram: ['ig-1'] }),
    );
  });

  it('resetForm clears the bound publishing accounts', () => {
    const s = usePersonaStore.getState();
    s.setPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['yt-1'] });

    usePersonaStore.getState().resetForm();

    expect(usePersonaStore.getState().publishingAccounts).toEqual(emptyPersonaDefaultAccounts());
  });

  it('buildPersonaFormData sends an empty binding when none is picked', () => {
    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(JSON.parse(String(formData.get('publishingAccounts')))).toEqual(emptyPersonaDefaultAccounts());
  });
});
