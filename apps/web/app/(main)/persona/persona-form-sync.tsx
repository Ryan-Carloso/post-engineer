'use client';

import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { usePersonaStore } from '@/lib/store';

//---------------
// PersonaFormSync — mirrors RHF fields into the zustand store
// (only when the field is dirty, so the store is not overwritten
// on mount or in the edit flow).
//
// Extracted from page.tsx so the page module stays under the file-size
// ratchet.
//---------------
export const PersonaFormSync = () => {
  const { formState: { dirtyFields } } = useFormContext();
  const name = useWatch({ name: 'name' });
  const niche = useWatch({ name: 'niche' });
  const scriptPrompt = useWatch({ name: 'scriptPrompt' });

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

  return null;
};
