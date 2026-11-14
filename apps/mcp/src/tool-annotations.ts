// MCP tool annotations (ChatGPT / annotation-aware clients).
//
// The SDK's server.tool(name, description, paramsSchema, annotations, cb)
// overload carries these hints into tools/list. They are hints only, but
// clients use them to decide auto-approve vs. confirm vs. warn, so every
// registration passes one explicitly:
// Hints are per tool, not per action: a tool with one destructive action is
// DESTRUCTIVE for all its actions (issue #566 §12).
// - READ_ONLY: video_tasks, posts, insights, billing, prompts, check_script.
// - DESTRUCTIVE: cancel_video, personas, persona_media, voices, accounts,
//   schedules, publish_video.
// - MUTATING (generate_video, experiments, media): creates/updates/generation that change state but do not
//   destroy existing content.
// openWorldHint is true for every tool here: each one talks to the Post
// Engineer API (or, for media (action: check), a caller-supplied public URL).
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const MUTATING: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
