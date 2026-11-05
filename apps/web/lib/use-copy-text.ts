'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

//---------------
// useCopyText — one clipboard copy with a short "copied" confirmation.
// `copied` turns true only after the write actually landed: outside a
// secure context navigator.clipboard has no writeText, and the write can
// reject (permission denied). In both cases the label stays un-copied so
// the user never pastes an empty clipboard into their agent; a rejection
// is logged. The confirmation resets after COPY_CONFIRM_MS.
//---------------

export const COPY_CONFIRM_MS = 2500;

export function useCopyText(): { copied: boolean; copy: (text: string) => void } {
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
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
      })
      .catch((error: unknown) => {
        console.error('[copy] clipboard write failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  return { copied, copy };
}
