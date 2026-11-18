export function parseInstagramInsightsPayload(body: unknown): Record<string, number> {
  const values: Record<string, number> = {};
  if (typeof body !== 'object' || body === null) return values;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return values;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as { name?: unknown; values?: unknown; total_value?: unknown };
    if (typeof record.name !== 'string') continue;
    const first = Array.isArray(record.values) ? (record.values[0] as { value?: unknown } | undefined) : undefined;
    const total = record.total_value as { value?: unknown } | undefined;
    const value = first?.value ?? total?.value;
    if (typeof value === 'number' && Number.isFinite(value)) values[record.name] = value;
  }
  return values;
}
