import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { VoicePickerDialog } from '../voice-picker-dialog';
import type { VoiceOption } from '@/lib/voice-catalog';

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  return {
    I18nProvider,
    useI18n: () => ({
      t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
      locale: 'pt',
      setLocale: vi.fn(),
    }),
  };
});

const v = (id: string, overrides: Partial<VoiceOption>): VoiceOption => ({
  id,
  label: id,
  provider: 'kokoro',
  gender: 'female',
  accent: 'us',
  kind: 'standard',
  description: null,
  ...overrides,
});

const VOICES: VoiceOption[] = [
  v('chatterbox:a', { label: 'Heart', description: 'American female voice, bright.' }),
  v('chatterbox:b', { label: 'George', gender: 'male', accent: 'gb', description: 'British male voice, mid-range.' }),
  v('chatterbox:c', { label: 'Azgorath', provider: 'phonon', gender: 'male', accent: null, kind: 'character', description: 'An enormous ancient demon.' }),
];

function renderDialog(overrides: Partial<Parameters<typeof VoicePickerDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    voices: VOICES,
    selectedVoiceId: null,
    playingVoiceId: null,
    onPlay: vi.fn(),
    onPick: vi.fn(),
    labelFor: (voice: VoiceOption) => voice.label ?? voice.id,
    modelFor: () => '',
    ...overrides,
  };
  render(<VoicePickerDialog {...props} />);
  return props;
}

const rowNames = (): string[] =>
  within(screen.getByRole('dialog'))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('.font-semibold')?.textContent ?? '');

describe('VoicePickerDialog', () => {
  it('lists every voice with its description and the count', () => {
    renderDialog();
    expect(rowNames()).toEqual(['Heart', 'George', 'Azgorath']);
    expect(screen.getByText('An enormous ancient demon.')).toBeInTheDocument();
    expect(screen.getByText('persona.voicePickerCount {"count":3}')).toBeInTheDocument();
  });

  it('filters by search text, gender and origin together', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByRole('searchbox'), 'demon');
    expect(rowNames()).toEqual(['Azgorath']);

    await user.clear(screen.getByRole('searchbox'));
    await user.click(within(screen.getByRole('group', { name: 'persona.voiceFilterGender' })).getByText('persona.voiceFilterMale'));
    expect(rowNames()).toEqual(['George', 'Azgorath']);

    await user.click(within(screen.getByRole('group', { name: 'persona.voiceFilterOrigin' })).getByText('persona.voiceFilterGb'));
    expect(rowNames()).toEqual(['George']);
  });

  it('shows the empty message when nothing matches', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('persona.voiceFilterEmpty')).toBeInTheDocument();
  });

  it('plays from the round button and picks from the row', async () => {
    const user = userEvent.setup();
    const props = renderDialog({ selectedVoiceId: 'chatterbox:b' });
    const georgeRow = screen.getByText('George').closest('li') as HTMLLIElement;
    const [playButton, pickButton] = within(georgeRow).getAllByRole('button');

    await user.click(playButton);
    expect(props.onPlay).toHaveBeenCalledWith(VOICES[1]);
    expect(props.onPick).not.toHaveBeenCalled();

    expect(pickButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(pickButton);
    expect(props.onPick).toHaveBeenCalledWith(VOICES[1]);
  });
});
