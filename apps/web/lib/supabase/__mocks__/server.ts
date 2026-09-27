//---------------
// Mock Supabase Server Client — returns an authenticated session for tests
//---------------

const MOCK_USER = {
  id: 'test-user-id',
  email: 'test@example.com',
  user_metadata: {
    full_name: 'Test User',
  },
  app_metadata: {},
  aud: 'authenticated',
  role: 'authenticated',
  created_at: new Date().toISOString(),
};

const MOCK_SESSION = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: MOCK_USER,
};

export function createMockSupabaseServerClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: MOCK_USER },
        error: null,
      }),
      getSession: async () => ({
        data: { session: MOCK_SESSION },
        error: null,
      }),
    },
  };
}
