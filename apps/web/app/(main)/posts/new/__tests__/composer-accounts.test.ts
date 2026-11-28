import { describe, expect, it } from 'vitest';

import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import {
  preselectedAccounts,
  pruneAccounts,
  pruneDisconnectedAccounts,
} from '../composer-accounts';

describe('composer-accounts', () => {
  it('keeps only the accounts the media kind allows', () => {
    expect(pruneAccounts({ youtube: ['ch-1'], instagram: ['ig-1'] }, 'image')).toEqual({
      instagram: ['ig-1'],
    });
    expect(pruneAccounts({ youtube: ['ch-1'], instagram: ['ig-1'] }, 'video')).toEqual({
      youtube: ['ch-1'],
      instagram: ['ig-1'],
    });
    expect(pruneAccounts({ youtube: [] }, 'video')).toEqual({});
  });

  it('preselects the bound accounts the media kind allows without mutating them', () => {
    const bound = emptyPersonaDefaultAccounts();
    bound.youtube = ['ch-1'];
    bound.instagram = ['ig-1'];
    const image = preselectedAccounts(bound, 'image');
    expect(image).toEqual({ instagram: ['ig-1'] });
    expect(preselectedAccounts(bound, 'video')).toEqual({ youtube: ['ch-1'], instagram: ['ig-1'] });
    expect(image.instagram).not.toBe(bound.instagram);
    expect(bound.youtube).toEqual(['ch-1']);
  });

  it('drops the ids that are no longer connected', () => {
    const connected = new Set(['youtube\0ch-1', 'instagram\0ig-1']);
    expect(
      pruneDisconnectedAccounts({ youtube: ['ch-1', 'ch-2'], instagram: ['ig-1'] }, connected),
    ).toEqual({ youtube: ['ch-1'], instagram: ['ig-1'] });
    expect(pruneDisconnectedAccounts({ youtube: ['ch-2'] }, connected)).toEqual({});
    expect(pruneDisconnectedAccounts({}, connected)).toEqual({});
  });
});
