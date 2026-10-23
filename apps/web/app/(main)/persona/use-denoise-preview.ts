'use client';

import { useEffect, useState } from 'react';

import { fetchDenoisePreview } from '@/lib/cloned-voices-client';

//---------------
// useDenoisePreview — fetches the cleaned (denoised) take of a pending
// reference recording while "clean audio" is on, for the A/B listen before
// cloning. Revokes its object URL when the recording or the toggle changes.
//---------------
export function useDenoisePreview(
  pendingBlob: Blob | null,
  denoise: boolean,
): { cleanedUrl: string | null; cleaning: boolean; cleanFailed: boolean } {
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanFailed, setCleanFailed] = useState(false);

  useEffect(() => {
    setCleanedUrl(null);
    setCleanFailed(false);
    if (pendingBlob === null || !denoise) {
      setCleaning(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setCleaning(true);
    fetchDenoisePreview(pendingBlob)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.success) {
          objectUrl = URL.createObjectURL(result.audio);
          setCleanedUrl(objectUrl);
        } else {
          setCleanFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCleanFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCleaning(false);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [pendingBlob, denoise]);

  return { cleanedUrl, cleaning, cleanFailed };
}
