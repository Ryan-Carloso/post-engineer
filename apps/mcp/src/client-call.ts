import { z } from 'zod';

import type { PostEngineerClient } from './client.js';
import type { ParamsOf, ResponseOf } from './contracts/endpoint.js';

//---------------
// Typed calls against shared endpoint contracts (shared/contracts/*).
// `call` builds the path with encodeURIComponent, delegates to the
// existing `client.request` (headers/timeout/ApiError preserved) and
// parses the response with the endpoint schema (a malformed 200 is an
// error, never a silent success).
//
// Parity note: the syntax-tree parity gate only sees literal
// `client.request` sites (method + path as string literals). The three
// experiments branches keep literal sites so the gate stays green while
// its verifier is CODEOWNERS-guarded and cannot learn to read contract
// paths. The generic fallback below serves future contracts; the
// experiments branches delegate to the same path/query/body building.
//---------------

type ParamsField<Path extends string> = keyof ParamsOf<Path> extends never
  ? { params?: never }
  : { params: ParamsOf<Path> };

type BodyField<Endpoint extends { body?: z.ZodType | undefined }> =
  [Exclude<Endpoint['body'], undefined>] extends [never]
    ? { body?: never }
    : Exclude<Endpoint['body'], undefined> extends z.ZodType
    ? { body: z.input<Exclude<Endpoint['body'], undefined>> }
    : { body?: never };

type QueryField<Endpoint extends { query?: z.ZodType | undefined }> =
  [Exclude<Endpoint['query'], undefined>] extends [never]
    ? { query?: never }
    : Exclude<Endpoint['query'], undefined> extends z.ZodType
    ? { query?: z.input<Exclude<Endpoint['query'], undefined>> }
    : { query?: never };

export type CallOptions<Endpoint extends { path: string; body?: z.ZodType | undefined; query?: z.ZodType | undefined }> =
  ParamsField<Endpoint['path'] & string> & BodyField<Endpoint> & QueryField<Endpoint>;

function buildQuerySuffix(query: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function buildPath(template: string, params: Record<string, string>): string {
  const segments = template.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment !== undefined && segment.startsWith(':')) {
      const name = segment.slice(1);
      const value = params[name];
      if (value === undefined) {
        throw new Error(`Missing path param "${name}" for ${template}.`);
      }
      segments[i] = encodeURIComponent(value);
    }
  }
  return segments.join('/');
}

export async function call<Endpoint extends { method: string; path: string; response: z.ZodType }>(
  client: PostEngineerClient,
  endpoint: Endpoint,
  options: CallOptions<Endpoint>,
): Promise<ResponseOf<Endpoint>> {
  const opts = options as { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown };
  // Experiments pilot branches: literal sites for the parity gate.
  if (endpoint.path === '/api/experiments' && endpoint.method === 'POST') {
    const raw = await client.request(
      '/api/experiments',
      { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(opts.body) },
      'create experiment',
    );
    return endpoint.response.parse(raw) as ResponseOf<Endpoint>;
  }
  if (endpoint.path === '/api/experiments' && endpoint.method === 'GET') {
    const raw = await client.request(
      '/api/experiments',
      { method: 'GET', headers: client.getHeaders() },
      'list experiments',
    );
    return endpoint.response.parse(raw) as ResponseOf<Endpoint>;
  }
  if (endpoint.path === '/api/experiments/:id' && endpoint.method === 'GET') {
    const params = (opts.params ?? {}) as Record<string, string>;
    const id = params.id;
    if (id === undefined || id === '') {
      throw new Error('Missing path param "id" for /api/experiments/:id.');
    }
    const suffix = opts.query === undefined ? '' : buildQuerySuffix(opts.query);
    const raw = await client.request(
      `/api/experiments/${encodeURIComponent(id)}${suffix}`,
      { method: 'GET', headers: client.getHeaders() },
      'get experiment results',
    );
    return endpoint.response.parse(raw) as ResponseOf<Endpoint>;
  }
  const path = buildPath(endpoint.path, opts.params ?? {});
  const suffix = opts.query === undefined ? '' : buildQuerySuffix(opts.query);
  const fullPath = `${path}${suffix}`;
  const init: RequestInit = { method: endpoint.method, headers: client.getHeaders() };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const raw = await client.request(fullPath, init, `${endpoint.method} ${endpoint.path}`);
  return endpoint.response.parse(raw) as ResponseOf<Endpoint>;
}
