//---------------
// Creating a post — after a successful create the user lands back on /posts
// and the new post is already there WITH its progress %, without waiting
// for a refetch: the mutation seeds the list caches from its own response
// (slots + schedule) before invalidating. The status/schedules stubs below
// are delayed on purpose: the seeded cards are provably the render source,
// because the stubbed responses have not arrived yet when the assertions
// run. Every app-page spec logs in for real (the middleware bounces
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

function createPostPayload() {
  return {
    success: true,
    replayed: false,
    schedule: { id: NEW_POST_SCHEDULE_ID },
    slots: [
      {
        slotId: 'slot-e2e-a',
        slotAt: '2030-06-01T09:00:00.000Z',
        topic: 'E2E topic one',
        taskId: null,
        status: 'pending',
      },
      {
        slotId: 'slot-e2e-b',
        slotAt: '2030-06-02T09:00:00.000Z',
        topic: 'E2E topic two',
        taskId: null,
        status: 'pending',
      },
    ],
  };
}

//---------------
// setDateTimeValue — datetime-local inputs reject typed text in Cypress;
// set the value through the native setter and fire the input event React
// listens to.
//---------------
function setDateTimeValue(selector: string, value: string): void {
  cy.get(selector).then(($el) => {
    const el = $el[0] as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Creating a post', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/list', personasPayload()).as('personas');
    cy.intercept('GET', '/api/account', postAccountsPayload()).as('accounts');
    cy.intercept('GET', '/api/persona/video-generations*', {
      success: true,
      generations: [],
    }).as('generations');
    // Delayed: the assertions below must pass on the seeded cache alone.
    cy.intercept('GET', '/api/schedule/status*', {
      delay: 8000,
      body: { success: true, upcoming: [], recent: [] },
    }).as('status');
    cy.intercept('GET', '/api/schedule', {
      delay: 8000,
      body: { success: true, schedules: [] },
    }).as('schedules');
    cy.intercept('POST', '/api/videos/generate-and-schedule', createPostPayload()).as('createPost');
  });

  it('lands back on /posts with the new post already visible and its 0% progress', () => {
    // The real journey starts on /posts — the list caches are warm, exactly
    // like the user's session when they tap "New post". The navigation must
    // stay client-side (a cy.visit would wipe the React Query cache, which
    // the real Next.js Link navigation never does).
    cy.visit('/posts');
    cy.wait('@status');
    cy.contains('a', /Novo post|New post/).click();
    cy.location('pathname').should('eq', '/posts/new');
    cy.wait('@personas');

    // From here the stubs go quiet on purpose: the assertions below must
    // pass on the seeded cache alone, because no stubbed response arrives
    // in time. (Cypress matches the most recently defined intercept first.)
    cy.intercept('GET', '/api/schedule/status*', {
      delay: 8000,
      body: { success: true, upcoming: [], recent: [] },
    }).as('statusDelayed');
    cy.intercept('GET', '/api/schedule', {
      delay: 8000,
      body: { success: true, schedules: [] },
    }).as('schedulesDelayed');

    // Persona (required) — the radio card is a label wrapping the text.
    cy.contains('E2E Persona').click();
    // One topic (the store starts with a single empty row).
    cy.get('input[type="text"]').first().type('E2E topic one');
    // First publish — must parse in the selected timezone.
    setDateTimeValue('input[type="datetime-local"]', '2030-06-01T09:00');
    // At least one publishing account.
    cy.get('[data-testid="account-card"]').first().click();

    cy.contains('button', /Agendar posts|Schedule posts/).click();

    cy.wait('@createPost').its('request.body').should('deep.include', {
      personaId: 'persona-e2e-1',
      topics: ['E2E topic one'],
    });

    // Success redirects to the list…
    cy.location('pathname').should('eq', '/posts');
    // …where the new post is already rendered from the seeded cache — the
    // delayed status/schedules stubs have not responded yet, so nothing
    // else could have painted these cards.
    cy.contains('E2E topic one').should('be.visible');
    // Freshly created: 0% with a progress bar, like the detail page shows.
    cy.contains('0%').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '0');
  });
});

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
          topic: 'E2E generating topic',
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
    cy.wait('@status');

    cy.contains('E2E generating topic').should('be.visible');
    cy.contains('42%').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '42');
  });
});
