import { houseVoice } from '../support/voices';

const PERSONA_ID = '11111111-1111-4111-8111-111111111111';
const PATH = `/persona?edit=${PERSONA_ID}`;
const EMPTY_ACCOUNTS = {
  youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [],
  pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [],
};

interface StoredCard {
  version: number;
  identity: { face?: { eyes?: string; hair?: { color?: string } }; body?: { height?: string } };
  defaults?: { outfit?: { top?: string } };
}

function mockEditPage(state: { stored: StoredCard | null; patches: number }): void {
  cy.intercept('GET', '/api/persona/voices', {
    statusCode: 200,
    body: { voices: [houseVoice('en_us_male_01', 'male')] },
  });
  cy.intercept('GET', '/api/persona/cloned-voices', { statusCode: 200, body: { success: true, voices: [] } });
  cy.intercept('GET', '/api/persona/images*', { statusCode: 200, body: { success: true, images: [] } });
  cy.intercept('GET', '/api/persona/list', {
    statusCode: 200,
    body: {
      authenticated: true,
      personas: [
        {
          id: PERSONA_ID,
          name: 'Maya Card',
          createdAt: new Date().toISOString(),
          avatarUrl: '/caracter-samples/file-3.png',
          voiceId: 'chatterbox:en_us_male_01',
          videoAspect: '9:16',
          scriptPrompt: '',
          niche: '',
          language: 'en-US',
          hookPanel: true,
          aiLabel: false,
        },
      ],
    },
  });
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: {
      authenticated: true,
      accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'UC1', channelName: 'Canal Um' }],
      message: 'ok',
    },
  });
  cy.intercept('GET', '/api/persona/publishing-accounts*', {
    statusCode: 200,
    body: { success: true, defaults: { ...EMPTY_ACCOUNTS, youtube: ['UC1'] } },
  });
  cy.intercept('GET', '/api/persona/identity-card*', (request) => {
    request.reply({ statusCode: 200, body: { success: true, identityCard: state.stored } });
  }).as('getCard');
  cy.intercept('PATCH', '/api/persona*', (request) => {
    state.patches += 1;
    const match = /name="identityCard"\r\n\r\n([^\r]*)\r\n/.exec(String(request.body));
    state.stored = match === null ? state.stored : (JSON.parse(match[1]) as StoredCard | null);
    request.reply({ statusCode: 200, body: { success: true } });
  }).as('patchPersona');
}

function visitEdit(): void {
  cy.visit(PATH);
  cy.location('pathname', { timeout: 15_000 }).then((pathname) => {
    if (pathname === '/landing') {
      cy.loginE2EUser();
      cy.visit(PATH);
    }
  });
  cy.get('#persona-name', { timeout: 15_000 }).should('have.value', 'Maya Card');
}

describe('Persona — identity card', () => {
  beforeEach(() => {
    cy.loginE2EUser();
  });

  it('saves a card and shows it again after a reload', () => {
    const state: { stored: StoredCard | null; patches: number } = { stored: null, patches: 0 };
    mockEditPage(state);

    visitEdit();
    cy.wait('@getCard');
    cy.get('[data-testid="persona-identity-card"]').scrollIntoView();
    cy.get('[data-testid="identity-card-face.eyes"]').should('be.enabled').and('have.value', '');
    cy.get('[data-testid="identity-card-consent"]').should('be.visible');

    cy.get('[data-testid="identity-card-face.eyes"]').type('blue-grey');
    cy.get('[data-testid="identity-card-face.hair.color"]').type('blonde');
    cy.get('[data-testid="identity-card-body.height"]').type('tall');
    cy.get('[data-testid="identity-card-outfit.top"]').type('sage-green t-shirt');

    cy.contains('button', 'Salvar alterações').click();
    cy.wait('@patchPersona').then(() => {
      expect(state.patches).to.equal(1);
      expect(state.stored).to.deep.equal({
        version: 1,
        identity: { face: { eyes: 'blue-grey', hair: { color: 'blonde' } }, body: { height: 'tall' } },
        defaults: { outfit: { top: 'sage-green t-shirt' } },
      });
    });

    visitEdit();
    cy.wait('@getCard');
    cy.get('[data-testid="identity-card-face.eyes"]').should('have.value', 'blue-grey');
    cy.get('[data-testid="identity-card-face.hair.color"]').should('have.value', 'blonde');
    cy.get('[data-testid="identity-card-body.height"]').should('have.value', 'tall');
    cy.get('[data-testid="identity-card-outfit.top"]').should('have.value', 'sage-green t-shirt');
  });

  it('blocks an outfit without any face or body trait and sends nothing', () => {
    const state: { stored: StoredCard | null; patches: number } = { stored: null, patches: 0 };
    mockEditPage(state);

    visitEdit();
    cy.wait('@getCard');
    cy.get('[data-testid="identity-card-outfit.top"]').type('sage-green t-shirt');
    cy.contains('button', 'Salvar alterações').click();

    cy.contains('Preencha ao menos um traço de rosto ou corpo antes de definir uma roupa.').should('be.visible');
    cy.then(() => expect(state.patches).to.equal(0));
  });
});

export {};
