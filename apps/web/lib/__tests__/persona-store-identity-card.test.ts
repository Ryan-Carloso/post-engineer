import { beforeEach, describe, expect, it } from 'vitest';
import { usePersonaStore } from '../store';
import { cardToText } from '../persona-identity-card-form';
import { FIXTURE_CARD, FIXTURE_CARD_V2 } from '@/test/identity-card-fixtures';

function baseState(): void {
  usePersonaStore.getState().resetForm();
  usePersonaStore.getState().setName('Maria');
}

beforeEach(baseState);

describe('persona store identity card', () => {
  it('starts blank and not submitting', () => {
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toBe('');
    expect(state.identityCardLoaded).toBe('');
    expect(state.isSubmitting).toBe(false);
  });

  it('edits the box without touching the loaded copy', () => {
    usePersonaStore.getState().setIdentityCardText('green eyes');
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toBe('green eyes');
    expect(state.identityCardLoaded).toBe('');
  });

  it('adopts the stored text as both the draft and the loaded copy when untouched', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToText(FIXTURE_CARD));
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toBe(cardToText(FIXTURE_CARD));
    expect(state.identityCardLoaded).toBe(cardToText(FIXTURE_CARD));
  });

  it('keeps what the user typed when a refetch lands, but still records the server copy', () => {
    usePersonaStore.getState().setIdentityCardText('green eyes');
    usePersonaStore.getState().applyServerIdentityCard(cardToText(FIXTURE_CARD_V2));
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toBe('green eyes');
    expect(state.identityCardLoaded).toBe(cardToText(FIXTURE_CARD_V2));
  });

  it('resets the card with the rest of the form', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToText(FIXTURE_CARD));
    usePersonaStore.getState().setSubmitting(true);
    usePersonaStore.getState().resetForm();
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toBe('');
    expect(state.identityCardLoaded).toBe('');
    expect(state.isSubmitting).toBe(false);
  });

  it('clears only the card on resetIdentityCard', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToText(FIXTURE_CARD));
    usePersonaStore.getState().resetIdentityCard();
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toBe('');
    expect(state.name).toBe('Maria');
  });
});

describe('persona store form data with an identity card', () => {
  it('omits identityCard from the create form when the card is blank', () => {
    expect(usePersonaStore.getState().buildPersonaFormData().has('identityCard')).toBe(false);
  });

  it('puts the card JSON in the create form when the user filled it', () => {
    usePersonaStore.getState().setIdentityCardText(' green eyes ');
    const raw = usePersonaStore.getState().buildPersonaFormData().get('identityCard');
    expect(JSON.parse(String(raw))).toEqual({ version: 3, identity: { description: 'green eyes' } });
  });

  it('puts a pasted card in the create form as pasted', () => {
    usePersonaStore.getState().setIdentityCardText(JSON.stringify(FIXTURE_CARD_V2));
    const raw = usePersonaStore.getState().buildPersonaFormData().get('identityCard');
    expect(JSON.parse(String(raw))).toEqual(FIXTURE_CARD_V2);
  });

  it('omits identityCard from the edit form when nothing changed', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToText(FIXTURE_CARD));
    expect(usePersonaStore.getState().buildPersonaEditFormData().has('identityCard')).toBe(false);
  });

  it('sends the changed card on edit and null when a stored card was emptied', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToText(FIXTURE_CARD));
    usePersonaStore.getState().setIdentityCardText('{"version":1,"identity":{"body":{"height":"short"}}}');
    const changed = usePersonaStore.getState().buildPersonaEditFormData().get('identityCard');
    expect(JSON.parse(String(changed)).identity.body.height).toBe('short');

    usePersonaStore.getState().setIdentityCardText('');
    expect(usePersonaStore.getState().buildPersonaEditFormData().get('identityCard')).toBe('null');
  });
});
