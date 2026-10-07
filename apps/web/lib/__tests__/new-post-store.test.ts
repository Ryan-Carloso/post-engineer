import { describe, it, expect, beforeEach } from 'vitest';
import { useNewPostStore } from '@/lib/store';

//---------------
// store — useNewPostStore (the /posts/new draft).
//
// The topic is a single string: one post is one video. The form submits it as
// a one-element array, so the "empty topics array" failure (TOPICS_REQUIRED)
// is unreachable from the UI and needs no guard here.
//---------------

beforeEach(() => {
  useNewPostStore.getState().reset();
});

describe('useNewPostStore topic', () => {
  it('starts empty, with no second row to fill', () => {
    expect(useNewPostStore.getState().topic).toBe('');
  });

  it('setTopic replaces the whole topic rather than appending', () => {
    const { setTopic } = useNewPostStore.getState();
    setTopic('First');
    setTopic('Second');

    expect(useNewPostStore.getState().topic).toBe('Second');
  });
});

describe('useNewPostStore persona choice', () => {
  it('starts on neither a persona nor the explicit persona-less choice', () => {
    // An empty personaId is "not chosen yet", which is NOT the same as
    // choosing "no persona": the form must be able to tell the user apart.
    const state = useNewPostStore.getState();
    expect(state.personaId).toBe('');
    expect(state.withoutPersona).toBe(false);
  });

  it('withoutPersona clears any persona', () => {
    const store = useNewPostStore.getState();
    store.setPersonaId('p1');

    store.setWithoutPersona(true);

    expect(useNewPostStore.getState().personaId).toBe('');
    expect(useNewPostStore.getState().withoutPersona).toBe(true);
  });

  it('choosing a persona clears the persona-less flag', () => {
    // The two are exclusive: leaving the flag set would coerce the post to
    // faceless and drop the persona from the request.
    const store = useNewPostStore.getState();
    store.setWithoutPersona(true);

    store.setPersonaId('p1');

    expect(useNewPostStore.getState().personaId).toBe('p1');
    expect(useNewPostStore.getState().withoutPersona).toBe(false);
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
    store.setVoiceId('calm');
    store.setTopic('A topic');
    store.setStartAt('2030-01-05T09:00');
    store.setTimezone('Europe/Lisbon');
    store.setValidationKey('newPost.errorGeneric');
    store.setPending(true);
    store.setResult({ success: false, scheduleId: null, scheduleMode: null, slotId: null, slotCount: 0, code: 'INTERNAL_ERROR', need: null, have: null });

    store.reset();

    const state = useNewPostStore.getState();
    expect(state.personaId).toBe('');
    expect(state.voiceId).toBe('');
    expect(state.withoutPersona).toBe(false);
    expect(state.topic).toBe('');
    expect(state.startAt).toBe('');
    expect(state.timezone).toBe('UTC');
    expect(state.validationKey).toBeNull();
    expect(state.pending).toBe(false);
    expect(state.result).toBeNull();
  });
});
