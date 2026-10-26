import type { SlotDetailPayload } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

//---------------
// buildGenerationRows — the label/value rows of the post's generation facts,
// in display order. Extracted from page.tsx (grandfathered over the
// file-size cap). The material row is always shown, face or not: the video
// is either stock only or drawings only, and the post says which.
//---------------
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
    {
      label: t('posts.generationMaterialLabel'),
      value: generation.material === 'svg' ? t('posts.generationMaterialSvg') : t('posts.generationMaterialBroll'),
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
