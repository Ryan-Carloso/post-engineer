import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import { POSTS_NO_PERSONA, PostFiltersBar, usePostFilters, type PostFilters, type PostJoins } from '../post-joins';
import type { ScheduleConfig, ScheduledSlot } from '@/lib/api';

const personas = [
  { id: 'p1', name: 'Viva Leve' },
  { id: 'p2', name: 'Other Persona' },
];

function makeSchedule(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    id: 's1',
    personaId: 'p1',
    providers: ['youtube', 'instagram'],
    youtubeAccountIds: ['ch1'],
    instagramAccountIds: ['ig1'],
    linkedinAccountIds: [],
    blueskyAccountIds: [],
    threadsAccountIds: [],
    facebookAccountIds: [],
    pinterestAccountIds: [],
    pinterestBoardId: null,
    threespeakAccountIds: [],
    rumbleAccountIds: [],
    fanvueAccountIds: [],
    telegramAccountIds: [],
    daysOfWeek: [1, 2, 3],
    startHour: 9,
    endHour: 17,
    postsPerDay: 1,
    timezone: 'UTC',
    active: true,
    publishMode: 'scheduled',
    ...overrides,
  };
}

function makeSlot(overrides: Partial<ScheduledSlot> = {}): ScheduledSlot {
  return {
    id: 'u1',
    scheduleId: 's1',
    slotAt: '2030-06-01T10:00:00.000Z',
    status: 'awaiting',
    title: 'Upcoming topic',
    error: null,
    publishedAt: null,
    taskId: null,
    progress: 0,
    stage: null,
    queuePosition: null,
    queueTotal: null,
    retryable: null,
    ...overrides,
  };
}

function makeJoins(overrides: { schedules?: ScheduleConfig[]; personas?: { id: string; name: string }[] } = {}): PostJoins {
  const schedules = overrides.schedules ?? [
    makeSchedule(),
    makeSchedule({ id: 's2', personaId: 'p2', providers: ['youtube'] }),
    makeSchedule({ id: 's3', personaId: null, providers: ['youtube'] }),
  ];
  const names = overrides.personas ?? personas;
  return {
    scheduleById: new Map(schedules.map((schedule) => [schedule.id, schedule])),
    personaNameById: new Map(names.map((persona) => [persona.id, persona.name])),
    personaPhotoById: new Map(
      names.map((persona) => [
        persona.id,
        { avatarUrl: undefined, photoUrl: undefined, libraryUrl: undefined, name: persona.name },
      ]),
    ),
    accountOptions: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function makeFilters(overrides: Partial<PostFilters> = {}): PostFilters {
  return {
    provider: 'all',
    persona: 'all',
    personas,
    hasActiveFilter: false,
    setProvider: vi.fn(),
    setPersona: vi.fn(),
    clear: vi.fn(),
    passes: () => true,
    ...overrides,
  };
}

describe('usePostFilters passes', () => {
  it('passes every slot when nothing is filtered', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));

    expect(result.current.passes(makeSlot())).toBe(true);
    expect(result.current.passes(makeSlot({ scheduleId: 's2' }))).toBe(true);
    expect(result.current.passes(makeSlot({ scheduleId: 's3' }))).toBe(true);
  });

  it('keeps only the selected persona slots', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));
    act(() => {
      result.current.setPersona('p1');
    });

    expect(result.current.passes(makeSlot())).toBe(true);
    expect(result.current.passes(makeSlot({ scheduleId: 's2' }))).toBe(false);
    expect(result.current.passes(makeSlot({ scheduleId: 's3' }))).toBe(false);
  });

  it('keeps only faceless slots for the no-persona option', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));
    act(() => {
      result.current.setPersona(POSTS_NO_PERSONA);
    });

    expect(result.current.passes(makeSlot())).toBe(false);
    expect(result.current.passes(makeSlot({ scheduleId: 's2' }))).toBe(false);
    expect(result.current.passes(makeSlot({ scheduleId: 's3' }))).toBe(true);
  });

  it('combines the persona and provider predicates', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));
    act(() => {
      result.current.setPersona('p1');
      result.current.setProvider('instagram');
    });

    expect(result.current.passes(makeSlot())).toBe(true);
    act(() => {
      result.current.setProvider('linkedin');
    });
    expect(result.current.passes(makeSlot())).toBe(false);
  });

  it('keeps the persona filter when the provider changes', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));
    act(() => {
      result.current.setPersona('p2');
      result.current.setProvider('youtube');
    });

    expect(result.current.persona).toBe('p2');
    expect(result.current.passes(makeSlot({ scheduleId: 's2' }))).toBe(true);
    expect(result.current.passes(makeSlot())).toBe(false);
  });

  it('drops slots whose schedule no longer exists', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));

    expect(result.current.passes(makeSlot({ scheduleId: 'deleted' }))).toBe(false);
  });

  it('matches a deleted persona id against nothing', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));
    act(() => {
      result.current.setPersona('p9');
    });

    expect(result.current.passes(makeSlot())).toBe(false);
    expect(result.current.passes(makeSlot({ scheduleId: 's2' }))).toBe(false);
    expect(result.current.passes(makeSlot({ scheduleId: 's3' }))).toBe(false);
  });

  it('clears both filters and reports no active filter', () => {
    const { result } = renderHook(() => usePostFilters(makeJoins()));
    act(() => {
      result.current.setPersona('p1');
      result.current.setProvider('youtube');
    });
    expect(result.current.hasActiveFilter).toBe(true);

    act(() => {
      result.current.clear();
    });

    expect(result.current.persona).toBe('all');
    expect(result.current.provider).toBe('all');
    expect(result.current.hasActiveFilter).toBe(false);
    expect(result.current.passes(makeSlot())).toBe(true);
  });
});

