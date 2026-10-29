//---------------
// Video full flow — the complete journey the product owner described:
//  1. the user creates a persona (real /persona UI),
//  2. the user connects a social network (mocked Bluesky form, no OAuth),
//  3. the generation progress screen appears and the user waits,
//  4. the "video generated" screen shows the video to the user.
//  (Creation itself is API/MCP-only since Phase 4 removed /posts/new,
//  so the flow starts from an already-created slot's detail screens.)
//
// Only what cannot run in CI is mocked: the social connection, the
// generate-and-schedule call (it would spend tokens and hit the real
// engine), and the engine task progress. Everything else drives the real
// UI. Like the other specs, cy.loginE2EUser() opens a real Supabase
// session — intercepts alone are not enough for the middleware.
//---------------

const PERSONA = {
  id: 'persona-e2e-1',
  name: 'Maya E2E',
  createdAt: new Date().toISOString(),
  voiceId: 'chatterbox:en_us_male_01',
  videoAspect: '9:16',
  faceMixPercent: 0,
  faceQuality: 'ok',
};

const BLUESKY_ACCOUNT = {
  provider: 'bluesky',
  recordId: 'row-e2e',
  did: 'did:plc:e2e',
  handle: 'e2e.bsky.social',
  connectedAt: 1_700_000_000_000,
  lastUsed: 1_700_000_000_000,
};

const SCHEDULE_ID = 'sched-e2e-1';
const SLOT_ID = 'slot-e2e-1';
const E2E_TASK_ID = 'task-e2e-1';
const TOPIC = 'Hábitos matinais que mudam o dia';

//---------------
// tomorrowDateInput — "YYYY-MM-DD" for tomorrow in the browser timezone,
// the value format a datetime-local input expects.
//---------------
function tomorrowDateInput(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
}

//---------------
// scheduleRow — the snake_case row GET /api/schedule returns, mapped by
// mapSchedule into the ScheduleConfig the /posts page joins against.
//---------------
function scheduleRow() {
  return {
    id: SCHEDULE_ID,
    persona_id: PERSONA.id,
    providers: ['bluesky'],
    youtube_account_ids: [],
    instagram_account_ids: [],
    linkedin_account_ids: [],
    bluesky_account_ids: [BLUESKY_ACCOUNT.did],
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: 1,
    timezone: 'UTC',
    active: true,
  };
}

//---------------
// slotRow — the snake_case row GET /api/schedule/status returns, mapped by
// mapSlot into the ScheduledSlot the /posts page renders.
//---------------
function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SLOT_ID,
    schedule_id: SCHEDULE_ID,
    slot_at: `${tomorrowDateInput()}T20:00:00.000Z`,
    status: 'generating',
    title: TOPIC,
    error: null,
    published_at: null,
    task_id: E2E_TASK_ID,
    progress: 35,
    stage: 'render',
    queuePosition: null,
    queueTotal: null,
    retryable: null,
    ...overrides,
  };
}

//---------------
// slotDetail — the camelCase slot payload the unified GET /api/posts/[id]
// returns for a slot id (kind: 'slot')
// (SlotDetailPayload), read by the /posts/[id] detail page.
//---------------
function slotDetail(status: 'generating' | 'ready', progress: number, stage: string | null) {
  return {
    success: true,
    slot: {
      id: SLOT_ID,
      scheduleId: SCHEDULE_ID,
      slotAt: `${tomorrowDateInput()}T20:00:00.000Z`,
      status,
      title: TOPIC,
      error: null,
      publishedAt: null,
      taskId: E2E_TASK_ID,
      progress,
      stage,
      retryable: null,
      queuePosition: null,
      queueTotal: null,
      publishLinks: [],
    },
    schedule: {
      id: SCHEDULE_ID,
      personaId: PERSONA.id,
      providers: ['bluesky'],
      youtubeAccountIds: [],
      instagramAccountIds: [],
      linkedinAccountIds: [],
      blueskyAccountIds: [BLUESKY_ACCOUNT.did],
    },
    persona: { id: PERSONA.id, name: PERSONA.name },
  };
}

