'use client';

import { useState } from 'react';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/providers/registry';
import { ProviderIcon } from '@/components/provider-icon';
import { INPUT_CLASS } from '@/lib/ui';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { SectionDivider } from './persona-section-parts';

//---------------
// PersonaCtaSection — per-persona call to action, intent only.
//
// PREVIEW ONLY (issue #639): local state, no save wiring yet — the
// migration, API and engine checks land with the implementation PR.
// The persona stores the CTA type + facts (URL, or the "other"
// instruction). The agent writes the CTA words per video from the
// story and the topic; no wording is stored here.
//---------------

export type PersonaCtaType = 'follow' | 'comment' | 'share' | 'save' | 'link' | 'buy' | 'other';

const CTA_TYPES: PersonaCtaType[] = ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'];

const CTA_TYPE_LABEL_KEYS: Record<PersonaCtaType, TranslationKey> = {
  follow: 'personas.ctaTypeFollow',
  comment: 'personas.ctaTypeComment',
  share: 'personas.ctaTypeShare',
  save: 'personas.ctaTypeSave',
  link: 'personas.ctaTypeLink',
  buy: 'personas.ctaTypeBuy',
  other: 'personas.ctaTypeOther',
};

const CTA_PREVIEW_KEYS: Record<PersonaCtaType, TranslationKey> = {
  follow: 'personas.ctaPreviewFollow',
  comment: 'personas.ctaPreviewComment',
  share: 'personas.ctaPreviewShare',
  save: 'personas.ctaPreviewSave',
  link: 'personas.ctaPreviewLink',
  buy: 'personas.ctaPreviewBuy',
  other: 'personas.ctaPreviewOther',
};

// Link behaviour per network: where the URL goes when the CTA type is
// "link" (or "buy"). Instagram and Pinterest have no clickable link in
// the post text — the agent says "link in bio" / points at the pin's
// destination URL instead.
const CTA_LINK_KEYS: Record<SocialProvider, TranslationKey> = {
  youtube: 'personas.ctaLinkYoutube',
  instagram: 'personas.ctaLinkInstagram',
  bluesky: 'personas.ctaLinkBluesky',
  linkedin: 'personas.ctaLinkLinkedin',
  threads: 'personas.ctaLinkThreads',
  facebook: 'personas.ctaLinkFacebook',
  pinterest: 'personas.ctaLinkPinterest',
  '3speak': 'personas.ctaLinkThreespeak',
  rumble: 'personas.ctaLinkRumble',
  fanvue: 'personas.ctaLinkFanvue',
};

const CTA_LINK_CLICKABLE: Record<SocialProvider, boolean> = {
  youtube: true,
  instagram: false,
  bluesky: true,
  linkedin: true,
  threads: true,
  facebook: true,
  pinterest: false,
  '3speak': true,
  rumble: true,
  fanvue: true,
};

function CtaLinkTable() {
  const { t } = useI18n();
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{t('personas.ctaLinkTableTitle')}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted-text">
              <th scope="col" className="px-4 py-3 font-semibold">{t('personas.ctaLinkTableNetwork')}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t('personas.ctaLinkTableClickable')}</th>
              <th scope="col" className="px-4 py-3 font-semibold">{t('personas.ctaLinkTableWhat')}</th>
            </tr>
          </thead>
          <tbody>
            {SOCIAL_PROVIDERS.map((provider) => (
              <tr key={provider} className="border-b border-line last:border-b-0">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 font-semibold text-ink">
                    <ProviderIcon provider={provider} />
                    {PROVIDER_LABELS[provider]}
                  </span>
                </td>
                <td
                  className={`px-4 py-3 font-semibold ${
                    CTA_LINK_CLICKABLE[provider] ? 'text-success' : 'text-destructive'
                  }`}
                >
                  {CTA_LINK_CLICKABLE[provider] ? t('personas.ctaLinkYes') : t('personas.ctaLinkNo')}
                </td>
                <td className="px-4 py-3 leading-6 text-ink-soft">{t(CTA_LINK_KEYS[provider])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PersonaCtaSection() {
  const { t } = useI18n();
  const [ctaType, setCtaType] = useState<PersonaCtaType>('follow');
  const [customInstruction, setCustomInstruction] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const needsUrl = ctaType === 'link' || ctaType === 'buy';
  return (
    <section>
      <SectionDivider label={t('personas.ctaSectionLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-1.5">
          <Label>{t('personas.ctaTypeLabel')}</Label>
          <Select value={ctaType} onValueChange={(value) => setCtaType(value as PersonaCtaType)}>
            <SelectTrigger aria-label={t('personas.ctaTypeLabel')} className="w-full" data-testid="persona-cta-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CTA_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(CTA_TYPE_LABEL_KEYS[type])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t('personas.ctaTypeHint')}</span>
        </div>
        {ctaType === 'other' ? (
          <label className="block text-sm font-semibold text-ink">
            {t('personas.ctaOtherLabel')}
            <input
              type="text"
              className={INPUT_CLASS}
              placeholder={t('personas.ctaOtherPlaceholder')}
              value={customInstruction}
              onChange={(event) => setCustomInstruction(event.target.value)}
              data-testid="persona-cta-instruction"
            />
          </label>
        ) : null}
        {needsUrl ? (
          <label className="block text-sm font-semibold text-ink">
            {t('personas.ctaUrlLabel')}
            <input
              type="url"
              className={INPUT_CLASS}
              placeholder={t('personas.ctaUrlPlaceholder')}
              value={ctaUrl}
              onChange={(event) => setCtaUrl(event.target.value)}
              data-testid="persona-cta-url"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('personas.ctaUrlHint')}</span>
          </label>
        ) : null}
        <p className="rounded-xl bg-sunken px-4 py-3 text-sm leading-6 text-ink-soft">{t(CTA_PREVIEW_KEYS[ctaType])}</p>
        {needsUrl ? <CtaLinkTable /> : null}
      </div>
    </section>
  );
}
