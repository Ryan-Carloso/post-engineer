import { describe, expect, it } from 'vitest';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

describe('getAccountIdsFromFormData', () => {
  it('normalizes repeated account IDs and removes blanks/duplicates', () => {
    const formData = new FormData();
    formData.append('accountIds', ' account-1 ');
    formData.append('accountIds', '');
    formData.append('accountIds', 'account-1');
    formData.append('accountIds', 'account-2');

    expect(getAccountIdsFromFormData(formData, 'accountIds')).toEqual(['account-1', 'account-2']);
  });
});
