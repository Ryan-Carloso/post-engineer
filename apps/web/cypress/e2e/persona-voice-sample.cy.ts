//---------------
 // Persona voice sample E2E — clicar no card de voz da casa na página
// /persona seleciona a voz E toca o sample de áudio. Rede mockada via
// cy.intercept; o construtor Audio é stubado antes do load da página.
//
// The catalog is the provider-qualified Chatterbox list
// (chatterbox:<name>) and the picker renders the bare voice name
// (voiceLabel strips the prefix, underscores become spaces).
//---------------

// Catalog entry as GET /api/persona/voices returns it (lib/voice-catalog.ts).
// label null: the picker shows the id without the `chatterbox:` prefix.
const houseVoice = (name: string, gender: 'female' | 'male') => ({
  id: `chatterbox:${name}`,
  label: null,
  provider: 'chatterbox',
  gender,
  accent: 'us',
  kind: 'standard',
  description: `American ${gender} voice.`,
});

const VOICES = [
  houseVoice('en_us_male_01', 'male'),
  houseVoice('en_us_female_01', 'female'),
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

  it('plays the house voice sample from its play button', () => {
    cy.playHouseVoiceSample('en us male 01');

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(1);
      // Sample files are named after the catalog voice name, without the
      // `chatterbox:` prefix (public/voice-samples/<name>.mp3); every
      // sample is the English take.
      expect(audios[0].url).to.equal('/voice-samples/en_us_male_01.mp3');
      expect(audios[0].playCalled).to.be.true;
    });
  });

  it('playing another voice plays the new sample', () => {
    cy.playHouseVoiceSample('en us male 01');
    cy.playHouseVoiceSample('en us female 01');

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(2);
      expect(audios[1].url).to.equal(
        '/voice-samples/en_us_female_01.mp3',
      );
      expect(audios[1].playCalled).to.be.true;
    });
  });

  it('não mostra seletor de idioma do sample', () => {
    cy.get('select[data-testid=sample-language]').should('not.exist');
  });
});
