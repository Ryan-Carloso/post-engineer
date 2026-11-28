'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const COPY_CONFIRM_MS = 2500;

export function useCopyText(onCopied?: () => void): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback((text: string): void => {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      console.error('[copy] clipboard API unavailable (insecure context)');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        onCopied?.();
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
      })
      .catch((error: unknown) => {
        console.error('[copy] clipboard write failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [onCopied]);

  return { copied, copy };
}
