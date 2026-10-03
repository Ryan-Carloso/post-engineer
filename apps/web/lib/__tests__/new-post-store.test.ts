import { describe, it, expect, beforeEach } from 'vitest';
import { useNewPostStore } from '@/lib/store';
import { MAX_POST_TOPICS } from '@/lib/schedule/slot-distribution';

//---------------
// store — useNewPostStore (the /posts/new draft).
//
// The topic cap and the "never drop the last row" rules are load-bearing:
// the API rejects an empty topics array and a request above the cap, so the
// form must not be able to build either.
//---------------

beforeEach(() => {
  useNewPostStore.getState().reset();
});

describe('useNewPostStore topics', () => {
  it('starts with exactly one editable topic row', () => {
    expect(useNewPostStore.getState().topics).toEqual(['']);
  });

  it('setTopic edits the row at the given index only', () => {
    const { addTopic, setTopic } = useNewPostStore.getState();
    addTopic();
    setTopic(0, 'First');
    setTopic(1, 'Second');

    expect(useNewPostStore.getState().topics).toEqual(['First', 'Second']);
  });

  it('addTopic never exceeds the API limit', () => {
    for (let i = 0; i < MAX_POST_TOPICS + 5; i += 1) {
      useNewPostStore.getState().addTopic();
    }

    expect(useNewPostStore.getState().topics).toHaveLength(MAX_POST_TOPICS);
  });

  it('removeTopic drops the row at the index but keeps the last one', () => {
    const { addTopic, setTopic, removeTopic } = useNewPostStore.getState();
    addTopic();
    setTopic(0, 'First');
    setTopic(1, 'Second');

    removeTopic(0);
    expect(useNewPostStore.getState().topics).toEqual(['Second']);

    // A single remaining row is not removable: an empty topics array would be
    // rejected by the API (TOPICS_REQUIRED).
    removeTopic(0);
    expect(useNewPostStore.getState().topics).toEqual(['Second']);
  });
});

describe('useNewPostStore times', () => {
  it('removeTime keeps at least one time row', () => {
    useNewPostStore.getState().addTime();
    useNewPostStore.getState().setTime(0, '09:00');
    useNewPostStore.getState().setTime(1, '18:00');

    useNewPostStore.getState().removeTime(1);
    expect(useNewPostStore.getState().times).toEqual(['09:00']);

    useNewPostStore.getState().removeTime(0);
    expect(useNewPostStore.getState().times).toEqual(['09:00']);
  });
});

describe('useNewPostStore reset', () => {
  it('clears the draft, the outcome and the pending flag', () => {
    const store = useNewPostStore.getState();
    store.setPersonaId('p1');
    store.setTopic(0, 'A topic');
    store.setStartAt('2030-01-05T09:00');
    store.setTimezone('Europe/Lisbon');
    store.setValidationKey('newPost.errorGeneric');
    store.setPending(true);
    store.setResult({ success: false, scheduleId: null, slotCount: 0, code: 'INTERNAL_ERROR', need: null, have: null });

    store.reset();

    const state = useNewPostStore.getState();
    expect(state.personaId).toBe('');
    expect(state.topics).toEqual(['']);
    expect(state.startAt).toBe('');
    expect(state.timezone).toBe('UTC');
    expect(state.validationKey).toBeNull();
    expect(state.pending).toBe(false);
    expect(state.result).toBeNull();
  });
});
