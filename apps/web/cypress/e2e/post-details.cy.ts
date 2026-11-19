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
      title: 'E2E caption for the post details page',
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
    generation: {
      faceless: false,
      language: 'pt-BR',
      voiceId: 'ana_neural',
      videoAspect: '9:16',
      niche: 'cooking',
      paragraphNumber: 5,
      faceQuality: 'high',
    },
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
    cy.loginE2EUser();

    cy.intercept('GET', '/api/posts/*', { ...slotDetailPayload(), kind: 'slot' }).as('slotDetail');
    cy.intercept('GET', '/api/account', accountsPayload()).as('accounts');
    cy.visit(`/posts/${POST_DETAIL_SLOT_ID}`);
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
    cy.contains(/Agendado para|Scheduled for/).scrollIntoView().should('be.visible');
    cy.contains('11:00').scrollIntoView().should('be.visible');
    cy.contains('(Europe/Lisbon)').scrollIntoView().should('be.visible');
  });

  it('shows the generation facts of the post', () => {
    cy.contains(/Como foi gerado|How it was generated/).scrollIntoView().should('be.visible');
    cy.contains('pt-BR').scrollIntoView().should('be.visible');
    cy.contains('ana_neural').scrollIntoView().should('be.visible');
    cy.contains('9:16').scrollIntoView().should('be.visible');
    cy.contains(/Com o rosto da persona|With the persona's face/).scrollIntoView().should('be.visible');
    cy.contains(/Como foi gerado|How it was generated/)
      .parent('section')
      .within(() => {
        cy.get('button').should('not.exist');
        cy.get('input, textarea').should('not.exist');
      });
  });

  it('lists the target accounts by name', () => {
    cy.contains(/Contas|Accounts/).scrollIntoView().should('be.visible');
    cy.contains('E2E Channel').scrollIntoView().should('be.visible');
    cy.contains('@e2e.insta').scrollIntoView().should('be.visible');
  });

  it('shows the caption and saves an edited caption', () => {
    cy.intercept('PATCH', '/api/schedule/slots/*', {
      success: true,
      title: 'Updated E2E caption',
    }).as('updateCaption');

    cy.contains('E2E caption for the post details page').should('be.visible');

    cy.contains('button', /Editar legenda|Edit caption/).click();
    cy.get('textarea').clear().type('Updated E2E caption');
    cy.contains('button', /Salvar|Save/).click();

    cy.wait('@updateCaption').its('request.body').should('deep.equal', {
      title: 'Updated E2E caption',
    });
    cy.get('textarea').should('not.exist');
  });

  it('deletes the post after confirmation and goes back to the list', () => {
    cy.intercept('DELETE', '/api/schedule/slots/*', { success: true }).as('deleteSlot');

    cy.contains('button', /Apagar|Delete/).click();
    cy.contains('button', /Confirmar exclusão|Confirm deletion/).click();

    cy.wait('@deleteSlot');
    cy.url().should('match', /\/posts$/);
  });
});

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
    cy.intercept('GET', '/api/posts/*', { ...payload, kind: 'slot' }).as('slotDetail');
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
