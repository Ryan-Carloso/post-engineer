'use client';

import { useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';

type ConfirmDialogTone = 'default' | 'destructive';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  detail?: ReactNode;
  tone?: ConfirmDialogTone;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
}

const CONFIRM_TONE_CLASS: Record<ConfirmDialogTone, string> = {
  default: 'bg-brand text-white hover:bg-brand-hover',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
};

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  detail,
  tone = 'default',
  cancelLabel,
  confirmLabel,
  pending = false,
}: ConfirmDialogProps): ReactNode {
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
          data-testid="confirm-dialog"
          aria-label={title}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-1/2 rounded-2xl bg-card p-6 shadow-xl"
        >
          <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-ink">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-5 text-muted-text">{body}</DialogPrimitive.Description>
          {detail === undefined ? null : (
            <p
              data-testid="confirm-dialog-detail"
              className="mt-4 flex items-center gap-2 truncate rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">{detail}</span>
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              data-testid="confirm-dialog-cancel"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted-text transition-colors hover:border-muted-text hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              onClick={onClose}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              data-testid="confirm-dialog-confirm"
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                CONFIRM_TONE_CLASS[tone],
              )}
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
