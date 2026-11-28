const SLUG = 'cold-brew-hook';
const BODIES: Record<number, string> = {
  1: 'Write a short hook about coffee.',
  2: 'Write a punchy hook about coffee.',
  3: 'Write a punchy hook about cold brew coffee.',
};

const versionId = (version: number): string => `44444444-4444-4444-8444-44444444444${version}`;

const summary = (version: number) => ({
  versionId: versionId(version),
  version,
  title: 'Cold brew hook',
  createdAt: new Date().toISOString(),
  preview: BODIES[version],
  previewTruncated: false,
  bodyLength: BODIES[version].length,
  current: version === 3,
});

describe('Comparing prompt versions', () => {
  beforeEach(() => {
    cy.viewport(1280, 1100);
    cy.loginE2EUser();
    cy.intercept('GET', `/api/prompts/${SLUG}`, {
      statusCode: 200,
      body: {
        success: true,
        prompt: {
          slug: SLUG,
          title: 'Cold brew hook',
          description: '',
          source: 'own',
          visibility: 'private',
          verified: false,
          prompt: BODIES[3],
          body: BODIES[3],
          versionId: versionId(3),
          version: 3,
        },
      },
    }).as('detail');
    cy.intercept('GET', `/api/prompts/${SLUG}/versions`, {
      statusCode: 200,
      body: { success: true, currentVersion: 3, versions: [summary(3), summary(2), summary(1)], truncated: false, nextCursor: null },
    }).as('versions');
    for (const version of [1, 2]) {
      cy.intercept('GET', `/api/prompts/${SLUG}/versions/${version}`, {
        statusCode: 200,
        body: {
          success: true,
          version: { versionId: versionId(version), version, title: 'Cold brew hook', createdAt: new Date().toISOString(), body: BODIES[version], current: false },
        },
      }).as(`version${version}`);
    }
  });

  it('shows the words a version added and removed, for the default pair and a row', () => {
    cy.visit(`/recipes/${SLUG}`, {
      onBeforeLoad(win) {
        win.localStorage.setItem('social-hub-locale', 'en');
      },
    });
    cy.wait(['@detail', '@versions']);
    cy.get('[data-testid="prompt-version-compare-open"]').scrollIntoView().click();
    cy.wait('@version2');
    cy.get('[data-testid="text-diff-summary"]').should('have.text', '+2 words, −0 words');
    cy.get('[data-testid="text-diff"] [data-diff="added"]').should('have.text', 'cold brew ');

    cy.get('[data-testid="prompt-version-changes-2"]').click();
    cy.wait('@version1');
    cy.get('[data-testid="prompt-version-compare"]').should('contain', 'Version 1 → version 2');
    cy.get('[data-testid="text-diff"] [data-diff="removed"]').should('have.text', 'short');
    cy.get('[data-testid="text-diff"] [data-diff="added"]').should('have.text', 'punchy');

    cy.get('[data-testid="prompt-version-compare-from"]').click();
    cy.get('[role="option"]').contains(/^Version 2$/).click();
    cy.get('[data-testid="text-diff-summary"]').should('have.text', 'Both versions have the same text.');
  });
});

export {};
