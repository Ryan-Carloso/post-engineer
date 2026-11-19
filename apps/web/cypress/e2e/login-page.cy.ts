describe('Login — UI', () => {
  it('renderiza título, subtítulo e botão de entrar com GitHub', () => {
    cy.visit('/login');

    cy.contains('h2', 'Bem-vindo de volta').should('be.visible');
    cy.contains('Conecte suas contas e continue a criar').should('be.visible');
    cy.contains('button', 'Continuar com GitHub').should('be.visible');
  });

  it('mostra redirecionamento e volta ao normal quando o OAuth falha', () => {
    cy.intercept('GET', '**/auth/v1/authorize*', (req) => {
      req.redirect('http://localhost:3434/login', 302);
    }).as('oauthFail');

    cy.visit('/login');

    cy.contains('button', 'Continuar com GitHub').click();

    cy.url().should('match', /\/login$/);
    cy.contains('button', 'Continuar com GitHub').should('be.visible');
    cy.contains('button', 'Continuar com GitHub').should('not.be.disabled');
  });
});
