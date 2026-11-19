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
    title: DETAIL_TOPIC,
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
      title: DETAIL_TOPIC,
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
    cy.intercept('GET', '/api/account', {
      statusCode: 200,
      body: { authenticated: true, accounts: [] },
    });
    cy.intercept('GET', '/api/persona/video-generations?*', {
      statusCode: 200,
      body: { success: true, generations: [] },
    });

    cy.intercept('GET', `/api/posts/${DETAIL_SLOT_ID}`, {
      statusCode: 200,
      body: { ...detailSlotPayload(), kind: 'slot' },
    }).as('slotDetail');

    cy.intercept('GET', `/api/persona/video-download/${DETAIL_TASK_ID}/final-1.mp4`, {
      fixture: 'e2e-generated.mp4,null',
    }).as('videoDownload');
  });

  it('opens a history post detail and loads its video without 404s', () => {
    cy.visit('/posts/history');

    cy.get(`a[href="/posts/${DETAIL_SLOT_ID}"]`).first().click();
    cy.url().should('match', new RegExp(`/posts/${DETAIL_SLOT_ID}$`));

    cy.wait('@slotDetail').then((interception) => {
      expect(interception.response?.statusCode, 'slot detail must not 404').to.not.eq(404);
    });

    cy.get('video').should(
      'have.attr',
      'src',
      `/api/persona/video-download/${DETAIL_TASK_ID}/final-1.mp4`,
    );

    cy.get('[data-testid="video-debug"]', { timeout: 30_000 })
      .invoke('text')
      .should('match', /\d+×\d+/);
    cy.wait('@videoDownload').then((interception) => {
      expect(interception.response?.statusCode, 'video download must not 404').to.not.eq(404);
    });
  });
});
