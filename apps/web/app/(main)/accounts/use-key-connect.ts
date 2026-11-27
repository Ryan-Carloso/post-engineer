'use client';

import { useState } from 'react';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

interface KeyConnectOptions {
  endpoint: string;
  fields: (handle: string, secret: string) => Record<string, string>;
  failureMessage: string;
  rejectedMessage?: (code: unknown) => string;
  onConnected: () => void;
}

export interface KeyConnect {
  open: boolean;
  show: (handle?: string) => void;
  dialogProps: {
    handle: string;
    appPassword: string;
    error: string | null;
    pending: boolean;
    onHandleChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onSubmit: () => void;
    onClose: () => void;
  };
}

function errorCode(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
}

export function useKeyConnect({ endpoint, fields, failureMessage, rejectedMessage, onConnected }: KeyConnectOptions): KeyConnect {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (): Promise<void> => {
    if (!handle.trim() || !secret.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      for (const [name, value] of Object.entries(fields(handle.trim(), secret))) formData.append(name, value);
      const response = await fetch(endpoint, { method: 'POST', body: formData });
      if (!response.ok) {
        notifyIfSessionExpired(response);
        setError(rejectedMessage === undefined ? failureMessage : rejectedMessage(errorCode(await response.json().catch(() => null))));
        setSecret('');
        return;
      }
      setOpen(false);
      setHandle('');
      setSecret('');
      onConnected();
    } catch {
      setError(failureMessage);
      setSecret('');
    } finally {
      setPending(false);
    }
  };

  const show = (nextHandle?: string): void => {
    if (nextHandle !== undefined) setHandle(nextHandle);
    setOpen(true);
  };

  return {
    open,
    show,
    dialogProps: {
      handle,
      appPassword: secret,
      error,
      pending,
      onHandleChange: setHandle,
      onPasswordChange: setSecret,
      onSubmit: () => void connect(),
      onClose: () => setOpen(false),
    },
  };
}
