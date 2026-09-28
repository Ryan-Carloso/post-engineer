import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

//---------------
// Tests for the public persona seam in lib/api:
// createPersona, generatePersonaAvatar e useVoicesQuery/fetchVoices.
// The global fetch is stubbed (HTTP boundary) — nothing internal is mocked.
//---------------

import {
  createPersona,
  generatePersonaAvatar,
  fetchVoices,
  fetchPersonaList,
  deletePersona,
  updatePersona,
  useDeletePersonaMutation,
  useUpdatePersonaMutation,
} from '@/lib/api';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/api — persona', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createPersona', () => {
    it('sends FormData to /api/persona and returns the result', async () => {
      const formData = new FormData();
      formData.append('name', 'Persona Teste');
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, personaId: 'p-1' }),
      );

      const result = await createPersona(formData);

      expect(fetchMock).toHaveBeenCalledWith('/api/persona', {
        method: 'POST',
        body: formData,
      });
      expect(result.success).toBe(true);
      expect(result.personaId).toBe('p-1');
    });

    it('returns an error when the server responds with failure', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, error: 'Nome obrigatório' }),
      );

      const result = await createPersona(new FormData());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Nome obrigatório');
    });

    it('passes through imageIds and warnings string arrays', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          personaId: 'p-1',
          imageIds: ['img-1'],
          warnings: ['primary_swap_failed'],
        }),
      );

      const result = await createPersona(new FormData());

      expect(result.imageIds).toEqual(['img-1']);
      expect(result.warnings).toEqual(['primary_swap_failed']);
    });

    it('drops imageIds/warnings that are not string arrays', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          personaId: 'p-1',
          imageIds: ['img-1', 42],
          warnings: 'primary_swap_failed',
        }),
      );

      const result = await createPersona(new FormData());

      expect(result.imageIds).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('generatePersonaAvatar', () => {
    it('sends the prompt as JSON to /api/persona/avatar and returns the image', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          imageUrl: 'data:image/png;base64,MOCK',
        }),
      );

      const result = await generatePersonaAvatar('avatar de um robô fofo');

      expect(fetchMock).toHaveBeenCalledWith('/api/persona/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'avatar de um robô fofo' }),
      });
      expect(result.success).toBe(true);
      expect(result.imageUrl).toBe('data:image/png;base64,MOCK');
    });

    it('returns an error when generation fails', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, error: 'gerador indisponível' }, 500),
      );

      const result = await generatePersonaAvatar('qualquer');

      expect(result.success).toBe(false);
      expect(result.error).toBe('gerador indisponível');
    });
  });

  describe('fetchPersonaList', () => {
    it('fetches /api/persona/list and returns the persona list', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          authenticated: true,
          personas: [{ id: 'p-1', name: 'Ana', voiceId: 'voz-1' }],
        }),
      );

      const personas = await fetchPersonaList();

      expect(fetchMock).toHaveBeenCalledWith('/api/persona/list');
      expect(personas).toEqual([
        { id: 'p-1', name: 'Ana', voiceId: 'voz-1' },
      ]);
    });
  });

  describe('fetchVoices', () => {
    it('fetches /api/persona/voices and returns the voice list', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          voices: [
            { id: 'calm' },
            { id: 'energetic' },
          ],
        }),
      );

      const voices = await fetchVoices();

      expect(fetchMock).toHaveBeenCalledWith('/api/persona/voices');
      expect(voices).toEqual([
        { id: 'calm' },
        { id: 'energetic' },
      ]);
    });

    it('throws the API error instead of returning undefined', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, error: 'Voices service unreachable.' },
          502,
        ),
      );

      await expect(fetchVoices()).rejects.toThrow(
        'Voices service unreachable.',
      );
    });

    it('rejects a success payload without a voice list', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));

      await expect(fetchVoices()).rejects.toThrow('Invalid voices response.');
    });
  });

  describe('deletePersona', () => {
    it('sends DELETE to /api/persona with the encoded id and returns the result', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));

      const result = await deletePersona('p/1 espaço');

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/persona?personaId=${encodeURIComponent('p/1 espaço')}`,
        { method: 'DELETE' },
      );
      expect(result.success).toBe(true);
    });

    it('returns an error when the server responds with failure', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, error: 'Persona not found.' }),
      );

      const result = await deletePersona('p-404');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Persona not found.');
    });
  });

  describe('updatePersona', () => {
    it('sends a multipart PATCH to /api/persona with the encoded id', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const formData = new FormData();
      formData.append('name', 'Novo Nome');

      const result = await updatePersona('p/1 espaço', formData);

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/persona?personaId=${encodeURIComponent('p/1 espaço')}`,
        { method: 'PATCH', body: formData },
      );
      expect(result.success).toBe(true);
    });

    it('returns an error when the server responds with failure', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, error: 'Failed to update persona.' }),
      );

      const result = await updatePersona('p-1', new FormData());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to update persona.');
    });
  });

  describe('useUpdatePersonaMutation', () => {
    it('updates the persona and invalidates the list to reload', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const queryClient = new QueryClient();
      queryClient.setQueryData(['persona-list'], [{ id: 'p-1', name: 'Ana' }]);

      function Wrapper({ children }: { children: ReactNode }) {
        return createElement(
          QueryClientProvider,
          { client: queryClient },
          children,
        );
      }
      Wrapper.displayName = 'UpdatePersonaWrapper';

      const { result } = renderHook(() => useUpdatePersonaMutation(), {
        wrapper: Wrapper,
      });
      await result.current.mutateAsync({ personaId: 'p-1', formData: new FormData() });

      await waitFor(() => {
        expect(queryClient.getQueryState(['persona-list'])?.isInvalidated).toBe(true);
      });
    });
  });

  describe('useDeletePersonaMutation', () => {
    it('deletes the persona and invalidates the list to reload', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }));
      const queryClient = new QueryClient();
      queryClient.setQueryData(['persona-list'], [{ id: 'p-1', name: 'Ana' }]);

      function Wrapper({ children }: { children: ReactNode }) {
        return createElement(
          QueryClientProvider,
          { client: queryClient },
          children,
        );
      }
      Wrapper.displayName = 'DeletePersonaWrapper';

      const { result } = renderHook(() => useDeletePersonaMutation(), {
        wrapper: Wrapper,
      });
      await result.current.mutateAsync('p-1');

      await waitFor(() => {
        expect(queryClient.getQueryState(['persona-list'])?.isInvalidated).toBe(true);
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/persona?personaId=p-1', {
        method: 'DELETE',
      });
    });
  });
});
