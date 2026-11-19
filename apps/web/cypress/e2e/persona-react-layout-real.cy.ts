const realVideoEnabled = () => String(Cypress.env('runRealVideo')) === '1';

const PERSONA_NAME = `Ana React ${Date.now()}`;

describe('persona — layout de abertura real (persona no topo)', () => {
  let personaId = '';

  beforeEach(() => {
    cy.visit('/landing');
    cy.loginE2EUser();
    cy.window().then((win) => {
      win.localStorage.setItem('social-hub-locale', 'en');
    });
  });

  it('cria a persona pela UI com "Persona no topo" e persiste o layout', function () {
    if (!realVideoEnabled()) {
      this.skip();
      return;
    }

    cy.intercept('POST', '/api/persona').as('createPersona');

    cy.visit('/persona');
    cy.get('#persona-name').type(PERSONA_NAME);
    cy.get('button[aria-label="Choose a character 1"]').click();

    cy.pickHouseVoice('Michael');
    cy.get('[data-testid="selected-voice"]').should('contain.text', 'Michael');

    cy.contains('button', 'Full screen').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', 'Persona on top').click();
    cy.contains('button', 'Persona on top').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', 'Full screen').should('have.attr', 'aria-pressed', 'false');

    cy.contains('button', 'Create persona').click();

    cy.wait('@createPersona').then((interception) => {
      personaId = String(interception.response?.body?.personaId ?? '');
      expect(personaId, 'personaId criado').to.not.eq('');
    });

    cy.request('/api/persona/list').then((response) => {
      const personas = response.body as { personas?: Array<{ id: string; videoLayout?: string }> };
      const created = (personas.personas ?? []).find((p) => p.id === personaId);
      expect(created, 'persona na lista').to.not.eq(undefined);
      expect(created?.videoLayout, 'videoLayout persistido').to.eq('react');
    });
  });
});

export {};