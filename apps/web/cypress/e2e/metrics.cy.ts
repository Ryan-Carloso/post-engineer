const PERSONA_ID = '11111111-2222-4333-8444-555555555555';

const PUBLISHED_AT = '2026-10-20T12:00:00Z';

const ROWS = [
  {
    postId: 'post-1', personaId: PERSONA_ID, provider: 'youtube', accountId: 'UC1',
    externalId: 'video-1', scriptAngle: 'myth-busting', publishedAt: PUBLISHED_AT, views: 1200, likes: 90,
    comments: 12, saves: 4, collectedAt: '2026-10-21T12:00:00Z',
    analyticsViews: 1000, engagedViews: 641, stayedToWatchPct: 64.1, averageViewDurationSeconds: 21.4,
    averageViewPercentage: 78.2, contentType: 'SHORTS', analyticsStatus: 'ok', provisional: true,
  },
  {
    postId: 'post-2', personaId: null, provider: 'youtube', accountId: 'UC1',
    externalId: 'video-2', scriptAngle: null, publishedAt: PUBLISHED_AT, views: 300, likes: 10,
    comments: 1, saves: 0, collectedAt: '2026-10-21T12:00:00Z',
    analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
    averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
  },
  {
    postId: 'post-3', personaId: PERSONA_ID, provider: 'youtube', accountId: 'UC1',
    externalId: 'video-3', scriptAngle: 'tutorial', publishedAt: PUBLISHED_AT, views: null, likes: null,
    comments: null, saves: null, collectedAt: '2026-10-21T12:00:00Z',
    analyticsViews: null, engagedViews: null, stayedToWatchPct: null, averageViewDurationSeconds: null,
    averageViewPercentage: null, contentType: null, analyticsStatus: null, provisional: false,
  },
];

function interceptShell(): void {
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
}

function interceptMetrics(body: unknown, statusCode = 200): void {
  cy.intercept('GET', '/api/metrics**', { statusCode, body }).as('getMetrics');
}

describe('metrics dashboard', () => {
  beforeEach(() => {
    cy.loginE2EUser();
    interceptShell();
  });

  it('renders totals and rows sorted by views; filters through the Sheet and clears', () => {
    interceptMetrics({ success: true, truncated: true, rows: ROWS });
    cy.visit('/metrics');
    cy.wait('@getMetrics');

    cy.contains('h1', 'Métricas').should('be.visible');
    cy.contains('Medições').should('be.visible');
    cy.contains('Uma por vídeo por rede').should('be.visible');
    cy.contains('1.500').should('be.visible');
    cy.contains('117').should('be.visible');
    cy.get('.recharts-wrapper').should('not.exist');
    cy.contains('myth-busting').should('be.visible');
    cy.contains('YouTube · 21 de out. de 2026').scrollIntoView().should('be.visible');
    cy.contains('Sem ângulo').should('not.exist');
    cy.contains('Mostrando só as').scrollIntoView().should('be.visible');
    cy.contains('n/d').scrollIntoView().should('be.visible');

    cy.contains('button', '7d').click();
    cy.wait('@getMetrics');
    cy.contains('button', '28d').click();
    cy.wait('@getMetrics').its('request.url').should('include', 'window=28d');

    cy.contains('button', 'Filtros').click();
    cy.get('button[aria-label="Rede"]').click();
    cy.get('[role="option"]').contains('Instagram').click();
    cy.contains('button', 'Aplicar filtros').click();
    cy.wait('@getMetrics').its('request.url').should('include', 'provider=instagram');
    cy.contains('button', 'Limpar filtros').click();
    cy.contains('button', 'Limpar filtros').should('not.exist');

    cy.contains('button', 'Filtros').click();
    cy.get('button[aria-label="Persona"]').click();
    cy.get('[role="option"]').contains('Alpha').click();
    cy.contains('button', 'Aplicar filtros').click();
    cy.wait('@getMetrics').its('request.url').should('include', `persona=${PERSONA_ID}`);
    cy.contains('button', 'Limpar filtros').click();
    cy.contains('button', 'Limpar filtros').should('not.exist');
  });

  it('shows YouTube retention on a row and the reconnect prompt for an old token', () => {
    interceptMetrics({
      success: true,
      truncated: false,
      rows: [ROWS[0], { ...ROWS[1], analyticsStatus: 'scope_missing' }],
    });
    cy.visit('/metrics');
    cy.wait('@getMetrics');
    cy.contains('641 views engajadas').scrollIntoView().should('be.visible');
    cy.contains('Ficaram para assistir (derivado: views engajadas / views)').should('be.visible');
    cy.contains('64,1%').should('be.visible');
    cy.contains('Provisório').should('be.visible');
    cy.contains('Reconecte o YouTube para ativar as estatísticas de retenção').scrollIntoView().should('be.visible');
    cy.contains('a', 'Ir para Contas').should('have.attr', 'href', '/accounts');
  });

  it('opens the retention curve of a long-form video on demand', () => {
    interceptMetrics({
      success: true,
      truncated: false,
      rows: [{ ...ROWS[0], contentType: 'VIDEO_ON_DEMAND', analyticsStatus: 'ok', provisional: false }],
    });
    cy.intercept('GET', '/api/metrics/retention-curve**', {
      statusCode: 200,
      body: {
        success: true,
        provisional: false,
        points: [
          { ratio: 0, audienceWatchRatio: 1, relativeRetentionPerformance: 0.8 },
          { ratio: 0.5, audienceWatchRatio: 0.7, relativeRetentionPerformance: 0.9 },
          { ratio: 1, audienceWatchRatio: 0.4, relativeRetentionPerformance: null },
        ],
      },
    }).as('getCurve');

    cy.visit('/metrics');
    cy.wait('@getMetrics');
    cy.get('.recharts-wrapper').should('have.length', 0);
    cy.get('@getCurve.all').should('have.length', 0);
    cy.contains('button', 'Curva de retenção').scrollIntoView().click();
    cy.wait('@getCurve');
    cy.get('.recharts-wrapper').should('have.length', 1);
    cy.get('.recharts-wrapper').last().trigger('mousemove', { clientX: 200, clientY: 90 });
    cy.contains('Público assistindo:').should('be.visible');
    cy.contains('button', 'Esconder curva de retenção').click();
    cy.get('.recharts-wrapper').should('have.length', 0);
  });

  it('shows the empty state when nothing was measured', () => {
    interceptMetrics({ success: true, truncated: false, rows: [] });
    cy.visit('/metrics');
    cy.wait('@getMetrics');
    cy.contains('Nenhum vídeo medido ainda').scrollIntoView().should('be.visible');
  });

  it('shows the error state and recovers on retry', () => {
    let fail = true;
    cy.intercept('GET', '/api/metrics**', (req) => {
      if (fail) {
        req.reply({ statusCode: 500, body: { success: false, error: 'boom' } });
      } else {
        req.reply({ statusCode: 200, body: { success: true, truncated: false, rows: ROWS } });
      }
    }).as('getMetricsFlaky');

    cy.visit('/metrics');
    cy.contains('Não foi possível carregar as métricas', { timeout: 15_000 }).scrollIntoView().should('be.visible');

    cy.then(() => {
      fail = false;
    });
    cy.contains('button', 'Tentar de novo').click();
    cy.wait('@getMetricsFlaky');
    cy.contains('Medições').scrollIntoView().should('be.visible');
    cy.contains('myth-busting').scrollIntoView().should('be.visible');
  });
});

export {};