describe('Fluxo completo de vídeo — persona → rede social → agendar → gerar → assistir', () => {
  // Toggled by the Bluesky connect test: the account list is empty until
  // the mocked connect succeeds, then the refetch picks the account up.
  let blueskyConnected = false;

  beforeEach(() => {
    blueskyConnected = false;
    cy.loginE2EUser();

    // Persona page dependencies.
    cy.intercept('GET', '/api/persona/voices', {
      statusCode: 200,
      body: {
        voices: ['en_us_male_01', 'en_us_female_01'].map((name, index) => ({
          id: `chatterbox:${name}`,
          label: null,
          provider: 'chatterbox',
          gender: index === 0 ? 'male' : 'female',
          accent: 'us',
          kind: 'standard',
          description: 'American voice.',
        })),
      },
    });
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: { authenticated: true, personas: [PERSONA] },
    }).as('personaList');

    // Social accounts for /accounts (filtered per provider
    // by fetchProviderAccounts from this single response).
    cy.intercept('GET', '/api/account', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          authenticated: true,
          message: 'ok',
          accounts: blueskyConnected ? [BLUESKY_ACCOUNT] : [],
        },
      });
    }).as('getAccounts');

    // /posts list dependencies: the schedule must exist or the status
    // query's slots are dropped (joinedUpcoming filters by schedule id).
    cy.intercept('GET', '/api/schedule', {
      statusCode: 200,
      body: { success: true, schedules: [scheduleRow()] },
    });
    cy.intercept('GET', '/api/schedule/status*', {
      statusCode: 200,
      body: { success: true, upcoming: [slotRow()], recent: [] },
    });
    cy.intercept('GET', '/api/persona/video-generations?*', {
      statusCode: 200,
      body: { success: true, generations: [] },
    });
  });

  it('1 — cria a persona pela UI real', () => {
    cy.intercept('POST', '/api/persona', (req) => {
      console.log('[DEBUG] Create persona request body:', req.body);
      req.reply({ statusCode: 200, body: { success: true, personaId: PERSONA.id } });
    }).as('createPersona');

    cy.visit('/persona');

    // Real UI: name, a character from the carousel, a house voice.
    cy.get('#persona-name').type(PERSONA.name);
    cy.get('button[aria-label="Escolha um personagem 1"]').click();
    cy.pickHouseVoice('en us male 01');

    cy.contains('button', 'Criar persona').click();
    cy.wait('@createPersona');

    // Success lands on the personas list, where the user sees the persona
    // they just created.
    cy.url().should('match', /\/personas$/);
  });

  it('2 — conecta o Bluesky (mockado, sem OAuth)', () => {
    cy.intercept('POST', '/api/bluesky-connect', (req) => {
      blueskyConnected = true;
      console.log('[DEBUG] Bluesky connect request body:', req.body);
      req.reply({ statusCode: 200, body: { success: true, accountId: 'row-e2e', did: BLUESKY_ACCOUNT.did } });
    }).as('blueskyConnect');

    cy.visit('/accounts');
    cy.wait('@getAccounts');

    // The connect control is a dialog now (not the old inline panel): the
    // Bluesky section's connect button opens it.
    cy.contains('section', 'Bluesky').within(() => {
      cy.contains('button', 'Conectar uma conta').click();
    });
    cy.get('[role="dialog"]').should('be.visible');

    cy.get('[data-testid="bluesky-handle-input"]').type(BLUESKY_ACCOUNT.handle);
    cy.get('[data-testid="bluesky-password-input"]').type('xxxx-xxxx-xxxx-xxxx');
    cy.get('[data-testid="bluesky-connect-button"]').click();
    cy.wait('@blueskyConnect');

    // The dialog closes and the refetch renders the connected account card.
    cy.get('[role="dialog"]').should('not.exist');
    cy.wait('@getAccounts');
    cy.contains(BLUESKY_ACCOUNT.handle).should('be.visible');
  });

  it('3 — mostra a tela de progresso enquanto o vídeo está sendo gerado', () => {
    // First poll: still generating. The detail endpoint 404s on the
    // generations route, so the slot view is the one rendered.
    cy.intercept('GET', `/api/posts/${SLOT_ID}`, {
      statusCode: 200,
      body: { ...slotDetail('generating', 35, 'render'), kind: 'slot' },
    }).as('slotDetail');

    cy.visit(`/posts/${SLOT_ID}`);
    cy.wait('@slotDetail');

    // The user waits on the progress screen: status badge, live progress
    // bar with the polled percentage, and the "being generated" copy.
    cy.contains('Gerando vídeo').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '35');
    cy.contains('O vídeo está sendo gerado agora.').should('be.visible');
  });

  it('4 — mostra o vídeo quando a geração completa', () => {
    // Later poll: ready with a task id — the mocked engine progress.
    cy.intercept('GET', `/api/posts/${SLOT_ID}`, {
      statusCode: 200,
      body: { ...slotDetail('ready', 100, 'done'), kind: 'slot' },
    }).as('slotDetail');
    cy.intercept('GET', `/api/persona/video-generations/${SLOT_ID}`, {
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
    cy.intercept(
      'GET',
      `/api/persona/video-download/${E2E_TASK_ID}/final-1.mp4`,
      { fixture: 'e2e-generated.mp4,null' },
    ).as('videoDownload');

    cy.visit(`/posts/${SLOT_ID}`);
    cy.wait('@slotDetail');

    // The "video generated" screen shows the video to the user: a real
    // <video> element pointed at the download proxy.
    cy.get('video')
      .should('have.attr', 'src', `/api/persona/video-download/${E2E_TASK_ID}/final-1.mp4`);

    // The video bytes actually decode: the debug line switches from
    // "loading…" to the resolved dimensions once loadedmetadata fires.
    cy.get('[data-testid="video-debug"]', { timeout: 30_000 })
      .invoke('text')
      .should('match', /\d+×\d+/);
    cy.wait('@videoDownload');
  });
});
