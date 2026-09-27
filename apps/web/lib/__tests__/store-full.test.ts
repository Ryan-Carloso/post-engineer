import { describe, it, expect, beforeEach } from 'vitest';
import { useUploadStore } from '@/lib/store';
import type { UploadContentResult } from '@/lib/types';

//---------------
// store — setters, resets e resolveContent (gap restante)
//---------------

type StoreState = ReturnType<typeof useUploadStore.getState>;
const emptyState: Partial<StoreState> = {
  selectedAccountIds: { youtube: [], instagram: [], bluesky: [], linkedin: [] },
  mode: 'youtube',
  file: null,
  title: '',
  description: '',
  tags: '',
  privacyStatus: 'public',
  result: null,
  oauthUrl: null,
  igFile: null,
  igCaption: '',
  igCaptionEdited: false,
  igResult: null,
  ytTitleOverride: '',
  ytDescriptionOverride: '',
  igCaptionOverride: '',
  ytThumbnail: null,
};

describe('useUploadStore setters', () => {
  beforeEach(() => {
    useUploadStore.setState(emptyState);
  });

  it('setMode alterna o modo ativo', () => {
    useUploadStore.getState().setMode('instagram');
    expect(useUploadStore.getState().mode).toBe('instagram');
  });

  it('setters YouTube atualizam campos', () => {
    const file = new File(['data'], 'video.mp4');
    const thumb = new File(['t'], 'thumb.jpg');
    const result: UploadContentResult = { success: true } as UploadContentResult;

    const s = useUploadStore.getState();
    s.setFile(file);
    s.setTitle('Título');
    s.setDescription('Descrição');
    s.setTags('a,b');
    s.setPrivacyStatus('private');
    s.setResult(result);
    s.setOauthUrl('http://oauth');
    s.setYtThumbnail(thumb);

    const state = useUploadStore.getState();
    expect(state.file).toBe(file);
    expect(state.title).toBe('Título');
    expect(state.description).toBe('Descrição');
    expect(state.tags).toBe('a,b');
    expect(state.privacyStatus).toBe('private');
    expect(state.result).toBe(result);
    expect(state.oauthUrl).toBe('http://oauth');
    expect(state.ytThumbnail).toBe(thumb);

    s.setResult(null);
    s.setOauthUrl(null);
    s.setFile(null);
    s.setYtThumbnail(null);
    expect(useUploadStore.getState().result).toBeNull();
    expect(useUploadStore.getState().oauthUrl).toBeNull();
  });

  it('setters Instagram atualizam campos', () => {
    const igFile = new File(['img'], 'photo.jpg');
    const igResult: UploadContentResult = { success: true } as UploadContentResult;

    const s = useUploadStore.getState();
    s.setIgFile(igFile);
    s.setIgCaption('legenda');
    s.setIgResult(igResult);

    const state = useUploadStore.getState();
    expect(state.igFile).toBe(igFile);
    expect(state.igCaption).toBe('legenda');
    expect(state.igCaptionEdited).toBe(true);
    expect(state.igResult).toBe(igResult);

    s.setIgFile(null);
    s.setIgResult(null);
    expect(useUploadStore.getState().igFile).toBeNull();
    expect(useUploadStore.getState().igResult).toBeNull();
  });

  it('setters de override atualizam campos', () => {
    const s = useUploadStore.getState();
    s.setYtTitleOverride('YT título');
    s.setYtDescriptionOverride('YT desc');
    s.setIgCaptionOverride('IG legenda');

    const state = useUploadStore.getState();
    expect(state.ytTitleOverride).toBe('YT título');
    expect(state.ytDescriptionOverride).toBe('YT desc');
    expect(state.igCaptionOverride).toBe('IG legenda');
  });

  it('clearSelectedAccounts clears by provider and all', () => {
    const s = useUploadStore.getState();
    s.toggleSelectedAccount('youtube', 'y1');
    s.toggleSelectedAccount('instagram', 'i1');

    useUploadStore.getState().clearSelectedAccounts('youtube');
    expect(useUploadStore.getState().selectedAccountIds).toEqual({
      youtube: [],
      instagram: ['i1'],
      bluesky: [],
      linkedin: [],
    });

    useUploadStore.getState().clearSelectedAccounts();
    expect(useUploadStore.getState().selectedAccountIds).toEqual({
      youtube: [],
      instagram: [],
      bluesky: [],
      linkedin: [],
    });
  });

  it('resetForm clears YouTube fields and overrides', () => {
    const s = useUploadStore.getState();
    s.setFile(new File(['d'], 'v.mp4'));
    s.setTitle('T');
    s.setDescription('D');
    s.setTags('t');
    s.setPrivacyStatus('unlisted');
    s.setYtTitleOverride('o1');
    s.setYtDescriptionOverride('o2');
    s.setIgCaptionOverride('o3');
    s.setYtThumbnail(new File(['x'], 'a.jpg'));

    useUploadStore.getState().resetForm();

    const state = useUploadStore.getState();
    expect(state.file).toBeNull();
    expect(state.title).toBe('');
    expect(state.description).toBe('');
    expect(state.tags).toBe('');
    expect(state.privacyStatus).toBe('public');
    expect(state.ytTitleOverride).toBe('');
    expect(state.ytDescriptionOverride).toBe('');
    expect(state.igCaptionOverride).toBe('');
    expect(state.ytThumbnail).toBeNull();
  });

  it('resetIgForm clears Instagram fields', () => {
    const s = useUploadStore.getState();
    s.setIgFile(new File(['i'], 'p.jpg'));
    s.setIgCaption('cap');
    s.setIgResult({ success: true } as UploadContentResult);

    useUploadStore.getState().resetIgForm();

    const state = useUploadStore.getState();
    expect(state.igFile).toBeNull();
    expect(state.igCaption).toBe('');
    expect(state.igCaptionEdited).toBe(false);
    expect(state.igResult).toBeNull();
  });

  it('resolveContent prefers overrides and uses shared values as fallback', () => {
    const s = useUploadStore.getState();
    s.setTitle('Compartilhado');
    s.setDescription('Desc compartilhada');

    let resolved = useUploadStore.getState().resolveContent();
    expect(resolved).toEqual({
      title: 'Compartilhado',
      description: 'Desc compartilhada',
      igCaption: 'Desc compartilhada',
    });

    s.setYtTitleOverride('Override YT');
    s.setIgCaptionOverride('Override IG');

    resolved = useUploadStore.getState().resolveContent();
    expect(resolved.title).toBe('Override YT');
    expect(resolved.igCaption).toBe('Override IG');
  });
});
