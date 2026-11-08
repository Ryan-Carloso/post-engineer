import { describe, expect, it } from 'vitest';
import {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIABLES,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
} from '@/lib/experiments/limits';
import { experimentOperationSchemas } from '../../../scripts/openapi-experiments-schemas.mjs';

//---------------
// The OpenAPI schemas repeat the experiment limits as literals (the
// generator is plain .mjs and cannot import TypeScript). Pin them to
// limits.ts so the published contract never drifts from what the routes
// accept.
//---------------

interface Schema {
  properties: Record<string, Record<string, unknown> & { items?: Schema }>;
}

const passthrough = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const operations = experimentOperationSchemas({ success: passthrough, object: passthrough, anyObject: {}, str: {} }) as Record<
  string,
  { request?: Schema }
>;

describe('experiment OpenAPI schemas match lib/experiments/limits.ts', () => {
  const create = operations['POST /api/experiments'].request as Schema;
  const variant = create.properties.variants.items as Schema;

  it('create request limits', () => {
    expect(create.properties.name).toMatchObject({ maxLength: EXPERIMENT_NAME_MAX_LENGTH });
    expect(create.properties.variable).toMatchObject({ enum: [...EXPERIMENT_VARIABLES] });
    expect(create.properties.targetPairs).toMatchObject({ minimum: EXPERIMENT_TARGET_PAIRS_MIN, maximum: EXPERIMENT_TARGET_PAIRS_MAX });
    expect(variant.properties.name).toMatchObject({ maxLength: EXPERIMENT_VARIANT_NAME_MAX_LENGTH });
    expect(variant.properties.description).toMatchObject({ maxLength: EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH });
    expect(variant.properties.variantId).toMatchObject({ pattern: EXPERIMENT_VARIANT_ID_PATTERN.source });
  });
});