describe('PostFiltersBar', () => {
  it('renders two shadcn comboboxes and no native select', () => {
    render(<PostFiltersBar filters={makeFilters()} />);

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(document.querySelector('select')).toBeNull();
  });

  it('shows the all-providers and all-personas labels when nothing is filtered', () => {
    render(<PostFiltersBar filters={makeFilters()} />);

    expect(screen.getByRole('combobox', { name: 'posts.filterProvider' })).toHaveTextContent('posts.allProviders');
    expect(screen.getByRole('combobox', { name: 'posts.filterPersona' })).toHaveTextContent('posts.allPersonas');
  });

  it('calls setProvider with the picked provider', async () => {
    const filters = makeFilters();
    render(<PostFiltersBar filters={filters} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'posts.filterProvider' }));
    await user.click(screen.getByRole('option', { name: 'YouTube' }));

    expect(filters.setProvider).toHaveBeenCalledWith('youtube');
  });

  it('calls setPersona with the picked persona id', async () => {
    const filters = makeFilters();
    render(<PostFiltersBar filters={filters} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'posts.filterPersona' }));
    await user.click(screen.getByRole('option', { name: 'Viva Leve' }));

    expect(filters.setPersona).toHaveBeenCalledWith('p1');
  });

  it('lists the personas and the no-persona option', async () => {
    render(<PostFiltersBar filters={makeFilters()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'posts.filterPersona' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);

    expect(options).toEqual(['posts.allPersonas', 'Viva Leve', 'Other Persona', 'posts.noPersona']);
  });

  it('highlights the provider trigger while a provider filter is active', () => {
    render(<PostFiltersBar filters={makeFilters({ provider: 'youtube', hasActiveFilter: true })} />);

    const trigger = screen.getByRole('combobox', { name: 'posts.filterProvider' });
    expect(trigger.className).toContain('border-primary');
    expect(trigger.className).toContain('bg-info-soft');
  });

  it('highlights the persona trigger while a persona filter is active', () => {
    render(<PostFiltersBar filters={makeFilters({ persona: 'p1', hasActiveFilter: true })} />);

    const trigger = screen.getByRole('combobox', { name: 'posts.filterPersona' });
    expect(trigger.className).toContain('border-primary');
    expect(trigger.className).toContain('bg-info-soft');
  });

  it('disables both triggers when the bar is disabled', () => {
    render(<PostFiltersBar filters={makeFilters()} disabled />);

    for (const trigger of screen.getAllByRole('combobox')) {
      expect(trigger).toBeDisabled();
    }
  });

  it('hides the chevron on both triggers while the bar is disabled', () => {
    render(<PostFiltersBar filters={makeFilters()} disabled />);

    for (const trigger of screen.getAllByRole('combobox')) {
      expect(trigger.className.split(/\s+/)).toContain('[&>svg]:hidden');
    }
  });

  it('shows the clear button only with an active filter and clears on click', async () => {
    const filters = makeFilters({ provider: 'youtube', hasActiveFilter: true });
    const { rerender } = render(<PostFiltersBar filters={filters} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'posts.clearFilters' }));
    expect(filters.clear).toHaveBeenCalled();

    rerender(<PostFiltersBar filters={makeFilters()} />);
    expect(screen.queryByRole('button', { name: 'posts.clearFilters' })).toBeNull();
  });
});
