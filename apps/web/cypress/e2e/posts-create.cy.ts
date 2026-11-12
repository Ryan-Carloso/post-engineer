//---------------
// Posts list progress — creation happens through the API/MCP now (the
// /posts/new screen was removed in Phase 4), so this spec covers what the
// list page still does: the New post link to the recipes hub, and rendering
// live progress on its cards. Every app-page spec logs in for real (the
// middleware bounces unauthenticated visits to /landing).
//---------------

const NEW_POST_SCHEDULE_ID = 'sched-e2e-new';

// The first-visit onboarding wizard auto-opens on /posts and hides the
// page behind it; these specs cover the list, not the wizard, so every
// visit starts seen. The key lives in lib/onboarding-wizard.ts.
function visitPosts() {
  cy.visit('/posts', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
}

// Day 15 is always in the shown month, so the same test works on any
// day; the button's aria-label is the full pt-BR date react-day-picker
// renders (pt is the default locale).
function day15FullDate(): string {
  const target = new Date();
  target.setDate(15);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(target);
}

function day15ShortDate(): string {
  const target = new Date();
  target.setDate(15);
  return shortDate(target);
}

// Short day heading the side panel renders ("qui., 12 de nov."): the
// same Intl options the page uses for its day headings.
function shortDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

function monthLong(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

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

  it('links New post to the recipes hub, with no onboard card or dialog', () => {
    visitPosts();
    cy.get('[data-testid=mcp-onboard-card]').should('not.exist');
    cy.get('[role=dialog]').should('not.exist');
    cy.get('[data-testid=new-post-button]').should('have.attr', 'href', '/recipes');
  });

  it('shows the live progress percent on the calendar day card', () => {
    visitPosts();
    // Today's posts render below the calendar, inside the scrolling <main>.
    cy.contains('E2E generating topic').scrollIntoView().should('be.visible');
    cy.contains('42%').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '42');
  });

  it('drives the calendar: pick a day, change month, go to today, refresh', () => {
    visitPosts();
    // Pick a day: the day panel names the 15th.
    cy.get('[data-calendar-card]').find(`button[aria-label^="${day15FullDate()}"]`).click();
    cy.contains(`Publicações de ${day15ShortDate()}`).should('be.visible');
    // Next month: the panel moves to the next month.
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    cy.get('[data-calendar-card]').find('button[aria-label="Próximo mês"]').click();
    cy.contains(`Publicações de ${monthLong(nextMonth)}`).should('be.visible');
    // Go to today: the day panel names today again.
    cy.get('[data-calendar-card]').contains('Ir para hoje').click();
    cy.contains(`Publicações de ${shortDate(new Date())}`).should('be.visible');
    // Refresh: the generating card is still there after the refetch.
    cy.get('button[aria-label="Atualizar"]').click();
    cy.contains('E2E generating topic').scrollIntoView().should('be.visible');
  });

  it('scrolls the day panel into view when picking a day on a narrow screen', () => {
    cy.viewport(390, 844);
    visitPosts();
    cy.get('[data-calendar-card]').find(`button[aria-label^="${day15FullDate()}"]`).click();
    cy.contains(`Publicações de ${day15ShortDate()}`).should('be.visible');
  });
});

export {};

