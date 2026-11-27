import { z } from 'zod';

type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface EndpointDefinition<
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

export type BodyOf<Endpoint extends { body?: z.ZodType | undefined }> =
  [Exclude<Endpoint['body'], undefined>] extends [never]
    ? never
    : Exclude<Endpoint['body'], undefined> extends z.ZodType
    ? z.input<Exclude<Endpoint['body'], undefined>>
    : never;

export type ResponseOf<Endpoint extends { response: z.ZodType }> = Endpoint['response'] extends z.ZodType
  ? z.output<Endpoint['response']>
  : never;
