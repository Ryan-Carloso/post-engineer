import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebugStore, DEBUG_UNLOCK_CLICKS, DEBUG_CLICK_WINDOW_MS } from '@/lib/debug-store';

//---------------
// Tests for the Debug Store — 10 clicks on the logo within the window unlock
// debug mode; fewer clicks do not; the count expires outside the window.
//---------------

const store = () => useDebugStore.getState();

describe('useDebugStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T12:00:00.000Z'));
    useDebugStore.setState({ debugMode: false, clickTimestamps: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts locked with no clicks', () => {
    expect(store().debugMode).toBe(false);
    expect(store().clickTimestamps).toEqual([]);
  });

  it('desbloqueia ao completar DEBUG_UNLOCK_CLICKS cliques dentro da janela', () => {
    for (let i = 0; i < DEBUG_UNLOCK_CLICKS; i++) {
      store().registerClick();
    }
    expect(store().debugMode).toBe(true);
  });

  it('stays locked with fewer than DEBUG_UNLOCK_CLICKS clicks', () => {
    for (let i = 0; i < DEBUG_UNLOCK_CLICKS - 1; i++) {
      store().registerClick();
    }
    expect(store().debugMode).toBe(false);
  });

  it('expires clicks outside the window and does not unlock with stale clicks', () => {
    for (let i = 0; i < DEBUG_UNLOCK_CLICKS; i++) {
      store().registerClick();
    }
    expect(store().debugMode).toBe(true);

    // advance past the window and reset
    vi.setSystemTime(new Date('2026-09-08T12:06:00.000Z'));
    useDebugStore.setState({ debugMode: false, clickTimestamps: [] });

    // fewer clicks inside the new window do not unlock
    for (let i = 0; i < DEBUG_UNLOCK_CLICKS - 1; i++) {
      store().registerClick();
    }
    expect(store().debugMode).toBe(false);
  });

  it('a fast burst unlocks even when clicks sit exactly at the window boundary', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    for (let i = 0; i < DEBUG_UNLOCK_CLICKS; i++) {
      vi.setSystemTime(new Date(now.getTime() + i * Math.floor(DEBUG_CLICK_WINDOW_MS / DEBUG_UNLOCK_CLICKS)));
      store().registerClick();
    }
    expect(store().debugMode).toBe(true);
  });

  it('resetDebug unlocks the mode and clears the history', () => {
    for (let i = 0; i < DEBUG_UNLOCK_CLICKS; i++) {
      store().registerClick();
    }
    expect(store().debugMode).toBe(true);
    store().resetDebug();
    expect(store().debugMode).toBe(false);
    expect(store().clickTimestamps).toEqual([]);
  });
});