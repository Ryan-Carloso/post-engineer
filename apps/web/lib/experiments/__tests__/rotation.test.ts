import { describe, expect, it } from 'vitest';
import { distributeSlots } from '@/lib/schedule/slot-distribution';
import { latinSquareRotation } from '../rotation';

const PER_VARIANT = [5, 6, 7, 10, 13, 15];
const TIME_SETS = [['09:00'], ['09:00', '18:00'], ['08:00', '12:00', '19:00'], ['07:00', '10:00', '13:00', '16:00', '19:00']];

function rotationFor(variants: number, perVariant: number, times: string[], startAtISO = '2026-12-01T00:00:00Z') {
  const slots = distributeSlots({ startAtISO, times, timezone: 'UTC', count: variants * perVariant });
  return latinSquareRotation(slots, variants, perVariant);
}

describe('latinSquareRotation', () => {
  it('starts at the variant (dayIndex + timeIndex) modulo the variant count when the column quotas are tied', () => {
    const rotated = rotationFor(2, 4, ['09:00', '18:00']);
    expect(rotated.map((entry) => entry.variantIndex)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it('gives every variant exactly perVariant videos, numbered 0..perVariant-1 in time order', () => {
    for (let variants = 2; variants <= 5; variants += 1) {
      for (const perVariant of PER_VARIANT) {
        for (const times of TIME_SETS) {
          const rotated = rotationFor(variants, perVariant, times);
          for (let variant = 0; variant < variants; variant += 1) {
            const mine = rotated.filter((entry) => entry.variantIndex === variant);
            expect(mine.map((entry) => entry.videoIndex)).toEqual(Array.from({ length: perVariant }, (_, index) => index));
          }
        }
      }
    }
  });

  it('keeps each variant within one video of the others at every time of day', () => {
    for (let variants = 2; variants <= 5; variants += 1) {
      for (const perVariant of PER_VARIANT) {
        for (const times of TIME_SETS) {
          const rotated = rotationFor(variants, perVariant, times);
          for (let timeIndex = 0; timeIndex < times.length; timeIndex += 1) {
            const counts = Array.from({ length: variants }, () => 0);
            for (const entry of rotated) {
              if (entry.slot.timeIndex === timeIndex) counts[entry.variantIndex] += 1;
            }
            expect(Math.max(...counts) - Math.min(...counts), `${variants}x${perVariant} ${times.join(',')} t${timeIndex}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('never puts the same variant at the same time of day on two consecutive days', () => {
    for (let variants = 2; variants <= 5; variants += 1) {
      for (const perVariant of PER_VARIANT) {
        for (const times of TIME_SETS) {
          const rotated = rotationFor(variants, perVariant, times);
          for (const entry of rotated) {
            const next = rotated.find(
              (other) => other.slot.timeIndex === entry.slot.timeIndex && other.slot.dayIndex === entry.slot.dayIndex + 1,
            );
            if (next !== undefined) {
              expect(next.variantIndex, `${variants}x${perVariant} ${times.join(',')}`).not.toBe(entry.variantIndex);
            }
          }
        }
      }
    }
  });

  it('spreads the extra video of an uneven column without repeating a variant on consecutive days', () => {
    const rotated = rotationFor(2, 5, ['08:00', '12:00', '19:00']);
    const column = (timeIndex: number) =>
      rotated.filter((entry) => entry.slot.timeIndex === timeIndex).map((entry) => entry.variantIndex);
    expect(column(0)).toEqual([0, 1, 0, 1]);
    expect(column(1)).toEqual([0, 1, 0]);
    expect(column(2)).toEqual([1, 0, 1]);
  });

  it('rejects a slot list that does not match variants times perVariant', () => {
    const slots = distributeSlots({ startAtISO: '2026-12-01T00:00:00Z', times: ['09:00'], timezone: 'UTC', count: 5 });
    expect(() => latinSquareRotation(slots, 2, 2)).toThrow(RangeError);
    expect(() => latinSquareRotation(slots, 0, 5)).toThrow(RangeError);
    expect(() => latinSquareRotation(slots, 5, 0)).toThrow(RangeError);
  });
});
