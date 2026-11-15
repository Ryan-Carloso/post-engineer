// Shared endpoint definition: the single source of truth for one web API
// exchange. Both apps generate a copy of this file (see
// scripts/sync-contracts.mjs) so renaming a field fails typecheck in
// apps/web and apps/mcp in the same change. Imports only zod so the
// same bytes compile under the web bundler and the MCP NodeNext mode.
import { z } from 'zod';

export type EndpointMethod = 'GET' | 'POST';

export interface EndpointDefinition<
  Body extends z.ZodType | undefined,
  Query extends z.ZodType | undefined,
  Response extends z.ZodType,
  Path extends string,
> {
  method: EndpointMethod;
  path: Path;
  body?: Body;
  query?: Query;
  response: Response;
}

/** Define one endpoint contract. The literal path is preserved in the type
 * so ParamsOf can read its `:param` segments. `Body`/`Query` default to
 * `undefined` so an omitted optional schema stays `undefined` (not the
 * bare `ZodType`) in the returned definition. */
export function defineEndpoint<
  Body extends z.ZodType | undefined = undefined,
  Query extends z.ZodType | undefined = undefined,
  Response extends z.ZodType = z.ZodType,
  Path extends string = string,
>(config: {
  method: EndpointMethod;
  path: Path;
  body?: Body;
  query?: Query;
  response: Response;
}): EndpointDefinition<Body, Query, Response, Path> {
  return config;
}

/** Request body input type (`z.input` of the `body` schema). Indexed
 * access is used (not infer) so an optional `body?` property keeps its
 * schema type instead of widening to `unknown`. */
export type BodyOf<Endpoint extends { body?: z.ZodType | undefined }> =
  [Exclude<Endpoint['body'], undefined>] extends [never]
    ? never
    : Exclude<Endpoint['body'], undefined> extends z.ZodType
    ? z.input<Exclude<Endpoint['body'], undefined>>
    : never;

/** Query input type (`z.input` of the `query` schema). */
export type QueryOf<Endpoint extends { query?: z.ZodType | undefined }> =
  [Exclude<Endpoint['query'], undefined>] extends [never]
    ? never
    : Exclude<Endpoint['query'], undefined> extends z.ZodType
    ? z.input<Exclude<Endpoint['query'], undefined>>
    : never;

/** Response output type (`z.output` of the `response` schema). */
export type ResponseOf<Endpoint extends { response: z.ZodType }> = Endpoint['response'] extends z.ZodType
  ? z.output<Endpoint['response']>
  : never;

/** Path params from a path template: each `:name` segment becomes a
 * `string` field. A path without segments is an empty record. */
export type ParamsOf<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Name}/${infer After}`
    ? { [Key in Name]: string } & ParamsOf<`/${After}`>
    : { [Key in Rest]: string }
  : Record<never, never>;
