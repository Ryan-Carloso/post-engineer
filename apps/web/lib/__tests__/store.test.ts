import { describe, it, expect, beforeEach } from 'vitest';
import { resolveScriptLanguage, useUploadStore } from '@/lib/store';

//---------------
// UploadStore — unit tests for the multi-account toggle
//---------------

describe('useUploadStore', () => {
  beforeEach(() => {
    useUploadStore.setState({
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
    });
  });

  describe('toggleSelectedAccount', () => {
    it('adds a YouTube account on the first click', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');

      expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch-1']);
    });

    it('removes the same account on the second click (toggle off)', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');

      expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual([]);
    });

    it('allows multiple YouTube accounts', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-2');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-3');

      expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch-1', 'ch-2', 'ch-3']);
    });

    it('allows multiple networks simultaneously (YouTube + Instagram)', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: ['ch-1'],
        instagram: ['ig-1'],
        bluesky: [],
        linkedin: [],
      });
    });

    it('does not affect other networks when toggling', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-2');

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: ['ch-1', 'ch-2'],
        instagram: ['ig-1'],
        bluesky: [],
        linkedin: [],
      });
    });

    it('toggling on Instagram does not affect YouTube', () => {
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: [],
        instagram: [],
        bluesky: [],
        linkedin: [],
      });
    });
  });

  describe('deselectAccount', () => {
    it('removes only the disconnected account, keeping the others', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-2');
      useUploadStore.getState().deselectAccount('youtube', 'ch-1');

      expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch-2']);
    });

    it('does nothing when the account was not selected', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().deselectAccount('youtube', 'ch-9');

      expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch-1']);
    });

    it('does not affect the other network', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');
      useUploadStore.getState().deselectAccount('youtube', 'ch-1');

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: [],
        instagram: ['ig-1'],
        bluesky: [],
        linkedin: [],
      });
    });

    it('is a no-op for providers without selection (e.g. bluesky)', () => {
      expect(() => useUploadStore.getState().deselectAccount('bluesky', 'did:1')).not.toThrow();
      expect(useUploadStore.getState().selectedAccountIds.bluesky).toEqual([]);
    });

    it('initializes an empty selection for all providers', () => {
      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: [],
        instagram: [],
        bluesky: [],
        linkedin: [],
      });
    });
  });

  describe('platform overrides', () => {
    it('starts with empty overrides', () => {
      const state = useUploadStore.getState();
      expect(state.ytTitleOverride).toBe('');
      expect(state.ytDescriptionOverride).toBe('');
      expect(state.igCaptionOverride).toBe('');
      expect(state.ytThumbnail).toBeNull();
    });

    it('setYtTitleOverride updates the custom YouTube title', () => {
      useUploadStore.getState().setYtTitleOverride('Título custom');
      expect(useUploadStore.getState().ytTitleOverride).toBe('Título custom');
    });

    it('setYtDescriptionOverride updates the custom YouTube description', () => {
      useUploadStore.getState().setYtDescriptionOverride('Descrição custom');
      expect(useUploadStore.getState().ytDescriptionOverride).toBe('Descrição custom');
    });

    it('setIgCaptionOverride atualiza a legenda custom Instagram', () => {
      useUploadStore.getState().setIgCaptionOverride('Legenda custom');
      expect(useUploadStore.getState().igCaptionOverride).toBe('Legenda custom');
    });

    it('setYtThumbnail atualiza o thumbnail custom YouTube', () => {
      const file = new File(['thumb'], 'thumb.jpg', { type: 'image/jpeg' });
      useUploadStore.getState().setYtThumbnail(file);
      expect(useUploadStore.getState().ytThumbnail).toBe(file);
    });

    it('resetForm clears the platform overrides', () => {
      useUploadStore.getState().setYtTitleOverride('Título custom');
      useUploadStore.getState().setYtDescriptionOverride('Descrição custom');
      useUploadStore.getState().setIgCaptionOverride('Legenda custom');
      const file = new File(['thumb'], 'thumb.jpg', { type: 'image/jpeg' });
      useUploadStore.getState().setYtThumbnail(file);

      useUploadStore.getState().resetForm();

      const state = useUploadStore.getState();
      expect(state.ytTitleOverride).toBe('');
      expect(state.ytDescriptionOverride).toBe('');
      expect(state.igCaptionOverride).toBe('');
      expect(state.ytThumbnail).toBeNull();
    });
  });

  describe('resolveContent', () => {
    it('uses the shared value when the override is empty', () => {
      useUploadStore.getState().setTitle('Título compartilhado');
      useUploadStore.getState().setDescription('Descrição compartilhada');

      const result = useUploadStore.getState().resolveContent();
      expect(result.title).toBe('Título compartilhado');
      expect(result.description).toBe('Descrição compartilhada');
    });

    it('uses the override when filled', () => {
      useUploadStore.getState().setTitle('Título compartilhado');
      useUploadStore.getState().setDescription('Descrição compartilhada');
      useUploadStore.getState().setYtTitleOverride('Título custom YT');
      useUploadStore.getState().setYtDescriptionOverride('Descrição custom YT');

      const result = useUploadStore.getState().resolveContent();
      expect(result.title).toBe('Título custom YT');
      expect(result.description).toBe('Descrição custom YT');
    });

    it('uses the Instagram override when filled', () => {
      useUploadStore.getState().setDescription('Descrição compartilhada');
      useUploadStore.getState().setIgCaptionOverride('Legenda custom IG');

      const result = useUploadStore.getState().resolveContent();
      expect(result.igCaption).toBe('Legenda custom IG');
    });

    it('uses the shared description as the Instagram fallback', () => {
      useUploadStore.getState().setDescription('Descrição compartilhada');

      const result = useUploadStore.getState().resolveContent();
      expect(result.igCaption).toBe('Descrição compartilhada');
    });
  });

  describe('clearSelectedAccounts', () => {
    it('clears all accounts when called without an argument', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');
      useUploadStore.getState().clearSelectedAccounts();

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: [],
        instagram: [],
        bluesky: [],
        linkedin: [],
      });
    });

    it('clears only YouTube when passed the youtube provider', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');
      useUploadStore.getState().clearSelectedAccounts('youtube');

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: [],
        instagram: ['ig-1'],
        bluesky: [],
        linkedin: [],
      });
    });

    it('clears only Instagram when passed the instagram provider', () => {
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().toggleSelectedAccount('instagram', 'ig-1');
      useUploadStore.getState().clearSelectedAccounts('instagram');

      expect(useUploadStore.getState().selectedAccountIds).toEqual({
        youtube: ['ch-1'],
        instagram: [],
        bluesky: [],
        linkedin: [],
      });
    });
  });

  describe('setMode / resetForm', () => {
    it('setMode altera o modo', () => {
      useUploadStore.getState().setMode('instagram');
      expect(useUploadStore.getState().mode).toBe('instagram');
    });

    it('resetForm clears form fields but keeps selectedAccountIds', () => {
      useUploadStore.getState().setTitle('Test');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
      useUploadStore.getState().resetForm();

      expect(useUploadStore.getState().title).toBe('');
      expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch-1']);
    });
  });
});

describe('resolveScriptLanguage', () => {
  it('maps supported locales to the script language', () => {
    expect(resolveScriptLanguage('pt')).toBe('pt');
    expect(resolveScriptLanguage('pt-BR')).toBe('pt');
    expect(resolveScriptLanguage('es')).toBe('es');
    expect(resolveScriptLanguage('es-ES')).toBe('es');
    expect(resolveScriptLanguage('fr')).toBe('fr');
    expect(resolveScriptLanguage('fr-FR')).toBe('fr');
    expect(resolveScriptLanguage('en')).toBe('en');
    expect(resolveScriptLanguage('en-US')).toBe('en');
  });

  it('falls back to English when the base language is not supported', () => {
    expect(resolveScriptLanguage('de')).toBe('en');
    expect(resolveScriptLanguage('de-DE')).toBe('en');
    expect(resolveScriptLanguage('ja-JP')).toBe('en');
    expect(resolveScriptLanguage('')).toBe('en');
  });

  it('normalizes uppercase before resolving', () => {
    expect(resolveScriptLanguage('PT')).toBe('pt');
    expect(resolveScriptLanguage('Pt-bR')).toBe('pt');
  });
});
