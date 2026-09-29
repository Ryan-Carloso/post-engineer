'use client';

import { Suspense } from 'react';
import BatchForm from './batch-form';

//---------------
// SchedulePage — manual video batches only (for now).
//
// The recurring/one-off schedule form was removed: the engine no longer
// does automatic scheduling. This page is just the batch flow — the user
// requests N videos, pays upfront, and the engine generates + publishes
// each one at its scheduled time.
//---------------

export default function SchedulePage() {
  return (
    <Suspense fallback={<ScheduleSkeleton />}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <BatchForm />
      </div>
    </Suspense>
  );
}

//---------------
// ScheduleSkeleton — placeholder enquanto o formulário carrega.
//---------------
const ScheduleSkeleton = () => (
  <div className="mx-auto w-full max-w-3xl space-y-5" aria-hidden="true">
    <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
    <div className="h-64 animate-pulse rounded-2xl bg-neutral-200" />
  </div>
);
