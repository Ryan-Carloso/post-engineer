//---------------
// E2E: the metrics dashboard renders the caller's per-video snapshots
// (grouped by script angle by default), with the API stubbed at the
// network boundary so no real account data is needed.
//---------------

const PERSONA_ID = '11111111-2222-4333-8444-555555555555';

function interceptMetricsData(): void {
  cy.intercept('GET', '/api/account', {
    statusCode: 200,
    body: {
      authenticated: true,
      accounts: [{ provider: 'youtube', recordId: 'r1', channelId: 'UC1', channelName: 'Canal Um' }],
      message: 'ok',
    },
  });

  cy.intercept('GET', '/api/billing/tokens', {
    statusCode: 200,
    body: { success: true, balance: 100 },
  });

  cy.intercept('GET', '/api/persona/list', {
    statusCode: 200,
    body: { authenticated: true, personas: [{ id: PERSONA_ID, name: 'Alpha' }] },
  });

  cy.intercept('GET', '/api/metrics**', {
    statusCode: 200,
    body: {
      success: true,
      truncated: false,
      rows: [
        {
          postId: 'post-1', personaId: PERSONA_ID, provider: 'youtube', accountId: 'UC1',
          externalId: 'video-1', scriptAngle: 'myth-busting', views: 1200, likes: 90,
          comments: 12, saves: 4, collectedAt: '2026-10-21T12:00:00Z',
        },
        {
          postId: 'post-2', personaId: null, provider: 'youtube', accountId: 'UC1',
          externalId: 'video-2', scriptAngle: null, views: 300, likes: 10,
          comments: 1, saves: 0, collectedAt: '2026-10-21T12:00:00Z',
        },
      ],
    },
  }).as('getMetrics');
}

describe('metrics dashboard', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    interceptMetricsData();
  });

  it('renders stats, the chart and the per-video rows', () => {
    cy.visit('/metrics');
    cy.wait('@getMetrics');

    cy.contains('h1', 'Métricas').should('be.visible');
    cy.contains('Vídeos medidos').should('be.visible');
    cy.contains('myth-busting').should('be.visible');
    cy.contains('Sem ângulo').should('be.visible');

    // Group by network: the chart and stats re-render with provider labels.
    cy.contains('label', 'Comparar por').find('select').select('provider');
    cy.contains('Melhor rede').scrollIntoView().should('be.visible');
    cy.contains('YouTube').should('be.visible');
  });
});

export {};
