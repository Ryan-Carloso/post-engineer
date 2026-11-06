'use client';

//---------------
// DisconnectAccountDialog — destructive confirmation before removing a
// connected social account. Built on the Radix dialog primitives: Escape
// closes, focus is trapped inside the panel (and restored on close), and
// the content unmounts when closed so the next open starts clean.
// Initial focus lands on the cancel button, never the confirm.
//---------------

import { useEffect, useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { SpinnerIcon } from '@/lib/ui';

export interface DisconnectAccountDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  accountName: string;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
}

export default function DisconnectAccountDialog({
  open,
  onClose,
  onConfirm,
  accountName,
  title,
  body,
  cancelLabel,
  confirmLabel,
  pending = false,
}: DisconnectAccountDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-neutral-950/60" />
        <DialogPrimitive.Content
          data-testid="disconnect-dialog"
          aria-label={title}
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-1/2 rounded-2xl bg-white p-6 shadow-xl"
          onInteractOutside={(event) => { if (!pending) { event.preventDefault(); onClose(); } }}
        >
          <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-[#101728]">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-5 text-[#718096]">{body}</DialogPrimitive.Description>
          <p
            data-testid="disconnect-dialog-account"
            className="mt-4 flex items-center gap-2 truncate rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-semibold text-[#101728]"
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate">{accountName}</span>
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              data-testid="disconnect-cancel-button"
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900"
              onClick={onClose}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              data-testid="disconnect-confirm-button"
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
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
