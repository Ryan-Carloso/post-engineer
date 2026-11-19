import type { SlotDetailPayload } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

export interface GenerationRow {
  label: string;
  value: string;
}

export function buildGenerationRows(
  generation: SlotDetailPayload['generation'],
  personaName: string,
  t: (key: TranslationKey) => string,
): GenerationRow[] {
  const rows: GenerationRow[] = [
    { label: t('posts.generationPersonaLabel'), value: personaName },
    {
      label: t('posts.generationFaceLabel'),
      value: generation.faceless ? t('posts.generationFaceless') : t('posts.generationWithFace'),
    },
  ];
  if (generation.language !== null) {
    rows.push({ label: t('posts.generationLanguageLabel'), value: generation.language });
  }
  if (generation.voiceId !== null) {
    rows.push({ label: t('posts.generationVoiceLabel'), value: generation.voiceId });
  }
  if (generation.videoAspect !== null) {
    rows.push({ label: t('posts.generationFormatLabel'), value: generation.videoAspect });
  }
  if (generation.niche !== null) {
    rows.push({ label: t('posts.generationNicheLabel'), value: generation.niche });
  }
  if (generation.paragraphNumber !== null) {
    rows.push({ label: t('posts.generationParagraphsLabel'), value: String(generation.paragraphNumber) });
  }
  return rows;
}
