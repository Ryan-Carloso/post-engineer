import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

import { formatDate, formatTime, resolveSlotAccounts } from '../post-card';

describe('formatDate and formatTime', () => {
  it('formats pt-BR dates with the month name in Portuguese', () => {
    expect(formatDate('2026-09-23T10:00:00.000Z', 'pt')).toMatch(/de set\. de 2026/);
    expect(formatTime('2026-09-23T10:00:00.000Z', 'pt')).toMatch(/^\d{1,2}:\d{2}$/);
  });
});

describe('resolveSlotAccounts', () => {
  it('resolves no accounts without a schedule', () => {
    expect(
      resolveSlotAccounts(undefined, [{ id: 'ch1', provider: 'youtube', label: 'Europa Na Estrada' }]),
    ).toEqual([]);
  });
});


