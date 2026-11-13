// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { savePersonaBinding } from '../create-binding';
import { setPersonaDefaultAccounts, type PersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { rollbackStoragePath } from '@/lib/persona-remote-face';

//---------------
// savePersonaBinding tests (issue #572): a coded lib error keeps its
// status (400/404), only genuine DB failures are a 500 — the rollback
// itself runs in every failure case, so no persona survives unbound.
//---------------

vi.mock('@/lib/persona-publishing-accounts', () => ({
  setPersonaDefaultAccounts: vi.fn(),
}));
vi.mock('@/lib/persona-remote-face', () => ({
  rollbackStoragePath: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockedSetBinding = vi.mocked(setPersonaDefaultAccounts);
const mockedRollbackStorage = vi.mocked(rollbackStoragePath);

function codedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}

function mockSupabase() {
  const eq = vi.fn(() => Promise.resolve({ error: null }));
  const deleteFn = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: deleteFn }));
  return { client: { from } as never, from, deleteFn, eq };
}

const BINDING: PersonaDefaultAccounts = {
  youtube: ['acct-1'],
  instagram: [],
  bluesky: [],
  linkedin: [],
  threads: [],
  facebook: [],
  pinterest: [],
  '3speak': [],
  rumble: [],
  fanvue: [],
};

describe('savePersonaBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when the binding saves', async () => {
    const { client } = mockSupabase();
    mockedSetBinding.mockResolvedValueOnce(BINDING);

    const result = await savePersonaBinding(client, 'user-1', 'persona-1', BINDING, null);

    expect(result).toEqual({ ok: true });
    expect(mockedRollbackStorage).not.toHaveBeenCalled();
  });

  it('maps INVALID_PROVIDER_ACCOUNT to a 400 and still rolls back', async () => {
    const { client, from, deleteFn, eq } = mockSupabase();
    mockedSetBinding.mockRejectedValueOnce(
      codedError('INVALID_PROVIDER_ACCOUNT', 'Account acct-1 is not a connected youtube account of this user.'),
    );

    const result = await savePersonaBinding(client, 'user-1', 'persona-1', BINDING, 'photo/path.png');

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'INVALID_PROVIDER_ACCOUNT',
      error: 'Account acct-1 is not a connected youtube account of this user.',
    });
    expect(from).toHaveBeenCalledWith('personas');
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('id', 'persona-1');
    expect(mockedRollbackStorage).toHaveBeenCalledWith(client, 'photo/path.png');
  });

  it('maps VALIDATION_FAILED to a 400 and still rolls back', async () => {
    const { client } = mockSupabase();
    mockedSetBinding.mockRejectedValueOnce(
      codedError('VALIDATION_FAILED', 'A persona must have at least one bound account.'),
    );

    const result = await savePersonaBinding(client, 'user-1', 'persona-1', { ...BINDING, youtube: [] }, null);

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      error: 'A persona must have at least one bound account.',
    });
    expect(mockedRollbackStorage).toHaveBeenCalledTimes(1);
  });

  it('maps PERSONA_NOT_FOUND to a 404 and still rolls back', async () => {
    const { client } = mockSupabase();
    mockedSetBinding.mockRejectedValueOnce(codedError('PERSONA_NOT_FOUND', 'Persona not found.'));

    const result = await savePersonaBinding(client, 'user-1', 'persona-1', BINDING, null);

    expect(result).toEqual({
      ok: false,
      status: 404,
      code: 'PERSONA_NOT_FOUND',
      error: 'Persona not found.',
    });
    expect(mockedRollbackStorage).toHaveBeenCalledTimes(1);
  });

  it('maps an uncoded DB failure to a 500 with the generic message', async () => {
    const { client } = mockSupabase();
    mockedSetBinding.mockRejectedValueOnce(new Error('Failed to save persona default accounts: db down'));

    const result = await savePersonaBinding(client, 'user-1', 'persona-1', BINDING, null);

    expect(result).toEqual({
      ok: false,
      status: 500,
      code: 'INTERNAL_ERROR',
      error: 'Failed to bind publishing accounts to the persona.',
    });
    expect(mockedRollbackStorage).toHaveBeenCalledTimes(1);
  });
});
