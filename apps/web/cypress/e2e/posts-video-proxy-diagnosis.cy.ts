//---------------
// Video download proxy diagnosis — drives the REAL proxy with the real
// engine task id from the user's failing report, asserting the fallback:
// guessed file 404 → engine task lookup → 302 to the actual file → 200
// video bytes.
//---------------

const TASK_ID = 'ebcd234a-fe45-4133-a4fd-8227a47773fc';

describe('Video download proxy fallback', () => {
  before(() => {
    cy.loginE2EUser();
  });

  it('engine status exposes the real video file path', () => {
    cy.request({
      url: `/api/persona/video-status/${TASK_ID}`,
      failOnStatusCode: false,
    }).then((response) => {
      cy.log('video-status status', response.status);
      cy.log('video-status body', JSON.stringify(response.body).slice(0, 2000));
      expect(response.status).to.eq(200);
    });
  });

  it('the guessed file 404s upstream but resolves via the fallback redirect', () => {
    cy.request({
      url: `/api/persona/video-download/${TASK_ID}/final-1.mp4`,
      followRedirect: false,
      failOnStatusCode: false,
    }).then((response) => {
      cy.log('first hop status', response.status);
      cy.log('first hop location', response.headers['location'] as string);
      expect(response.status).to.eq(302);
      const location = response.headers['location'] as string;
      expect(location).to.match(/\/api\/persona\/video-download\//);

      return cy.request({ url: location, followRedirect: false, failOnStatusCode: false });
    }).then((resolved) => {
      cy.log('resolved status', resolved.status);
      cy.log('resolved content-type', resolved.headers['content-type'] as string);
      expect(resolved.status).to.eq(200);
      expect(String(resolved.headers['content-type'])).to.include('video/');
    });
  });
});
