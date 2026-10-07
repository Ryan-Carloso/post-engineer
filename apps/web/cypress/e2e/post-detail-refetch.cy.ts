//---------------
// Post detail auto-refresh E2E — regression for the frozen detail page:
// useSlotDetailQuery is the only query on this screen with a
// refetchInterval, so a user parked on a generating post must see it flip
// to ready (and the <video> appear) without a reload. The slot endpoint
// answers "generating" on the first hit and "ready" from the second on;
// cy.clock + cy.tick fire the 60s interval without a 60s real wait.
// The login itself is real (the middleware bounces unauthenticated visits
// to /landing, so every app-page spec logs in).
//---------------

const SLOT_ID = 'slot-e2e-refetch';
const SCHEDULE_ID = 'sched-e2e-refetch';

function slotDetailPayload(status: 'generating' | 'ready') {
  const generating = status === 'generating';
  return {
    success: true,
    slot: {
      id: SLOT_ID,
      scheduleId: SCHEDULE_ID,
      slotAt: '2030-06-01T10:00:00.000Z',
      status,
      topic: 'E2E caption for the refetch spec',
      error: null,
      publishedAt: null,
      taskId: 'task-e2e-refetch',
      progress: generating ? 45 : 100,
      stage: generating ? 'lipsync' : 'done',
      retryable: null,
      publishLinks: [],
      progressHistory: [],
      queuePosition: 1,
      queueTotal: 3,
    },
    schedule: {
      id: SCHEDULE_ID,
      personaId: 'persona-e2e-1',
      providers: ['youtube'],
      youtubeAccountIds: ['ch-e2e-1'],
      instagramAccountIds: [],
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
      niche: null,
      paragraphNumber: null,
      faceQuality: null,
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
    ],
  };
}

describe('Post detail auto-refresh', () => {
  beforeEach(() => {
    // Real session cookie first: with test isolation on, the login must
    // run in beforeEach — a before() login only authenticates the first
    // test and every later visit bounces to /landing, where no slot
    // request ever fires and cy.wait('@slotDetail') times out with
    // "No request ever occurred".
    cy.loginE2EUser();

    let hits = 0;
    cy.intercept('GET', '/api/schedule/slots/*', (req) => {
      hits += 1;
      req.reply(slotDetailPayload(hits === 1 ? 'generating' : 'ready'));
    }).as('slotDetail');
    cy.intercept('GET', '/api/persona/video-generations/*', {
      statusCode: 404,
      body: { success: false, error: 'Not found' },
    });
    cy.intercept('GET', '/api/account', accountsPayload());
    // The <video> src is never a real file in this spec — answer 404 so
    // the player stays quiet instead of hitting the dev server.
    cy.intercept('GET', '/api/persona/video-download/*', { statusCode: 404 });

    // Install the fake clock before the app loads so the query's 60s
    // refetchInterval is a controllable timer. Only the interval timers
    // (and Date) are faked: React Query delivers query results through a
    // real setTimeout(0) batch, and faking setTimeout wedges the query in
    // its loading state forever — the stubbed response arrives but the
    // page never leaves the skeleton.
    cy.clock(Date.now(), ['setInterval', 'clearInterval', 'Date']);
    cy.visit(`/posts/${SLOT_ID}`);
    // The page resolves its entity by id through the detail endpoint —
    // wait for the stubbed response the page actually consumes.
    cy.wait('@slotDetail');
  });

  it('flips from generating to ready and shows the video without a reload', () => {
    // First hit: generating — progress UI, no player.
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '45');
    cy.get('video').should('not.exist');

    // Fire the 60s refetchInterval: the second hit answers ready.
    cy.tick(60_000);
    cy.wait('@slotDetail');

    // No reload happened — the same page now renders the player.
    cy.get('video').should('exist');
    cy.get('video').should(
      'have.attr',
      'src',
      '/api/persona/video-download/task-e2e-refetch/final-1.mp4',
    );
    cy.get('[role="progressbar"]').should('not.exist');
  });
});

export {};
