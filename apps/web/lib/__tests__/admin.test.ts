//---------------
// Tests for lib/admin — the admin allowlist.
//---------------

import { describe, it, expect, beforeEach } from 'vitest';

import { isAdminUser } from '../admin';

beforeEach(() => {
  delete process.env.ADMIN_USER_IDS;
});

describe('isAdminUser', () => {
  it('returns true for a listed user id', () => {
    process.env.ADMIN_USER_IDS = 'user-1,user-2';
    expect(isAdminUser('user-1')).toBe(true);
    expect(isAdminUser('user-2')).toBe(true);
  });

  it('returns false for anyone not listed', () => {
    process.env.ADMIN_USER_IDS = 'user-1';
    expect(isAdminUser('user-9')).toBe(false);
  });

  it('returns false when the allowlist is unset or empty', () => {
    expect(isAdminUser('user-1')).toBe(false);
    process.env.ADMIN_USER_IDS = '  ';
    expect(isAdminUser('user-1')).toBe(false);
  });

  it('trims whitespace around entries', () => {
    process.env.ADMIN_USER_IDS = ' user-1 , user-2 ';
    expect(isAdminUser('user-1')).toBe(true);
  });
});
