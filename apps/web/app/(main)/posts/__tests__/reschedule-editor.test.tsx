import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-slot-reschedule', () => ({
  useRescheduleSlotMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'en', setLocale: vi.fn() }),
    I18nProvider,
  };
});

import { RescheduleEditor } from '../reschedule-editor';
import { utcToZonedInputValue } from '@/lib/timezone';

const SLOT_ID = 'slot-1';
const SLOT_AT = '2026-12-05T15:00:00.000Z';
const MOUNT_TIME = new Date('2026-11-28T12:00:00.000Z');

function renderEditor(timezone = 'UTC') {
  return render(
    <RescheduleEditor
      slotId={SLOT_ID}
      slotAt={SLOT_AT}
      timezone={timezone}
      onDone={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

function boundsAt(now: Date, timezone: string) {
  return {
    min: utcToZonedInputValue(new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(), timezone),
    max: utcToZonedInputValue(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), timezone),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MOUNT_TIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('RescheduleEditor', () => {
  it('starts the draft from the slot time', () => {
    renderEditor();
    const input = screen.getByLabelText('posts.reschedule') as HTMLInputElement;
    expect(input.value).toBe(utcToZonedInputValue(SLOT_AT, 'UTC'));
  });

  it('bounds the input between 3 hours and 30 days ahead of the mount time', () => {
    renderEditor();
    const input = screen.getByLabelText('posts.reschedule') as HTMLInputElement;
    const expected = boundsAt(MOUNT_TIME, 'UTC');
    expect(input.min).toBe(expected.min ?? '');
    expect(input.max).toBe(expected.max ?? '');
  });

  it('keeps the bounds anchored to the mount time when the timezone changes', () => {
    const { rerender } = renderEditor('UTC');
    const input = screen.getByLabelText('posts.reschedule') as HTMLInputElement;
    expect(input.min).toBe(boundsAt(MOUNT_TIME, 'UTC').min ?? '');
    vi.setSystemTime(new Date(MOUNT_TIME.getTime() + 10 * 60 * 1000));
    rerender(
      <RescheduleEditor
        slotId={SLOT_ID}
        slotAt={SLOT_AT}
        timezone="America/Sao_Paulo"
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const expected = boundsAt(MOUNT_TIME, 'America/Sao_Paulo');
    expect(input.min).toBe(expected.min ?? '');
    expect(input.max).toBe(expected.max ?? '');
  });
});
