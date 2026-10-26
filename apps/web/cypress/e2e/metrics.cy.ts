//---------------
// E2E: the metrics dashboard renders the caller's per-video snapshots
// (grouped by script angle by default), with the API stubbed at the
// network boundary so no real account data is needed. Also drives the
// filters, the chart tooltip and the empty/error states.
//---------------

const PERSONA_ID = '11111111-2222-4333-8444-555555555555';

const ROWS = [
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
  {
    postId: 'post-3', personaId: PERSONA_ID, provider: 'youtube', accountId: 'UC1',
    externalId: 'video-3', scriptAngle: 'tutorial', views: null, likes: null,
    comments: null, saves: null, collectedAt: '2026-10-21T12:00:00Z',
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

  it('renders stats, the chart and rows; filters, regroups and hovers', () => {
    interceptMetrics({ success: true, truncated: true, rows: ROWS });
    cy.visit('/metrics');
    cy.wait('@getMetrics');

    cy.contains('h1', 'Métricas').should('be.visible');
    cy.contains('Vídeos medidos').should('be.visible');
    cy.contains('myth-busting').should('be.visible');
    cy.contains('Sem ângulo').should('be.visible');
    // The truncated note and the not-reported counters render too.
    cy.contains('Mostrando só os').scrollIntoView().should('be.visible');
    cy.contains('n/d').scrollIntoView().should('be.visible');

    // Hover the first bar: the tooltip names the group and its count.
    cy.get('.recharts-wrapper').trigger('mousemove', { clientX: 320, clientY: 40 });
    cy.contains('myth-busting · 1 vídeos').should('be.visible');

    // Window + metric controls re-render the summary (24h is the
    // default window, so switch to 7 days to force a refetch).
    cy.contains('button', '7d').click();
    cy.wait('@getMetrics');
    cy.contains('button', 'Curtidas').click();
    cy.contains('Média de curtidas').scrollIntoView().should('be.visible');

    // Filters narrow the request; clearing restores it.
    cy.contains('label', 'Ângulo do roteiro').last().scrollIntoView().find('select').select('myth-busting');
    cy.wait('@getMetrics');
    cy.contains('button', 'Limpar filtros').click();
    // Clearing returns to the window's already-fresh query, so no new
    // request fires — the button disappearing is the observable reset.
    cy.contains('button', 'Limpar filtros').should('not.exist');

    // Group by network: the chart and stats re-render with provider labels.
    cy.contains('label', 'Comparar por').scrollIntoView().find('select').select('provider');
    cy.contains('Melhor rede').scrollIntoView().should('be.visible');
    cy.contains('YouTube').should('be.visible');
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

    // Flip the stub inside the command queue: a plain assignment here
    // would run synchronously before any queued command executes.
    cy.then(() => {
      fail = false;
    });
    cy.contains('button', 'Tentar de novo').click();
    cy.wait('@getMetricsFlaky');
    cy.contains('Vídeos medidos').scrollIntoView().should('be.visible');
    cy.contains('myth-busting').scrollIntoView().should('be.visible');
  });
});

export {};
