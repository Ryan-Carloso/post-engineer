import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

import { notifyIfSessionExpired } from '@/lib/session-expiry';
import { useKeyConnect } from '../use-key-connect';

const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

function setup(rejectedMessage?: (code: unknown) => string) {
  const onConnected = vi.fn();
  const hook = renderHook(() => useKeyConnect({
    endpoint: '/api/demo-connect',
    fields: (handle, secret) => ({ name: handle, key: secret }),
    failureMessage: 'failed',
    rejectedMessage,
    onConnected,
  }));
  return { hook, onConnected };
}

async function submit(hook: ReturnType<typeof setup>['hook'], handle: string, secret: string): Promise<void> {
  act(() => hook.result.current.show());
  act(() => hook.result.current.dialogProps.onHandleChange(handle));
  act(() => hook.result.current.dialogProps.onPasswordChange(secret));
  await act(async () => hook.result.current.dialogProps.onSubmit());
}

describe('useKeyConnect', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the trimmed handle and the secret, then closes and reports success', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const { hook, onConnected } = setup();
    await submit(hook, '  me  ', ' key ');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo-connect');
    const body = init.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) return;
    expect(body.get('name')).toBe('me');
    expect(body.get('key')).toBe(' key ');
    expect(onConnected).toHaveBeenCalledOnce();
    expect(hook.result.current.open).toBe(false);
    expect(hook.result.current.dialogProps.handle).toBe('');
  });

  it('does not post while a field is blank', async () => {
    const { hook } = setup();
    await submit(hook, 'me', '   ');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the failure message and clears only the secret on a rejected request', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"X"}', { status: 400 }));
    const { hook, onConnected } = setup();
    await submit(hook, 'me', 'key');
    expect(notifyIfSessionExpired).toHaveBeenCalled();
    expect(hook.result.current.dialogProps.error).toBe('failed');
    expect(hook.result.current.dialogProps.appPassword).toBe('');
    expect(hook.result.current.dialogProps.handle).toBe('me');
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('maps the error code of a rejected request when a mapper is given', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"BAD_KEY"}', { status: 400 }));
    const { hook } = setup((code) => `rejected:${String(code)}`);
    await submit(hook, 'me', 'key');
    expect(hook.result.current.dialogProps.error).toBe('rejected:BAD_KEY');
  });

  it('passes an undefined code when the rejected body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));
    const { hook } = setup((code) => `rejected:${String(code)}`);
    await submit(hook, 'me', 'key');
    expect(hook.result.current.dialogProps.error).toBe('rejected:undefined');
  });

  it('shows the failure message when the request throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { hook } = setup((code) => `rejected:${String(code)}`);
    await submit(hook, 'me', 'key');
    expect(hook.result.current.dialogProps.error).toBe('failed');
    expect(hook.result.current.dialogProps.pending).toBe(false);
  });

  it('opens prefilled with a handle and closes on demand', () => {
    const { hook } = setup();
    act(() => hook.result.current.show('prefilled'));
    expect(hook.result.current.open).toBe(true);
    expect(hook.result.current.dialogProps.handle).toBe('prefilled');
    act(() => hook.result.current.dialogProps.onClose());
    expect(hook.result.current.open).toBe(false);
  });
});
