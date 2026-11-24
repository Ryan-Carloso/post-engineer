import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';

import { enDictionary } from '@/lib/i18n';
import { usePersonaStore } from '@/lib/store';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { PersonaSubmit } from '../persona-submit';

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
    <QueryClientProvider client={new QueryClient()}>
      <FormProvider {...methods}>{children}</FormProvider>
    </QueryClientProvider>
  );
}

function fillRequiredFields(): void {
  const store = usePersonaStore.getState();
  store.setName('Maria');
  store.setAvatarUrl('https://example.com/a.png');
  store.setVoiceId('voice-1');
  store.setPublishingAccounts({ ...emptyPersonaDefaultAccounts(), youtube: ['UC1'] });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.submittingDuringCall.length = 0;
  usePersonaStore.getState().resetForm();
  fillRequiredFields();
  api.createPersona.mockImplementation(async () => {
    api.submittingDuringCall.push(usePersonaStore.getState().isSubmitting);
    return { success: true };
  });
});

async function submit(): Promise<void> {
  render(<PersonaSubmit editId={null} />, { wrapper: Wrapper });
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(usePersonaStore.getState().result).not.toBeNull());
}

describe('PersonaSubmit with an identity card', () => {
  it('sends the filled card with the create request and marks the store as submitting meanwhile', async () => {
    usePersonaStore.getState().setIdentityCardField('face.eyes', 'green');
    await submit();
    const formData = api.createPersona.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(formData.get('identityCard')))).toEqual({ version: 1, identity: { face: { eyes: 'green' } } });
    expect(api.submittingDuringCall).toEqual([true]);
    expect(usePersonaStore.getState().isSubmitting).toBe(false);
  });

  it('sends no card field when the card is blank', async () => {
    await submit();
    expect((api.createPersona.mock.calls[0][0] as FormData).has('identityCard')).toBe(false);
  });

  it('blocks an invalid card before any request and shows the localized message', async () => {
    usePersonaStore.getState().setIdentityCardField('outfit.top', 'shirt');
    await submit();
    expect(api.createPersona).not.toHaveBeenCalled();
    expect(usePersonaStore.getState().result).toEqual({
      success: false,
      error: enDictionary.identityCard.errNoTrait,
    });
    expect(usePersonaStore.getState().isSubmitting).toBe(false);
  });

  it('replaces an English server card error with the localized message', async () => {
    usePersonaStore.getState().setIdentityCardField('face.eyes', 'green');
    api.createPersona.mockResolvedValueOnce({ success: false, error: 'identityCard.identity.face.eyes: at most 80 characters' });
    await submit();
    expect(usePersonaStore.getState().result).toEqual({
      success: false,
      error: enDictionary.identityCard.errField,
    });
  });
});
