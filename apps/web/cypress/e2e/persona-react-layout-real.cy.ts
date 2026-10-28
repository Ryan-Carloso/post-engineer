//---------------
// Real end-to-end for the opening layout (persona on top / b-roll below).
//
// The persona is created through the UI for real and the opening layout
// choice is asserted on the persisted persona. The old second test (post
// scheduling + real engine render through /posts/new) was deleted in
// Phase 4 with the creation screen; creation is API/MCP-only now.
//
// Run:  pnpm exec cypress run --env runRealVideo=1 --spec cypress/e2e/persona-react-layout-real.cy.ts
//---------------

// Read inside each test, not at module scope, and compare as a STRING: Cypress
// parses `--env runRealVideo=1` into the NUMBER 1, so `=== '1'` is false and
// the spec silently skips itself.
const realVideoEnabled = () => String(Cypress.env('runRealVideo')) === '1';

const PERSONA_NAME = `Ana React ${Date.now()}`;

describe('persona — layout de abertura real (persona no topo)', () => {
  let personaId = '';

  beforeEach(() => {
    cy.visit('/landing');
    // Must come AFTER the first visit, otherwise the cookie is not attached to
    // the AUT domain and every API route answers 401.
    cy.loginE2EUser();
    // The persona's SCRIPT language follows the app locale (resolveScriptLanguage),
    // not the voice. Every Chatterbox voice configured is en_us, so a PT locale
    // would script in Portuguese and speak it with an English cloned voice —
    // the mismatch broke subtitle alignment and killed the hook retry.
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

    // The real engine serves the catalog (voice_catalog.json): pick Kokoro's
    // American "Michael" through the dialog, then the card shows it.
    cy.pickHouseVoice('Michael');
    cy.get('[data-testid="selected-voice"]').should('contain.text', 'Michael');

    // The layout the whole feature exists for. 'Full screen' is the default, so
    // asserting the click actually moved the selection is the honest gate —
    // a silent no-op here would still send 'standard'.
    cy.contains('button', 'Full screen').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', 'Persona on top').click();
    cy.contains('button', 'Persona on top').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', 'Full screen').should('have.attr', 'aria-pressed', 'false');

    cy.contains('button', 'Create persona').click();

    cy.wait('@createPersona').then((interception) => {
      personaId = String(interception.response?.body?.personaId ?? '');
      expect(personaId, 'personaId criado').to.not.eq('');
    });

    // Assert the OUTCOME, not the request encoding: Cypress re-encodes a
    // multipart body into its own shape, so reading `videoLayout` off it proves
    // nothing. The stored value read back through the API is the real contract.
    cy.request('/api/persona/list').then((response) => {
      const personas = response.body as { personas?: Array<{ id: string; videoLayout?: string }> };
      const created = (personas.personas ?? []).find((p) => p.id === personaId);
      expect(created, 'persona na lista').to.not.eq(undefined);
      expect(created?.videoLayout, 'videoLayout persistido').to.eq('react');
    });
  });
});

export {};