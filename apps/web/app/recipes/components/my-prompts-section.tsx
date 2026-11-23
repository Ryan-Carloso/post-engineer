'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyPrompt } from '@/lib/use-copy-prompt';
import { Button } from '@/components/ui/button';
import { INPUT_CLASS, SpinnerIcon } from '@/lib/ui';
import { filterPromptSummaries } from '@/lib/prompt-search';
import { PROMPT_SEARCH_MAX_LENGTH } from '@/lib/contracts/prompts';
import {
  useCreatePromptMutation,
  useDeletePromptMutation,
  useUpdatePromptMutation,
  useUserPromptsQuery,
} from '@/lib/use-user-prompts';
import { fetchPrompt, promptFailureKey, type PromptCallFailure, type PromptDraft } from '@/lib/user-prompts-client';
import type { PromptSummary } from '@/lib/user-prompts-types';
import UserPromptForm from './user-prompt-form';
import UserPromptRow from './user-prompt-row';

const EMPTY_DRAFT: PromptDraft = { slug: '', title: '', description: '', prompt: '', visibility: 'private' };

type FormState = { mode: 'new' } | { mode: 'edit'; draft: PromptDraft };

export default function MyPromptsSection(): React.ReactElement {
  const { t } = useI18n();
  const query = useUserPromptsQuery();
  const createMutation = useCreatePromptMutation();
  const updateMutation = useUpdatePromptMutation();
  const deleteMutation = useDeletePromptMutation();
  const copier = useCopyPrompt();

  const [form, setForm] = useState<FormState | null>(null);
  const [failure, setFailure] = useState<PromptCallFailure | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const listing = query.data !== undefined && query.data.success ? query.data.body.prompts : null;
  const displayable = (listing ?? []).filter((prompt) => prompt.source === 'own');
  const own = filterPromptSummaries(displayable, { q: search });
  const searching = search.trim() !== '';
  const emptyMessage = own.length > 0 ? null : searching ? t('userPrompts.noResults') : t('userPrompts.empty');
  const busy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    loadingSlug !== null ||
    copier.loadingSlug !== null;

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
      draft: {
        slug: detail.slug,
        title: detail.title,
        description: detail.description,
        prompt: detail.body,
        visibility: detail.visibility,
      },
    });
  };

  const submit = async (draft: PromptDraft): Promise<void> => {
    setFailure(null);
    const result =
      form?.mode === 'edit'
        ? await updateMutation.mutateAsync({
          slug: draft.slug,
          changes: {
            title: draft.title,
            description: draft.description,
            prompt: draft.prompt,
            visibility: draft.visibility,
          },
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

  const toggleVisibility = async (prompt: PromptSummary): Promise<void> => {
    setFailure(null);
    const result = await updateMutation.mutateAsync({
      slug: prompt.slug,
      changes: { visibility: prompt.visibility === 'public' ? 'private' : 'public' },
    });
    if (!result.success) setFailure(result);
  };

  const formPending = createMutation.isPending || updateMutation.isPending;
  const shownFailure = failure ?? copier.failure;
  const errorMessage = shownFailure === null ? null : t(promptFailureKey(shownFailure));

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

      {listing === null || displayable.length === 0 ? null : (
        <input
          type="search"
          value={search}
          maxLength={PROMPT_SEARCH_MAX_LENGTH}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('userPrompts.searchPlaceholder')}
          aria-label={t('userPrompts.searchPlaceholder')}
          data-testid="user-prompts-search"
          className={INPUT_CLASS}
        />
      )}

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
        <p className="text-sm text-muted-text">{emptyMessage}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {own.map((prompt) => (
            <UserPromptRow
              key={prompt.slug}
              prompt={prompt}
              busy={busy}
              copied={copier.copiedSlug === prompt.slug}
              onCopy={() => void copier.copyPrompt(prompt.slug)}
              onEdit={() => void openEdit(prompt)}
              onToggleVisibility={() => void toggleVisibility(prompt)}
              onDelete={() => void remove(prompt)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
