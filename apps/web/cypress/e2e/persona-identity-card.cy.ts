const PERSONA_ID = '11111111-1111-4111-8111-111111111111';
const PATH = `/persona?edit=${PERSONA_ID}`;
const EMPTY_ACCOUNTS = {
  youtube: [], instagram: [], bluesky: [], linkedin: [], threads: [], facebook: [],
  pinterest: [], '3speak': [], rumble: [], fanvue: [], telegram: [],
};

interface StoredCard {
  version: number;
  identity: { description?: string };
  defaults?: { style?: string };
}

function mockEditPage(state: { stored: StoredCard | null; patches: number }): void {
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

function description(): Cypress.Chainable<JQuery<HTMLTextAreaElement>> {
  return cy.get('[data-testid="identity-card-text"]');
}

describe('Persona — identity card', () => {
  beforeEach(() => {
    cy.loginE2EUser();
  });

  it('saves a free-text description and shows it again after a reload', () => {
    const state: { stored: StoredCard | null; patches: number } = { stored: null, patches: 0 };
    mockEditPage(state);

    visitEdit();
    cy.wait('@getCard');
    cy.get('[data-testid="persona-identity-card"]').scrollIntoView();
    description().should('be.enabled').and('have.value', '');
    cy.get('[data-testid="identity-card-consent"]').should('be.visible');

    description().type('Blue-grey wide-set eyes, blonde long wavy hair, tall athletic build.');
    cy.contains('button', 'Salvar alterações').click();
    cy.wait('@patchPersona').then(() => {
      expect(state.patches).to.equal(1);
      expect(state.stored).to.deep.equal({
        version: 3,
        identity: { description: 'Blue-grey wide-set eyes, blonde long wavy hair, tall athletic build.' },
      });
    });

    visitEdit();
    cy.wait('@getCard');
    description().should('have.value', 'Blue-grey wide-set eyes, blonde long wavy hair, tall athletic build.');
  });

  it('accepts a pasted JSON card and keeps it editable after a reload', () => {
    const state: { stored: StoredCard | null; patches: number } = { stored: null, patches: 0 };
    mockEditPage(state);

    visitEdit();
    cy.wait('@getCard');
    const card = { version: 3, identity: { description: 'Green eyes, square jaw, short black hair.' }, defaults: { style: 'casual' } };
    description().type(JSON.stringify(card), { parseSpecialCharSequences: false });
    cy.contains('button', 'Salvar alterações').click();
    cy.wait('@patchPersona').then(() => {
      expect(state.stored).to.deep.equal(card);
    });

    visitEdit();
    cy.wait('@getCard');
    description().should('have.value', JSON.stringify(card, null, 2));
  });

  it('blocks an empty description in a pasted card and sends nothing', () => {
    const state: { stored: StoredCard | null; patches: number } = { stored: null, patches: 0 };
    mockEditPage(state);

    visitEdit();
    cy.wait('@getCard');
    description().type('{"version":3,"identity":{"description":""}}', { parseSpecialCharSequences: false });
    cy.contains('button', 'Salvar alterações').click();

    cy.contains('Descreva a pessoa ou cole um cartão de identidade em JSON.').should('be.visible');
    cy.then(() => expect(state.patches).to.equal(0));
  });
});

export {};
