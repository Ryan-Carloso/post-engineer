// Generates apps/web/public/openapi.json from the MCP parity mapping.
// The mapping (apps/mcp/src/__tests__/parity-endpoint-tools.json) is the
// single list of Bearer-callable endpoints, so the spec never drifts from it.
// Run: node apps/web/scripts/generate-openapi.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentSchemas, operationSchemas } from './openapi-schemas.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mappingPath = join(root, 'apps/mcp/src/__tests__/parity-endpoint-tools.json');
const outPath = join(root, 'apps/web/public/openapi.json');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Version of the HTTP API contract, bumped by hand when the contract changes.
// Deliberately not the MCP package version: the MCP auto-bump rewrites only
// the MCP package.json and would leave the committed spec stale.
export const API_SPEC_VERSION = '1.0.1';

// `<method>_<first tool>`; when two endpoints share it (one MCP tool fronting
// two routes, e.g. connect_account), the last route segment disambiguates.
function buildOperationIds(mapping) {
  const base = (key) => `${key.split(' ')[0].toLowerCase()}_${mapping[key][0]}`;
  const counts = new Map();
  for (const key of Object.keys(mapping)) counts.set(base(key), (counts.get(base(key)) ?? 0) + 1);
  return new Map(
    Object.keys(mapping).map((key) => {
      const segment = key.split(' ')[1].split('/').pop().replace(/[^\w]/g, '_');
      return [key, counts.get(base(key)) > 1 ? `${base(key)}_${segment}` : base(key)];
    }),
  );
}

export function buildSpec(mapping, version) {
  const paths = {};
  const operationIds = buildOperationIds(mapping);
  for (const [key, tools] of Object.entries(mapping)) {
    const [method, route] = key.split(' ');
    if (!METHODS.includes(method) || !route.startsWith('/api/')) {
      throw new Error(`Unexpected mapping key: ${key}`);
    }
    const params = [...route.matchAll(/\[(?:\.\.\.)?(\w+)\]/g)].map((m) => m[1]);
    // OpenAPI path templating uses {name}; catch-all segments are flattened.
    const path = route.replace(/\[(?:\.\.\.)?(\w+)\]/g, '{$1}');
    const operation = {
      operationId: operationIds.get(key),
      summary: tools[0].replaceAll('_', ' '),
      tags: [route.split('/')[2]],
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Success. Engine-backed routes wrap the payload in { status, message, body }.' },
        400: { description: 'Invalid input.' },
        401: { description: 'Missing or invalid API key.' },
        404: { description: 'Resource not found.' },
        429: { description: 'Rate limited.' },
      },
    };
    const schemas = operationSchemas[key];
    if (schemas?.request !== undefined) {
      operation.requestBody = {
        required: true,
        content: { [schemas.contentType ?? 'application/json']: { schema: schemas.request } },
      };
    }
    if (schemas?.response !== undefined) {
      operation.responses[200] = {
        description: 'Success.',
        content: { [schemas.responseContent ?? 'application/json']: { schema: schemas.response } },
      };
    }
    // Route-specific statuses (402, 409, 410, 502, ...) a client must handle.
    for (const [status, description] of Object.entries(schemas?.extraResponses ?? {})) {
      operation.responses[status] = { description };
    }
    for (const status of Object.keys(operation.responses).filter((s) => s !== '200')) {
      operation.responses[status].content = {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      };
    }
    const parameters = [
      ...params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...(schemas?.query ?? []).map(({ name, required, enum: values }) => ({
        name,
        in: 'query',
        required,
        schema: values === undefined ? { type: 'string' } : { type: 'string', enum: values },
      })),
    ];
    if (parameters.length > 0) operation.parameters = parameters;
    if (schemas?.description !== undefined) operation.description = schemas.description;
    paths[path] = { ...paths[path], [method.toLowerCase()]: operation };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Post Engineer API',
      version,
      description:
        'Generate and schedule short videos for social accounts. Authenticate with an API key created in the dashboard: Authorization: Bearer <key>.',
    },
    servers: [{ url: 'https://post-engineer.com' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: componentSchemas,
    },
    paths,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));
  writeFileSync(outPath, `${JSON.stringify(buildSpec(mapping, API_SPEC_VERSION), null, 2)}\n`);
}
