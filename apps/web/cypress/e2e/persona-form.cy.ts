//---------------
// Persona form E2E — the /persona flows the voice-sample spec does not
// cover: tabs, photo upload, aspect picker, sample replay on language
// change, store-level validation errors, edit mode, the load-error page,
// prompt_rejected, the server-error dialog, and a network failure.
//
// Every mutating call is intercepted (CI must never write production
// data): POST /api/persona is stubbed per test, the persona list is a
// canned payload, and the image library is stubbed empty in edit mode.
// The session is real (cy.loginE2EUser), like the other specs.
//---------------

const FORM_VOICES = [
  { id: 'chatterbox:ryan' },
  { id: 'chatterbox:en_us_female_01' },
];

const FORM_SAMPLE_LANGUAGES = [
  { code: 'pt-br', label: 'Português (BR)' },
  { code: 'en-uk', label: 'English (UK)' },
];

interface FakeAudioRecord {
  url: string;
  playCalled: boolean;
}

const stubFormAudio = (win: Cypress.AUTWindow): void => {
  const created: FakeAudioRecord[] = [];
  class FakeAudio {
    url: string;
    playCalled: boolean;
    constructor(url: string) {
      this.url = url;
      this.playCalled = false;
      created.push(this);
    }
    play(): Promise<void> {
      this.playCalled = true;
      return Promise.resolve();
    }
    pause(): void {}
  }
  win.Audio = FakeAudio as unknown as typeof Audio;
  (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios = created;
};

// Base read-only intercepts: the voice catalog, the sample languages, an
// empty persona list, and an empty image library. Tests that need
// different payloads register their own intercept afterwards (the last
// matching intercept wins).
function mockBase(): void {
  cy.intercept('GET', '/api/persona/voices', {
    statusCode: 200,
    body: { voices: FORM_VOICES },
  }).as('getVoices');

  cy.intercept('GET', '/api/persona/voice-sample-languages', {
    statusCode: 200,
    body: { languages: FORM_SAMPLE_LANGUAGES },
  }).as('getSampleLanguages');

  cy.intercept('GET', '/api/persona/list', {
    statusCode: 200,
    body: { authenticated: true, personas: [] },
  }).as('getPersonas');

  cy.intercept('GET', '/api/persona/images*', {
    statusCode: 200,
    body: { success: true, images: [] },
  }).as('getPersonaImages');

  cy.intercept('GET', '/api/persona/cloned-voices', {
    statusCode: 200,
    body: { success: true, voices: [] },
  }).as('getClonedVoices');
}

function visitPersona(path: string): void {
  cy.visit(path, { onBeforeLoad: stubFormAudio });
  // Do not cy.wait('@getVoices'): React Query may serve a warm cache with no
  // network round-trip (same flake class as posts-create personas wait).
  cy.location('pathname', { timeout: 15_000 }).then((pathname) => {
    if (pathname === '/landing') {
      cy.loginE2EUser();
      cy.visit(path, { onBeforeLoad: stubFormAudio });
    }
  });
  cy.location('pathname', { timeout: 15_000 }).should('not.eq', '/landing');
  cy.get('#persona-name', { timeout: 15_000 }).should('be.visible');
}

// Fill a valid create form: name + character + voice.
function fillValidForm(): void {
  cy.get('#persona-name').type('Maya E2E');
  cy.get('button[aria-label="Escolha um personagem 1"]').click();
  cy.contains('button', 'ryan').click();
}

describe('Persona — formulário (abas, foto, validação, edição, erros)', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    mockBase();
  });

  it('alternar abas mostra o conteúdo da aba ativa', () => {
    visitPersona('/persona');

    cy.contains('[role="tab"]', 'Envie sua foto').click();
    cy.contains('button', 'Enviar foto').should('be.visible');
    cy.get('button[aria-label="Escolha um personagem 1"]').should('not.be.visible');

    cy.contains('[role="tab"]', 'Escolha um personagem').click();
    cy.get('button[aria-label="Escolha um personagem 1"]').should('be.visible');
  });

  it('digitar nicho e roteiro sincroniza o formulário', () => {
    visitPersona('/persona');

    cy.get('[data-testid="persona-niche"]').type('finanças pessoais');
    cy.get('textarea').type('Storytelling forte');

    cy.get('[data-testid="persona-niche"]').should('have.value', 'finanças pessoais');
    cy.get('textarea').should('have.value', 'Storytelling forte');
  });

  it('enviar foto mostra a foto e permite trocar', () => {
    visitPersona('/persona');

    cy.contains('[role="tab"]', 'Envie sua foto').click();
    cy.contains('button', 'Enviar foto').should('be.visible');
    cy.get('input[type="file"][accept="image/jpeg,image/png"]').selectFile(
      { contents: Cypress.Buffer.from('fake image bytes'), fileName: 'foto.png', mimeType: 'image/png' },
      { force: true },
    );

    cy.contains('foto.png').should('be.visible');
    // The photo branch offers the same "send photo" control to replace it.
    cy.contains('button', 'Enviar foto').should('be.visible');
  });

  it('clicar em formato muda o formato', () => {
    visitPersona('/persona');

    cy.contains('button', '16:9').click();
    cy.contains('button', '16:9').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', '9:16').should('have.attr', 'aria-pressed', 'false');
  });

  it('ouvir sample e trocar o idioma repete no novo idioma', () => {
    visitPersona('/persona');

    cy.contains('button', 'ryan').scrollIntoView().click();
    cy.get('select[data-testid=sample-language]')
      .should(($sel) => expect($sel.find('option').length).to.be.at.least(2))
      .select('en-uk');

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.lengthOf(2);
      expect(audios[1].url).to.equal('/voice-samples/chatterbox%3Aryan-en-uk.mp3');
      expect(audios[1].playCalled).to.equal(true);
    });
  });

  it('enviar sem avatar mostra erro de avatar', () => {
    visitPersona('/persona');

    cy.get('#persona-name').type('Maya E2E');
    cy.contains('button', 'ryan').click();
    cy.contains('button', 'Criar persona').click();

    cy.contains('Envie uma foto ou gere um avatar por IA.').should('be.visible');
  });

  it('enviar sem voz mostra erro de voz', () => {
    visitPersona('/persona');
    cy.wait('@getClonedVoices');

    cy.get('#persona-name').type('Maya E2E').blur();
    // Photo upload satisfies the avatar gate without relying on the character
    // carousel (off-screen slides flake in CI viewports).
    cy.contains('[role="tab"]', 'Envie sua foto').click();
    cy.get('input[type="file"][accept="image/jpeg,image/png"]').selectFile(
      { contents: Cypress.Buffer.from('fake image bytes'), fileName: 'foto.png', mimeType: 'image/png' },
      { force: true },
    );
    cy.contains('foto.png').should('be.visible');

    cy.contains('button', 'Criar persona').click();

    cy.get('[data-error-field="voice"]')
      .find('[role="alert"]')
      .should('contain.text', 'Escolha uma voz para a persona.');
  });

  it('edição carrega a persona e casa o idioma da amostra por prefixo', () => {
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: {
        authenticated: true,
        personas: [
          {
            id: 'p-1',
            name: 'Maya E2E',
            createdAt: new Date().toISOString(),
            avatarUrl: '/caracter-samples/file-3.png',
            voiceId: 'chatterbox:ryan',
            videoAspect: '9:16',
            scriptPrompt: '',
            niche: '',
            language: 'pt',
          },
        ],
      },
    }).as('getEditPersona');

    visitPersona('/persona?edit=p-1');

    // The pt → pt-br prefix match picks the closest sample language.
    cy.get('#persona-name').should('have.value', 'Maya E2E');
    cy.get('select[data-testid=sample-language]').should('have.value', 'pt-br');
  });

  it('edição de persona com foto mostra a foto atual', () => {
    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: {
        authenticated: true,
        personas: [
          {
            id: 'p-2',
            name: 'Foto',
            createdAt: new Date().toISOString(),
            photoUrl: 'https://example.com/foto.png',
            voiceId: 'chatterbox:ryan',
            videoAspect: '9:16',
            scriptPrompt: '',
            niche: '',
            language: 'pt-br',
          },
        ],
      },
    }).as('getPhotoPersona');

    visitPersona('/persona?edit=p-2');

    cy.contains('[role="tab"]', 'Envie sua foto').click();
    cy.contains('Foto atual').should('be.visible');
    cy.contains('button', 'Enviar foto').should('be.visible');
  });

  it('falha ao carregar mostra erro e permite tentar de novo', () => {
    cy.intercept('GET', '/api/persona/voices', {
      statusCode: 500,
      body: { error: 'voices down' },
    }).as('getVoicesError');

    // The 500 intercept answers the voices request, so the base
    // getVoices alias never fires — wait for the error alias instead.
    cy.visit('/persona', { onBeforeLoad: stubFormAudio });
    cy.wait('@getVoicesError');

    cy.contains('Não foi possível carregar as vozes').should('be.visible');
    cy.contains('button', 'Tentar novamente').click();
    cy.wait('@getVoicesError');
  });

  it('roteiro rejeitado mostra erro inline', () => {
    cy.intercept('POST', '/api/persona', {
      statusCode: 200,
      body: { success: false, error: 'prompt_rejected' },
    }).as('createPersonaRejected');

    visitPersona('/persona');
    fillValidForm();
    cy.contains('button', 'Criar persona').click();
    cy.wait('@createPersonaRejected');

    cy.contains('Este conteúdo não é permitido. Revise o roteiro ou o nicho e tente novamente.').should(
      'be.visible',
    );
    cy.url().should('match', /\/persona$/);
  });

  it('erro do servidor mostra diálogo e fechar funciona', () => {
    cy.intercept('POST', '/api/persona', {
      statusCode: 200,
      body: { success: false, error: 'deu ruim' },
    }).as('createPersonaFailed');

    visitPersona('/persona');
    fillValidForm();
    cy.contains('button', 'Criar persona').click();
    cy.wait('@createPersonaFailed');

    cy.get('[role="alertdialog"]').should('be.visible');
    cy.get('[role="alertdialog"]').contains('Não foi possível criar a persona.').should('be.visible');
    cy.get('[role="alertdialog"]').contains('deu ruim').should('be.visible');
    cy.get('[role="alertdialog"]').contains('button', 'Tentar novamente').click();
    cy.get('[role="alertdialog"]').should('not.exist');
  });

  it('falha de rede mostra erro de servidor', () => {
    cy.intercept('POST', '/api/persona', { forceNetworkError: true }).as('createPersonaNetwork');

    visitPersona('/persona');
    fillValidForm();
    cy.contains('button', 'Criar persona').click();
    cy.wait('@createPersonaNetwork');

    cy.contains('Não foi possível conectar ao servidor. Tente novamente.').should('be.visible');
  });
});
