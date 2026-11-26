'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import TextDiffView from '@/components/ui/text-diff-view';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { diffText, type TextDiff } from '@/lib/text-diff';
import { INPUT_CLASS, SpinnerIcon } from '@/lib/ui';
import { promptFailureKey } from '@/lib/user-prompts-client';
import { PromptVersionReadError, promptVersionQueryOptions } from '@/lib/use-user-prompts';

const GRANULARITY_NOTE: Record<TextDiff['granularity'], TranslationKey | null> = {
  word: null,
  line: 'userPrompts.compareByLine',
  block: 'userPrompts.compareByBlock',
};

export interface VersionPair {
  from: number;
  to: number;
}

export interface PromptVersionCompareProps {
  slug: string;
  currentVersion: number;
  currentBody: string;
  pair: VersionPair;
  onChange: (pair: VersionPair) => void;
  onClose: () => void;
}

interface VersionBody {
  body: string | null;
  error: Error | null;
}

function useVersionBody(slug: string, version: number, currentVersion: number, currentBody: string): VersionBody {
  const isCurrent = version === currentVersion;
  const query = useQuery({ ...promptVersionQueryOptions(slug, version), enabled: !isCurrent });
  if (isCurrent) return { body: currentBody, error: null };
  return { body: query.data?.version.body ?? null, error: query.isError ? query.error : null };
}

export default function PromptVersionCompare({
  slug,
  currentVersion,
  currentBody,
  pair,
  onChange,
  onClose,
}: PromptVersionCompareProps): React.ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = panel.current;
    if (element !== null && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pair.from, pair.to]);
  const from = useVersionBody(slug, pair.from, currentVersion, currentBody);
  const to = useVersionBody(slug, pair.to, currentVersion, currentBody);
  const diff = useMemo(
    () => (from.body === null || to.body === null ? null : diffText(from.body, to.body)),
    [from.body, to.body],
  );
  const versions = Array.from({ length: currentVersion }, (_, index) => currentVersion - index);
  const error = from.error ?? to.error;

  let content: React.ReactNode;
  if (error !== null) {
    content = (
      <p role="alert" data-testid="prompt-version-compare-error" className="text-sm text-destructive">
        {t(error instanceof PromptVersionReadError ? promptFailureKey(error.failure) : 'userPrompts.errorGeneric')}
      </p>
    );
  } else if (diff === null) {
    content = (
      <p className="flex items-center gap-2 text-sm text-muted-text">
        <SpinnerIcon />
      </p>
    );
  } else {
    const note = GRANULARITY_NOTE[diff.granularity];
    content = (
      <>
        {note === null ? null : <p className="text-xs text-warning">{t(note)}</p>}
        <TextDiffView
          segments={diff.segments}
          summary={t('userPrompts.compareSummary', { added: diff.addedWords, removed: diff.removedWords })}
          emptyLabel={t('userPrompts.compareSame')}
        />
      </>
    );
  }

  const select = (id: string, label: TranslationKey, value: number, update: (version: number) => void) => (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block text-xs font-medium text-ink-soft">
        {t(label)}
      </label>
      <select
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => update(Number(event.target.value))}
        className={INPUT_CLASS}
      >
        {versions.map((version) => (
          <option key={version} value={version}>
            {t(version === currentVersion ? 'userPrompts.compareCurrentOption' : 'userPrompts.versionLabel', { version })}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div ref={panel} data-testid="prompt-version-compare" className="mt-4 flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{t('userPrompts.compareTitle', { from: pair.from, to: pair.to })}</h3>
        <button
          type="button"
          data-testid="prompt-version-compare-close"
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink"
          onClick={onClose}
        >
          {t('userPrompts.compareClose')}
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {select('prompt-version-compare-from', 'userPrompts.compareFrom', pair.from, (version) => onChange({ ...pair, from: version }))}
        {select('prompt-version-compare-to', 'userPrompts.compareTo', pair.to, (version) => onChange({ ...pair, to: version }))}
      </div>
      {content}
    </div>
  );
}
