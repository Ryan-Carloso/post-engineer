const POST_DETAIL_SLOT_ID = 'slot-e2e-1';
const POST_DETAIL_SCHEDULE_ID = 'sched-e2e-1';

function slotDetailPayload() {
  return {
    success: true,
    slot: {
      id: POST_DETAIL_SLOT_ID,
      scheduleId: POST_DETAIL_SCHEDULE_ID,
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'ready',
      title: 'E2E caption for the post details page',
      error: null,
      publishedAt: null,
      publishLinks: [],
      userNotices: [],
      providerFailures: [],
      postUrl: null,
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
    prompt: null,
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

    cy.intercept('GET', '/api/posts/*', slotDetailPayload()).as('slotDetail');
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
