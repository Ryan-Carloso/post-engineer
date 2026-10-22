//---------------
// Persona voice sample E2E — clicar no card de voz na página /persona
// seleciona a voz E toca o sample sintetizado pela API local
// (GET /api/persona/voices/sample?voice_id=...). Rede mockada via
// cy.intercept; o construtor Audio é stubado antes do load da página.
//
// The catalog is the local preset catalog (Phonon + Kokoro) with
// filter metadata; the picker renders the voice name and the filter
// chips narrow the grid by gender and origin.
//---------------

const VOICES = [
  {
    id: 'phonon:Easton',
    name: 'Easton',
    provider: 'phonon',
    gender: 'male',
    category: 'normal',
    locale: 'en-US',
  },
  {
    id: 'kokoro:bf_emma',
    name: 'Emma',
    provider: 'kokoro',
    gender: 'female',
    category: 'normal',
    locale: 'en-GB',
  },
];

interface FakeAudioRecord {
  url: string;
  playCalled: boolean;
  pauseCalled: boolean;
}

const stubAudio = (win: Cypress.AUTWindow): void => {
  const created: FakeAudioRecord[] = [];
  class FakeAudio {
    url: string;
    playCalled: boolean;
    pauseCalled: boolean;
    constructor(url: string) {
      this.url = url;
      this.playCalled = false;
      this.pauseCalled = false;
      created.push(this);
    }
    play(): Promise<void> {
      this.playCalled = true;
      return Promise.resolve();
    }
    pause(): void {
      this.pauseCalled = true;
    }
  }
  win.Audio = FakeAudio as unknown as typeof Audio;
  (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios = created;
};

describe('Persona — sample de voz ao clicar no card', () => {
  beforeEach(() => {
    // Sessão REAL: o middleware rejeita visits sem cookie e devolve
    // /landing, onde a query de vozes nunca dispara.
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/voices', {
      statusCode: 200,
      body: { voices: VOICES },
    }).as('getVoices');

    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: { personas: [] },
    }).as('getPersonas');

    cy.visit('/persona', { onBeforeLoad: stubAudio });
    cy.wait('@getVoices');
  });

  it('toca o sample da voz ao clicar no card', () => {
    cy.contains('button', 'Easton').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(1);
      expect(audios[0].url).to.equal(
        '/api/persona/voices/sample?voice_id=phonon%3AEaston',
      );
      expect(audios[0].playCalled).to.equal(true);
    });
  });

  it('trocar de voz pausa o sample anterior e toca o da nova', () => {
    cy.contains('button', 'Easton').click();
    cy.contains('button', 'Emma').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(2);
      expect(audios[0].pauseCalled).to.equal(true);
      expect(audios[1].url).to.equal(
        '/api/persona/voices/sample?voice_id=kokoro%3Abf_emma',
      );
      expect(audios[1].playCalled).to.equal(true);
    });
  });

  it('filtro de género e origem estreita a grelha de vozes', () => {
    cy.contains('button', 'Easton').should('be.visible');
    cy.contains('button', 'Emma').should('be.visible');

    cy.get('[data-testid=voice-filter-gender-female]').click();
    cy.contains('button', 'Emma').should('be.visible');
    cy.contains('button', 'Easton').should('not.exist');

    cy.get('[data-testid=voice-filter-gender-all]').click();
    cy.get('[data-testid=voice-filter-origin-us]').click();
    cy.contains('button', 'Easton').should('be.visible');
    cy.contains('button', 'Emma').should('not.exist');
  });
});

export {};
