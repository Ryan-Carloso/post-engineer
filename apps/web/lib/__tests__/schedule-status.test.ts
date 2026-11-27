import { describe, it, expect } from 'vitest';
import { mapSlot, type SlotRow } from '@/lib/schedule-status';

function row(partial: Partial<SlotRow> = {}): SlotRow {
  return {
    id: 'slot-1',
    schedule_id: 's1',
    slot_at: '2030-06-01T10:00:00.000Z',
    status: 'awaiting_approval',
    title: 'Held video',
    ...partial,
  };
}

describe('mapSlot', () => {
  it('carries the description and media the status response serves for awaiting slots', () => {
    const mapped = mapSlot(
      row({
        description: 'Edited outside.',
        media: { kind: 'image', url: 'https://example.com/signed.jpg', contentType: 'image/jpeg' },
      }),
    );

    expect(mapped.description).toBe('Edited outside.');
    expect(mapped.media).toEqual({
      kind: 'image',
      url: 'https://example.com/signed.jpg',
      contentType: 'image/jpeg',
    });
  });

  it('defaults a missing description and media to null', () => {
    const mapped = mapSlot(row());

    expect(mapped.description).toBeNull();
    expect(mapped.media).toBeNull();
  });

  it('narrows malformed media to null instead of passing it through', () => {
    const mapped = mapSlot(row({ media: { kind: 'bogus', url: null, contentType: null } as never }));

    expect(mapped.media).toBeNull();
  });
});
