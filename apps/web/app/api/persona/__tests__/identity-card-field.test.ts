import { describe, expect, it } from 'vitest';
import { IDENTITY_CARD_MAX_BYTES } from '@/lib/contracts/persona-identity-card';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';
import { parseIdentityCardField } from '../identity-card-field';

describe('parseIdentityCardField', () => {
  it.each([[null], [''], ['   '], ['\n']])('treats %j as absent', (entry) => {
    expect(parseIdentityCardField(entry)).toEqual({ status: 'absent' });
  });

  it('treats the JSON literal null as a clear request', () => {
    expect(parseIdentityCardField('null')).toEqual({ status: 'clear' });
    expect(parseIdentityCardField(' null ')).toEqual({ status: 'clear' });
  });

  it('returns the card for a valid JSON string', () => {
    expect(parseIdentityCardField(JSON.stringify(FIXTURE_CARD))).toEqual({ status: 'set', card: FIXTURE_CARD });
  });

  it('rejects invalid JSON, unknown versions, unknown keys and over-size bodies', () => {
    expect(parseIdentityCardField('{not json')).toEqual({ status: 'invalid', error: 'identityCard: not valid JSON' });
    expect(parseIdentityCardField(JSON.stringify({ ...FIXTURE_CARD, version: 3 }))).toEqual({
      status: 'invalid',
      error: 'identityCard.version: unsupported version',
    });
    expect(parseIdentityCardField(JSON.stringify({ ...FIXTURE_CARD, extra: 1 }))).toEqual({
      status: 'invalid',
      error: 'identityCard: unknown field',
    });
    expect(parseIdentityCardField(' '.repeat(IDENTITY_CARD_MAX_BYTES) + 'x')).toEqual({
      status: 'invalid',
      error: `identityCard: at most ${IDENTITY_CARD_MAX_BYTES} bytes`,
    });
  });

  it('rejects an uploaded file in the text field', () => {
    const file = new File(['x'], 'card.json', { type: 'application/json' });
    expect(parseIdentityCardField(file)).toEqual({ status: 'invalid', error: 'identityCard: must be a JSON text field' });
  });

  it('rejects JSON that is not a card object', () => {
    for (const raw of ['[]', '"x"', '12', 'true']) {
      expect(parseIdentityCardField(raw).status).toBe('invalid');
    }
  });
});
