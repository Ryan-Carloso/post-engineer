export const TOOL_DESCRIPTIONS = [
  ['personas', 'List, read, create, update and delete personas (avatar, language, niche). Writes are previewed first, then confirmed. Personas are given by name or id.'],
  ['persona_media', 'A persona\'s identity card and the image prompts rendered from it, for your own image tool.'],
  ['accounts', 'List, connect and disconnect social accounts, read or set which accounts a persona publishes to, and list Pinterest boards. Accounts are given by name or id.'],
  ['schedules', 'List scheduled posts, cancel a schedule, read a slot, change a slot title or delete a slot.'],
  ['posts', 'List published posts and read one.'],
  ['insights', 'Post metrics, the last-24-hours metrics, the YouTube retention curve, and public share links for metrics (create, list, revoke).'],
  ['experiments', 'Compare your prompts inside each publishing account: per account, each prompt version with its results.'],
  ['publish_video', 'Publish a finished video or image you made elsewhere, directly or through a staged upload, now or at a scheduled time.'],
  ['prompts', 'The prompt library: list and read prompts, and create, update, delete and restore your own, with version history.'],
  ['tool_config', 'Read and save the search tool and the licensed stock sources. Keys are stored encrypted and only their presence and last 4 characters are ever returned.'],
];

export const MORE_SECTION = [
  '## More',
  '',
  '- [OpenAPI spec](https://post-engineer.com/openapi.json): every endpoint callable with an API key.',
  '- [MCP server docs](https://github.com/Ryan-Carloso/post-engineer/tree/main/apps/mcp): setup, tool list, prompts, and social account ID mapping.',
  '- [Prompts and recipes](https://post-engineer.com/recipes): the prompt hub.',
].join('\n');
