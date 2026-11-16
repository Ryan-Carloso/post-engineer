import { describe, expect, it } from 'vitest';
import { CreateExperimentSchema as ContractSchema } from '../contracts/experiments.js';
import { CreateExperimentSchema as ToolSchema } from '../tools-experiments.js';

// The `experiments` create action validates locally with a hand-written
// shape (tools-experiments.ts) before POSTing to the route, whose body is
// the shared contract (shared/contracts/experiments.ts). The shape is NOT
// derived from the contract: the limits constants are shared via the
// limits.ts re-export, but the validation refinements (.uuid(), .int(),
// the blank-text refine, the duplicate-variant rule, strictness) are
// re-typed by hand. A one-sided edit would make the MCP accept what the
// route rejects (blank name forwarded, route 400s) or reject what the
// route accepts, with no CI failure. This test pins the two schemas to
// identical accept/reject sets on the fields they share, so either side
// drifting breaks the build.
//
// Deliberate differences, pinned separately below, not in the table:
// - the tool has no `variable` field: it only creates hook experiments and
//   the handler hardcodes variable: 'hook';
// - the tool defaults an omitted targetPairs to 6; the contract requires it.

const VARIANTS = [
  { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
  { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
];

function valid(): Record<string, unknown> {
  return { name: 'Hook test', variable: 'hook', targetPairs: 6, variants: VARIANTS };
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ['valid payload', valid()],
  ['blank name', { ...valid(), name: '   ' }],
  ['empty name', { ...valid(), name: '' }],
  ['name over the limit', { ...valid(), name: 'x'.repeat(121) }],
  ['blank variant name', { ...valid(), variants: [{ ...VARIANTS[0], name: '  ' }, VARIANTS[1]] }],
  ['blank variant description', { ...valid(), variants: [VARIANTS[0], { ...VARIANTS[1], description: '   ' }] }],
  ['variant description over the limit', { ...valid(), variants: [VARIANTS[0], { ...VARIANTS[1], description: 'x'.repeat(501) }] }],
  ['non-uuid personaId', { ...valid(), personaId: 'not-a-uuid' }],
  ['null personaId', { ...valid(), personaId: null }],
  ['omitted personaId', valid()],
  ['targetPairs below the minimum', { ...valid(), targetPairs: 2 }],
  ['targetPairs above the maximum', { ...valid(), targetPairs: 21 }],
  ['non-integer targetPairs', { ...valid(), targetPairs: 2.5 }],
  ['string targetPairs', { ...valid(), targetPairs: '6' }],
  ['one variant', { ...valid(), variants: [VARIANTS[0]] }],
  ['three variants', { ...valid(), variants: [...VARIANTS, { variantId: 'hook-third', name: 'Third', description: 'third' }] }],
  ['duplicate variantIds', { ...valid(), variants: [VARIANTS[0], { ...VARIANTS[1], variantId: 'hook-calm' }] }],
  ['uppercase variantId', { ...valid(), variants: [{ variantId: 'A', name: 'a', description: 'a' }, VARIANTS[1]] }],
  ['variantId with a space', { ...valid(), variants: [{ variantId: 'hook calm', name: 'a', description: 'a' }, VARIANTS[1]] }],
  ['unknown top-level key', { ...valid(), extra: true }],
  ['unknown variant key', { ...valid(), variants: [{ ...VARIANTS[0], extra: true }, VARIANTS[1]] }],
];

describe('experiments create: tool schema matches the shared contract', () => {
  it.each(CASES)('%s: tool and contract agree on accept/reject', (_label, contractInput) => {
    const { variable: _variable, ...toolInput } = contractInput;
    const contract = ContractSchema.safeParse(contractInput);
    const tool = ToolSchema.safeParse(toolInput);
    expect(tool.success).toBe(contract.success);
  });

  it('defaults an omitted targetPairs to 6 and the defaulted request passes the contract', () => {
    const { variable: _variable, targetPairs: _targetPairs, ...toolInput } = valid();
    const tool = ToolSchema.safeParse(toolInput);
    expect(tool.success).toBe(true);
    expect(tool.data?.targetPairs).toBe(6);
    expect(ContractSchema.safeParse({ ...tool.data, variable: 'hook' }).success).toBe(true);
  });

  it('has no variable field: the tool only creates hook experiments', () => {
    const { variable: _variable, ...toolInput } = valid();
    expect(ToolSchema.safeParse({ ...toolInput, variable: 'hook' }).success).toBe(false);
  });
});
