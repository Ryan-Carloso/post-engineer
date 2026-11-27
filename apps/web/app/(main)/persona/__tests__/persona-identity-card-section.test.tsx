import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { enDictionary, ptDictionary } from '@/lib/i18n';
import { usePersonaStore } from '@/lib/store';
import { FIXTURE_CARD, FIXTURE_CARD_V2, FIXTURE_CARD_V3 } from '@/test/identity-card-fixtures';
import { IDENTITY_CARD_MAX_BYTES, type IdentityCard } from '@/lib/contracts/persona-identity-card';
import { PersonaIdentityCardSection } from '../persona-identity-card-section';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const mocks = vi.hoisted(() => ({
  query: {
    isSuccess: false,
    isError: false,
    isFetching: false,
    data: null as IdentityCard | null,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  },
  personaIds: [] as Array<string | null>,
  locale: 'en' as 'en' | 'pt',
}));

vi.mock('@/lib/persona-identity-card-api', () => ({
  usePersonaIdentityCardQuery: vi.fn((personaId: string | null) => {
    mocks.personaIds.push(personaId);
    return mocks.query;
  }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const [section, name] = key.split('.');
      const dictionary = (mocks.locale === 'en' ? enDictionary : ptDictionary) as unknown as Record<string, Record<string, string>>;
      return dictionary[section][name];
    },
    locale: mocks.locale,
  }),
}));

function setQuery(state: Partial<typeof mocks.query>): void {
  Object.assign(mocks.query, { isSuccess: false, isError: false, isFetching: false, data: null, dataUpdatedAt: 0 }, state);
}

function textarea(): HTMLTextAreaElement {
  return screen.getByTestId('identity-card-text') as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.personaIds.length = 0;
  mocks.locale = 'en';
  usePersonaStore.getState().resetForm();
  setQuery({});
});

