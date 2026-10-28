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
    cy.intercept('GET', '/api/schedule/status*', {
      success: true,
      upcoming: [
        {
          id: 'slot-e2e-gen',
          schedule_id: NEW_POST_SCHEDULE_ID,
          slot_at: '2030-06-01T09:00:00.000Z',
          status: 'generating',
          title: 'E2E generating topic',
          task_id: 'task-e2e-1',
          progress: 42,
          stage: 'lipsync',
          queuePosition: 1,
          queueTotal: 1,
          retryable: null,
        },
      ],
      recent: [],
    }).as('status');
  });

  it('shows the live progress percent on the list card', () => {
    cy.visit('/posts');
    cy.contains('E2E generating topic').should('be.visible');
    cy.contains('42%').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '42');
  });
});

export {};

