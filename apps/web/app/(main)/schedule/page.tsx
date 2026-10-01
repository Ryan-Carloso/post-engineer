'use client';

import { Suspense } from 'react';
import GenerateScheduleForm from './generate-schedule-form';

//---------------
// SchedulePage — the single generate+schedule experience.
//
// Video generation and scheduling are one operation now
// (POST /api/videos/generate-and-schedule): this page renders the unified
// form. The Suspense boundary is required because the form reads the
// ?personaId= search param (next/navigation's useSearchParams).
//---------------

export default function SchedulePage() {
  return (
    <Suspense fallback={<ScheduleSkeleton />}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <GenerateScheduleForm />
      </div>
    </Suspense>
  );
}

//---------------
// ScheduleSkeleton — placeholder while the form loads.
//---------------
const ScheduleSkeleton = () => (
  <div className="mx-auto w-full max-w-3xl space-y-5" aria-hidden="true">
    <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
    <div className="h-64 animate-pulse rounded-2xl bg-neutral-200" />
  </div>
);