describe('PersonaIdentityCardSection', () => {
  it('renders one text box that accepts the byte cap of a pasted card', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(textarea()).toHaveAttribute('maxlength', String(IDENTITY_CARD_MAX_BYTES));
    expect(textarea()).toBeEnabled();
    expect(textarea().tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'Identity card (JSON)' })).toBe(textarea());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('recommends the JSON card in the placeholder and the hint', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(textarea()).toHaveAttribute('placeholder', expect.stringContaining('"version": 3'));
    expect(screen.getByText(/Paste the card as JSON/)).toBeInTheDocument();
    expect(screen.getByText(/The optional "defaults" object names a clothing style/)).toBeInTheDocument();
    expect(screen.getByText(/plain text is accepted as a shortcut/)).toBeInTheDocument();
  });

  it('tells the user the card is advice and asks for consent', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.getByText(/not a guarantee/)).toBeInTheDocument();
    expect(screen.getByTestId('identity-card-consent')).toHaveTextContent('only with that person');
    expect(screen.getByTestId('identity-card-consent')).toHaveTextContent('never shown in the persona list or on shared pages');
    expect(screen.getByText(/The description is at most 800 characters/)).toBeInTheDocument();
  });

  it('renders the Portuguese copy when the locale is pt', () => {
    mocks.locale = 'pt';
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.getByText('Cartão de identidade')).toBeInTheDocument();
    expect(screen.getByTestId('identity-card-consent')).toHaveTextContent('consentimento');
    expect(screen.getByText(/Cole o cartão em JSON/)).toBeInTheDocument();
    expect(textarea()).toHaveAttribute('placeholder', expect.stringContaining('"version": 3'));
  });

  it('writes what the user types into the store draft', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    fireEvent.change(textarea(), { target: { value: 'green eyes' } });
    expect(usePersonaStore.getState().identityCardDraft).toBe('green eyes');
    expect(textarea()).toHaveValue('green eyes');
  });

  it('keeps a pasted JSON card in the draft exactly as pasted', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    const pasted = JSON.stringify(FIXTURE_CARD_V2);
    fireEvent.change(textarea(), { target: { value: pasted } });
    expect(usePersonaStore.getState().identityCardDraft).toBe(pasted);
    expect(textarea()).toHaveValue(pasted);
  });

  it('still accepts plain text as a shortcut for a version 3 description', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    fireEvent.change(textarea(), { target: { value: 'green eyes, square jaw' } });
    expect(usePersonaStore.getState().identityCardDraft).toBe('green eyes, square jaw');
    expect(textarea()).toHaveAttribute('placeholder', expect.stringContaining('"description"'));
  });

  it('has no clothing style control of its own', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.queryByTestId('identity-card-style')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows no loading text for a new persona', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.queryByText('Loading the identity card...')).not.toBeInTheDocument();
    expect(textarea()).toBeEnabled();
  });

  it('reads the stored card only for an existing persona', () => {
    const { unmount } = render(<PersonaIdentityCardSection personaId={null} />);
    expect(new Set(mocks.personaIds)).toEqual(new Set([null]));
    unmount();
    mocks.personaIds.length = 0;
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(new Set(mocks.personaIds)).toEqual(new Set(['p1']));
  });

  it('disables the box while the stored card loads', () => {
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByText('Loading the identity card...')).toBeInTheDocument();
    expect(textarea()).toBeDisabled();
  });

  it('shows a plain v3 card as its description once it loads', () => {
    const card: IdentityCard = { version: 3, identity: { description: 'Green eyes, square jaw.' } };
    setQuery({ isSuccess: true, data: card, dataUpdatedAt: 1 });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(textarea()).toHaveValue('Green eyes, square jaw.');
    expect(usePersonaStore.getState().identityCardLoaded).toBe('Green eyes, square jaw.');
    expect(textarea()).toBeEnabled();
  });

  it('shows a stored card with a style, and a v1 or v2 card, as JSON that can be edited and saved back', () => {
    setQuery({ isSuccess: true, data: FIXTURE_CARD_V3, dataUpdatedAt: 1 });
    const { unmount } = render(<PersonaIdentityCardSection personaId="p1" />);
    expect(JSON.parse(textarea().value)).toEqual(FIXTURE_CARD_V3);
    expect(textarea().value).toContain('\n  "version": 3');
    unmount();
    usePersonaStore.getState().resetForm();
    setQuery({ isSuccess: true, data: FIXTURE_CARD_V2, dataUpdatedAt: 1 });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(JSON.parse(textarea().value)).toEqual(FIXTURE_CARD_V2);
    expect(usePersonaStore.getState().identityCardLoaded).toBe(JSON.stringify(FIXTURE_CARD_V2, null, 2));
  });

  it('shows a blank form for a persona without a card', () => {
    setQuery({ isSuccess: true, data: null, dataUpdatedAt: 1 });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(textarea()).toHaveValue('');
    expect(textarea()).toBeEnabled();
  });

  it('blocks editing and offers a retry when the stored card cannot be loaded', () => {
    setQuery({ isError: true });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByText('We could not load the identity card.')).toBeInTheDocument();
    expect(textarea()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('disables the box while the save is pending', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    act(() => usePersonaStore.getState().setSubmitting(true));
    expect(textarea()).toBeDisabled();
    act(() => usePersonaStore.getState().setSubmitting(false));
    expect(textarea()).toBeEnabled();
  });

  it('starts blank again when it mounts for another persona', () => {
    usePersonaStore.getState().setIdentityCardText('left over');
    const { rerender } = render(<PersonaIdentityCardSection personaId={null} />);
    expect(textarea()).toHaveValue('');
    fireEvent.change(textarea(), { target: { value: 'green eyes' } });
    rerender(<PersonaIdentityCardSection personaId="p2" />);
    expect(usePersonaStore.getState().identityCardDraft).toBe('');
  });

  it('keeps what the user typed when the stored card refetches', () => {
    setQuery({ isSuccess: true, data: FIXTURE_CARD, dataUpdatedAt: 1 });
    const { rerender } = render(<PersonaIdentityCardSection personaId="p1" />);
    fireEvent.change(textarea(), { target: { value: '{"version":1,"identity":{"body":{"height":"short"}}}' } });
    setQuery({ isSuccess: true, data: { ...FIXTURE_CARD }, dataUpdatedAt: 2 });
    rerender(<PersonaIdentityCardSection personaId="p1" />);
    expect(JSON.parse(textarea().value)).toEqual({ version: 1, identity: { body: { height: 'short' } } });
  });
});
