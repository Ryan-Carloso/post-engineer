import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'> & { unoptimized?: boolean }) => {
    const { unoptimized: _unoptimized, ...rest } = props;
    // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
    return <img {...rest} />;
  },
}));

const mockWarn = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

import { MATERIAL_PREVIEW_SRC, MaterialPreview } from '../material-preview';

const MAX_PREVIEW_BYTES = 40 * 1024;

describe('MaterialPreview', () => {
  beforeEach(() => {
    mockWarn.mockReset();
  });

  it('shows the example frame for its material with the given alt', () => {
    render(<MaterialPreview material="svg" alt="drawings example" fallbackIcon={<span>icon</span>} selected={false} />);
    expect(screen.getByAltText('drawings example')).toHaveAttribute('src', '/material-previews/svg.svg');
    expect(screen.queryByText('icon')).not.toBeInTheDocument();
  });

  it('falls back to the card icon and warns when the frame fails to load', () => {
    render(<MaterialPreview material="broll" alt="clips example" fallbackIcon={<span>icon</span>} selected />);
    fireEvent.error(screen.getByAltText('clips example'));
    expect(screen.queryByAltText('clips example')).not.toBeInTheDocument();
    expect(screen.getByText('icon')).toBeInTheDocument();
    expect(mockWarn).toHaveBeenCalledWith('[material-preview] preview image failed to load', { material: 'broll' });
  });

  it.each(Object.entries(MATERIAL_PREVIEW_SRC))('ships a small %s preview file in public/', (_material, src) => {
    const file = join(findRepoRoot(import.meta.url), 'apps/web/public', src);
    expect(statSync(file).size).toBeLessThan(MAX_PREVIEW_BYTES);
  });

  it('keeps the svg preview original line art, never a catalog asset', () => {
    const svg = readFileSync(join(findRepoRoot(import.meta.url), 'apps/web/public', MATERIAL_PREVIEW_SRC.svg), 'utf8');
    expect(svg).toContain('Original line art');
    expect(svg).not.toContain('<image');
  });
});
