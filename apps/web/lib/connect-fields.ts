function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export async function readConnectFields(
  request: Request,
  names: readonly string[],
): Promise<{ ok: true; fields: Record<string, unknown> } | { ok: false; error: string }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { ok: false, error: 'Invalid JSON payload.' };
    }
    if (!isRecord(body)) return { ok: false, error: 'Invalid JSON payload.' };
    return { ok: true, fields: body };
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart payload.' };
  }
  return { ok: true, fields: Object.fromEntries(names.map((name) => [name, formData.get(name)])) };
}
