'use client';

import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { usePersonaStore } from '@/lib/store';

export const PersonaFormSync = () => {
  const { formState: { dirtyFields } } = useFormContext();
  const name = useWatch({ name: 'name' });
  const niche = useWatch({ name: 'niche' });
  const scriptPrompt = useWatch({ name: 'scriptPrompt' });
  const ctaText = useWatch({ name: 'ctaText' });

  useEffect(() => {
    if (dirtyFields.name && typeof name === 'string') {
      usePersonaStore.getState().setName(name);
    }
  }, [name, dirtyFields.name]);

  useEffect(() => {
    if (dirtyFields.niche && typeof niche === 'string') {
      usePersonaStore.getState().setNiche(niche);
    }
  }, [niche, dirtyFields.niche]);

  useEffect(() => {
    if (dirtyFields.scriptPrompt && typeof scriptPrompt === 'string') {
      usePersonaStore.getState().setScriptPrompt(scriptPrompt);
    }
  }, [scriptPrompt, dirtyFields.scriptPrompt]);

  useEffect(() => {
    if (dirtyFields.ctaText && typeof ctaText === 'string') {
      usePersonaStore.getState().setCtaText(ctaText);
    }
  }, [ctaText, dirtyFields.ctaText]);

  return null;
};
