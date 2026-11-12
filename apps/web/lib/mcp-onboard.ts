import { create } from 'zustand';

//---------------
// MCP-first onboard. The web app has no new-post form: a post is created
// when the user's agent sends it through the MCP server. The posts page
// explains that once (a card) and again whenever they press New post
// (a dialog). Dismissing either one is remembered on this browser.
//---------------

export const MCP_ONBOARD_SEEN_KEY = 'post-engineer-mcp-onboard-seen';

// The recipes hub is where the API key and the agent setup prompt live.
export const CREATE_POSTS_HREF = '/recipes';

export function readMcpOnboardSeen(): boolean {
  return window.localStorage.getItem(MCP_ONBOARD_SEEN_KEY) === '1';
}

export function markMcpOnboardSeen(): void {
  window.localStorage.setItem(MCP_ONBOARD_SEEN_KEY, '1');
}

interface McpOnboardState {
  isOpen: boolean;
  cardVisible: boolean;
  show: () => void;
  dismiss: () => void;
  revealCard: () => void;
}

export const useMcpOnboardStore = create<McpOnboardState>((set) => ({
  isOpen: false,
  cardVisible: false,
  show: () => set({ isOpen: true }),
  dismiss: () => {
    markMcpOnboardSeen();
    set({ isOpen: false, cardVisible: false });
  },
  revealCard: () => set({ cardVisible: true }),
}));
