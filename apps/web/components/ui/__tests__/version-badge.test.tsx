import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import VersionBadge from '@/components/ui/version-badge';
import * as versionLib from '@/lib/version';

describe('VersionBadge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders BETA - <version> (#<pr>) from /api/version', async () => {
    // The shape the VPS deploy produces: version is MAJOR.MINOR.PR.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '1.28.152', pr: 152, build: 152, commit: '8f31abc' }),
      })),
    );
    render(<VersionBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.28.152 (#152)');
    });
  });

  it('falls back to the build number when the backend reports no PR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '1.8.0', build: 502, commit: 'abc123' }),
      })),
    );
    render(<VersionBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.8.0 (502)');
    });
  });

  it('omits the build number when the backend reports none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '1.28', pr: null, build: null, commit: null }),
      })),
    );
    render(<VersionBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.28');
    });
    expect(screen.getByTestId('version-badge').textContent).not.toContain('(');
  });

  it('degrades to a bare BETA pill when /api/version fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    render(<VersionBadge />);
    // Renders BETA immediately (no layout shift) and stays there on error.
    expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA');
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent(/^BETA$/);
    });
  });

  it('degrades to a bare BETA pill on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    render(<VersionBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent(/^BETA$/);
    });
  });

  it('fetches /api/version with no-store cache', async () => {
    // Pins the fetch contract: unguessable-URL and cache-option mutants
    // must not survive unnoticed.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '1.28', pr: null, build: null, commit: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<VersionBadge />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/version', { cache: 'no-store' });
    });
  });

  it('ignores a late resolve after unmount (cancellation)', async () => {
    // The cancelled guard must drop the response when the component is
    // gone: without it, setLabel fires on an unmounted component.
    const parseSpy = vi.spyOn(versionLib, 'parseBuildInfo');
    let resolveJson!: (value: unknown) => void;
    const jsonPromise = new Promise<unknown>((resolve) => {
      resolveJson = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: () => jsonPromise })),
    );
    const { unmount } = render(<VersionBadge />);
    unmount();
    await act(async () => {
      resolveJson({ version: '1.28.152', pr: 152, build: 152 });
      await jsonPromise;
    });
    expect(parseSpy).not.toHaveBeenCalled();
  });
});
