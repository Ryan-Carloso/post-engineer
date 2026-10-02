import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import VersionBadge from '@/components/ui/version-badge';

describe('VersionBadge', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders BETA with the deployed version', () => {
    vi.stubEnv('APP_VERSION', '1.13.3');
    render(<VersionBadge />);
    expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - 1.13.3');
  });

  it('falls back to dev when the version env is unset', () => {
    vi.stubEnv('APP_VERSION', '');
    render(<VersionBadge />);
    expect(screen.getByTestId('version-badge')).toHaveTextContent('BETA - dev');
  });
});
