const SLOT_ID = 'slot-e2e-refetch';
const SCHEDULE_ID = 'sched-e2e-refetch';

function slotDetailPayload(status: 'generating' | 'ready') {
  const generating = status === 'generating';
  return {
    success: true,
    kind: 'slot',
    slot: {
      id: SLOT_ID,
      scheduleId: SCHEDULE_ID,
      slotAt: '2030-06-01T10:00:00.000Z',
      status,
      title: 'E2E caption for the refetch spec',
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
      voiceover: false,
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
    cy.loginE2EUser();

    let hits = 0;
    cy.intercept('GET', '/api/posts/*', (req) => {
      hits += 1;
      req.reply(slotDetailPayload(hits === 1 ? 'generating' : 'ready'));
    }).as('slotDetail');
    cy.intercept('GET', '/api/account', accountsPayload());
    cy.intercept('GET', '/api/persona/video-download/*', { statusCode: 404 });

    cy.clock(Date.now(), ['setInterval', 'clearInterval', 'Date']);
    cy.visit(`/posts/${SLOT_ID}`);
    cy.wait('@slotDetail');
  });

  it('flips from generating to ready and shows the video without a reload', () => {
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '45');
    cy.get('video').should('not.exist');

    cy.tick(60_000);
    cy.wait('@slotDetail');

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
