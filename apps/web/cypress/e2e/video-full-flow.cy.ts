//---------------
// Video full flow — the complete journey the product owner described:
//  1. the user creates a persona (real /persona UI),
//  2. the user connects a social network (mocked Bluesky form, no OAuth),
//  3. the user creates a video via /posts/new — creation REQUIRES scheduling,
//     so the schedule is mocked for "tomorrow",
//  4. the generation progress screen appears and the user waits,
//  5. the "video generated" screen shows the video to the user.
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
  voiceId: 'calm',
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
    topic: TOPIC,
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
// slotDetail — the camelCase payload GET /api/schedule/slots/:id returns
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
      topic: TOPIC,
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
      body: { voices: [{ id: 'calm' }, { id: 'energetic' }] },
    });
    cy.intercept('GET', '/api/persona/voice-sample-languages', {
      statusCode: 200,
      body: { languages: [{ code: 'pt-br', label: 'Português' }] },
    });
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: { authenticated: true, personas: [PERSONA] },
    }).as('personaList');

    // Social accounts for /accounts and /posts/new (filtered per provider
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
    cy.contains('button', 'Voz feminina calma').click();

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

  it('3 — cria e agenda o vídeo para amanhã (agendar é obrigatório)', () => {
    const startAtDate = tomorrowDateInput();
    cy.intercept('POST', '/api/videos/generate-and-schedule', (req) => {
      console.log('[DEBUG] Create and schedule request body:', req.body);
      req.reply({
        statusCode: 200,
        body: {
          success: true,
          schedule: { id: SCHEDULE_ID },
          slots: [
            {
              slotId: SLOT_ID,
              slotAt: `${startAtDate}T20:00:00.000Z`,
              topic: TOPIC,
              taskId: E2E_TASK_ID,
              status: 'generating',
            },
          ],
          replayed: false,
          error: null,
          code: null,
          need: null,
          have: null,
        },
      });
    }).as('createPost');

    // The success navigation lands on the new post's own page, whose detail
    // query must be stubbed like the later tests do — the create above is
    // stubbed, so no real slot exists for the real backend to return.
    cy.intercept('GET', `/api/schedule/slots/${SLOT_ID}`, {
      statusCode: 200,
      body: slotDetail('generating', 0, null),
    }).as('slotDetail');

    // From here on the account is connected for this test.
    blueskyConnected = true;

    cy.visit('/posts/new');
    cy.wait('@personaList');

    // Real UI: pick the persona card, type one topic, select the Bluesky
    // account, set the first publication for tomorrow 20:00.
    cy.contains('label', PERSONA.name).click();
    // The click must actually select: assert the store-backed selected state
    // instead of discovering a silent no-op at the submit wait.
    cy.get('label[data-selected="true"]').should('contain', PERSONA.name);
    cy.get('input[aria-label="Tema"]').type(TOPIC);
    cy.contains('[data-testid="account-card"]', BLUESKY_ACCOUNT.handle).click();
    cy.get('[data-testid="account-card-select"]').should('be.checked');
    // A datetime-local input does not take .type() reliably (its segments
    // are filled per keystroke). Set the value through the native prototype
    // setter and dispatch a native 'input' event: React's onChange listens
    // to 'input' (not 'change'), and assigning .value directly trips React's
    // value tracker, which then swallows the event and the store never
    // updates — the submit validation rejects with no request fired.
    cy.get('input[type="datetime-local"]').then(($input) => {
      const el = $input[0] as HTMLInputElement;
      const view = el.ownerDocument.defaultView;
      if (!view) throw new Error('datetime input has no defaultView');
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('native input value setter not found');
      setter.call(el, `${startAtDate}T20:00`);
      el.dispatchEvent(new view.Event('input', { bubbles: true }));
    });
    cy.get('input[type="datetime-local"]').should('have.value', `${startAtDate}T20:00`);
    // The schedule preview renders only once persona, topics and date are
    // all in the store — the honest gate before submitting.
    cy.contains('Preencha persona, temas e data para ver a prévia.').should('not.exist');

    cy.contains('button', 'Agendar posts').click();

    cy.wait('@createPost').then((interception) => {
      const body = interception.request.body as Record<string, unknown>;
      const publishing = body.publishing as Record<string, unknown>;
      const schedule = publishing.schedule as Record<string, unknown>;
      expect(body.personaId, 'persona').to.eq(PERSONA.id);
      expect(body.topics, 'topics').to.deep.eq([TOPIC]);
      expect(publishing.providers, 'providers').to.deep.eq(['bluesky']);
      expect(
        (publishing.accounts as Record<string, string[]>).bluesky,
        'accounts',
      ).to.deep.eq([BLUESKY_ACCOUNT.did]);
      // The schedule is mocked for "tomorrow": the request must carry it.
      expect(String(schedule.startAt), 'schedule startAt').to.contain(startAtDate);
    });

    // Success opens the created post's own page (single-topic form, #116),
    // where the video and its live progress live.
    cy.url().should('match', /\/posts\/slot-e2e-1$/);
    cy.contains(TOPIC).should('be.visible');
  });

  it('4 — mostra a tela de progresso enquanto o vídeo está sendo gerado', () => {
    // First poll: still generating. The detail endpoint 404s on the
    // generations route, so the slot view is the one rendered.
    cy.intercept('GET', `/api/schedule/slots/${SLOT_ID}`, {
      statusCode: 200,
      body: slotDetail('generating', 35, 'render'),
    }).as('slotDetail');
    cy.intercept('GET', `/api/persona/video-generations/${SLOT_ID}`, {
      statusCode: 404,
      body: { success: false },
    });

    cy.visit(`/posts/${SLOT_ID}`);
    cy.wait('@slotDetail');

    // The user waits on the progress screen: status badge, live progress
    // bar with the polled percentage, and the "being generated" copy.
    cy.contains('Gerando vídeo').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '35');
    cy.contains('O vídeo está sendo gerado agora.').should('be.visible');
  });

  it('5 — mostra o vídeo quando a geração completa', () => {
    // Later poll: ready with a task id — the mocked engine progress.
    cy.intercept('GET', `/api/schedule/slots/${SLOT_ID}`, {
      statusCode: 200,
      body: slotDetail('ready', 100, 'done'),
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
