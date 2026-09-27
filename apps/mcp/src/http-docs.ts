const SERVICE_NAME = 'Post Engineer MCP';
const MCP_ENDPOINT = 'https://mcp.post-engineer.com/';

export const docsMarkdown: string = `# ${SERVICE_NAME}

Remote MCP server for Post Engineer.

## MCP endpoint

Use this URL when connecting a remote MCP client:

\`${MCP_ENDPOINT}\`

The MCP endpoint accepts \`POST\` requests with the standard MCP Streamable HTTP transport.

## Authentication

ChatGPT should use OAuth discovery. The authorization server issues a short-lived
Bearer access token after the user signs in and consents:

\`\`\`text
OAuth: https://post-engineer.com/.well-known/oauth-authorization-server
\`\`\`

For clients without OAuth support, use the user's own Post Engineer API key:

\`\`\`http
Authorization: Bearer <USER_POST_ENGINEER_API_KEY>
\`\`\`

There is no global Post Engineer API key on this server. OAuth tokens and API keys are read from each request and forwarded to Post Engineer for that request only.

Never put the API key in the URL, a query string, source code, or a public repository.

Create or revoke keys at [post-engineer.com/api-keys](https://post-engineer.com/api-keys).

## ChatGPT

1. Open ChatGPT on the web.
2. Enable **Settings -> Security and login -> Developer mode**.
3. Open **Apps** or **Plugins**, then choose **Add**.
4. Enter \`${MCP_ENDPOINT}\` as the remote MCP URL.
5. Complete the OAuth consent flow when prompted.
6. Install the app, open a new chat, and select it with \`@\` or \`+\`.

This server publishes RFC 9728 protected resource metadata at \`${MCP_ENDPOINT}.well-known/oauth-protected-resource\`, pointing at \`https://post-engineer.com\` as the authorization server. The MCP tools accept the resulting OAuth access token and remain compatible with API-key clients.

## Local clients

For OpenCode, Claude Desktop, Cursor, and other local clients using stdio:

\`\`\`json
{
  "mcpServers": {
    "post-engineer": {
      "type": "local",
      "command": ["npx", "-y", "post-engineer-mcp"],
      "environment": {
        "POST_ENGINEER_API_KEY": "<USER_POST_ENGINEER_API_KEY>"
      }
    }
  }
}
\`\`\`

## Available tools

- \`list_personas\`
- \`list_voices\`
- \`list_faces\` — stock faces with gender, age (number), ethnicity, hair, description (EN); use \`url\` as avatarUrl
- \`create_persona\`
- \`update_persona\`
- \`get_token_balance\`
- \`generate_video_from_persona\`
- \`get_video_status\`
- \`list_social_accounts\`
- \`connect_account\` — connect a social account (OAuth URL for youtube/instagram/linkedin; direct connect for bluesky with handle + appPassword)
- \`schedule_video\`
- \`list_schedules\`
- \`list_posts\` — upcoming (scheduled) and past (published/failed) posts across all connected accounts
- \`cancel_schedule\`

## Example prompts

Copy one of these into a chat with the app selected to see what the MCP can do:

\`\`\`text
Show me my upcoming and past posts.
\`\`\`

\`\`\`text
What posts already went out this week, and did any fail?
\`\`\`

\`\`\`text
What is scheduled next on my connected accounts?
\`\`\`

## Validation endpoints

- JSON health check: [${MCP_ENDPOINT}health](https://mcp.post-engineer.com/health)
- Markdown health check: [${MCP_ENDPOINT}health.md](https://mcp.post-engineer.com/health.md)
- Browser documentation: [${MCP_ENDPOINT}docs](https://mcp.post-engineer.com/docs)
- Raw documentation: [${MCP_ENDPOINT}docs.md](https://mcp.post-engineer.com/docs.md)

## Manual checks

\`\`\`bash
curl -i https://mcp.post-engineer.com/health
curl -i https://mcp.post-engineer.com/health.md
curl -i https://mcp.post-engineer.com/docs
curl -i https://mcp.post-engineer.com/docs.md
curl -i -X POST https://mcp.post-engineer.com/ \\
  -H 'Authorization: Bearer <USER_POST_ENGINEER_API_KEY>' \\
  -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual-check","version":"1.0.0"}}}'
\`\`\`
`;

export const healthMarkdown: string = `# ${SERVICE_NAME} health

Status: ok

The HTTP process is running. This endpoint does not authenticate or call the Post Engineer API.
`;

export const docsHtml: string = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${SERVICE_NAME}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { max-width: 880px; margin: 0 auto; padding: 32px 20px; line-height: 1.6; }
      code { background: #eef2f7; border-radius: 6px; color: #18202a; padding: 2px 5px; }
      pre { background: #20242b; border-radius: 6px; color: #f4f7fa; overflow-x: auto; padding: 16px; }
      a { color: #4ea1ff; }
      .card { border: 1px solid #555; border-radius: 10px; padding: 16px; }
    </style>
  </head>
  <body>
    <h1>${SERVICE_NAME}</h1>
    <p>Remote MCP server for Post Engineer.</p>
    <div class="card">
      <strong>MCP endpoint</strong>
      <p><code>${MCP_ENDPOINT}</code></p>
      <p>Use OAuth for ChatGPT. Other clients may use the user's API key as <code>Authorization: Bearer &lt;API_KEY&gt;</code>. There is no global server key.</p>
    </div>
    <h2>ChatGPT</h2>
    <ol>
      <li>Enable Developer mode in ChatGPT under Settings, Security and login.</li>
      <li>Open Apps or Plugins and choose Add.</li>
      <li>Enter <code>${MCP_ENDPOINT}</code>.</li>
      <li>Complete OAuth consent, or configure the user's API key if OAuth is unavailable.</li>
      <li>Install the app and select it in a new chat with <code>@</code> or <code>+</code>.</li>
    </ol>
    <h2>Validation</h2>
    <ul>
      <li><a href="/health">JSON health</a></li>
      <li><a href="/health.md">Markdown health</a></li>
      <li><a href="/docs.md">Raw Markdown documentation</a></li>
      <li><a href="/.well-known/oauth-protected-resource">OAuth discovery metadata</a></li>
    </ul>
    <h2>Available tools</h2>
    <p><code>list_personas</code>, <code>list_voices</code>, <code>list_faces</code>, <code>create_persona</code>, <code>update_persona</code>, <code>get_token_balance</code>, <code>generate_video_from_persona</code>, <code>get_video_status</code>, <code>list_social_accounts</code>, <code>connect_account</code>, <code>schedule_video</code>, <code>list_schedules</code>, <code>list_posts</code>, <code>cancel_schedule</code></p>
    <h2>Example prompts</h2>
    <p>Copy one of these into a chat with the app selected:</p>
    <ul>
      <li><code>Show me my upcoming and past posts.</code></li>
      <li><code>What posts already went out this week, and did any fail?</code></li>
      <li><code>What is scheduled next on my connected accounts?</code></li>
    </ul>
  </body>
</html>`;
