import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { VideoGeneration } from '@/lib/api';

//---------------
// Tests for the shared posts-list pieces in post-card.tsx: the date/time
// formatters, the slot-account resolution and the standalone generation
// row. i18n echoes keys. The fallbacks here are the defensive branches
// (unknown status / unmapped error code / no schedule), so each test pins
// the branch the happy-path fixtures never take.
//---------------

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

import { GenerationCard, formatDate, formatTime, resolveSlotAccounts } from '../post-card';

const GENERATION: VideoGeneration = {
  id: 'g1',
  generationId: 'gen-1',
  engineTaskId: 'task-1',
  personaName: 'Viva Leve',
  videoSubject: 'Myth busting',
  status: 'failed',
  errorCode: 'custom_audio_invalid',
  tokensRefunded: true,
  createdAt: '2026-09-23T10:00:00.000Z',
  completedAt: '2026-09-23T10:01:00.000Z',
};

function renderCard(generation: Partial<VideoGeneration> = {}) {
  cleanup();
  return render(<GenerationCard generation={{ ...GENERATION, ...generation }} locale="en" />);
}

describe('formatDate and formatTime', () => {
  it('formats pt-BR dates with the month name in Portuguese', () => {
    // Zone-agnostic: the month name and year survive any viewer timezone
    // (the day can shift by one at the zone edges), and the time pins only
    // its HH:MM shape, never the wall clock of a UTC instant.
    expect(formatDate('2026-09-23T10:00:00.000Z', 'pt')).toMatch(/de set\. de 2026/);
    expect(formatTime('2026-09-23T10:00:00.000Z', 'pt')).toMatch(/^\d{1,2}:\d{2}$/);
  });
});

describe('resolveSlotAccounts', () => {
  it('resolves no accounts without a schedule', () => {
    expect(
      resolveSlotAccounts(undefined, [{ id: 'ch1', provider: 'youtube', label: 'Europa Na Estrada' }]),
    ).toEqual([]);
  });
});

describe('GenerationCard thumbnail and failure state', () => {
  it('shows the video thumbnail only for a completed generation', () => {
    const { container } = renderCard({ status: 'completed', errorCode: null });

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-1/final-1.mp4#t=0.1');
    // A completed card carries no failure line and no destructive border.
    expect(container.querySelector('[data-generation-error]')).toBeNull();
    const card = screen.getByRole('link').firstElementChild as HTMLElement;
    expect(card.className.split(/\s+/)).not.toContain('border-destructive/35');
  });

  it('shows the fallback icon without a thumbnail while the video is still generating', () => {
    const { container } = renderCard({ status: 'generating', errorCode: null });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[data-generation-error]')).toBeNull();
    const icon = container.querySelector('.size-14 svg');
    expect(icon?.getAttribute('class')).toContain('text-muted-text');
  });

  it('marks a failed generation with the destructive border and the error line', () => {
    const { container } = renderCard({ status: 'failed', errorCode: 'custom_audio_invalid' });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('[data-generation-error]')).not.toBeNull();
    const card = screen.getByRole('link').firstElementChild as HTMLElement;
    expect(card.className.split(/\s+/)).toContain('border-destructive/35');
  });
});

describe('GenerationCard fallbacks', () => {
  it('falls back to the pending label and style for an unknown status', () => {
    renderCard({ status: 'bogus' });

    const badge = screen.getByText('posts.statusPending');
    expect(badge.className.split(/\s+/)).toContain('bg-sunken');
    expect(badge.className.split(/\s+/)).toContain('text-muted-text');
  });

  it('falls back to the unknown-error copy for an unmapped error code', () => {
    renderCard({ status: 'failed', errorCode: 'not_a_real_code' });

    expect(screen.getByText('posts.errorUnknown')).toBeInTheDocument();
  });

  it('falls back to the unknown-error copy when the generation has no error code', () => {
    renderCard({ status: 'failed', errorCode: null });

    expect(screen.getByText('posts.errorUnknown')).toBeInTheDocument();
  });
});
