//---------------
// E2E: the billing storefront (pricing page) renders balance, token packs,
// notices and the cancel dialog, and checkout reacts to the shared
// session-expiry policy: a hub-session 401 redirects to /login with ?next=
// so the user comes back to the same page after signing in.
//---------------

describe('Billing — storefront, checkout and after-payment notices', () => {
  beforeEach(() => {
    // Sessão REAL no Supabase (usuário de teste do repo) — o middleware
    // valida o cookie server-side; intercepts não bastam.
    cy.loginE2EUser();

    cy.intercept('GET', '/api/billing/tokens', {
      statusCode: 200,
      body: { success: true, balance: 42 },
    }).as('tokens');
    cy.intercept('GET', '/api/billing/transactions**', {
      statusCode: 200,
      body: { success: true, transactions: [], total: 0, limit: 20, offset: 0 },
    }).as('transactions');
  });

  it('renders the storefront: hero, balance, packs, benefits and history', (): void => {
    cy.visit('/billing');
    cy.wait('@tokens');

    cy.contains('h1', 'Suas ideias merecem virar vídeos.').should('be.visible');
    cy.contains('42 tokens').scrollIntoView().should('be.visible');
    cy.contains('Escolha seu pacote').should('be.visible');
    // A clean URL shows no after-payment notice.
    cy.get('[role="status"]').should('not.exist');
  });

  it('starts checkout with any pack and pushes the returned checkout URL', (): void => {
    cy.intercept('POST', '/api/billing/checkout', {
      statusCode: 200,
      body: { success: true, url: '/billing' },
    }).as('checkout');

    cy.visit('/billing');
    cy.wait('@tokens');
    // Packs render one buy action each ("Comprar {count} tokens"); the
    // first one is enough to exercise the handler.
    cy.contains('button', /Comprar \d+ tokens/).first().click();
    cy.wait('@checkout').its('request.body.packId').should('be.a', 'string');
    // A non-2xx alert must never appear on the success path.
    cy.get('[role="alert"]').should('not.exist');
  });

  it('redirects to /login?next=<current page> when checkout 401s with a dead session', (): void => {
    cy.intercept('POST', '/api/billing/checkout', {
      statusCode: 401,
      body: { success: false, error: 'Authentication required.' },
    }).as('checkoutFail');

    cy.visit('/billing');
    cy.wait('@tokens');
    cy.contains('button', /Comprar \d+ tokens/).first().click();
    cy.wait('@checkoutFail');

    // The shared session-expiry reaction fires once on the first failed
    // read (lib/session-expiry), and the login flow returns to /billing.
    cy.url().should('include', '/login?next=%2Fbilling');
  });

  it('shows the after-payment notice and settles back to /billing', (): void => {
    cy.visit('/billing?checkout=success');
    cy.wait('@tokens');
    cy.contains('[role="status"]', 'Seu pagamento está sendo confirmado.').should('be.visible');
  });

  it('shows the canceled notice plus the feedback dialog and closes both', (): void => {
    cy.visit('/billing?checkout=canceled');
    cy.wait('@tokens');

    cy.contains('[role="status"]', 'Nenhum cobrado.').should('be.visible');
    // The cancel feedback dialog asks WHY and closes via router.replace.
    cy.contains('Por que você desistiu?').should('be.visible');
    cy.contains('button', 'Fechar').click();
    cy.url().should('include', '/billing');
    cy.url().should('not.include', 'checkout=canceled');
  });
});

export {};
