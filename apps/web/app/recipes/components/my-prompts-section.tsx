'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import { SpinnerIcon } from '@/lib/ui';
import {
  useCreatePromptMutation,
  useDeletePromptMutation,
  useSetPromptVisibilityMutation,
  useUpdatePromptMutation,
  useUserPromptsQuery,
} from '@/lib/use-user-prompts';
import { fetchPrompt, promptFailureKey, type PromptCallFailure, type PromptDraft } from '@/lib/user-prompts-client';
import type { PromptSummary } from '@/lib/user-prompts-types';
import UserPromptForm from './user-prompt-form';
import UserPromptRow from './user-prompt-row';

const EMPTY_DRAFT: PromptDraft = { slug: '', title: '', description: '', prompt: '' };

type FormState = { mode: 'new' } | { mode: 'edit'; draft: PromptDraft; approved: boolean };

export default function MyPromptsSection(): React.ReactElement {
  const { t } = useI18n();
  const query = useUserPromptsQuery();
  const createMutation = useCreatePromptMutation();
  const updateMutation = useUpdatePromptMutation();
  const deleteMutation = useDeletePromptMutation();
  const visibilityMutation = useSetPromptVisibilityMutation();
  const { copied, copy } = useCopyText();

  const [form, setForm] = useState<FormState | null>(null);
  const [failure, setFailure] = useState<PromptCallFailure | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);

  const listing = query.data !== undefined && query.data.success ? query.data.body.prompts : null;
  const own = (listing ?? []).filter((prompt) => prompt.source === 'own');
  const community = (listing ?? []).filter((prompt) => prompt.source === 'community');
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    visibilityMutation.isPending ||
    loadingSlug !== null;

  const closeForm = (): void => {
    setForm(null);
    setFailure(null);
  };

  const openNew = (): void => {
    setFailure(null);
    setForm({ mode: 'new' });
  };

  const openEdit = async (prompt: PromptSummary): Promise<void> => {
    setFailure(null);
    setLoadingSlug(prompt.slug);
    const result = await fetchPrompt(prompt.slug);
    setLoadingSlug(null);
    if (!result.success) {
      setFailure(result);
      return;
    }
    const detail = result.body.prompt;
    setForm({
      mode: 'edit',
      approved: prompt.status === 'approved',
      draft: { slug: detail.slug, title: detail.title, description: detail.description, prompt: detail.prompt },
    });
  };

  const copyPrompt = async (prompt: PromptSummary): Promise<void> => {
    setFailure(null);
    setLoadingSlug(prompt.slug);
    const result = await fetchPrompt(prompt.slug);
    setLoadingSlug(null);
    if (!result.success) {
      setFailure(result);
      return;
    }
    copy(result.body.prompt.prompt);
    setCopiedSlug(prompt.slug);
  };

  const submit = async (draft: PromptDraft): Promise<void> => {
    setFailure(null);
    const result =
      form?.mode === 'edit'
        ? await updateMutation.mutateAsync({
          slug: draft.slug,
          changes: { title: draft.title, description: draft.description, prompt: draft.prompt },
        })
        : await createMutation.mutateAsync(draft);
    if (result.success) {
      closeForm();
      return;
    }
    setFailure(result);
  };

  const remove = async (prompt: PromptSummary): Promise<void> => {
    if (!window.confirm(t('userPrompts.deleteConfirm'))) return;
    setFailure(null);
    const result = await deleteMutation.mutateAsync(prompt.slug);
    if (!result.success) setFailure(result);
  };

  const setVisibility = async (prompt: PromptSummary, visibility: 'public' | 'private'): Promise<void> => {
    setFailure(null);
    const result = await visibilityMutation.mutateAsync({ slug: prompt.slug, visibility });
    if (!result.success) setFailure(result);
  };

  const formPending = createMutation.isPending || updateMutation.isPending;
  const errorMessage = failure === null ? null : t(promptFailureKey(failure));

  return (
    <div className="flex flex-col gap-4" data-testid="my-prompts-section">
      <div>
        <Button
          type="button"
          onClick={openNew}
          disabled={form !== null || busy}
          data-testid="new-user-prompt-btn"
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-soft disabled:opacity-50"
        >
          {t('userPrompts.newPrompt')}
        </Button>
      </div>

      {form === null ? null : (
        <UserPromptForm
          key={form.mode === 'edit' ? form.draft.slug : 'new'}
          mode={form.mode}
          initial={form.mode === 'edit' ? form.draft : EMPTY_DRAFT}
          approved={form.mode === 'edit' && form.approved}
          pending={formPending}
          errorMessage={errorMessage}
          onSubmit={(draft) => void submit(draft)}
          onCancel={closeForm}
        />
      )}

      {form === null && errorMessage !== null ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {query.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-text">
          <SpinnerIcon />
        </p>
      ) : listing === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">{t('userPrompts.loadError')}</p>
          <Button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:border-ink"
          >
            {t('userPrompts.retry')}
          </Button>
        </div>
      ) : own.length === 0 ? (
        <p className="text-sm text-muted-text">{t('userPrompts.empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {own.map((prompt) => (
            <UserPromptRow
              key={prompt.slug}
              prompt={prompt}
              busy={busy}
              copied={copied && copiedSlug === prompt.slug}
              onCopy={() => void copyPrompt(prompt)}
              onEdit={() => void openEdit(prompt)}
              onPublish={() => void setVisibility(prompt, 'public')}
              onWithdraw={() => void setVisibility(prompt, 'private')}
              onDelete={() => void remove(prompt)}
            />
          ))}
        </ul>
      )}

      {community.length === 0 ? null : (
        <section aria-labelledby="community-prompts-title" className="flex flex-col gap-3 pt-2">
          <div>
            <h3 id="community-prompts-title" className="text-base font-bold tracking-tight text-ink">
              {t('userPrompts.communityTitle')}
            </h3>
            <p className="text-sm text-muted-text">{t('userPrompts.communityHint')}</p>
          </div>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {community.map((prompt) => (
              <UserPromptRow
                key={prompt.slug}
                prompt={prompt}
                busy={busy}
                copied={copied && copiedSlug === prompt.slug}
                onCopy={() => void copyPrompt(prompt)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
