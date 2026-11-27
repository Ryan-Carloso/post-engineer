import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string, vars?: Record<string, string | number>): string =>
    vars === undefined ? key : `${key}(${JSON.stringify(vars)})`;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'pt' as const, setLocale: vi.fn() }),
    I18nProvider,
  };
});

import { PostFields } from '../post-fields';
import { I18nProvider } from '@/lib/i18n/provider';
import { createDraft, type ComposerDraft, type ComposerField } from '@/lib/post-composer/compose';
import type { SocialProvider } from '@/lib/contracts/providers';
import type { BoardOption } from '../boards';

const BOARDS: BoardOption[] = [
  { id: 'board-1', name: 'Summer' },
  { id: 'board-2', name: 'Recipes' },
];

function renderFields(overrides: {
  draft?: Partial<ComposerDraft>;
  providers?: SocialProvider[];
  boards?: BoardOption[];
  boardsLoading?: boolean;
  boardsError?: boolean;
  issues?: Partial<Record<ComposerField, string>>;
  disabled?: boolean;
} = {}) {
  const onChange = vi.fn();
  const onBoardChange = vi.fn();
  const issues = overrides.issues ?? {};
  const props: Parameters<typeof PostFields>[0] = {
    draft: { ...createDraft('UTC'), title: 'Hello', description: 'World', ...overrides.draft },
    providers: overrides.providers ?? ['youtube'],
    boards: overrides.boards ?? [],
    boardsLoading: overrides.boardsLoading ?? false,
    boardsError: overrides.boardsError ?? false,
    issueFor: (field: ComposerField) => issues[field] ?? null,
    disabled: overrides.disabled ?? false,
    onChange,
    onBoardChange,
  };
  const utils = render(
    <I18nProvider>
      <PostFields {...props} />
    </I18nProvider>,
  );
  return { ...utils, onChange, onBoardChange, props };
}

