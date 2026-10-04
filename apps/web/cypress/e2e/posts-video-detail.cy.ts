//---------------
// Posts video detail E2E — a history post's detail page must load its
// video through the download proxy without 404s. This is the regression
// test for the user-reported black player: the video exists in the engine
// but the guessed file name (final-1.mp4) 404'd, and the proxy's fallback
// redirect must resolve it.
//
// Everything the page needs is mocked at the network level (the suite
// never depends on the E2E user owning real history posts): the schedule
// list, the status list with one published slot, the slot detail, and the
// finished render served as a fixture through the download proxy path.
// The proxy fallback itself is pinned by unit tests
// (video-download route.test.ts); here the page must request the video
// and the bytes must decode (loadedmetadata fires).
//---------------

const DETAIL_SCHEDULE_ID = 'sched-detail-1';
const DETAIL_SLOT_ID = 'slot-detail-1';
const DETAIL_TASK_ID = 'task-detail-1';
const DETAIL_PERSONA_ID = 'persona-detail-1';
const DETAIL_PERSONA_NAME = 'Maya Detail';
const DETAIL_TOPIC = 'Um post do histórico';

function detailScheduleRow() {
  return {
    id: DETAIL_SCHEDULE_ID,
    persona_id: DETAIL_PERSONA_ID,
    providers: ['bluesky'],
    youtube_account_ids: [],
    instagram_account_ids: [],
    linkedin_account_ids: [],
    bluesky_account_ids: [],
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: 1,
    timezone: 'UTC',
    active: true,
  };
}

function detailPublishedSlotRow() {
  return {
    id: DETAIL_SLOT_ID,
    schedule_id: DETAIL_SCHEDULE_ID,
    slot_at: '2026-10-01T20:00:00.000Z',
    status: 'published',
    topic: DETAIL_TOPIC,
    error: null,
    published_at: '2026-10-01T20:05:00.000Z',
    task_id: DETAIL_TASK_ID,
    progress: 100,
    stage: 'done',
    queuePosition: null,
    queueTotal: null,
    retryable: null,
  };
}

function detailSlotPayload() {
  return {
    success: true,
    slot: {
      id: DETAIL_SLOT_ID,
      scheduleId: DETAIL_SCHEDULE_ID,
      slotAt: '2026-10-01T20:00:00.000Z',
      status: 'published',
      topic: DETAIL_TOPIC,
      error: null,
      publishedAt: '2026-10-01T20:05:00.000Z',
      taskId: DETAIL_TASK_ID,
      progress: 100,
      stage: 'done',
      retryable: null,
      queuePosition: null,
      queueTotal: null,
      publishLinks: [],
    },
    schedule: {
      id: DETAIL_SCHEDULE_ID,
      personaId: DETAIL_PERSONA_ID,
      providers: ['bluesky'],
      youtubeAccountIds: [],
      instagramAccountIds: [],
      linkedinAccountIds: [],
      blueskyAccountIds: [],
    },
    persona: { id: DETAIL_PERSONA_ID, name: DETAIL_PERSONA_NAME },
  };
}

describe('Posts video detail', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    // /posts list dependencies: the schedule must exist or the status
    // query's slots are dropped (the page filters by schedule id).
    cy.intercept('GET', '/api/schedule', {
      statusCode: 200,
      body: { success: true, schedules: [detailScheduleRow()] },
    });
    cy.intercept('GET', '/api/schedule/status*', {
      statusCode: 200,
      body: { success: true, upcoming: [], recent: [detailPublishedSlotRow()] },
    });
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: {
        authenticated: true,
        personas: [{ id: DETAIL_PERSONA_ID, name: DETAIL_PERSONA_NAME }],
      },
    });
    cy.intercept('GET', '/api/persona/video-generations?*', {
      statusCode: 200,
      body: { success: true, generations: [] },
    });

    // Detail page: the slot resolves, the generations lookup 404s so the
    // slot view renders.
    cy.intercept('GET', `/api/schedule/slots/${DETAIL_SLOT_ID}`, {
      statusCode: 200,
      body: detailSlotPayload(),
    }).as('slotDetail');
    cy.intercept('GET', `/api/persona/video-generations/${DETAIL_SLOT_ID}`, {
      statusCode: 404,
      body: { success: false },
    });

    // The finished render, served through the download proxy path. The
    // ',null' encoding suffix is load-bearing: .mp4 is not in Cypress's
    // binary fixture extension list, so without it the file is read as
    // UTF-8 and the bytes are corrupted — the player then fails with
    // MEDIA_ERR_SRC_NOT_SUPPORTED even though the file is valid. 'null'
    // makes the server return a Buffer, which streams byte-identical
    // (the same path .png/.jpg/.zip fixtures take).
    cy.intercept('GET', `/api/persona/video-download/${DETAIL_TASK_ID}/final-1.mp4`, {
      fixture: 'e2e-generated.mp4,null',
    }).as('videoDownload');
  });

  it('opens a history post detail and loads its video without 404s', () => {
    cy.visit('/posts');

    // History tab holds published posts and manual generations.
    cy.contains('button', /Histórico|History/).click();

    // Open the post card by exact href — a bare `a[href^="/posts/"]`
    // matches /posts/new first and lands on the creation page instead.
    cy.get(`a[href="/posts/${DETAIL_SLOT_ID}"]`).first().click();
    cy.url().should('match', new RegExp(`/posts/${DETAIL_SLOT_ID}$`));

    // The detail page must resolve its entity by id, and neither the
    // detail fetch nor the video download may 404.
    cy.wait('@slotDetail').then((interception) => {
      expect(interception.response?.statusCode, 'slot detail must not 404').to.not.eq(404);
    });

    // The video element points at the download proxy...
    cy.get('video').should(
      'have.attr',
      'src',
      `/api/persona/video-download/${DETAIL_TASK_ID}/final-1.mp4`,
    );

    // ...and the bytes actually decode: the debug line switches from
    // "loading…" to the resolved dimensions once loadedmetadata fires.
    cy.get('[data-testid="video-debug"]', { timeout: 30_000 })
      .invoke('text')
      .should('match', /\d+×\d+/);
    cy.wait('@videoDownload').then((interception) => {
      expect(interception.response?.statusCode, 'video download must not 404').to.not.eq(404);
    });
  });
});
