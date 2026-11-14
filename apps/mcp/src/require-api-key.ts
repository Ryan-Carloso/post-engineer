// API key for the stdio server: the local MCP authenticates to the web API
// with the owner's key. OAuth-mode HTTP needs no local key (see main()).
export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.POST_ENGINEER_API_KEY;
  if (!apiKey) {
    throw new Error('POST_ENGINEER_API_KEY is required');
  }
  return apiKey;
}
