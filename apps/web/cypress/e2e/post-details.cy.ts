//---------------
// Post details E2E — the redesigned detail page shows the post's identity:
// its Post ID with a working copy button, the scheduled date rendered in
// the schedule's timezone, the caption, and the target accounts by name.
// The API responses are stubbed so the assertions never depend on the E2E
// user's real data; the login itself is real (the middleware bounces
// unauthenticated visits to /landing, so every app-page spec logs in).
//---------------

const POST_DETAIL_SLOT_ID = 'slot-e2e-1';
const POST_DETAIL_SCHEDULE_ID = 'sched-e2e-1';

function slotDetailPayload() {
  return {
    success: true,
    slot: {
      id: POST_DETAIL_SLOT_ID,
      scheduleId: POST_DETAIL_SCHEDULE_ID,
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'awaiting',
      topic: 'E2E caption for the post details page',
      error: null,
      publishedAt: null,
      taskId: null,
      progress: 0,
      stage: null,
      retryable: null,
      publishLinks: [],
      queuePosition: 1,
      queueTotal: 3,
    },
    schedule: {
      id: POST_DETAIL_SCHEDULE_ID,
      personaId: 'persona-e2e-1',
      providers: ['youtube', 'instagram'],
      youtubeAccountIds: ['ch-e2e-1'],
      instagramAccountIds: ['ig-e2e-1'],
      linkedinAccountIds: [],
      blueskyAccountIds: [],
      timezone: 'Europe/Lisbon',
    },
    persona: { id: 'persona-e2e-1', name: 'E2E Persona' },
  };
}

