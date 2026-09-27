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
    const state = usePersonaStore.getState();
    state.setScheduleTimes(['09:00', '14:30']);

    const formData = state.buildPersonaFormData();
    expect(formData.has('schedule')).toBe(false);
  });

  it('adds and removes times without duplicating', () => {
    const state = usePersonaStore.getState();
    state.addScheduleTime('12:15');
    state.addScheduleTime('12:15');
    state.removeScheduleTime('12:15');

    expect(usePersonaStore.getState().scheduleTimes).toEqual(['09:00']);
  });

  it('buildPersonaFormData includes avatarUrl when no photo was uploaded', () => {
    const s = usePersonaStore.getState();
    s.setName('IA Persona');
    s.setAvatarUrl('data:image/png;base64,IA');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('avatarUrl')).toBe('data:image/png;base64,IA');
    expect(formData.has('photo')).toBe(false);
  });

  it('starts in persona mode (default)', () => {
    expect(usePersonaStore.getState().personaMode).toBe('persona');
  });

  it('buildPersonaFormData no modo faceless omite foto e avatar', () => {
    const photo = new File(['img'], 'foto.png', { type: 'image/png' });
    const s = usePersonaStore.getState();
    s.setPersonaMode('faceless');
    s.setName('Canal Ninja');
    s.setPhoto(photo);
    s.setAvatarUrl('data:image/png;base64,IA');
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('personaMode')).toBe('faceless');
    expect(formData.has('photo')).toBe(false);
    expect(formData.has('avatarUrl')).toBe(false);
    expect(formData.get('voiceId')).toBe('calm');
  });

  it('buildPersonaFormData in persona mode sends photo and personaMode', () => {
    const photo = new File(['img'], 'foto.png', { type: 'image/png' });
    const s = usePersonaStore.getState();
    s.setPersonaMode('persona');
    s.setName('Zé Persona');
    s.setPhoto(photo);
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('personaMode')).toBe('persona');
    expect(formData.get('photo')).toBe(photo);
  });

  it('setPersonaMode alterna entre persona e faceless', () => {
    const s = usePersonaStore.getState();
    s.setPersonaMode('faceless');
    expect(usePersonaStore.getState().personaMode).toBe('faceless');
    s.setPersonaMode('persona');
    expect(usePersonaStore.getState().personaMode).toBe('persona');
  });

  it('resetForm volta ao modo persona (default)', () => {
    const s = usePersonaStore.getState();
    s.setPersonaMode('faceless');
    usePersonaStore.getState().resetForm();
    expect(usePersonaStore.getState().personaMode).toBe('persona');
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
  // Faceless/face mix (hybrid) + face quality — token prices.
  //---------------

  it('starts with 100% face (default mix) and ok quality', () => {
    const state = usePersonaStore.getState();
    expect(state.faceMixPercent).toBe(100);
    expect(state.faceQuality).toBe('ok');
  });

  it('setFaceMixPercent atualiza o mix e deriva o modo', () => {
    const s = usePersonaStore.getState();
    s.setFaceMixPercent(0);
    let state = usePersonaStore.getState();
    expect(state.faceMixPercent).toBe(0);
    expect(state.personaMode).toBe('faceless');

    s.setFaceMixPercent(40);
    state = usePersonaStore.getState();
    expect(state.faceMixPercent).toBe(40);
    expect(state.personaMode).toBe('persona');

    s.setFaceMixPercent(100);
    expect(usePersonaStore.getState().personaMode).toBe('persona');
  });

  it('setFaceMixPercent clampa valores fora de 0–100', () => {
    usePersonaStore.getState().setFaceMixPercent(-10);
    expect(usePersonaStore.getState().faceMixPercent).toBe(0);
    usePersonaStore.getState().setFaceMixPercent(150);
    expect(usePersonaStore.getState().faceMixPercent).toBe(100);
  });

  it('setFaceQuality altera a qualidade da face', () => {
    const s = usePersonaStore.getState();
    s.setFaceQuality('very_good');
    expect(usePersonaStore.getState().faceQuality).toBe('very_good');
  });

  it('buildPersonaFormData sends faceMixPercent and faceQuality', () => {
    const s = usePersonaStore.getState();
    s.setName('Mix');
    s.setFaceMixPercent(75);
    s.setFaceQuality('very_good');
    s.setPhoto(new File(['png'], 'foto.png', { type: 'image/png' }));
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('faceMixPercent')).toBe('75');
    expect(formData.get('faceQuality')).toBe('very_good');
  });

  it('buildPersonaFormData derives the mix from the mode: faceless sends 0', () => {
    const s = usePersonaStore.getState();
    s.setName('Mix');
    s.setVoiceId('calm');
    s.setPersonaMode('faceless');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('personaMode')).toBe('faceless');
    expect(formData.get('faceMixPercent')).toBe('0');
  });

  it('buildPersonaFormData with mix 0 omits photo and avatar', () => {
    const s = usePersonaStore.getState();
    s.setName('Mix');
    s.setFaceMixPercent(0);
    s.setPhoto(new File(['png'], 'foto.png', { type: 'image/png' }));
    s.setAvatarUrl('data:image/png;base64,IA');
    s.setVoiceId('calm');

    const formData = usePersonaStore.getState().buildPersonaFormData();
    expect(formData.get('personaMode')).toBe('faceless');
    expect(formData.has('photo')).toBe(false);
    expect(formData.has('avatarUrl')).toBe(false);
  });

  it('resetForm volta ao mix 100% face e qualidade ok', () => {
    const s = usePersonaStore.getState();
    s.setFaceMixPercent(0);
    s.setFaceQuality('very_good');
    usePersonaStore.getState().resetForm();

    const state = usePersonaStore.getState();
    expect(state.faceMixPercent).toBe(100);
    expect(state.faceQuality).toBe('ok');
    expect(state.personaMode).toBe('persona');
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
  // Autopilot LinkedIn accounts — selection and schedule JSON.
  //---------------

  it('starts with no LinkedIn account selected', () => {
    usePersonaStore.getState().resetForm();
    expect(usePersonaStore.getState().linkedinSelectedIds).toEqual([]);
  });

  it('setLinkedInSelectedIds define e toggleLinkedInSelectedId alterna', () => {
    const s = usePersonaStore.getState();
    s.setLinkedInSelectedIds(['urn:li:person:1']);
    expect(usePersonaStore.getState().linkedinSelectedIds).toEqual(['urn:li:person:1']);

    s.toggleLinkedInSelectedId('urn:li:org:2');
    expect(usePersonaStore.getState().linkedinSelectedIds).toEqual(['urn:li:person:1', 'urn:li:org:2']);

    s.toggleLinkedInSelectedId('urn:li:person:1');
    expect(usePersonaStore.getState().linkedinSelectedIds).toEqual(['urn:li:org:2']);
  });

  it('resetForm clears the selected LinkedIn accounts', () => {
    const s = usePersonaStore.getState();
    s.setLinkedInSelectedIds(['urn:li:person:1']);
    usePersonaStore.getState().resetForm();
    expect(usePersonaStore.getState().linkedinSelectedIds).toEqual([]);
  });
});
