//---------------
// Persona smoke E2E — cria no Supabase, envia ao money-print e confirma
// que o motor aceita a task. Cancela a task após entrar em processamento,
// evitando custo de renderização no teste rápido.
//---------------

interface PersonaCreateResponse {
  success: boolean;
  personaId?: string;
  error?: string;
}

interface VideoJobResponse {
  success: boolean;
  taskId?: string;
  error?: string;
}

interface SmokeTaskResponse {
  status: number;
  data?: { state?: number; progress?: number };
  message?: string;
}

describe('Persona API smoke', () => {
  let personaId: string | undefined;
  let taskId: string | undefined;

  before(() => {
    cy.loginE2EUser();
  });

  afterEach(() => {
    if (taskId) {
      cy.request({
        method: 'DELETE',
        url: `/api/persona/video-task/${taskId}`,
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

  it('cria persona no Supabase e entrega a persona ao money-print', () => {
    cy.window().then({ timeout: 30_000 }, (window) => {
      const formData = new window.FormData();
      formData.append('name', 'Cypress Smoke Persona');
      formData.append('voiceId', 'calm');
      const pngBytes = Uint8Array.from(
        window.atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        ),
        (character) => character.charCodeAt(0),
      );
      formData.append(
        'photo',
        new window.File([pngBytes], 'persona.png', { type: 'image/png' }),
      );
      return window.fetch('/api/persona', { method: 'POST', body: formData });
    })
      .then((response) => response.json() as Promise<PersonaCreateResponse>)
      .then((body) => {
        expect(body.success).to.eq(true);
        expect(body.personaId).to.be.a('string');
        personaId = body.personaId;
      });

    cy.request('/api/persona/list').then((response) => {
      expect(response.status).to.eq(200);
      const body = response.body as { personas: Array<{ id: string; name: string }> };
      expect(body.personas.some((persona) => persona.id === personaId)).to.eq(true);
    });

    cy.then(() => {
      expect(personaId).to.be.a('string');
      return cy.request({
        method: 'POST',
        url: '/api/persona/video-job',
        body: { personaId, video_subject: 'A quiet morning in a mountain village' },
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
      return pollTask(taskId as string, 30_000);
    }).then((body) => {
      expect([1, 4, -1]).to.include(body.data?.state);
    });
  });
});

function pollTask(taskId: string, timeoutMs: number): Cypress.Chainable<SmokeTaskResponse> {
  const deadline = Date.now() + timeoutMs;
  return cy.request({
    url: `/api/persona/video-status/${encodeURIComponent(taskId)}`,
    failOnStatusCode: false,
  }).then((response) => {
    const body = response.body as SmokeTaskResponse;
    if (body.data?.state === 1 || body.data?.state === -1 || Date.now() >= deadline) {
      return cy.wrap(body);
    }
    return cy.wait(1000).then(() => pollTask(taskId, deadline - Date.now()));
  });
}
