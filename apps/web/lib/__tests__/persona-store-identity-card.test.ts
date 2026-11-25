import { beforeEach, describe, expect, it } from 'vitest';
import { usePersonaStore } from '../store';
import { cardToDraft, emptyIdentityCardDraft } from '../persona-identity-card-form';
import { FIXTURE_CARD } from '@/test/identity-card-fixtures';

function baseState(): void {
  usePersonaStore.getState().resetForm();
  usePersonaStore.getState().setName('Maria');
}

beforeEach(baseState);

describe('persona store identity card', () => {
  it('starts blank and not submitting', () => {
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toEqual(emptyIdentityCardDraft());
    expect(state.identityCardLoaded).toEqual(emptyIdentityCardDraft());
    expect(state.isSubmitting).toBe(false);
  });

  it('edits one field without touching the loaded copy', () => {
    usePersonaStore.getState().setIdentityCardField('face.eyes', 'green');
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft['face.eyes']).toBe('green');
    expect(state.identityCardLoaded['face.eyes']).toBe('');
  });

  it('adopts the stored card as both the draft and the loaded copy when untouched', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(FIXTURE_CARD));
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toEqual(cardToDraft(FIXTURE_CARD));
    expect(state.identityCardLoaded).toEqual(cardToDraft(FIXTURE_CARD));
  });

  it('keeps what the user typed when a refetch lands, but still records the server copy', () => {
    usePersonaStore.getState().setIdentityCardField('face.eyes', 'green');
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(FIXTURE_CARD));
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft['face.eyes']).toBe('green');
    expect(state.identityCardLoaded).toEqual(cardToDraft(FIXTURE_CARD));
  });

  it('resets the card with the rest of the form', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(FIXTURE_CARD));
    usePersonaStore.getState().setSubmitting(true);
    usePersonaStore.getState().resetForm();
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toEqual(emptyIdentityCardDraft());
    expect(state.identityCardLoaded).toEqual(emptyIdentityCardDraft());
    expect(state.isSubmitting).toBe(false);
  });

  it('clears only the card on resetIdentityCard', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(FIXTURE_CARD));
    usePersonaStore.getState().resetIdentityCard();
    const state = usePersonaStore.getState();
    expect(state.identityCardDraft).toEqual(emptyIdentityCardDraft());
    expect(state.name).toBe('Maria');
  });
});

describe('persona store form data with an identity card', () => {
  it('omits identityCard from the create form when the card is blank', () => {
    expect(usePersonaStore.getState().buildPersonaFormData('en-US').has('identityCard')).toBe(false);
  });

  it('puts the card JSON in the create form when the user filled it', () => {
    usePersonaStore.getState().setIdentityCardField('face.eyes', ' green ');
    const raw = usePersonaStore.getState().buildPersonaFormData('en-US').get('identityCard');
    expect(JSON.parse(String(raw))).toEqual({ version: 2, identity: { face: { eyes: 'green' } } });
  });

  it('omits identityCard from the edit form when nothing changed', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(FIXTURE_CARD));
    expect(usePersonaStore.getState().buildPersonaEditFormData().has('identityCard')).toBe(false);
  });

  it('sends the changed card on edit and null when a stored card was emptied', () => {
    usePersonaStore.getState().applyServerIdentityCard(cardToDraft(FIXTURE_CARD));
    usePersonaStore.getState().setIdentityCardField('body.height', 'short');
    const changed = usePersonaStore.getState().buildPersonaEditFormData().get('identityCard');
    expect(JSON.parse(String(changed)).identity.body.height).toBe('short');

    for (const key of Object.keys(emptyIdentityCardDraft()) as Array<keyof ReturnType<typeof emptyIdentityCardDraft>>) {
      usePersonaStore.getState().setIdentityCardField(key, '');
    }
    expect(usePersonaStore.getState().buildPersonaEditFormData().get('identityCard')).toBe('null');
  });
});
