'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { INPUT_CLASS, SECTION_LABEL_CLASS } from '@/lib/ui';
import { USER_PROMPT_LIMITS, USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';
import type { PromptDraft } from '@/lib/user-prompts-client';

export interface UserPromptFormProps {
  mode: 'new' | 'edit';
  initial: PromptDraft;
  pending: boolean;
  errorMessage: string | null;
  onSubmit: (draft: PromptDraft) => void;
  onCancel: () => void;
}

export default function UserPromptForm({
  mode,
  initial,
  pending,
  errorMessage,
  onSubmit,
  onCancel,
}: UserPromptFormProps): React.ReactElement {
  const { t } = useI18n();
  const [draft, setDraft] = useState<PromptDraft>(initial);
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstField.current?.focus();
  }, []);
  const slugValid = USER_PROMPT_SLUG_PATTERN.test(draft.slug);
  const canSubmit =
    !pending && slugValid && draft.title.trim().length > 0 && draft.prompt.trim().length > 0;

  const field =
    (name: keyof PromptDraft) =>
      (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
        setDraft((current) => ({ ...current, [name]: event.target.value }));
      };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (canSubmit) onSubmit(draft);
  };

  return (
    <form
      onSubmit={submit}
      data-testid="user-prompt-form"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <h3 className="text-base font-bold tracking-tight text-ink">
        {t(mode === 'new' ? 'userPrompts.formTitleNew' : 'userPrompts.formTitleEdit')}
      </h3>
      <label className="block">
        <span className={SECTION_LABEL_CLASS}>{t('userPrompts.slugLabel')}</span>
        <input
          ref={mode === 'new' ? firstField : undefined}
          value={draft.slug}
          onChange={field('slug')}
          disabled={mode === 'edit' || pending}
          maxLength={USER_PROMPT_LIMITS.slug}
          aria-invalid={draft.slug.length > 0 && !slugValid}
          className={INPUT_CLASS}
        />
        <span className="mt-1 block text-xs text-muted-text">{t('userPrompts.slugHint')}</span>
      </label>
      <label className="block">
        <span className={SECTION_LABEL_CLASS}>{t('userPrompts.titleLabel')}</span>
        <input
          ref={mode === 'edit' ? firstField : undefined}
          value={draft.title}
          onChange={field('title')}
          disabled={pending}
          maxLength={USER_PROMPT_LIMITS.title}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block">
        <span className={SECTION_LABEL_CLASS}>{t('userPrompts.descriptionLabel')}</span>
        <input
          value={draft.description}
          onChange={field('description')}
          disabled={pending}
          maxLength={USER_PROMPT_LIMITS.description}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block">
        <span className={SECTION_LABEL_CLASS}>{t('userPrompts.promptLabel')}</span>
        <textarea
          value={draft.prompt}
          onChange={field('prompt')}
          disabled={pending}
          maxLength={USER_PROMPT_LIMITS.prompt}
          rows={10}
          className={`${INPUT_CLASS} font-mono`}
        />
      </label>
      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className={SECTION_LABEL_CLASS}>{t('userPrompts.visibilityLabel')}</legend>
        {(['private', 'public'] as const).map((visibility) => (
          <label key={visibility} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="user-prompt-visibility"
              value={visibility}
              checked={draft.visibility === visibility}
              onChange={() => setDraft((current) => ({ ...current, visibility }))}
            />
            {t(visibility === 'private' ? 'userPrompts.visibilityPrivate' : 'userPrompts.visibilityPublic')}
          </label>
        ))}
        {draft.visibility === 'public' ? (
          <p role="note" className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink-soft">
            {t('userPrompts.publicWarning')}
          </p>
        ) : null}
      </fieldset>
      {errorMessage === null ? null : (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
        >
          {pending ? t('userPrompts.saving') : t('userPrompts.save')}
        </Button>
        <Button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-ink"
        >
          {t('userPrompts.cancel')}
        </Button>
      </div>
    </form>
  );
}
