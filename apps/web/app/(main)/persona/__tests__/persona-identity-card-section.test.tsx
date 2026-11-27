import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { enDictionary, ptDictionary } from '@/lib/i18n';
import { usePersonaStore } from '@/lib/store';
import { cardToDraft } from '@/lib/persona-identity-card-form';
import { FIXTURE_CARD, FIXTURE_CARD_V2, FIXTURE_CARD_V3 } from '@/test/identity-card-fixtures';
import { CARD_STYLES, IDENTITY_CARD_MAX_BYTES, type IdentityCard } from '@/lib/contracts/persona-identity-card';
import { PersonaIdentityCardSection } from '../persona-identity-card-section';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

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
  it('renders one description box that accepts the byte cap of a pasted card', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(textarea()).toHaveAttribute('maxlength', String(IDENTITY_CARD_MAX_BYTES));
    expect(textarea()).toBeEnabled();
    expect(textarea().tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'Person' })).toBe(textarea());
    expect(screen.getByRole('group', { name: 'Person' })).toBeInTheDocument();
  });

  it('tells the user the card is advice and asks for consent', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.getByText(/not a guarantee/)).toBeInTheDocument();
    expect(screen.getByTestId('identity-card-consent')).toHaveTextContent('only with that person');
    expect(screen.getByTestId('identity-card-consent')).toHaveTextContent('never shown in the persona list or on shared pages');
    expect(screen.getByText(/or paste an identity card as JSON/)).toBeInTheDocument();
  });

  it('renders the Portuguese copy when the locale is pt', () => {
    mocks.locale = 'pt';
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.getByText('Cartão de identidade')).toBeInTheDocument();
    expect(screen.getByTestId('identity-card-consent')).toHaveTextContent('consentimento');
    expect(screen.getByText(/cole um cartão de identidade em JSON/)).toBeInTheDocument();
  });

  it('writes what the user types into the store draft', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    fireEvent.change(textarea(), { target: { value: 'green eyes' } });
    expect(usePersonaStore.getState().identityCardDraft.text).toBe('green eyes');
    expect(textarea()).toHaveValue('green eyes');
  });

  it('reads the stored card only for an existing persona', () => {
    const { unmount } = render(<PersonaIdentityCardSection personaId={null} />);
    expect(new Set(mocks.personaIds)).toEqual(new Set([null]));
    unmount();
    mocks.personaIds.length = 0;
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(new Set(mocks.personaIds)).toEqual(new Set(['p1']));
  });

  it('disables the description while the stored card loads', () => {
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByText('Loading the identity card...')).toBeInTheDocument();
    expect(textarea()).toBeDisabled();
  });

  it('fills the description and the style from a stored v3 card once it loads', () => {
    setQuery({ isSuccess: true, data: FIXTURE_CARD_V3, dataUpdatedAt: 1 });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(textarea()).toHaveValue(FIXTURE_CARD_V3.identity.description);
    expect(screen.getByTestId('identity-card-style')).toHaveTextContent('Business');
    expect(usePersonaStore.getState().identityCardLoaded).toEqual(cardToDraft(FIXTURE_CARD_V3));
    expect(textarea()).toBeEnabled();
  });

  it('shows a stored v1 or v2 card as JSON that can be edited and saved back', () => {
    setQuery({ isSuccess: true, data: FIXTURE_CARD_V2, dataUpdatedAt: 1 });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(JSON.parse(textarea().value)).toEqual(FIXTURE_CARD_V2);
    expect(textarea().value).toContain('\n  "version": 2');
    expect(screen.getByTestId('identity-card-style')).toHaveTextContent('Business');
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

  it('disables the description while the save is pending', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    act(() => usePersonaStore.getState().setSubmitting(true));
    expect(textarea()).toBeDisabled();
    act(() => usePersonaStore.getState().setSubmitting(false));
    expect(textarea()).toBeEnabled();
  });

  it('starts blank again when it mounts for another persona', () => {
    usePersonaStore.getState().setIdentityCardField('text', 'left over');
    const { rerender } = render(<PersonaIdentityCardSection personaId={null} />);
    expect(textarea()).toHaveValue('');
    fireEvent.change(textarea(), { target: { value: 'green eyes' } });
    rerender(<PersonaIdentityCardSection personaId="p2" />);
    expect(usePersonaStore.getState().identityCardDraft.text).toBe('');
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

describe('PersonaIdentityCardSection style select', () => {
  it('starts on no style and offers every style plus the empty choice', async () => {
    const user = userEvent.setup();
    render(<PersonaIdentityCardSection personaId={null} />);
    const trigger = screen.getByTestId('identity-card-style');
    expect(trigger).toHaveTextContent('No style');
    await user.click(trigger);
    expect(screen.getAllByRole('option')).toHaveLength(CARD_STYLES.length + 1);
    expect(screen.getByRole('option', { name: 'Beachwear' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Business casual' })).toBeInTheDocument();
  });

  it('labels the styles in Portuguese when the locale is pt', async () => {
    mocks.locale = 'pt';
    const user = userEvent.setup();
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.getByTestId('identity-card-style')).toHaveTextContent('Sem estilo');
    await user.click(screen.getByTestId('identity-card-style'));
    expect(screen.getAllByRole('option')).toHaveLength(CARD_STYLES.length + 1);
    expect(screen.getByRole('option', { name: 'Executivo casual' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ao ar livre' })).toBeInTheDocument();
  });

  it('writes the chosen style into the draft and clears it with the empty choice', async () => {
    const user = userEvent.setup();
    render(<PersonaIdentityCardSection personaId={null} />);
    await user.click(screen.getByTestId('identity-card-style'));
    await user.click(screen.getByRole('option', { name: 'Sporty' }));
    expect(usePersonaStore.getState().identityCardDraft.style).toBe('sporty');
    expect(screen.getByTestId('identity-card-style')).toHaveTextContent('Sporty');
    await user.click(screen.getByTestId('identity-card-style'));
    await user.click(screen.getByRole('option', { name: 'No style' }));
    expect(usePersonaStore.getState().identityCardDraft.style).toBe('');
  });

  it('shows the style of a stored v2 card and none for a stored v1 card', () => {
    setQuery({ isSuccess: true, data: FIXTURE_CARD_V2, dataUpdatedAt: 1 });
    const { unmount } = render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByTestId('identity-card-style')).toHaveTextContent('Business');
    unmount();
    usePersonaStore.getState().resetForm();
    setQuery({ isSuccess: true, data: FIXTURE_CARD, dataUpdatedAt: 1 });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByTestId('identity-card-style')).toHaveTextContent('No style');
  });

  it('disables the style select while the stored card loads and when it fails to load', () => {
    const { unmount } = render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByTestId('identity-card-style')).toBeDisabled();
    unmount();
    setQuery({ isError: true });
    render(<PersonaIdentityCardSection personaId="p1" />);
    expect(screen.getByTestId('identity-card-style')).toBeDisabled();
  });

  it('disables the style select while the save is pending', () => {
    render(<PersonaIdentityCardSection personaId={null} />);
    expect(screen.getByTestId('identity-card-style')).toBeEnabled();
    act(() => usePersonaStore.getState().setSubmitting(true));
    expect(screen.getByTestId('identity-card-style')).toBeDisabled();
  });
});
