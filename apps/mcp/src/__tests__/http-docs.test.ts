import { describe, it, expect } from 'vitest';
import { docsMarkdown, healthMarkdown, docsHtml } from '../http-docs.js';

// The public docs are served to users and AI clients; these tests lock in
// the security guidance and keep the documented tool list in sync with the
// tools actually registered on the server.
describe('HTTP docs', () => {
  describe('docsMarkdown', () => {
    it('publishes the MCP endpoint URL', () => {
      expect(docsMarkdown).toContain('https://mcp.post-engineer.com/');
    });

    it('documents OAuth discovery for ChatGPT', () => {
      expect(docsMarkdown).toContain('oauth-authorization-server');
      expect(docsMarkdown).toContain('post-engineer.com/.well-known/oauth-authorization-server');
    });

    it('warns never to expose the API key in URL, query string, or source code', () => {
      expect(docsMarkdown).toMatch(/never put the api key/i);
      expect(docsMarkdown).toContain('query string');
      expect(docsMarkdown).toContain('source code');
    });

    it('documents local stdio usage via npx', () => {
      expect(docsMarkdown).toContain('npx');
      expect(docsMarkdown).toContain('post-engineer-mcp');
      expect(docsMarkdown).toContain('POST_ENGINEER_API_KEY');
    });

    it('points users to the api-keys page', () => {
      expect(docsMarkdown).toContain('post-engineer.com/api-keys');
    });

    it('lists every tool the server registers', () => {
      const expectedTools = [
        'create_persona',
        'list_personas',
        'list_voices',
        'list_faces',
        'update_persona',
        'list_social_accounts',
        'connect_account',
        'list_schedules',
        'list_posts',
        'cancel_schedule',
        'get_token_balance',
        'generate_video_from_persona',
        'get_video_status',
        'schedule_video',
      ];
      for (const tool of expectedTools) {
        expect(docsMarkdown).toContain(tool);
      }
    });

    it('documents the validation endpoints', () => {
      expect(docsMarkdown).toContain('/health');
      expect(docsMarkdown).toContain('/docs');
    });
  });

  describe('healthMarkdown', () => {
    it('reports an ok status', () => {
      expect(healthMarkdown).toMatch(/status:\s*ok/i);
    });

    it('states the endpoint does not call the Post Engineer API', () => {
      expect(healthMarkdown).toContain('Post Engineer API');
    });
  });

  describe('docsHtml', () => {
    it('renders the endpoint and the tool list', () => {
      expect(docsHtml).toContain('https://mcp.post-engineer.com/');
      expect(docsHtml).toContain('generate_video_from_persona');
      expect(docsHtml).toContain('schedule_video');
    });

    it('is a complete HTML document', () => {
      expect(docsHtml).toContain('<!doctype html>');
      expect(docsHtml).toContain('</html>');
    });
  });
});
