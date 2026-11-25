import type { DiffKind, DiffSegment } from '@/lib/text-diff';
import { cn } from '@/lib/utils';

const SEGMENT_CLASS: Record<DiffKind, string> = {
  same: '',
  added: 'rounded-sm bg-success-soft text-success no-underline',
  removed: 'rounded-sm bg-destructive-soft text-destructive line-through',
};

export interface TextDiffViewProps {
  segments: readonly DiffSegment[];
  summary: string;
  emptyLabel: string;
  className?: string;
}

export default function TextDiffView({
  segments,
  summary,
  emptyLabel,
  className,
}: TextDiffViewProps): React.ReactElement {
  const changed = segments.some((segment) => segment.kind !== 'same');
  return (
    <div data-testid="text-diff" className={cn('flex flex-col gap-2', className)}>
      <p data-testid="text-diff-summary" className="text-xs font-semibold text-muted-text">
        {changed ? summary : emptyLabel}
      </p>
      <pre className="max-h-128 overflow-auto rounded-xl bg-surface p-3 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap text-ink-soft">
        {segments.map((segment, index) => {
          if (segment.kind === 'added') {
            return (
              <ins key={index} data-diff="added" className={SEGMENT_CLASS.added}>
                {segment.text}
              </ins>
            );
          }
          if (segment.kind === 'removed') {
            return (
              <del key={index} data-diff="removed" className={SEGMENT_CLASS.removed}>
                {segment.text}
              </del>
            );
          }
          return <span key={index}>{segment.text}</span>;
        })}
      </pre>
    </div>
  );
}
