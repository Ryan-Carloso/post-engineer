import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import type { IncomingMessage } from 'node:http';

import { isPublicIp, unbracketIpLiteral } from './public-ip.js';

export type HostLookup = (hostname: string) => Promise<ReadonlyArray<{ address: string }>>;

export const defaultLookup: HostLookup = (hostname) => lookup(hostname, { all: true });

export interface PublicFetchSubject {
  readonly param: string;
  readonly noun: string;
}

export interface PublicFetchOptions {
  readonly subject: PublicFetchSubject;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly lookup?: HostLookup;
}

export async function assertPublicHost(
  hostname: string,
  resolve: HostLookup,
  subject: PublicFetchSubject,
): Promise<ReadonlyArray<{ address: string }>> {
  const bare = unbracketIpLiteral(hostname);
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = isIP(bare) ? [{ address: bare }] : await resolve(bare);
  } catch {
    throw new Error(`${subject.param} must point to a public host`);
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicIp(a.address))) {
    throw new Error(`${subject.param} must point to a public host`);
  }
  return addresses;
}

function pinnedLookup(addresses: ReadonlyArray<{ address: string }>): LookupFunction {
  return (hostname, options, callback) => {
    const wantedFamily = typeof options.family === 'number' ? options.family : 0;
    const matching = addresses.filter((a) => {
      const family = isIP(a.address);
      return wantedFamily === 0 || family === wantedFamily;
    });
    if (matching.length === 0) {
      const error = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: 'ENOTFOUND',
      });
      callback(error, '', 0);
      return;
    }
    if (options.all === true) {
      callback(
        null,
        matching.map((a) => ({ address: a.address, family: isIP(a.address) })),
        0,
      );
      return;
    }
    const first = matching[0];
    callback(null, first.address, isIP(first.address));
  };
}

async function readNodeBodyWithCap(
  response: IncomingMessage,
  maxBytes: number,
  subject: PublicFetchSubject,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of response) {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        response.destroy();
        throw new Error(`Downloaded ${subject.noun} exceeds ${maxBytes / (1024 * 1024)} MB`);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    response.destroy();
    throw error;
  }
  return Buffer.concat(chunks);
}

async function fetchPinned(
  parsed: URL,
  addresses: ReadonlyArray<{ address: string }>,
  signal: AbortSignal,
  options: PublicFetchOptions,
): Promise<{ buffer: Buffer; contentType: string }> {
  const { subject } = options;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(
      parsed.toString(),
      { lookup: pinnedLookup(addresses), signal },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    response.resume();
    throw new Error(`Failed to download ${subject.noun}: redirect not allowed`);
  }
  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error(`Failed to download ${subject.noun}: HTTP ${status}`);
  }
  const buffer = await readNodeBodyWithCap(response, options.maxBytes, subject);
  if (buffer.length === 0) {
    throw new Error(`Downloaded ${subject.noun} is empty`);
  }
  const contentTypeHeader = response.headers['content-type'];
  const contentType =
    (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ??
    'application/octet-stream';
  return { buffer, contentType };
}

export async function fetchPublicHttps(
  parsed: URL,
  options: PublicFetchOptions,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (parsed.protocol !== 'https:') {
    throw new Error(`${options.subject.param} must use https`);
  }
  const addresses = await assertPublicHost(
    parsed.hostname,
    options.lookup ?? defaultLookup,
    options.subject,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await fetchPinned(parsed, addresses, controller.signal, options);
  } finally {
    clearTimeout(timeout);
  }
}
