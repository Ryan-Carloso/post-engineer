import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPinned } from '../pinned-request';

type PinnedLookup = (
  hostname: string,
  options: { all?: boolean },
  callback: (error: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
) => void;

function stubTlsConnect(
  onConnect: (options: tls.ConnectionOptions, socket: net.Socket) => void,
): void {
  vi.spyOn(tls, 'connect').mockImplementation(((options: tls.ConnectionOptions) => {
    const socket = new net.Socket();
    queueMicrotask(() => onConnect(options, socket));
    return socket;
  }) as typeof tls.connect);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestPinned dials the validated address', () => {
  it('asks the socket lookup for the pinned addresses and keeps the URL host', async () => {
    const answers: unknown[] = [];
    const singles: Array<{ address: unknown; family: unknown }> = [];
    const targets: Array<{ host?: string; port?: number; servername?: string }> = [];
    stubTlsConnect((options, socket) => {
      targets.push({ host: options.host, port: options.port, servername: options.servername });
      const lookup = options.lookup as PinnedLookup | undefined;
      lookup?.(options.host ?? '', { all: true }, (_error, address) => {
        answers.push(address);
      });
      lookup?.(options.host ?? '', {}, (_error, address, family) => {
        singles.push({ address, family });
      });
      socket.destroy(new Error('stopped'));
    });

    await expect(
      requestPinned('https://pinned.invalid/a.png', ['93.184.215.14', '2606:4700:4700::1111'], {
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('stopped');
    await expect(
      requestPinned('https://pinned.invalid/a.png', ['2606:4700:4700::1111'], { timeoutMs: 1000 }),
    ).rejects.toThrow('stopped');

    expect(targets).toEqual([
      { host: 'pinned.invalid', port: 443, servername: 'pinned.invalid' },
      { host: 'pinned.invalid', port: 443, servername: 'pinned.invalid' },
    ]);
    expect(answers[0]).toEqual([
      { address: '93.184.215.14', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    expect(singles[0]).toEqual({ address: '93.184.215.14', family: 4 });
    expect(singles[1]).toEqual({ address: '2606:4700:4700::1111', family: 6 });
  });

  it('fails closed when the pinned address list is empty', async () => {
    let code: string | undefined;
    stubTlsConnect((options, socket) => {
      const lookup = options.lookup as PinnedLookup | undefined;
      lookup?.(options.host ?? '', { all: true }, (error) => {
        code = error?.code;
        socket.destroy(error ?? new Error('missing lookup error'));
      });
    });

    await expect(requestPinned('https://pinned.invalid/a.png', [], { timeoutMs: 1000 })).rejects.toThrow(
      /ENOTFOUND/,
    );
    expect(code).toBe('ENOTFOUND');
  });

  it('aborts when the pinned socket does not connect before the timeout', async () => {
    const connect = tls.connect;
    vi.spyOn(tls, 'connect').mockImplementation(((options: tls.ConnectionOptions) => {
      const hung: tls.ConnectionOptions = { ...options, lookup: () => undefined };
      return connect(hung);
    }) as typeof tls.connect);

    await expect(
      requestPinned('https://pinned.invalid/a.png', ['93.184.215.14'], { timeoutMs: 30 }),
    ).rejects.toThrow('timeout');
  });
});

describe('requestPinned response edges', () => {
  it('rejects a response that arrived with no status code', async () => {
    vi.spyOn(https, 'request').mockImplementation(((_url, _options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error?: Error) => void };
      let resumed = false;
      req.destroy = (error?: Error) => {
        req.emit('error', error ?? new Error('destroyed'));
        req.emit('close');
      };
      req.end = () => {
        const incoming = new EventEmitter() as EventEmitter & {
          statusCode: number | null;
          headers: IncomingMessage['headers'];
          resume: () => void;
        };
        incoming.statusCode = null;
        incoming.headers = {};
        incoming.resume = () => {
          resumed = true;
        };
        if (callback) callback(incoming as IncomingMessage);
        expect(resumed).toBe(true);
      };
      return req;
    }) as typeof https.request);

    await expect(
      requestPinned('https://pinned.invalid/a.png', ['93.184.215.14'], { timeoutMs: 1000 }),
    ).rejects.toThrow('response had no status');
  });
});
