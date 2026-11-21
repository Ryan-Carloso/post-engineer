// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  boundedFormDataFailureResponse,
  readBoundedFormData,
} from '@/lib/upload/bounded-form-data';
import {
  lyingContentLengthRequest,
  multipartRequest,
  withoutContentLength,
} from '@/test/multipart-request';

const URL_ = 'http://localhost/api/anything';
const CAP = 4096;

describe('readBoundedFormData', () => {
  it('parses a body within the cap', async () => {
    const form = new FormData();
    form.set('provider', 'youtube');
    const result = await readBoundedFormData(await multipartRequest(URL_, form), CAP);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.formData.get('provider')).toBe('youtube');
  });

  it('answers 411 when Content-Length is missing, without parsing', async () => {
    const spy = vi.spyOn(Request.prototype, 'formData');
    const result = await readBoundedFormData(await withoutContentLength(URL_), CAP);
    expect(result).toMatchObject({ ok: false, status: 411, code: 'LENGTH_REQUIRED' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each(['abc', '-5', '12.5', '1e3', ''])('answers 411 for a non-numeric Content-Length %j', async (value) => {
    const request = await withoutContentLength(URL_, { 'content-length': value });
    const result = await readBoundedFormData(request, CAP);
    expect(result).toMatchObject({ ok: false, status: 411, code: 'LENGTH_REQUIRED' });
  });

  it('answers 413 before parsing when Content-Length is over the cap', async () => {
    const spy = vi.spyOn(Request.prototype, 'formData');
    const request = await withoutContentLength(URL_, { 'content-length': String(CAP + 1) });
    const result = await readBoundedFormData(request, CAP);
    expect(result).toMatchObject({ ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not reject a Content-Length exactly at the cap up front', async () => {
    const request = await withoutContentLength(URL_, { 'content-length': String(CAP) });
    const result = await readBoundedFormData(request, CAP);
    expect(result.ok || result.status !== 413).toBe(true);
  });

  it('aborts a body larger than a lying Content-Length', async () => {
    const request = await lyingContentLengthRequest(URL_, CAP * 4, 200);
    const result = await readBoundedFormData(request, CAP);
    expect(result).toMatchObject({ ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers 400 for a body that is not multipart', async () => {
    const request = new Request(URL_, {
      method: 'POST',
      body: 'plain text body',
      headers: { 'content-type': 'text/plain', 'content-length': '15' },
    });
    const result = await readBoundedFormData(request, CAP);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_MULTIPART' });
  });

  it('answers 400 when the request has no body', async () => {
    const request = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '0' },
    });
    const result = await readBoundedFormData(request, CAP);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_MULTIPART' });
  });
});

describe('boundedFormDataFailureResponse', () => {
  it('renders the stable code and status without raw errors', async () => {
    const result = await readBoundedFormData(await withoutContentLength(URL_), CAP);
    if (result.ok) throw new Error('expected a failure');
    const response = boundedFormDataFailureResponse(result);
    expect(response.status).toBe(411);
    expect(await response.json()).toEqual({
      success: false,
      error: 'A Content-Length header is required.',
      code: 'LENGTH_REQUIRED',
    });
  });
});
