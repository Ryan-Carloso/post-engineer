import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';

import { vi } from 'vitest';

export function restorePinnedHttp(): void {
  const restore = (fn: unknown) => {
    if (typeof fn === 'function' && 'mockRestore' in fn && typeof fn.mockRestore === 'function') {
      fn.mockRestore();
    }
  };
  restore(http.request);
  restore(https.request);
}

/** Intercept requestPinned (http/https.request) so route tests skip real DNS. */
export function stubPinnedHttp(status: number, body: Uint8Array = new Uint8Array()): void {
  const impl = (
    _url: URL,
    _opts: object,
    callback?: (incoming: EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      resume: () => void;
    }) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: () => void;
    };
    req.destroy = () => undefined;
    req.end = () => {
      const incoming = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        resume: () => void;
      };
      incoming.statusCode = status;
      incoming.headers = { 'content-type': 'image/png' };
      incoming.resume = () => undefined;
      callback?.(incoming);
      queueMicrotask(() => {
        if (body.byteLength) incoming.emit('data', Buffer.from(body));
        incoming.emit('end');
      });
    };
    return req;
  };
  vi.spyOn(http, 'request').mockImplementation(impl as never);
  vi.spyOn(https, 'request').mockImplementation(impl as never);
}
