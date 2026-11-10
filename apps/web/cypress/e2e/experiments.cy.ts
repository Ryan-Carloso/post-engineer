//---------------
// E2E: the /experiments A/B results page renders the paired results per
// provider from the live detail read, with the API stubbed at the network
// boundary so no real experiment data is needed. Also drives the window
// toggle and the empty/error states.
//---------------

const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';

const EXPERIMENT = {
  id: EXPERIMENT_ID,
  name: 'Hook test',
  variable: 'hook',
  personaId: null,
  targetPairs: 3,
  createdAt: '2026-11-10T09:00:00Z',
  variants: [
    { variantId: 'hook-calm', name: 'Calm question', description: 'Calm, curious opening.' },
    { variantId: 'hook-aggressive', name: 'Direct hook', description: 'Direct, provocative opening.' },
  ],
};

const DETAIL = {
  success: true,
  experiment: EXPERIMENT,
  window: '7d',
  videos: [],
  results: {
    targetPairs: 3,
    pairsCreated: 3,
    pairsPublished: 3,
    providers: [
      {
        provider: 'youtube',
        comparisons: [1, 2, 3].map((pair) => ({
          pair,
          values: {
            'hook-calm': { views: 500, likes: 2, comments: 1, averageViewDurationSeconds: 12 },
            'hook-aggressive': { views: 250, likes: 1, comments: 0, averageViewDurationSeconds: 20 },
          },
          winner: 'hook-calm',
        })),
        wins: { 'hook-calm': 3, 'hook-aggressive': 0 },
        ties: 0,
        pValue: 0.25,
        leader: 'hook-calm',
        label: 'indicative',
      },
    ],
  },
  truncated: false,
  source: 'live',
  liveAt: '2026-11-10T12:00:00.000Z',
  liveFailures: [],
  frozen: false,
};

function interceptShell(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: { authenticated: true, accounts: [], message: 'ok' },
  });

  cy.intercept('GET', '/api/billing/tokens', {
    statusCode: 200,
    body: { success: true, balance: 100 },
  });

  cy.intercept('GET', '/api/schedule', {
    statusCode: 200,
    body: { success: true, schedules: [] },
  });

  cy.intercept('GET', '/api/schedule/status**', {
    statusCode: 200,
    body: { success: true, upcoming: [], recent: [] },
  });

  cy.intercept('GET', '/api/persona/video-generations**', {
    statusCode: 200,
    body: { success: true, generations: [] },
  });
}

function interceptExperiments(listBody: unknown, detailBody: unknown = DETAIL): void {
  cy.intercept('GET', '/api/experiments', { statusCode: 200, body: listBody }).as('getExperiments');
  cy.intercept('GET', '/api/experiments/**', { statusCode: 200, body: detailBody }).as('getDetail');
}

describe('experiments results page', () => {
  beforeEach(() => {
    cy.viewport(1280, 1100);
    cy.loginE2EUser();
    interceptShell();
  });

  it('shows the live results with human variant names only', () => {
    interceptExperiments({ success: true, experiments: [EXPERIMENT], truncated: false });
    cy.visit('/experiments');
    cy.wait('@getExperiments');
    cy.wait('@getDetail');

    cy.contains('h1', 'Testes A/B').should('be.visible');
    cy.contains('Ao vivo').should('be.visible');
    cy.contains('Calm question').should('be.visible');
    cy.contains('Direct hook').should('be.visible');
    cy.contains('Indicativo').should('be.visible');
    cy.contains('YouTube').should('be.visible');
    // Per-pair views in the table; no A/B variant letters anywhere.
    cy.contains('td', '500').should('be.visible');
    cy.contains('td', '250').should('be.visible');
    cy.contains(/variante a/i).should('not.exist');
    cy.contains(/variant a/i).should('not.exist');
    // The winner stays unnamed while the label is indicative.
    cy.contains('Ainda sem vencedor').should('be.visible');
  });

  it('switches the window to 24h and reloads the live results', () => {
    interceptExperiments({ success: true, experiments: [EXPERIMENT], truncated: false });
    cy.visit('/experiments');
    cy.wait('@getDetail');

    cy.contains('button', '24h').click();
    cy.wait('@getDetail');
    cy.get('@getDetail').its('request.url').should('include', 'window=24h');
    cy.contains('button', '24h').should('have.attr', 'aria-pressed', 'true');
    cy.contains('button', '7d').should('have.attr', 'aria-pressed', 'false');
  });

  it('shows the empty state with no experiments', () => {
    interceptExperiments({ success: true, experiments: [], truncated: false });
    cy.visit('/experiments');
    cy.wait('@getExperiments');

    cy.contains('Nenhum teste A/B ainda').should('be.visible');
  });

  it('shows the error panel when the list fails', () => {
    cy.intercept('GET', '/api/experiments', {
      statusCode: 500,
      body: { success: false, error: 'down' },
    }).as('getExperiments');
    cy.visit('/experiments');
    cy.wait('@getExperiments');

    cy.contains('Não foi possível carregar os testes').should('be.visible');
    cy.contains('button', 'Tentar de novo').should('be.visible');
  });
});

export {};
