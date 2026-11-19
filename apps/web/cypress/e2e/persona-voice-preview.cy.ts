import { houseVoice } from '../support/voices';

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
  win.URL.createObjectURL = () => 'blob:fake';
  win.URL.revokeObjectURL = () => {};
};

describe('Persona — prévia de voz da casa com texto próprio', () => {
  beforeEach(() => {
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/voices', {
      statusCode: 200,
      body: { voices: VOICES },
    }).as('getVoices');

    cy.intercept('GET', '/api/persona/list', {
      statusCode: 200,
      body: { personas: [] },
    }).as('getPersonas');

    cy.intercept('POST', '/api/persona/voices/*/preview', {
      statusCode: 200,
      headers: { 'content-type': 'audio/mpeg' },
      body: 'fake-mp3-bytes',
    }).as('housePreview');

    cy.visit('/persona', { onBeforeLoad: stubAudio });
    cy.wait('@getVoices', { timeout: 30000 });
    cy.pickHouseVoice('en us male 01');
  });

  it('posts the typed line and plays the returned audio', () => {
    cy.get('#house-voice-preview-text').type('Hello there');
    cy.contains('button', 'Ouvir com o meu texto').click();

    cy.wait('@housePreview').then((interception) => {
      expect(interception.request.url).to.contain(
        '/api/persona/voices/chatterbox%3Aen_us_male_01/preview',
      );
      expect(interception.request.body.text).to.equal('Hello there');
    });

    cy.window().should((win) => {
      const audios = (win as unknown as { __fakeAudios: FakeAudioRecord[] }).__fakeAudios;
      expect(audios).to.have.length(1);
      expect(audios[0].url).to.equal('blob:fake');
      expect(audios[0].playCalled).to.equal(true);
    });
  });

  it('shows the daily-limit message on 429', () => {
    cy.intercept('POST', '/api/persona/voices/*/preview', {
      statusCode: 429,
      body: { success: false, error: 'Too many requests.' },
    }).as('housePreview429');

    cy.get('#house-voice-preview-text').type('Hello there');
    cy.contains('button', 'Ouvir com o meu texto').click();

    cy.wait('@housePreview429');
    cy.contains('Limite diário de prévias atingido. Tente amanhã.').should('be.visible');
  });

  it('keeps the typed line when switching voices', () => {
    cy.get('#house-voice-preview-text').type('Hello there');
    cy.pickHouseVoice('en us female 01');
    cy.get('#house-voice-preview-text').should('have.value', 'Hello there');
  });
});

export {};
