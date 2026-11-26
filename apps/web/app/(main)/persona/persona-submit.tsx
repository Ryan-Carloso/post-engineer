'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useFormContext } from 'react-hook-form';
import { createPersona, useUpdatePersonaMutation } from '@/lib/api';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import { scrollToErrorField } from '@/lib/scroll-to-error';
import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { surfaceAppErrorMessage } from '@/lib/errors';
import { localizeIdentityCardResult, validateIdentityCardDraft } from '@/lib/persona-identity-card-form';
import { PERSONA_IDENTITY_CARD_QUERY_KEY } from '@/lib/persona-identity-card-api';
import { totalBoundAccounts, type PersonaDefaultAccounts, samePublishingAccounts } from '@/lib/persona-publishing-accounts';
import { SpinnerIcon } from '@/lib/ui';

export function resolveEditingPersonaId(pathname: string, editId: string | null): string | null {
  const editMatch = pathname.match(/^\/personas\/([^/]+)\/edit$/);
  return editMatch?.[1] ?? editId;
}

interface PublishingAccountsResponse {
  success: boolean;
  error?: string;
}

async function savePublishingAccounts(
  personaId: string,
  accounts: PersonaDefaultAccounts,
  saveError: string,
): Promise<void> {
  const res = await fetch(`/api/persona/publishing-accounts?personaId=${encodeURIComponent(personaId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accounts }),
  });
  if (!res.ok) notifyIfSessionExpired(res);
  let body: PublishingAccountsResponse;
  try {
    body = (await res.json()) as PublishingAccountsResponse;
  } catch {
    throw new Error(saveError);
  }
  if (!res.ok || body.success !== true) {
    throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : saveError);
  }
}

export const PersonaSubmit = ({ editId }: { editId: string | null }) => {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateMutation = useUpdatePersonaMutation();
  const { handleSubmit: validateForm } = useFormContext();
  const [isPending, setIsPending] = useState(false);
  const accountsLoaded = usePersonaStore((s) => s.publishingAccountsLoaded);
  const loadedAccounts = usePersonaStore((s) => s.loadedPublishingAccounts);

  const editingPersonaId = resolveEditingPersonaId(pathname, editId);
  const isEditing = Boolean(editingPersonaId);

  const handleSubmit = async () => {
    const state = usePersonaStore.getState();
    if (!state.name.trim()) {
      state.setResult({ success: false, error: t('persona.errName') });
      scrollToErrorField('name');
      return;
    }
    if (totalBoundAccounts(state.publishingAccounts) === 0) {
      state.setResult({ success: false, error: t('publishing.mustSelectAccount') });
      scrollToErrorField('accounts');
      return;
    }

    const cardCheck = validateIdentityCardDraft(state.identityCardDraft);
    if (!cardCheck.ok) {
      state.setResult({ success: false, error: t(cardCheck.errorKey) });
      scrollToErrorField('identity-card');
      return;
    }

    state.setResult(null);
    setIsPending(true);
    state.setSubmitting(true);
    try {
      const personaId = editingPersonaId;
      if (personaId) {
        const formData = state.buildPersonaEditFormData();
        const result = localizeIdentityCardResult(await updateMutation.mutateAsync({ personaId, formData }), t);
        usePersonaStore.getState().setResult(result);
        if (result.success) {
          await queryClient.invalidateQueries({
            queryKey: [PERSONA_IDENTITY_CARD_QUERY_KEY, personaId],
          });
          if (loadedAccounts === null || !samePublishingAccounts(state.publishingAccounts, loadedAccounts)) {
            try {
              await savePublishingAccounts(personaId, state.publishingAccounts, t('persona.publishingAccountsSaveError'));
              usePersonaStore.getState().setLoadedPublishingAccounts(state.publishingAccounts);
            } catch (error) {
              usePersonaStore.getState().setResult({
                success: false,
                error: surfaceAppErrorMessage(error, t('persona.publishingAccountsSaveError')),
              });
              scrollToErrorField('accounts');
              return;
            }
          }
          await queryClient.invalidateQueries({ queryKey: ['persona-list'] });
          router.back();
        }
      } else {
        const result = localizeIdentityCardResult(await createPersona(state.buildPersonaFormData()), t);
        const createResult = result.success || result.error ? result : { success: false, error: t('persona.errServer') };
        usePersonaStore.getState().setResult(createResult);
        if (result.success) {
          await queryClient.invalidateQueries({ queryKey: ['persona-list'] });
          router.push('/personas');
        }
      }
    } catch (error) {
      usePersonaStore.getState().setResult({
        success: false,
        error: surfaceAppErrorMessage(error, t('persona.errServer')),
      });
    } finally {
      setIsPending(false);
      usePersonaStore.getState().setSubmitting(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={validateForm(() => void handleSubmit())}
        disabled={isPending || updateMutation.isPending || (isEditing && !accountsLoaded)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-on-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <SpinnerIcon />
            {t(isEditing ? 'personas.saving' : 'persona.submitting')}
          </>
        ) : (
          t(isEditing ? 'personas.save' : 'persona.submit')
        )}
      </button>
      <p className="mt-3 text-center text-sm leading-5 text-muted-text">
        {t(isEditing ? 'personas.saveHint' : 'persona.submitHint')}
      </p>
    </div>
  );
};
