//---------------
// Persona full-video E2E — fluxo produtivo completo até o MP4 final.
// Este spec é executado pelo cypress run normal e pode consumir recursos
// reais de LLM, TTS e materiais configurados no money-print.
//---------------

interface PersonaCreateResponse {
  success: boolean;
  personaId?: string;
}

interface VideoJobResponse {
  success: boolean;
  taskId?: string;
}

interface FullTaskResponse {
  status: number;
  data?: {
    state?: number;
    videos?: string[];
    progress?: number;
  };
}

interface SavedVideoInfo {
  path: string;
  bytes: number;
  isMp4: boolean;
}

describe('Persona full video', () => {
  let personaId: string | undefined;
  let taskId: string | undefined;

  before(() => {
    cy.loginE2EUser();
  });

  afterEach(() => {
    if (personaId) {
      cy.request({ method: 'DELETE', url: `/api/persona?personaId=${encodeURIComponent(personaId)}`, failOnStatusCode: false });
    }
  });

  it('usa uma persona persistida para gerar um vídeo completo', () => {
    cy.window().then({ timeout: 30_000 }, (window) => {
      const formData = new window.FormData();
      formData.append('name', 'Cypress Full Video Persona');
      formData.append('voiceId', 'calm');
      const pngBytes = Uint8Array.from(
        window.atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        ),
        (character) => character.charCodeAt(0),
      );
      formData.append('photo', new window.File([pngBytes], 'persona.png', { type: 'image/png' }));
      return window.fetch('/api/persona', { method: 'POST', body: formData });
    })
      .then((response) => response.json() as Promise<PersonaCreateResponse>)
      .then((body) => {
        expect(body.success).to.eq(true);
        expect(body.personaId).to.be.a('string');
        personaId = body.personaId;
      });

    cy.then(() => {
      expect(personaId).to.be.a('string');
      return cy.request({
        method: 'POST',
        url: '/api/persona/video-job',
        body: {
          personaId,
          video_subject: 'A quiet morning in a mountain village',
        },
        timeout: 30_000,
      });
    }).then((response) => {
      const body = response.body as VideoJobResponse;
      expect(response.status).to.eq(200);
      expect(body.success).to.eq(true);
      expect(body.taskId).to.be.a('string');
      taskId = body.taskId;
    });

    cy.then(() => {
      expect(taskId).to.be.a('string');
      return pollFullVideo(taskId as string, 30 * 60_000);
    }).then((body) => {
      expect(body.data?.state).to.eq(1);
      expect(body.data?.videos).to.be.an('array').and.not.be.empty;
      const videoUrl = body.data?.videos?.[0];
      expect(videoUrl).to.be.a('string');
      return downloadThroughProxy(taskId as string, videoUrl as string);
    }).then((saved) => {
      expect(saved.isMp4).to.eq(true);
      expect(saved.bytes).to.be.greaterThan(100_000);
      cy.log(`MP4 saved to ${saved.path} (${saved.bytes} bytes)`);
    });
  });
});

function pollFullVideo(taskId: string, timeoutMs: number): Cypress.Chainable<FullTaskResponse> {
  const deadline = Date.now() + timeoutMs;
  return cy.request({ url: `/api/persona/video-status/${encodeURIComponent(taskId)}`, failOnStatusCode: false }).then((response) => {
    const body = response.body as FullTaskResponse;
    if (body.data?.state === 1 || body.data?.state === -1) return cy.wrap(body);
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for video task ${taskId}`);
    return cy.wait(3000).then(() => pollFullVideo(taskId, deadline - Date.now()));
  });
}

//---------------
// downloadThroughProxy — baixa o MP4 sempre pela rota autenticada da app
// (/api/persona/video-download/...) e valida ftyp + tamanho.
// O videoUrl vem do status (relativo): /api/persona/video-download/{taskId}/{file}.
//---------------
function downloadThroughProxy(taskId: string, videoUrl: string): Cypress.Chainable<SavedVideoInfo> {
  const filename = videoUrl.split('/').pop() as string;
  expect(filename).to.match(/\.mp4$/);
  return cy.request({
    url: `/api/persona/video-download/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`,
    encoding: 'binary',
    timeout: 120_000,
  }).then((response) => {
    expect(response.status).to.eq(200);
    const base64 = Cypress.Buffer.from(response.body as unknown as string, 'binary').toString('base64');
    return cy.task<SavedVideoInfo>('saveDownloadedVideo', {
      filename: `persona-full-${Date.now()}-${filename}`,
      base64,
      contentType: (response.headers['content-type'] as string) ?? '',
    });
  });
}
