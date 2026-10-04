//---------------
// Login Flow — UI tests para a página /login
// Apenas renderização e comportamento visual; o redirecionamento
// OAuth real é serviço externo (Supabase) e não é testado/mocado aqui.
//---------------

describe('Login (UI)', () => {
  it('renderiza título, subtítulo e botão de login GitHub', () => {
    cy.visit('/login');
    // The card title is an h2; the only h1 is the hero headline, which is
    // hidden below the lg breakpoint.
    cy.contains('h2', 'Bem-vindo de volta').should('be.visible');
    cy.contains('p', 'Conecte suas contas e continue a criar').should('be.visible');
    cy.contains('button', 'Continuar com GitHub').should('be.visible');
  });

  it('aplicação de login é responsiva (layout centrado)', () => {
    cy.viewport(375, 667); // mobile
    cy.visit('/login');
    cy.contains('button', 'Continuar com GitHub').should('be.visible');
  });
});