import { describe, it, expect, beforeEach } from 'vitest';

//---------------
// Tests for personaStore (Zustand). Observed behavior
// through the store's public interface — no internal mocks.
//---------------

import { usePersonaStore } from '@/lib/store';

describe('usePersonaStore', () => {
  beforeEach(() => {
    usePersonaStore.getState().resetForm();
  });

  it('starts with an empty form', () => {
    const state = usePersonaStore.getState();
    expect(state.name).toBe('');
    expect(state.photo).toBeNull();
    expect(state.avatarUrl).toBeNull();
    expect(state.voiceId).toBeNull();
    expect(state.result).toBeNull();
    expect(state.faceQuality).toBe('ok');
  });

  it('setters atualizam os campos da persona', () => {
    const photo = new File(['img'], 'foto.png', { type: 'image/png' });
    const state = usePersonaStore.getState();

    state.setName('Zé Persona');
    state.setPhoto(photo);
    state.setPrompt('avatar estiloso');
    state.setAvatarUrl('data:image/png;base64,ABC');

    const updated = usePersonaStore.getState();
    expect(updated.name).toBe('Zé Persona');
    expect(updated.photo).toBe(photo);
    expect(updated.prompt).toBe('avatar estiloso');
    expect(updated.avatarUrl).toBe('data:image/png;base64,ABC');
  });

  it('buildPersonaFormData sends name, photo and house voice', () => {
    const photo = new File(['img'], 'foto.png', { type: 'image/png' });
    const s = usePersonaStore.getState();
    s.setName('Zé Persona');
    s.setPhoto(photo);
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('name')).toBe('Zé Persona');
    expect(formData.get('photo')).toBe(photo);
    expect(formData.get('voiceId')).toBe('calm');
    expect(formData.has('voiceAudio')).toBe(false);
  });

  it('buildPersonaFormData no longer includes the schedule field (persona/schedule separation)', () => {
    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.has('schedule')).toBe(false);
  });

  it('buildPersonaFormData includes avatarUrl when no photo was uploaded', () => {
    const s = usePersonaStore.getState();
    s.setName('IA Persona');
    s.setAvatarUrl('data:image/png;base64,IA');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('avatarUrl')).toBe('data:image/png;base64,IA');
    expect(formData.has('photo')).toBe(false);
  });

  //---------------
  // Personas are always faced: the store carries no faceless mode and no face
  // mix. "No face" is a per-post choice (NewPostState.faceless). The keys are
  // pinned absent so a future form cannot reintroduce dead state nobody reads.
  //---------------

  it('holds no faceless mode and no face mix', () => {
    const state = usePersonaStore.getState() as unknown as Record<string, unknown>;
    for (const key of [
      'personaMode',
      'setPersonaMode',
      'faceMixPercent',
      'setFaceMixPercent',
    ]) {
      expect(state).not.toHaveProperty(key);
    }
  });

  it('buildPersonaFormData sends no persona mode and no face mix', () => {
    const s = usePersonaStore.getState();
    s.setName('Zé Persona');
    s.setAvatarUrl('data:image/png;base64,IA');
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.has('personaMode')).toBe(false);
    expect(formData.has('faceMixPercent')).toBe(false);
    expect(formData.get('avatarUrl')).toBe('data:image/png;base64,IA');
    expect(formData.get('voiceId')).toBe('calm');
  });

  it('buildPersonaFormData sends the photo when one is staged', () => {
    const photo = new File(['img'], 'foto.png', { type: 'image/png' });
    const s = usePersonaStore.getState();
    s.setName('Zé Persona');
    s.setPhoto(photo);
    s.setAvatarUrl('data:image/png;base64,IA');
    s.setVoiceId('calm');

    // Exactly one visual identity: the staged photo wins over a character the
    // user may have picked earlier (same rule the server enforces).
    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('photo')).toBe(photo);
    expect(formData.has('avatarUrl')).toBe(false);
  });

  it('resetForm returns to the initial state', () => {
    const s = usePersonaStore.getState();
    s.setName('Alguém');
    s.setResult({ success: true, personaId: 'p-9' });

    usePersonaStore.getState().resetForm();

    const reset = usePersonaStore.getState();
    expect(reset.name).toBe('');
    expect(reset.result).toBeNull();
  });

  //---------------
  // Face quality — the persona's only face-related choice (the face itself is
  // always there). Token prices live in lib/tokens (computeVideoTokens).
  //---------------

  it('starts with ok quality', () => {
    expect(usePersonaStore.getState().faceQuality).toBe('ok');
  });

  it('setFaceQuality altera a qualidade da face', () => {
    const s = usePersonaStore.getState();
    s.setFaceQuality('very_good');
    expect(usePersonaStore.getState().faceQuality).toBe('very_good');
  });

  it('buildPersonaFormData sends faceQuality', () => {
    const s = usePersonaStore.getState();
    s.setName('Zé Persona');
    s.setFaceQuality('very_good');
    s.setAvatarUrl('data:image/png;base64,IA');
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('faceQuality')).toBe('very_good');
  });

  it('resetForm volta à qualidade ok', () => {
    const s = usePersonaStore.getState();
    s.setFaceQuality('very_good');
    usePersonaStore.getState().resetForm();

    expect(usePersonaStore.getState().faceQuality).toBe('ok');
  });

  it('buildPersonaFormData sends the niche when set and omits it when empty', () => {
    const s = usePersonaStore.getState();
    s.setName('Zé Persona');
    s.setNiche('  finanças pessoais  ');

    let formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('niche')).toBe('finanças pessoais');

    usePersonaStore.getState().setNiche('   ');
    formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.has('niche')).toBe(false);
  });

  it('buildPersonaFormData sends the niche as the video subject', () => {
    const s = usePersonaStore.getState();
    s.setNiche('  finanças  ');
    s.setScriptPrompt('Estilo curto');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('video_subject')).toBe('finanças');
  });

  //---------------
  // Scheduling has no screen of its own, so the persona store keeps no
  // scheduling state. These keys are pinned so a future scheduling form
  // does not silently reintroduce dead state nobody reads.
  //---------------
  it('holds no scheduling state', () => {
    const state = usePersonaStore.getState() as unknown as Record<string, unknown>;
    for (const key of [
      'scheduleDays',
      'scheduleTimes',
      'timezone',
      'youtubeSelectedIds',
      'instagramSelectedIds',
      'linkedinSelectedIds',
    ]) {
      expect(state).not.toHaveProperty(key);
    }
  });
});
