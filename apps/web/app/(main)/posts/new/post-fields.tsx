'use client';

import {
  COMMENT_PROVIDERS,
  isTitleProvider,
  type SocialProvider,
} from '@/lib/contracts/providers';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { InlineFieldError } from '@/components/ui/form-field';
import { INPUT_CLASS } from '@/lib/ui';
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type ComposerDraft,
  type ComposerField,
  type ComposerPrivacy,
} from '@/lib/post-composer/compose';
import type { BoardOption } from './boards';

const PRIVACY_OPTIONS: ReadonlyArray<{ value: ComposerPrivacy; key: TranslationKey }> = [
  { value: 'public', key: 'composer.privacyPublic' },
  { value: 'unlisted', key: 'composer.privacyUnlisted' },
  { value: 'private', key: 'composer.privacyPrivate' },
];

function isCommentProvider(provider: SocialProvider): boolean {
  return (COMMENT_PROVIDERS as readonly string[]).includes(provider);
}

export function PostFields({
  draft,
  providers,
  boards,
  boardsLoading,
  boardsError,
  issueFor,
  disabled,
  onChange,
  onBoardChange,
}: {
  draft: ComposerDraft;
  providers: readonly SocialProvider[];
  boards: BoardOption[];
  boardsLoading: boolean;
  boardsError: boolean;
  issueFor: (field: ComposerField) => string | null;
  disabled: boolean;
  onChange: (patch: Partial<ComposerDraft>) => void;
  onBoardChange: (boardId: string) => void;
}) {
  const { t } = useI18n();
  const youtube = providers.includes('youtube');
  const pinterest = providers.includes('pinterest');
  const caption = providers.some((provider) => !isTitleProvider(provider));
  const firstComment = providers.some(isCommentProvider);

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6" data-testid="composer-fields">
      <h2 className="text-base font-semibold text-ink">{t('composer.fieldsLabel')}</h2>

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="composer-title" className="block text-xs font-medium text-ink-soft">
              {t('composer.titleLabel')}
            </label>
            <span className="text-[11px] text-faint tabular-nums">
              {draft.title.length}/{TITLE_MAX_LENGTH}
            </span>
          </div>
          <input
            id="composer-title"
            type="text"
            value={draft.title}
            maxLength={TITLE_MAX_LENGTH}
            disabled={disabled}
            onChange={(event) => onChange({ title: event.target.value })}
            className={INPUT_CLASS}
            placeholder={t('composer.titleLabel')}
          />
          <p className="mt-1 text-[11px] text-muted-text">
            {t('composer.titleHint', { count: TITLE_MAX_LENGTH })}
          </p>
          {issueFor('title') !== null && <InlineFieldError message={issueFor('title') ?? ''} />}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="composer-description" className="block text-xs font-medium text-ink-soft">
              {t('composer.descriptionLabel')}
            </label>
            <span className="text-[11px] text-faint tabular-nums">
              {draft.description.length}/{DESCRIPTION_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id="composer-description"
            rows={5}
            value={draft.description}
            maxLength={DESCRIPTION_MAX_LENGTH}
            disabled={disabled}
            onChange={(event) => onChange({ description: event.target.value })}
            className={INPUT_CLASS}
          />
          <p className="mt-1 text-[11px] text-muted-text">
            {t('composer.descriptionHint', { count: DESCRIPTION_MAX_LENGTH })}
          </p>
          {issueFor('description') !== null && (
            <InlineFieldError message={issueFor('description') ?? ''} />
          )}
        </div>

        {caption ? (
          <div>
            <label htmlFor="composer-caption" className="block text-xs font-medium text-ink-soft">
              {t('composer.captionLabel')}
            </label>
            <textarea
              id="composer-caption"
              rows={3}
              value={draft.caption}
              disabled={disabled}
              onChange={(event) => onChange({ caption: event.target.value })}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-[11px] text-muted-text">{t('composer.captionHint')}</p>
          </div>
        ) : null}

        {youtube ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="composer-tags" className="block text-xs font-medium text-ink-soft">
                {t('composer.tagsLabel')}
              </label>
              <input
                id="composer-tags"
                type="text"
                value={draft.tags}
                disabled={disabled}
                onChange={(event) => onChange({ tags: event.target.value })}
                className={INPUT_CLASS}
                placeholder={t('composer.tagsPlaceholder')}
              />
              <p className="mt-1 text-[11px] text-muted-text">{t('composer.tagsHint')}</p>
              {issueFor('tags') !== null && <InlineFieldError message={issueFor('tags') ?? ''} />}
            </div>
            <div>
              <label htmlFor="composer-privacy" className="block text-xs font-medium text-ink-soft">
                {t('composer.privacyLabel')}
              </label>
              <select
                id="composer-privacy"
                value={draft.privacyStatus}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ privacyStatus: event.target.value as ComposerPrivacy })
                }
                className={INPUT_CLASS}
              >
                {PRIVACY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.key)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {pinterest ? (
          <div>
            <label htmlFor="composer-board" className="block text-xs font-medium text-ink-soft">
              {t('composer.boardLabel')}
            </label>
            <select
              id="composer-board"
              value={draft.pinterestBoardId}
              disabled={disabled || boardsLoading || boardsError}
              onChange={(event) => onBoardChange(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                {boardsLoading ? t('composer.boardLoading') : t('composer.boardSelect')}
              </option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-text">{t('composer.boardHint')}</p>
            {boardsError ? <InlineFieldError message={t('composer.boardError')} /> : null}
            {issueFor('board') !== null && <InlineFieldError message={issueFor('board') ?? ''} />}
          </div>
        ) : null}

        {firstComment ? (
          <div>
            <label htmlFor="composer-first-comment" className="block text-xs font-medium text-ink-soft">
              {t('composer.firstCommentLabel')}
            </label>
            <textarea
              id="composer-first-comment"
              rows={2}
              value={draft.firstComment}
              disabled={disabled}
              onChange={(event) => onChange({ firstComment: event.target.value })}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-[11px] text-muted-text">{t('composer.firstCommentHint')}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
