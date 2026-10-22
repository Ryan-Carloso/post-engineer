//---------------
// Real end-to-end for the opening layout (persona on top / b-roll below).
//
// Nothing on the video path is stubbed: the persona is created through the UI,
// the post is scheduled through the UI, and the engine (Chatterbox + Pexels +
// LongCat) actually renders. That costs GPU time and takes minutes, so this
// spec is opt-in: run it with RUN_REAL_VIDEO=1, otherwise it skips.
//
// Run:  pnpm exec cypress run --env runRealVideo=1 --spec cypress/e2e/persona-react-layout-real.cy.ts
//---------------

// Read inside each test, not at module scope, and compare as a STRING: Cypress
// parses `--env runRealVideo=1` into the NUMBER 1, so `=== '1'` is false and
// the spec silently skips itself.
const realVideoEnabled = () => String(Cypress.env('runRealVideo')) === '1';

// How long to wait for the engine to finish the real render. Generous by
// default (Chatterbox + Pexels + LongCat GPU), overridable so a local run can
// iterate in seconds instead of minutes.
const pollBudgetMs = () => Number(Cypress.env('pollBudgetMs')) || 15 * 60 * 1000;

// The expensive half (real engine render) needs BOTH flags, so the cheap UI
// half can be iterated on its own.
const realRenderEnabled = () =>
  String(Cypress.env('runRealVideo')) === '1' && String(Cypress.env('runVideo')) === '1';

const TOPIC = `Why most social media videos make no money ${Date.now()}`;
const PERSONA_NAME = `Ana React ${Date.now()}`;

describe('persona — layout de abertura real (persona no topo)', () => {
  let personaId = '';
  let slotId = '';

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

    // The catalog is the Chatterbox voice list, provider-qualified; the picker
    // shows the bare name. Every Chatterbox voice configured is en_us, so the
    // persona and its narration are English.
    cy.contains('button', 'en us male 01').click();
    cy.contains('button', 'en us male 01').should('have.attr', 'aria-pressed', 'true');

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

  it('agenda o post e entrega o vídeo com a persona no topo', function () {
    if (!realRenderEnabled()) {
      this.skip();
      return;
    }

    cy.intercept('POST', '/api/videos/generate-and-schedule').as('createPost');

    const startAt = new Date(Date.now() + 60 * 60 * 1000);
    const dateInput = `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, '0')}-${String(startAt.getDate()).padStart(2, '0')}`;

    cy.visit('/posts/new');
    cy.contains('label', PERSONA_NAME).click();
    cy.get('label[data-selected="true"]').should('contain', PERSONA_NAME);
    cy.get('input[aria-label="Topic"]').type(TOPIC);

    // Publishing needs a connected account; the E2E user may already have one.
    cy.get('body').then(($body) => {
      if ($body.find('[data-testid="account-card"]').length === 0) {
        cy.log('sem conta conectada — o agendamento não vai passar');
      }
    });
    cy.get('[data-testid="account-card-select"]').first().check({ force: true });

    // datetime-local only reacts to the native setter + a native input event;
    // assigning .value directly trips React's value tracker and the store never
    // updates (no request would ever fire).
    cy.get('input[type="datetime-local"]').then(($input) => {
      const el = $input[0] as HTMLInputElement;
      const view = el.ownerDocument.defaultView;
      if (!view) throw new Error('datetime input has no defaultView');
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('native input value setter not found');
      setter.call(el, `${dateInput}T20:00`);
      el.dispatchEvent(new view.Event('input', { bubbles: true }));
    });
    cy.get('input[type="datetime-local"]').should('have.value', `${dateInput}T20:00`);

    cy.contains('button', 'Schedule posts').click();

    cy.wait('@createPost', { timeout: 120_000 }).then((interception) => {
      const response = interception.response?.body as Record<string, unknown>;
      expect(response.success, 'agendamento criado').to.eq(true);
      const slots = response.slots as Array<Record<string, string>>;
      expect(slots.length, 'slots criados').to.be.greaterThan(0);
      slotId = String(slots[0].slotId);
    });

    // The engine scheduler takes the slot: Chatterbox TTS, Pexels b-roll and
    // the LongCat GPU intro. Real time — hence the generous budget.
    cy.log(`aguardando o vídeo do slot ${slotId} (minutos)`);
    cy.wrap(slotId, { log: false }).should((id) => id).then(() => {
      const deadline = Date.now() + pollBudgetMs();
      const poll = (): Cypress.Chainable => {
        // failOnStatusCode:false — a 404 while the row is still settling is a
        // normal state to wait out, not a reason to abort the whole poll.
        return cy
          .request({ url: `/api/posts/${slotId}`, failOnStatusCode: false, log: false })
          .then((response) => {
            const body = (response.body ?? {}) as Record<string, unknown>;
            const slot = (body.slot ?? {}) as Record<string, unknown>;
            const status = String(slot.status ?? '');
            if (status === 'ready' || slot.videoUrl || slot.videoPath) return body;
            if (status === 'failed' || status === 'error') {
              throw new Error(`geração falhou: ${JSON.stringify(body).slice(0, 500)}`);
            }
            if (Date.now() > deadline) {
              throw new Error(`timeout esperando o vídeo; último status: ${status}`);
            }
            cy.wait(15_000, { log: false });
            return poll();
          });
      };
      return poll();
    }).should((body) => {
      const slot = ((body as Record<string, unknown>).slot ?? {}) as Record<string, unknown>;
      expect(slot, 'slot finished').to.have.property('status', 'ready');
    });

    cy.visit(`/posts/${slotId}`);
    cy.get('video', { timeout: 60_000 }).should('be.visible');
  });
});

export {};