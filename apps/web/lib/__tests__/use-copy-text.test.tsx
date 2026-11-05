import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY_CONFIRM_MS, useCopyText } from '../use-copy-text';

function stubClipboard(value: unknown): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    writable: true,
    configurable: true,
  });
}

describe('useCopyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts un-copied', () => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useCopyText());
    expect(result.current.copied).toBe(false);
  });

  it('writes the exact text and turns copied on once the write resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const { result } = renderHook(() => useCopyText());

    act(() => result.current.copy('hello agent'));

    expect(writeText).toHaveBeenCalledExactlyOnceWith('hello agent');
    await waitFor(() => expect(result.current.copied).toBe(true));
  });

  it('resets copied after the confirmation window', async () => {
    vi.useFakeTimers();
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useCopyText());

    await act(async () => {
      result.current.copy('x');
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(COPY_CONFIRM_MS - 1);
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });

  it('restarts the confirmation window on a second copy instead of extending it', async () => {
    vi.useFakeTimers();
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useCopyText());

    await act(async () => {
      result.current.copy('x');
    });
    act(() => {
      vi.advanceTimersByTime(COPY_CONFIRM_MS - 500);
    });
    await act(async () => {
      result.current.copy('x');
    });
    // The first timer would have cleared it 500ms after the second copy.
    act(() => {
      vi.advanceTimersByTime(COPY_CONFIRM_MS - 1);
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });

  it('stays un-copied and logs when the clipboard API is unavailable', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubClipboard(undefined);
    const { result } = renderHook(() => useCopyText());

    act(() => result.current.copy('x'));

    expect(result.current.copied).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('[copy] clipboard API unavailable (insecure context)');
  });

  it('stays un-copied and logs when the write rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard({ writeText });
    const { result } = renderHook(() => useCopyText());

    act(() => result.current.copy('x'));

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[copy] clipboard write failed', {
        message: 'denied',
      }),
    );
    expect(result.current.copied).toBe(false);
  });
});
