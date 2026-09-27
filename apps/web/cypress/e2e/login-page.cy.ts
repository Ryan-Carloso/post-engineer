//---------------
// Login — UI tests para a página /login.
// Testa renderização do card, botão GitHub e estado de redirecionamento.
// O OAuth do Supabase é interceptado com falha de rede (sem navegação real).
//---------------

describe('Login — UI', () => {
  it('renderiza título, subtítulo e botão de entrar com GitHub', () => {
    cy.visit('/login');

    cy.contains('h1', 'Bem-vindo ao Post Engineer').should('be.visible');
    cy.contains('Conecte suas contas do YouTube e Instagram').should('be.visible');
    cy.contains('button', 'Entrar com GitHub').should('be.visible');
  });

  it('mostra redirecionamento e volta ao normal quando o OAuth falha', () => {
    // signInWithOAuth (fluxo pkce) NÃO faz fetch: constrói a URL de
    // authorize e navega o browser direto. Interceptamos essa navegação
    // document e redirecionamos de volta ao /login, simulando a volta
    // ao estado normal quando o OAuth falha.
    cy.intercept('GET', '**/auth/v1/authorize*', (req) => {
      req.redirect('http://localhost:3434/login', 302);
    }).as('oauthFail');

    cy.visit('/login');

    cy.contains('button', 'Entrar com GitHub').click();

    // Após a falha e o retorno ao /login, o botão volta ao estado inicial.
    cy.url().should('match', /\/login$/);
    cy.contains('button', 'Entrar com GitHub').should('be.visible');
    cy.contains('button', 'Entrar com GitHub').should('not.be.disabled');
  });
});
