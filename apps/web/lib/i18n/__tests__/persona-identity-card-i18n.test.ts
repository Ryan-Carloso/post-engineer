import { describe, expect, it } from 'vitest';
import { personaIdentityCardStrings } from '../persona-identity-card-i18n';

describe('personaIdentityCardStrings', () => {
  it('tells a v2 user a defaults object may name a style or an outfit', () => {
    expect(personaIdentityCardStrings.en.identityCard.errStyleOrOutfit).toBe(
      'A card defaults object must name a clothing style or an outfit.',
    );
    expect(personaIdentityCardStrings.pt.identityCard.errStyleOrOutfit).toBe(
      'O objeto de padrões do cartão precisa nomear um estilo ou uma roupa.',
    );
  });
});