describe('PostFields', () => {
  it('renders the title and description with counters and hints', () => {
    renderFields();
    expect(screen.getByText('composer.fieldsLabel')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.titleLabel')).toHaveValue('Hello');
    expect(screen.getByText('5/100')).toBeInTheDocument();
    expect(screen.getByText('composer.titleHint({"count":100})')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.descriptionLabel')).toHaveValue('World');
    expect(screen.getByText('5/5000')).toBeInTheDocument();
    expect(screen.getByText('composer.descriptionHint({"count":5000})')).toBeInTheDocument();
  });

  it('calls onChange for the title and description', () => {
    const { onChange } = renderFields();
    fireEvent.change(screen.getByLabelText('composer.titleLabel'), { target: { value: 'New title' } });
    expect(onChange).toHaveBeenCalledWith({ title: 'New title' });
    fireEvent.change(screen.getByLabelText('composer.descriptionLabel'), {
      target: { value: 'New description' },
    });
    expect(onChange).toHaveBeenCalledWith({ description: 'New description' });
  });

  it('shows the title and description issues', () => {
    renderFields({ issues: { title: 'composer.validationTitle', description: 'composer.validationDescription' } });
    expect(screen.getByText('composer.validationTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.validationDescription')).toBeInTheDocument();
  });

  it('shows the caption for a non-title provider and hides it for youtube only', () => {
    const first = renderFields({ providers: ['instagram'] });
    expect(screen.getByLabelText('composer.captionLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.captionHint')).toBeInTheDocument();
    first.unmount();
    renderFields({ providers: ['youtube'] });
    expect(screen.queryByLabelText('composer.captionLabel')).not.toBeInTheDocument();
  });

  it('calls onChange for the caption', () => {
    const { onChange } = renderFields({ providers: ['instagram'] });
    fireEvent.change(screen.getByLabelText('composer.captionLabel'), {
      target: { value: 'A caption' },
    });
    expect(onChange).toHaveBeenCalledWith({ caption: 'A caption' });
  });

  it('shows the youtube tags and privacy fields with all privacy options', () => {
    renderFields({ providers: ['youtube'] });
    expect(screen.getByLabelText('composer.tagsLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.tagsHint')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.privacyLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.privacyPublic')).toBeInTheDocument();
    expect(screen.getByText('composer.privacyUnlisted')).toBeInTheDocument();
    expect(screen.getByText('composer.privacyPrivate')).toBeInTheDocument();
  });

  it('hides the youtube fields for a non-youtube provider', () => {
    renderFields({ providers: ['instagram'] });
    expect(screen.queryByLabelText('composer.tagsLabel')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('composer.privacyLabel')).not.toBeInTheDocument();
  });

  it('calls onChange for tags and privacy', () => {
    const { onChange } = renderFields({ providers: ['youtube'] });
    fireEvent.change(screen.getByLabelText('composer.tagsLabel'), { target: { value: 'a, b' } });
    expect(onChange).toHaveBeenCalledWith({ tags: 'a, b' });
    fireEvent.change(screen.getByLabelText('composer.privacyLabel'), { target: { value: 'private' } });
    expect(onChange).toHaveBeenCalledWith({ privacyStatus: 'private' });
  });

  it('shows the tags issue', () => {
    renderFields({ providers: ['youtube'], issues: { tags: 'composer.validationTags' } });
    expect(screen.getByText('composer.validationTags')).toBeInTheDocument();
  });

  it('shows the pinterest board select with the boards', () => {
    renderFields({ providers: ['pinterest'], boards: BOARDS, draft: { pinterestBoardId: 'board-2' } });
    const select = screen.getByLabelText('composer.boardLabel') as HTMLSelectElement;
    expect(select).toHaveValue('board-2');
    expect(screen.getByText('Summer')).toBeInTheDocument();
    expect(screen.getByText('Recipes')).toBeInTheDocument();
    expect(screen.getByText('composer.boardHint')).toBeInTheDocument();
    expect(screen.getByText('composer.boardSelect')).toBeInTheDocument();
  });

  it('calls onBoardChange when a board is picked', () => {
    const { onBoardChange } = renderFields({ providers: ['pinterest'], boards: BOARDS });
    fireEvent.change(screen.getByLabelText('composer.boardLabel'), { target: { value: 'board-1' } });
    expect(onBoardChange).toHaveBeenCalledTimes(1);
    expect(onBoardChange).toHaveBeenCalledWith('board-1');
  });

  it('shows the loading placeholder and disables the board select while loading', () => {
    renderFields({ providers: ['pinterest'], boards: BOARDS, boardsLoading: true });
    expect(screen.getByText('composer.boardLoading')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.boardLabel')).toBeDisabled();
  });

  it('shows the board error and the board issue', () => {
    renderFields({
      providers: ['pinterest'],
      boards: BOARDS,
      boardsError: true,
      issues: { board: 'composer.validationBoard' },
    });
    expect(screen.getByText('composer.boardError')).toBeInTheDocument();
    expect(screen.getByText('composer.validationBoard')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.boardLabel')).toBeDisabled();
  });

  it('hides the board select for non-pinterest providers', () => {
    renderFields({ providers: ['youtube'] });
    expect(screen.queryByLabelText('composer.boardLabel')).not.toBeInTheDocument();
  });

  it('shows the first comment for a comment provider and hides it for pinterest only', () => {
    const first = renderFields({ providers: ['youtube'] });
    expect(screen.getByLabelText('composer.firstCommentLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.firstCommentHint')).toBeInTheDocument();
    first.unmount();
    renderFields({ providers: ['pinterest'] });
    expect(screen.queryByLabelText('composer.firstCommentLabel')).not.toBeInTheDocument();
  });

  it('calls onChange for the first comment', () => {
    const { onChange } = renderFields({ providers: ['youtube'] });
    fireEvent.change(screen.getByLabelText('composer.firstCommentLabel'), {
      target: { value: 'First!' },
    });
    expect(onChange).toHaveBeenCalledWith({ firstComment: 'First!' });
  });

  it('disables every field while disabled', () => {
    renderFields({ providers: ['youtube', 'instagram', 'pinterest'], boards: BOARDS, disabled: true });
    expect(screen.getByLabelText('composer.titleLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.descriptionLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.captionLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.tagsLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.privacyLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.boardLabel')).toBeDisabled();
    expect(screen.getByLabelText('composer.firstCommentLabel')).toBeDisabled();
  });
});
