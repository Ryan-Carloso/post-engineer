import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import VersionBadge from '@/components/ui/version-badge';

describe('VersionBadge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders BETA - <version> (<build>) from /api/version', async () => {
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
        json: async () => ({ version: '1.8.0', build: null, commit: null }),
      })),
    );
    render(<VersionBadge />);
    await waitFor(() => {
      expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.8.0');
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
});
