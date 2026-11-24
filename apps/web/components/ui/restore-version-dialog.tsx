'use client';

import { useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { SpinnerIcon } from '@/lib/ui';

export interface RestoreVersionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
}

export default function RestoreVersionDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  cancelLabel,
  confirmLabel,
  pending = false,
}: RestoreVersionDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim/60" />
        <DialogPrimitive.Content
          data-testid="restore-dialog"
          aria-label={title}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-1/2 rounded-2xl bg-card p-6 shadow-xl"
        >
          <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-ink">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-5 text-muted-text">{body}</DialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              data-testid="restore-cancel-button"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted-text transition-colors hover:border-muted-text hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              onClick={onClose}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              data-testid="restore-confirm-button"
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? <span className="[&>svg]:size-4"><SpinnerIcon /></span> : null}
              {confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
