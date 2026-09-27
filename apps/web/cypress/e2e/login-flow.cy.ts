//---------------
// Login Flow — UI tests para a página /login
// Apenas renderização e comportamento visual; o redirecionamento
// OAuth real é serviço externo (Supabase) e não é testado/mocado aqui.
//---------------

describe('Login (UI)', () => {
  it('renderiza título, subtítulo e botão de login GitHub', () => {
    cy.visit('/login');
    cy.contains('h1', 'Bem-vindo ao Post Engineer').should('be.visible');
    cy.contains('p', 'Conecte suas contas do YouTube e Instagram').should('be.visible');
    cy.contains('button', 'Entrar com GitHub').should('be.visible');
  });

  it('aplicação de login é responsiva (layout centrado)', () => {
    cy.viewport(375, 667); // mobile
    cy.visit('/login');
    cy.contains('button', 'Entrar com GitHub').should('be.visible');
  });
});