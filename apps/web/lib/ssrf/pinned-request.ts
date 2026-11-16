// Connect to a URL using only the addresses a prior public-IP check accepted.
// A second DNS answer (rebinding to 127.0.0.1 or link-local) cannot move the
// socket. Callers pass the validated list; this module does not re-resolve.

import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';

export interface PinnedRequestOptions {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  timeoutMs: number;
  /** When set, a body larger than this resolves as HTTP 413 instead of buffering. */
  maxBytes?: number;
}

type PinnedLookup = NonNullable<http.RequestOptions['lookup']>;

function pinnedLookup(addresses: readonly string[]): PinnedLookup {
  return (_hostname, options, callback) => {
    // Node 20+ connects with autoSelectFamily, which calls lookup with
    // { all: true } and expects an address array; the single-address form
    // then fails every hostname URL with ERR_INVALID_IP_ADDRESS.
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
    // public-IP check already accepted for this hop. The lookup below ignores
    // DNS and returns only that set, so the socket cannot rebind. Redirects
    // are not followed: a 3xx is returned to the caller (redirect: 'error' /
    // manual handling). https and the timeout are the caller's options.
    const req = transport.request(
      parsed,
      {
        method,
        headers: options.headers,
        lookup: pinnedLookup(addresses),
      },
      (incoming) => {
        const status = incoming.statusCode ?? 0;
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
