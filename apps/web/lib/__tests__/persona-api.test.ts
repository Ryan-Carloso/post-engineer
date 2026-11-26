import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import {
  createPersona,
  fetchPersonaList,
  deletePersona,
  fetchDeletePreview,
  updatePersona,
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

    it('returns success:false on a non-JSON body instead of throwing', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      );

      const result = await createPersona(new FormData());

      expect(result.success).toBe(false);
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

  describe('fetchDeletePreview', () => {
    it('GETs /api/persona/delete-preview with the encoded id', async () => {
      const preview = { success: true, counts: { schedules: 1 } };
      fetchMock.mockResolvedValue(jsonResponse(preview));

      const result = await fetchDeletePreview('p/1 espaço');

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/persona/delete-preview?personaId=${encodeURIComponent('p/1 espaço')}`,
      );
      expect(result).toEqual(preview);
    });

    it('returns success:false on a non-ok response instead of throwing', async () => {
      fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

      const result = await fetchDeletePreview('p-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('502');
    });

    it('surfaces the server structured error on a non-ok JSON response', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: 'Persona not found.', code: 'PERSONA_NOT_FOUND' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await fetchDeletePreview('p-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Persona not found.');
    });

    it('returns success:false on a non-JSON body instead of throwing', async () => {
      fetchMock.mockResolvedValue(
        new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      );

      const result = await fetchDeletePreview('p-1');

      expect(result.success).toBe(false);
    });
  });

  describe('deletePersona robustness', () => {
    it('returns success:false on a non-ok response instead of throwing', async () => {
      fetchMock.mockResolvedValue(new Response('timeout', { status: 504 }));

      const result = await deletePersona('p-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('504');
    });

    it('returns success:false on a non-JSON body instead of throwing', async () => {
      fetchMock.mockResolvedValue(
        new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      );

      const result = await deletePersona('p-1');

      expect(result.success).toBe(false);
    });
  });

  describe('updatePersona robustness', () => {
    it('returns success:false on a non-ok response instead of throwing', async () => {
      fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

      const result = await updatePersona('p-1', new FormData());

      expect(result.success).toBe(false);
      expect(result.error).toContain('502');
    });

    it('returns success:false on a non-JSON body instead of throwing', async () => {
      fetchMock.mockResolvedValue(
        new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      );

      const result = await updatePersona('p-1', new FormData());

      expect(result.success).toBe(false);
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

});