function accountsPayload() {
  return {
    authenticated: true,
    accounts: [
      {
        provider: 'youtube',
        recordId: 'rec-yt-1',
        channelId: 'ch-e2e-1',
        channelName: 'E2E Channel',
        email: 'e2e@example.com',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
      {
        provider: 'instagram',
        recordId: 'rec-ig-1',
        igUserId: 'ig-e2e-1',
        username: 'e2e.insta',
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    ],
  };
}

//---------------
// stubClipboard — the copy button writes through navigator.clipboard.
// localhost is a secure context so it usually exists; the guard keeps the
// spec green where it doesn't.
//---------------
function stubClipboard(): void {
  cy.window().then((win) => {
    const nav = win.navigator as Navigator & {
      clipboard?: { writeText: (text: string) => Promise<void> };
    };
    if (!nav.clipboard) {
      Object.defineProperty(nav, 'clipboard', {
        value: { writeText: (): Promise<void> => Promise.resolve() },
        configurable: true,
      });
    }
    const clipboard = nav.clipboard as { writeText: (text: string) => Promise<void> };
    cy.wrap(cy.stub(clipboard, 'writeText').resolves()).as('clipboardWrite');
  });
}

describe('Post details page', () => {
  beforeEach(() => {
    // Real session cookie first: the middleware validates it server-side and
    // bounces unauthenticated visitors to /landing. loginE2EUser writes a
    // plain cookie (no cy.session), so with test isolation on it must run in
    // beforeEach — a before() login only authenticates the first test and
    // every later visit bounces to /landing, where no slot request ever
    // fires and cy.wait('@slotDetail') times out with "No request ever
    // occurred". Every other app-page spec does the same.
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/video-generations/*', {
      statusCode: 404,
      body: { success: false, error: 'Not found' },
    }).as('generationDetail');
    cy.intercept('GET', '/api/schedule/slots/*', slotDetailPayload()).as('slotDetail');
    cy.intercept('GET', '/api/account', accountsPayload()).as('accounts');
    cy.visit(`/posts/${POST_DETAIL_SLOT_ID}`);
    // The page resolves its entity by id through the detail endpoint —
    // wait for the stubbed response the page actually consumes.
    cy.wait('@slotDetail');
  });

  it('shows the post ID and copies it to the clipboard', () => {
    stubClipboard();

    cy.contains(/ID do post|Post ID/).should('be.visible');
    cy.contains('code', POST_DETAIL_SLOT_ID).should('be.visible');

    cy.contains('button', /Copiar|Copy/).click();
    cy.get('@clipboardWrite').should('have.been.calledWith', POST_DETAIL_SLOT_ID);
    cy.contains(/Copiado|Copied/).should('be.visible');
  });

  it('shows the scheduled date in the schedule timezone', () => {
    // 2030-06-01T10:00:00Z is 11:00 in Europe/Lisbon (UTC+1 in June) —
    // the converted hour proves the zone is applied, not just printed.
    // The schedule section sits below the fold of the scrollable main
    // column, so scroll each target into view before asserting visibility.
    cy.contains(/Agendado para|Scheduled for/).scrollIntoView().should('be.visible');
    cy.contains('11:00').scrollIntoView().should('be.visible');
    cy.contains('(Europe/Lisbon)').scrollIntoView().should('be.visible');
  });

  it('lists the target accounts by name', () => {
    cy.contains(/Contas|Accounts/).scrollIntoView().should('be.visible');
    cy.contains('E2E Channel').scrollIntoView().should('be.visible');
    cy.contains('@e2e.insta').scrollIntoView().should('be.visible');
  });

  it('shows the caption and saves an edited caption', () => {
    cy.intercept('PATCH', '/api/schedule/slots/*', {
      success: true,
      topic: 'Updated E2E caption',
    }).as('updateCaption');

    cy.contains('E2E caption for the post details page').should('be.visible');

    cy.contains('button', /Editar legenda|Edit caption/).click();
    cy.get('textarea').clear().type('Updated E2E caption');
    cy.contains('button', /Salvar|Save/).click();

    cy.wait('@updateCaption').its('request.body').should('deep.equal', {
      topic: 'Updated E2E caption',
    });
    // The editor closes on success.
    cy.get('textarea').should('not.exist');
  });

  it('deletes the post after confirmation and goes back to the list', () => {
    cy.intercept('DELETE', '/api/schedule/slots/*', { success: true }).as('deleteSlot');

    cy.contains('button', /Apagar|Delete/).click();
    // Two-step delete: the first click arms the confirmation.
    cy.contains('button', /Confirmar exclusão|Confirm deletion/).click();

    cy.wait('@deleteSlot');
    cy.url().should('match', /\/posts$/);
  });
});

//---------------
// Progress history — the detail page lists every observed (progress,
// stage) transition of a generating post, with regressed rows marked so a
// 40% -> 0% drop is visible instead of a mystery.
//---------------
describe('Post details page — progress history', () => {
  const HISTORY = [
    { progress: 40, stage: 'subtitle', recordedAt: '2026-10-05T22:10:00.000Z' },
    { progress: 0, stage: 'music_mood', recordedAt: '2026-10-05T22:12:00.000Z' },
    { progress: 50, stage: 'materials', recordedAt: '2026-10-05T22:14:00.000Z' },
  ];

  function visitWithHistory(progressHistory: unknown[]) {
    cy.loginE2EUser();
    cy.intercept('GET', '/api/persona/video-generations/*', {
      statusCode: 404,
      body: { success: false, error: 'Not found' },
    }).as('generationDetail');
    const payload = slotDetailPayload() as {
      success: boolean;
      slot: Record<string, unknown>;
      schedule: unknown;
      persona: unknown;
    };
    payload.slot = {
      ...payload.slot,
      status: 'generating',
      taskId: 'task-e2e-7',
      progress: 50,
      stage: 'materials',
      progressHistory,
    };
    cy.intercept('GET', '/api/schedule/slots/*', payload).as('slotDetail');
    cy.intercept('GET', '/api/account', accountsPayload()).as('accounts');
    cy.visit(`/posts/${POST_DETAIL_SLOT_ID}`);
    cy.wait('@slotDetail');
  }

  it('lists the observed transitions oldest-first with the regression marked', () => {
    visitWithHistory(HISTORY);

    cy.contains(/Histórico de progresso|Progress history/)
      .scrollIntoView()
      .should('be.visible');
    cy.get('[data-testid="progress-history-row"]').should('have.length', 3);
    cy.get('[data-testid="progress-history-row"]').eq(0).should('contain', '40%');
    // The 0% row follows 40%: a regression, marked for visibility.
    cy.get('[data-testid="progress-history-row"]')
      .eq(1)
      .should('have.attr', 'data-regressed', 'true')
      .and('contain', '0%');
    cy.get('[data-testid="progress-history-row"]')
      .eq(2)
      .should('not.have.attr', 'data-regressed');
  });

  it('hides the section when nothing was recorded', () => {
    visitWithHistory([]);

    cy.contains(/Histórico de progresso|Progress history/).should('not.exist');
    cy.get('[data-testid="progress-history-row"]').should('not.exist');
  });
});
