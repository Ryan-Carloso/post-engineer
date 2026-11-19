export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.POST_ENGINEER_API_KEY;
  if (!apiKey) {
    throw new Error('POST_ENGINEER_API_KEY is required');
  }
  return apiKey;
}
