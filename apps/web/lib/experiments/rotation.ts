import type { DistributedSlot } from '@/lib/schedule/slot-distribution';

export interface RotatedSlot {
  slot: DistributedSlot;
  variantIndex: number;
  videoIndex: number;
}

export function latinSquareRotation(
  slots: DistributedSlot[],
  variantCount: number,
  perVariant: number,
): RotatedSlot[] {
  if (!Number.isInteger(variantCount) || variantCount < 1) {
    throw new RangeError('variantCount must be a positive integer.');
  }
  if (!Number.isInteger(perVariant) || perVariant < 1) {
    throw new RangeError('perVariant must be a positive integer.');
  }
  if (slots.length !== variantCount * perVariant) {
    throw new RangeError('slots must hold exactly variantCount * perVariant entries.');
  }
  const columnSizes = new Map<number, number>();
  for (const slot of slots) columnSizes.set(slot.timeIndex, (columnSizes.get(slot.timeIndex) ?? 0) + 1);
  const quotas = columnQuotas(columnSizes, variantCount, perVariant);
  const placed: number[] = Array.from({ length: variantCount }, () => 0);
  const previousInColumn = new Map<number, number>();
  return slots.map((slot) => {
    const remaining = quotas.get(slot.timeIndex);
    if (remaining === undefined) throw new RangeError('slot has no column quota.');
    const previous = previousInColumn.get(slot.timeIndex);
    const preferred = (slot.dayIndex + slot.timeIndex) % variantCount;
    let variantIndex = -1;
    for (let offset = 0; offset < variantCount; offset += 1) {
      const candidate = (preferred + offset) % variantCount;
      if (remaining[candidate] === 0 || (candidate === previous && variantCount > 1)) continue;
      if (variantIndex === -1 || remaining[candidate] > remaining[variantIndex]) variantIndex = candidate;
    }
    if (variantIndex === -1) throw new RangeError('no variant has quota left for this slot.');
    remaining[variantIndex] -= 1;
    previousInColumn.set(slot.timeIndex, variantIndex);
    const videoIndex = placed[variantIndex];
    placed[variantIndex] += 1;
    return { slot, variantIndex, videoIndex };
  });
}

function columnQuotas(
  columnSizes: Map<number, number>,
  variantCount: number,
  perVariant: number,
): Map<number, number[]> {
  const quotas = new Map<number, number[]>();
  const owed: number[] = Array.from({ length: variantCount }, () => perVariant);
  const columns = [...columnSizes.entries()].sort(([left], [right]) => left - right);
  for (const [timeIndex, size] of columns) {
    const base = Math.floor(size / variantCount);
    const quota: number[] = Array.from({ length: variantCount }, () => base);
    for (let variant = 0; variant < variantCount; variant += 1) owed[variant] -= base;
    quotas.set(timeIndex, quota);
  }
  for (const [timeIndex, size] of columns) {
    const quota = quotas.get(timeIndex);
    if (quota === undefined) continue;
    const extras = size % variantCount;
    const order = Array.from({ length: variantCount }, (_, variant) => variant).sort(
      (left, right) => owed[right] - owed[left] || left - right,
    );
    for (const variant of order.slice(0, extras)) {
      quota[variant] += 1;
      owed[variant] -= 1;
    }
  }
  return quotas;
}
