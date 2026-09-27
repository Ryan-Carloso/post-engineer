//---------------
// Persona voice sample E2E — clicar no card de voz da casa na página
// /persona seleciona a voz E toca o sample de áudio. Rede mockada via
// cy.intercept; o construtor Audio é stubado antes do load da página.
//---------------

const VOICES = [
  { id: 'calm' },
  { id: 'energetic' },
];

const SAMPLE_LANGUAGES = [
  { code: 'pt-br', label: 'Português (BR)' },
  { code: 'en-uk', label: 'English (UK)' },
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
    cy.intercept('GET', '/api/persona/voices', {
      statusCode: 200,
      body: { voices: VOICES },
    }).as('getVoices');

    cy.intercept('GET', '/api/persona/voice-sample-languages', {
      statusCode: 200,
      body: { languages: SAMPLE_LANGUAGES },
    }).as('getSampleLanguages');

    cy.visit('/persona', { onBeforeLoad: stubAudio });
    cy.wait('@getVoices');
  });

  it('toca o sample da voz ao clicar no card da casa', () => {
    cy.contains('button', 'Voz feminina calma').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(1);
      expect(audios[0].url).to.equal('/voice-samples/calmo-pt-br.mp3');
      expect(audios[0].playCalled).to.be.true;
    });
  });

  it('trocar de voz para o sample anterior e toca o da nova', () => {
    cy.contains('button', 'Voz feminina calma').click();
    cy.contains('button', 'Voz masculina enérgica').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(2);
      expect(audios[1].url).to.equal(
        '/voice-samples/energetico-pt-br.mp3',
      );
      expect(audios[1].playCalled).to.be.true;
    });
  });

  it('mudar o idioma do sample altera a language do áudio tocado', () => {
    cy.get('select[data-testid=sample-language]')
      .should(($sel) => expect($sel.find('option').length).to.be.at.least(2))
      .select('en-uk');
    cy.contains('button', 'Voz feminina calma').click();

    cy.window().then((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(1);
      expect(audios[0].url).to.equal('/voice-samples/calmo-en-uk.mp3');
      expect(audios[0].playCalled).to.be.true;
    });
  });
});
