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

  it('one request is shared by every badge copy mounted together', async () => {
    // Three copies mount per page (desktop sidebar, mobile header,
    // /account); each used to fire its own /api/version read, and each
    // web-side read re-asked the engine. The shared in-flight request
    // must collapse them into one.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '1.28.152', pr: 152, build: 152, commit: '8f31abc' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <div>
        <VersionBadge />
        <VersionBadge />
        <VersionBadge />
      </div>,
    );
    await waitFor(() => {
      const badges = screen.getAllByTestId('version-badge');
      expect(badges).toHaveLength(3);
      for (const badge of badges) {
        expect(badge).toHaveTextContent('BETA - 1.28.152 (#152)');
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a failed shared read degrades every copy to BETA with a single request', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <div>
        <VersionBadge />
        <VersionBadge />
      </div>,
    );
    await waitFor(() => {
      const badges = screen.getAllByTestId('version-badge');
      for (const badge of badges) {
        expect(badge).toHaveTextContent(/^BETA$/);
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the shared request is dropped after settling so a later mount can retry', async () => {
    // Only the in-flight request is shared. Once it settles, a badge
    // mounted later by a navigation must fetch again — a permanently
    // cached promise would stick every future copy on a stale (or
    // failed) response for the whole session.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '1.28', pr: null, build: null, commit: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const first = render(<VersionBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.28');
    });
    first.unmount();
    render(<VersionBadge />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.28');
  });
});
