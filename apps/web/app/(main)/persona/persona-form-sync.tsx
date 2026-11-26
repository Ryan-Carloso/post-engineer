'use client';

import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { usePersonaStore } from '@/lib/store';

export const PersonaFormSync = () => {
  const { formState: { dirtyFields } } = useFormContext();
  const name = useWatch({ name: 'name' });

  useEffect(() => {
    if (dirtyFields.name && typeof name === 'string') {
      usePersonaStore.getState().setName(name);
    }
  }, [name, dirtyFields.name]);

  return null;
};
