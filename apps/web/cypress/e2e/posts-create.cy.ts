//---------------
// Posts list progress — creation happens through the API/MCP now (the
// /posts/new screen was removed in Phase 4), so this spec covers only
// what the list page still does: rendering live progress on its cards.
// Every app-page spec logs in for real (the middleware bounces
// unauthenticated visits to /landing).
//---------------

const NEW_POST_SCHEDULE_ID = 'sched-e2e-new';

function personasPayload() {
  return {
    authenticated: true,
    personas: [
      {
        id: 'persona-e2e-1',
        name: 'E2E Persona',
        niche: 'e2e',
        avatarUrl: null,
        photoUrl: null,
      },
    ],
  };
}

function postAccountsPayload() {
  return {
    authenticated: true,
    accounts: [
      {
        provider: 'youtube',
        recordId: 'rec-yt-1',
        channelId: 'ch-e2e-1',
        channelName: 'E2E Channel',
        email: 'e2e@example.com',
        thumbnail: null,
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    ],
  };
}

describe('Posts list progress', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/list', personasPayload()).as('personas');
    cy.intercept('GET', '/api/account', postAccountsPayload()).as('accounts');
    cy.intercept('GET', '/api/persona/video-generations*', {
      success: true,
      generations: [],
    }).as('generations');
    cy.intercept('GET', '/api/schedule', {
      success: true,
      schedules: [
        {
          id: NEW_POST_SCHEDULE_ID,
          persona_id: 'persona-e2e-1',
          providers: ['youtube'],
          youtube_account_ids: ['ch-e2e-1'],
          instagram_account_ids: [],
          linkedin_account_ids: [],
          bluesky_account_ids: [],
          days_of_week: [],
          start_hour: null,
          end_hour: null,
          posts_per_day: 1,
          timezone: 'Europe/Lisbon',
          active: true,
        },
      ],
    }).as('schedules');
    // Today, so the calendar (which opens on today) lists the card; the
    // same intercept answers the calendar's range read (`slots`).
    const generatingSlot = {
      id: 'slot-e2e-gen',
      schedule_id: NEW_POST_SCHEDULE_ID,
      slot_at: new Date().toISOString(),
      status: 'generating',
      title: 'E2E generating topic',
      task_id: 'task-e2e-1',
      progress: 42,
      stage: 'lipsync',
      queuePosition: 1,
      queueTotal: 1,
      retryable: null,
    };
    cy.intercept('GET', '/api/schedule/status*', {
      success: true,
      upcoming: [generatingSlot],
      recent: [],
      slots: [generatingSlot],
    }).as('status');
  });

  it('explains that a new post is sent through the MCP', () => {
    cy.visit('/posts', {
      onBeforeLoad(win) {
        win.localStorage.removeItem('post-engineer-mcp-onboard-seen');
      },
    });
    cy.get('[data-testid=mcp-onboard-card]').should('be.visible');
    cy.contains('Esta tela não cria a publicação').should('be.visible');
    cy.get('[data-testid=new-post-button]').click();
    cy.get('[role=dialog]').within(() => {
      cy.contains('MCP first').should('be.visible');
      cy.contains('servidor MCP').should('be.visible');
      cy.contains('a', 'Configurar o agente').should('have.attr', 'href', '/recipes');
      cy.contains('button', 'Entendi').click();
    });
    cy.get('[role=dialog]').should('not.exist');
    cy.get('[data-testid=mcp-onboard-card]').should('not.exist');
  });

  it('shows the live progress percent on the calendar day card', () => {
    cy.visit('/posts');
    // Today's posts render below the calendar, inside the scrolling <main>.
    cy.contains('E2E generating topic').scrollIntoView().should('be.visible');
    cy.contains('42%').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '42');
  });
});

export {};

