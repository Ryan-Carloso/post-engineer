// MCP tool annotations (ChatGPT / annotation-aware clients).
//
// The SDK's server.tool(name, description, paramsSchema, annotations, cb)
// overload carries these hints into tools/list. They are hints only, but
// clients use them to decide auto-approve vs. confirm vs. warn, so every
// registration passes one explicitly:
// - READ_ONLY: list_*/get_*/check_*/validate/score and other pure reads.
// - DESTRUCTIVE: delete_*, publish, disconnect and cancel tools.
// - MUTATING: creates/updates/generation that change state but do not
//   destroy existing content.
// openWorldHint is true for every tool here: each one talks to the Post
// Engineer API (or, for check_media, a caller-supplied public URL).
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
