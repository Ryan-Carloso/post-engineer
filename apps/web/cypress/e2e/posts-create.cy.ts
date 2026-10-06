//---------------
// Creating a post — the form takes ONE topic and, after a successful
// create, opens that post's own detail page (/posts/<slotId>) where the
// video and its progress live. The list caches are still seeded from the
// mutation response (the user navigates back to /posts without a flash of
// empty), and the status/schedules stubs below are delayed on purpose: the
// assertions must pass on the seeded cache alone, because the stubbed
// responses have not arrived yet when they run. Every app-page spec logs in
// for real (the middleware bounces unauthenticated visits to /landing).
//---------------

const NEW_POST_SCHEDULE_ID = 'sched-e2e-new';
const NEW_POST_SLOT_ID = 'slot-e2e-new';

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

//---------------
// createPostPayload — one slot, because the form now creates one video.
//---------------
function createPostPayload() {
  return {
    success: true,
    replayed: false,
    schedule: { id: NEW_POST_SCHEDULE_ID },
    slots: [
      {
        slotId: NEW_POST_SLOT_ID,
        slotAt: '2030-06-01T09:00:00.000Z',
        topic: 'E2E topic one',
        taskId: null,
        status: 'pending',
      },
    ],
  };
}

//---------------
// newPostSlotDetailPayload — what the detail page fetches for the slot the
// create response pointed at. The status is `awaiting` (nothing generated
// yet), so the page shows a 0% progress bar.
//---------------
function newPostSlotDetailPayload() {
  return {
    success: true,
    slot: {
      id: NEW_POST_SLOT_ID,
      scheduleId: NEW_POST_SCHEDULE_ID,
      slotAt: '2030-06-01T09:00:00.000Z',
      status: 'awaiting',
      topic: 'E2E topic one',
      error: null,
      publishedAt: null,
      taskId: null,
      progress: 0,
      stage: null,
      retryable: null,
      publishLinks: [],
      queuePosition: 1,
      queueTotal: 1,
    },
    schedule: {
      id: NEW_POST_SCHEDULE_ID,
      personaId: 'persona-e2e-1',
      providers: ['youtube'],
      youtubeAccountIds: ['ch-e2e-1'],
      instagramAccountIds: [],
      linkedinAccountIds: [],
      blueskyAccountIds: [],
      timezone: 'UTC',
    },
    persona: { id: 'persona-e2e-1', name: 'E2E Persona' },
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
    // The detail page also probes the generation history for this id; a
    // scheduled post that has not generated has none, so 404 is the truth
    // (the page treats it as "not a generation", not as a failure).
    cy.intercept('GET', '/api/persona/video-generations/*', {
      statusCode: 404,
      body: { success: false, error: 'Not found' },
    }).as('generationDetail');
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
    // The detail page the create response points at. Defined last so it wins
    // over the catch-all generations intercept for that id.
    cy.intercept('GET', `/api/schedule/slots/${NEW_POST_SLOT_ID}`, newPostSlotDetailPayload()).as('slotDetail');
  });

  it('opens the new post detail page with its 0% progress', () => {
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
    // The single topic field. The app's default locale is pt, so the aria
    // label is the PT copy — hardcoding the English one made this spec fail
    // on the label, not on the flow.
    cy.get('[aria-label="Tema"]').type('E2E topic one');
    // First publish — must parse in the selected timezone.
    setDateTimeValue('input[type="datetime-local"]', '2030-06-01T09:00');
    // At least one publishing account.
    cy.get('[data-testid="account-card"]').first().click();

    cy.contains('button', /Agendar posts|Schedule posts/).click();

    cy.wait('@createPost').its('request.body').should('deep.include', {
      personaId: 'persona-e2e-1',
      topics: ['E2E topic one'],
    });

    // Success opens THAT post's page, not the list: the video and its live
    // progress are what the user came for.
    cy.location('pathname').should('eq', `/posts/${NEW_POST_SLOT_ID}`);
    cy.wait('@slotDetail');
    cy.contains('E2E topic one').should('be.visible');
    // Freshly created: 0% with a progress bar, like the detail page shows.
    cy.contains('0%').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '0');
  });

  it('offers a single topic field with no add/remove controls', () => {
    cy.visit('/posts/new');
    cy.wait('@personas');

    cy.get('[aria-label="Tema"]').should('have.length', 1);
    // A second topic is a second post: the batch form is gone from /posts/new.
    cy.contains('button', /Adicionar tema|Add topic/).should('not.exist');
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
