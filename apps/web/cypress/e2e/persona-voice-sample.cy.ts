//---------------
 // Persona voice sample E2E — clicar no card de voz da casa na página
// /persona seleciona a voz E toca o sample de áudio. Rede mockada via
// cy.intercept; o construtor Audio é stubado antes do load da página.
//
// The catalog is the provider-qualified Chatterbox list
// (chatterbox:<name>) and the picker renders the bare voice name
// (voiceLabel strips the prefix, underscores become spaces).
//---------------

const VOICES = [
  { id: 'chatterbox:en_us_male_01' },
  { id: 'chatterbox:en_us_female_01' },
];

interface FakeAudioRecord {
  url: string;
  playCalled: boolean;
}

const stubAudio = (win: Cypress.AUTWindow): void => {
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

  it('toca o sample da voz ao clicar no card da casa', () => {
    cy.contains('button', 'en us male 01').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(1);
      // Sample files are named after the voice id, URL-encoded
      // (public/voice-samples/<encoded-id>-<lang>.mp3). English-only
      // launch: there is no sample-language picker any more, so the
      // sample always plays the English take (en-us).
      expect(audios[0].url).to.equal('/voice-samples/chatterbox%3Aen_us_male_01-en-us.mp3');
      expect(audios[0].playCalled).to.be.true;
    });
  });

  it('trocar de voz para o sample anterior e toca o da nova', () => {
    cy.contains('button', 'en us male 01').click();
    cy.contains('button', 'en us female 01').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(2);
      expect(audios[1].url).to.equal(
        '/voice-samples/chatterbox%3Aen_us_female_01-en-us.mp3',
      );
      expect(audios[1].playCalled).to.be.true;
    });
  });

  it('não mostra seletor de idioma do sample', () => {
    cy.get('select[data-testid=sample-language]').should('not.exist');
  });
});
