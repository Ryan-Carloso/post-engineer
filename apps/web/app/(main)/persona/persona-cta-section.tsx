'use client';

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
import { PERSONA_CTA_TYPES, type PersonaCtaType } from '@/lib/contracts/personas';
import { usePersonaStore } from '@/lib/store';
import { SectionDivider } from './persona-section-parts';

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
  telegram: 'personas.ctaLinkTelegram',
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
  telegram: true,
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
  const ctaType = usePersonaStore((s) => s.ctaType);
  const ctaUrl = usePersonaStore((s) => s.ctaUrl);
  const ctaInstruction = usePersonaStore((s) => s.ctaInstruction);
  const setCta = usePersonaStore((s) => s.setCta);
  const needsUrl = ctaType === 'link' || ctaType === 'buy';
  return (
    <section>
      <SectionDivider label={t('personas.ctaSectionLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-1.5">
          <Label>{t('personas.ctaTypeLabel')}</Label>
          <Select
            value={ctaType}
            onValueChange={(value) => {
              const type = value as PersonaCtaType;
              setCta({
                type,
                url: type === 'link' || type === 'buy' ? ctaUrl : '',
                instruction: type === 'other' ? ctaInstruction : '',
              });
            }}
          >
            <SelectTrigger aria-label={t('personas.ctaTypeLabel')} className="w-full" data-testid="persona-cta-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERSONA_CTA_TYPES.map((type) => (
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
              value={ctaInstruction}
              onChange={(event) => setCta({ type: ctaType, url: ctaUrl, instruction: event.target.value })}
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
              onChange={(event) => setCta({ type: ctaType, url: event.target.value, instruction: ctaInstruction })}
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
