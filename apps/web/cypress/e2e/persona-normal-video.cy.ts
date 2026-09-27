//---------------
// Persona normal-video E2E — fluxo completo no navegador: login,
// criação da persona pela UI (personagem + voz + nicho), API key,
// geração de vídeo NORMAL (lipsync: false — sem InfiniteTalk/H200),
// polling até concluir e download do MP4 com validação de conteúdo.
//---------------

interface PersonaListResponse {
  personas: Array<{ id: string; name: string }>;
}

interface VideoJobResponse {
  success: boolean;
  taskId?: string;
  error?: string;
}

interface VideoStatusResponse {
  status: number;
  data?: {
    state?: number;
    videos?: string[];
    progress?: number;
  };
  message?: string;
}

interface SavedVideoInfo {
  path: string;
  bytes: number;
  isMp4: boolean;
}

const POLL_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 5_000;

describe('Persona normal video com download', () => {
  let personaName: string;
  let personaId: string | undefined;
  let taskId: string | undefined;

  before(() => {
    personaName = `Cypress Normal ${Date.now()}`;
    cy.loginE2EUser();
  });

  afterEach(() => {
    if (taskId) {
      cy.request({
        method: 'DELETE',
        url: `/api/persona/video-task/${encodeURIComponent(taskId)}`,
        failOnStatusCode: false,
      });
    }
    if (personaId) {
      cy.request({
        method: 'DELETE',
        url: `/api/persona?personaId=${encodeURIComponent(personaId)}`,
        failOnStatusCode: false,
      });
    }
  });

  it('cria persona pela UI, gera vídeo normal e baixa o MP4', () => {
    //---------------
    // 1. UI: personagem 1 (só foto), nome, voz da casa e nicho.
    // A primeira chamada aquece o engine (imports lazy) — timeouts generosos.
    //---------------
    cy.visit('/persona');
    cy.get('button[aria-label="Escolha um personagem 1"]', { timeout: 120_000 }).should('be.visible').click();
    cy.get('#persona-name').type(personaName);
    cy.contains('button', 'Voz feminina calma', { timeout: 60_000 }).click();
    cy.get('[data-testid="persona-niche"]').type('finanças pessoais');
    cy.contains('button', 'Criar persona').click();
    cy.contains('Persona criada!', { timeout: 60_000 }).should('be.visible');

    //---------------
    // 2. Recupera o personaId criado
    //---------------
    cy.request('/api/persona/list').then((response) => {
      expect(response.status).to.eq(200);
      const body = response.body as PersonaListResponse;
      const persona = body.personas.find((candidate) => candidate.name === personaName);
      expect(persona, 'persona recém-criada aparece na lista').to.exist;
      personaId = persona?.id;
    });

    //---------------
    // 3. Job de vídeo NORMAL: lipsync false (sem H200), nicho no assunto
    //---------------
    cy.then(() => {
      return cy.request({
        method: 'POST',
        url: '/api/persona/video-job',
        body: {
          personaId,
          video_subject: 'Dicas simples de finanças pessoais para o dia a dia',
          video_language: 'pt',
          lipsync: false,
        },
        timeout: 30_000,
      });
    }).then((response) => {
      expect(response.status).to.eq(200);
      const body = response.body as VideoJobResponse;
      expect(body.success).to.eq(true);
      expect(body.taskId).to.be.a('string');
      taskId = body.taskId;
      cy.log(`task criada: ${taskId}`);
    });

    //---------------
    // 5. Polling até concluir (state 1) com progresso no log
    //---------------
    cy.then(() => {
      return pollNormalVideo(taskId as string, POLL_TIMEOUT_MS);
    }).then((body) => {
      expect(body.data?.state, 'task deve terminar completa').to.eq(1);
      const videos = body.data?.videos;
      expect(videos).to.be.an('array').and.not.be.empty;
      const videoUrl = videos?.[0] as string;
      const filename = videoUrl.split('/').pop() as string;
      expect(filename).to.match(/\.mp4$/);
      cy.wrap({ videoUrl, filename }).as('videoInfo');
    });

    //---------------
    // 6. Download pela rota autenticada da app + validação do MP4.
    // videos[0] vem como "api/v1/download/{taskId}/{arquivo}"; a rota
    // web espera /video-download/{taskId}/{arquivo}.
    //---------------
    cy.get<{ videoUrl: string; filename: string }>('@videoInfo').then(({ videoUrl, filename }) => {
      expect(videoUrl.endsWith(filename), 'filename é o último segmento do path').to.eq(true);
      cy.request({
        url: `/api/persona/video-download/${encodeURIComponent(taskId as string)}/${encodeURIComponent(filename)}`,
        encoding: 'binary',
        timeout: 120_000,
      }).then((response) => {
        expect(response.status).to.eq(200);
        const base64 = Cypress.Buffer.from(response.body as unknown as string, 'binary').toString('base64');
        cy.task<SavedVideoInfo>('saveDownloadedVideo', {
          filename: `persona-normal-${Date.now()}-${filename}`,
          base64,
          contentType: (response.headers['content-type'] as string) ?? '',
        }).then((saved) => {
          expect(saved.isMp4).to.eq(true);
          expect(saved.bytes).to.be.greaterThan(100_000);
          cy.log(`MP4 salvo em ${saved.path} (${saved.bytes} bytes)`);
          cy.wrap(saved).as('savedVideo');
        });
      });
    });
    cy.get<SavedVideoInfo>('@savedVideo').then((saved) => {
      cy.readFile(saved.path, 'binary').should('not.be.empty');
    });
  });
});

//---------------
// pollNormalVideo — consulta o status até state 1 (completo) ou -1
// (falha), logando o progresso a cada tentativa.
//---------------
function pollNormalVideo(taskId: string, timeoutMs: number): Cypress.Chainable<VideoStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  return cy
    .request({
      url: `/api/persona/video-status/${encodeURIComponent(taskId)}`,
      failOnStatusCode: false,
    })
    .then((response) => {
      const body = response.body as VideoStatusResponse;
      if (body.data?.state === 1 || body.data?.state === -1) return cy.wrap(body);
      if (typeof body.data?.progress === 'number') {
        cy.log(`progresso: ${body.data.progress.toFixed(1)}%`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for normal video task ${taskId}`);
      }
      return cy.wait(POLL_INTERVAL_MS).then(() => pollNormalVideo(taskId, deadline - Date.now()));
    });
}
