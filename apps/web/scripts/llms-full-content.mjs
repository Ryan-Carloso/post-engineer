export const TOOL_DESCRIPTIONS = [
  ['generate_video', 'Generate one video or a batch of 2-12, schedule each 3 hours to 30 days ahead (or `mode: \'asap\'`) and auto-publish it. The script is segments: the hook first, then the content takes in order, 60-200 words in total.'],
  ['video_tasks', 'Check the progress or the final outcome of video generations, list past generations and read one in full.'],
  ['cancel_video', 'Cancel a video that is still generating (your own task only). Kept apart from `video_tasks` so a client can allow status checks without allowing cancellation.'],
  ['personas', 'List, read, create, update and delete personas (avatar, voice, language, niche). Writes are previewed first, then confirmed. Personas are given by name or id.'],
  ['persona_media', 'A persona\'s face and image library: the stock faces to pick an avatar from, the library images used for per-video image selection, the identity card and the rendered image prompt.'],
  ['voices', 'List the house voices and preview them, and manage your own cloned voices (create, read, preview, delete).'],
  ['accounts', 'List, connect and disconnect social accounts, read or set which accounts a persona publishes to, and list Pinterest boards. Accounts are given by name or id.'],
  ['schedules', 'List scheduled posts, cancel a schedule, read a slot, change a slot title or delete a slot.'],
  ['posts', 'List published posts and read one.'],
  ['insights', 'Post metrics, the last-24-hours metrics, the YouTube retention curve, and public share links for metrics (create, list, revoke).'],
  ['billing', 'Read the prepaid token balance and the token transactions. Check the balance before generating.'],
  ['experiments', 'Compare your prompts inside each publishing account: per account, each prompt version with its results.'],
  ['check_script', 'Check a script mechanically (`validate`) or score a draft (`score`). No tokens are spent.'],
  ['media', 'Images for video segments: upload an image or mechanically check a public image URL.'],
  ['publish_video', 'Publish a finished video file you already have, directly or through a staged upload, or publish an existing generation.'],
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
