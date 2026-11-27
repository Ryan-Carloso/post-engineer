import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

import { enDictionary } from '@/lib/i18n';
import { usePersonaStore } from '@/lib/store';
import { PERSONA_IDENTITY_CARD_QUERY_KEY } from '@/lib/persona-identity-card-api';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { PersonaSubmit } from '../persona-submit';

let queryClient = new QueryClient();

const api = vi.hoisted(() => ({
  createPersona: vi.fn(),
  updateMutateAsync: vi.fn(),
  submittingDuringCall: [] as boolean[],
}));

vi.mock('@/lib/api', () => ({
  createPersona: api.createPersona,
  useUpdatePersonaMutation: () => ({ mutateAsync: api.updateMutateAsync, isPending: false }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/personas/new',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const [section, name] = key.split('.');
      return (enDictionary as unknown as Record<string, Record<string, string>>)[section][name];
    },
    locale: 'en',
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const methods = useForm();
  return (
    <QueryClientProvider client={queryClient}>
      <FormProvider {...methods}>{children}</FormProvider>
    </QueryClientProvider>
  );
}

function fillRequiredFields(): void {
  const store = usePersonaStore.getState();
  store.setName('Maria');
  store.setPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['UC1'] });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.submittingDuringCall.length = 0;
  queryClient = new QueryClient();
  usePersonaStore.getState().resetForm();
  fillRequiredFields();
  api.createPersona.mockImplementation(async () => {
    api.submittingDuringCall.push(usePersonaStore.getState().isSubmitting);
    return { success: true };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submit(): Promise<void> {
  render(<PersonaSubmit editId={null} />, { wrapper: Wrapper });
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(usePersonaStore.getState().result).not.toBeNull());
}

describe('PersonaSubmit with an identity card', () => {
  it('sends the filled card with the create request and marks the store as submitting meanwhile', async () => {
    usePersonaStore.getState().setIdentityCardText('green eyes, oval face');
    await submit();
    const formData = api.createPersona.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(formData.get('identityCard')))).toEqual({
      version: 3,
      identity: { description: 'green eyes, oval face' },
    });
    expect(api.submittingDuringCall).toEqual([true]);
    expect(usePersonaStore.getState().isSubmitting).toBe(false);
  });

  it('sends no card field when the card is blank', async () => {
    await submit();
    expect((api.createPersona.mock.calls[0][0] as FormData).has('identityCard')).toBe(false);
  });

  it('blocks an invalid card before any request and shows the localized message', async () => {
    usePersonaStore.getState().setIdentityCardText('{not json');
    await submit();
    expect(api.createPersona).not.toHaveBeenCalled();
    expect(usePersonaStore.getState().result).toEqual({
      success: false,
      error: enDictionary.identityCard.errGeneric,
    });
    expect(usePersonaStore.getState().isSubmitting).toBe(false);
  });

  it('replaces an English server card error with the localized message', async () => {
    usePersonaStore.getState().setIdentityCardText('green eyes');
    api.createPersona.mockResolvedValueOnce({ success: false, error: 'identityCard.identity.description: at most 800 characters' });
    await submit();
    expect(usePersonaStore.getState().result).toEqual({
      success: false,
      error: enDictionary.identityCard.errField,
    });
  });

  it('invalidates the identity card query after a successful edit save', async () => {
    const personaId = '11111111-1111-4111-8111-111111111111';
    api.updateMutateAsync.mockResolvedValue({ success: true });
    const store = usePersonaStore.getState();
    store.setPublishingAccountsLoaded(true);
    store.setLoadedPublishingAccounts(store.publishingAccounts);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(<PersonaSubmit editId={personaId} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(usePersonaStore.getState().result).toEqual({ success: true }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['persona-list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [PERSONA_IDENTITY_CARD_QUERY_KEY, personaId],
    });
    invalidateSpy.mockRestore();
  });

  it('invalidates the identity card query even when the publishing accounts save fails', async () => {
    const personaId = '11111111-1111-4111-8111-111111111111';
    api.updateMutateAsync.mockResolvedValue({ success: true });
    const store = usePersonaStore.getState();
    store.setPublishingAccountsLoaded(true);
    store.setLoadedPublishingAccounts(emptyPersonaDefaultAccounts());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) }),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(<PersonaSubmit editId={personaId} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(usePersonaStore.getState().result?.success).toBe(false));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [PERSONA_IDENTITY_CARD_QUERY_KEY, personaId],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['persona-list'] });
    invalidateSpy.mockRestore();
  });
});
