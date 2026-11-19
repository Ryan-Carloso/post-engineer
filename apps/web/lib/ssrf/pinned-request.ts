import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';

export interface PinnedRequestOptions {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxBytes?: number;
}

type PinnedLookup = NonNullable<http.RequestOptions['lookup']>;

function pinnedLookup(addresses: readonly string[]): PinnedLookup {
  return (_hostname, options, callback) => {
    const pinned = addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));
    if (pinned.length === 0) {
      callback(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), '', 0);
      return;
    }
    if (options.all === true) {
      callback(null, pinned);
      return;
    }
    callback(null, pinned[0].address, pinned[0].family);
  };
}

function headersFrom(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  const contentType = incoming.headers['content-type'];
  if (typeof contentType === 'string') headers.set('content-type', contentType);
  const contentLength = incoming.headers['content-length'];
  if (typeof contentLength === 'string' && contentLength.length > 0) {
    headers.set('content-length', contentLength);
  }
  const location = incoming.headers.location;
  if (typeof location === 'string' && location.length > 0) {
    headers.set('location', location);
  }
  return headers;
}

export function requestPinned(
  url: string,
  addresses: readonly string[],
  options: PinnedRequestOptions,
): Promise<Response> {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const method = options.method ?? 'GET';
  return new Promise((resolve, reject) => {
    // codeql[js/request-forgery]: false positive — `addresses` is the set a
    const req = transport.request(
      parsed,
      {
        method,
        headers: options.headers,
        lookup: pinnedLookup(addresses),
      },
      (incoming) => {
        const status = incoming.statusCode;
        if (typeof status !== 'number') {
          incoming.resume();
          reject(new Error('response had no status'));
          return;
        }
        const headers = headersFrom(incoming);
        if (method === 'HEAD' || (status >= 300 && status < 400)) {
          incoming.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const maxBytes = options.maxBytes;
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (maxBytes !== undefined && size > maxBytes) {
            req.destroy();
            resolve(new Response(null, { status: 413 }));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('end', () => {
          resolve(new Response(Buffer.concat(chunks, size), { status, headers }));
        });
        incoming.on('error', reject);
      },
    );
    const deadline = setTimeout(() => {
      req.destroy(new Error('timeout'));
    }, options.timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end();
  });
}
