const BOUNDARY_HEADER = 'content-type';

async function encodeForm(
  url: string,
  form: FormData,
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const encoded = new Request(url, { method: 'POST', body: form });
  const contentType = encoded.headers.get(BOUNDARY_HEADER);
  if (contentType === null) throw new Error('multipart content-type missing');
  return { body: await encoded.arrayBuffer(), contentType };
}

function fileForm(bytes: number): FormData {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), 'big.bin');
  return form;
}

export async function multipartRequest(
  url: string,
  form: FormData,
  headers: Record<string, string> = {},
): Promise<Request> {
  const { body, contentType } = await encodeForm(url, form);
  return new Request(url, {
    method: 'POST',
    body,
    headers: { ...headers, 'content-type': contentType, 'content-length': String(body.byteLength) },
  });
}

export async function lyingContentLengthRequest(
  url: string,
  realBytes: number,
  declaredLength: number,
  headers: Record<string, string> = {},
): Promise<Request> {
  const { body, contentType } = await encodeForm(url, fileForm(realBytes));
  return new Request(url, {
    method: 'POST',
    body,
    headers: { ...headers, 'content-type': contentType, 'content-length': String(declaredLength) },
  });
}

export async function withoutContentLength(
  url: string,
  headers: Record<string, string> = {},
): Promise<Request> {
  const { body, contentType } = await encodeForm(url, fileForm(16));
  return new Request(url, {
    method: 'POST',
    body,
    headers: { ...headers, 'content-type': contentType },
  });
}
