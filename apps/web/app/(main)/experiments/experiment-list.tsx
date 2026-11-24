'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ExperimentProgress } from '@/lib/contracts/experiments';
import { useCancelExperimentMutation, useExperimentsQuery } from '@/lib/experiments/instances-query';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

const CARD_CLASS = 'rounded-2xl border border-hairline bg-card shadow-[0_8px_24px_rgba(20,32,51,0.04)]';

export function ExperimentList(): React.ReactElement {
  const { t } = useI18n();
  const query = useExperimentsQuery();
  const cancel = useCancelExperimentMutation();
  const [cancelError, setCancelError] = useState(false);
  const experiments = query.data?.success === true ? query.data.experiments : [];

  return (
    <section className={cn(CARD_CLASS, 'flex flex-col gap-3 p-4 lg:p-5')}>
      <h2 className="text-sm font-semibold text-ink">{t('experiments.activeTitle')}</h2>
      {experiments.length === 0 ? (
        <p className="text-xs text-muted-text">{t('experiments.activeEmpty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {experiments.map((experiment) => (
            <ExperimentRow
              key={experiment.id}
              experiment={experiment}
              cancelling={cancel.isPending && cancel.variables === experiment.id}
              onCancel={() => {
                setCancelError(false);
                cancel.mutate(experiment.id, { onSuccess: (done) => { if (!done) setCancelError(true); }, onError: () => setCancelError(true) });
              }}
            />
          ))}
        </ul>
      )}
      {cancelError && <p className="text-xs text-destructive">{t('experiments.cancelError')}</p>}
    </section>
  );
}

function ExperimentRow({ experiment, cancelling, onCancel }: {
  experiment: ExperimentProgress;
  cancelling: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const total = experiment.progress.reduce((sum, prompt) => sum + prompt.total, 0);
  const published = experiment.progress.reduce((sum, prompt) => sum + prompt.published, 0);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 grow basis-60">
        <p className="truncate text-sm font-semibold text-ink">{experiment.name}</p>
        <p className="text-xs text-muted-text">
          {t('experiments.progress', { published, total })}
          {' · '}
          {t('experiments.perPrompt', { count: experiment.videosPerPrompt, perDay: experiment.postsPerDay })}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {experiment.progress.map((prompt) => (
            <li key={prompt.promptVersionId} className="text-xs text-muted-text">
              {prompt.promptVersionId}: {t('experiments.progress', { published: prompt.published, total: prompt.total })}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="outline">{t(experiment.status === 'active' ? 'experiments.statusActive' : 'experiments.statusCancelled')}</Badge>
        {experiment.status === 'active' && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="rounded-xl border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50"
          >
            {t(cancelling ? 'experiments.cancelling' : 'experiments.cancel')}
          </button>
        )}
      </div>
    </li>
  );
}
