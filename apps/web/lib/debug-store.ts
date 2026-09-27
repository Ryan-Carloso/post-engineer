import { create } from 'zustand';

//---------------
// Debug Store — 10 clicks on the logo within 5s unlock debug mode.
//---------------

export const DEBUG_UNLOCK_CLICKS = 10;
export const DEBUG_CLICK_WINDOW_MS = 5000;

interface DebugState {
  debugMode: boolean;
  clickTimestamps: number[];
  registerClick: () => void;
  resetDebug: () => void;
}

export const useDebugStore = create<DebugState>((set, get) => ({
  debugMode: false,
  clickTimestamps: [],

  registerClick: () => {
    const now = Date.now();
    const { clickTimestamps } = get();
    // keep only clicks inside the window
    const recent = clickTimestamps.filter((ts) => now - ts < DEBUG_CLICK_WINDOW_MS);
    const updated = [...recent, now];
    set({ clickTimestamps: updated });
    if (updated.length >= DEBUG_UNLOCK_CLICKS) {
      set({ debugMode: true });
    }
  },

  resetDebug: () => set({ debugMode: false, clickTimestamps: [] }),
}));