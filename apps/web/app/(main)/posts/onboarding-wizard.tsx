'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { CircleHelp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SUPPORT_EMAIL } from '@/components/ui/pricing-contact';
import { useI18n } from '@/lib/i18n/provider';
import {
  readOnboardingWizardSeen,
  readOnboardingWizardStep,
  useOnboardingWizardStore,
} from '@/lib/onboarding-wizard';
import { whatsappUrl } from '@/lib/whatsapp';
import { CREATE_POSTS_HREF } from './day-section';

//---------------
// First-visit onboarding wizard (issue #573). Four steps with room to
// explain: what the app is, connect an account, connect the agent, tokens.
// It opens on the first visit to the posts calendar and resumes at the
// saved step after a detour (to /accounts, or to /recipes for the setup
// prompt). Closing it or finishing it marks the visit seen; the header
// button reopens it from step 1. It never creates anything itself: account
// connect lives on /accounts, the setup prompt on /recipes, tokens are
// contact-only (WhatsApp / email, no billing UI).
//---------------

// Brand names are the same in both locales, so the chips use literals.
const PROVIDERS = [
  'YouTube',
  'Instagram',
  'Bluesky',
  'LinkedIn',
  'Threads',
  'Facebook',
  'Pinterest',
  'Fanvue',
  '3Speak',
  'Rumble',
] as const;

export function OnboardingWizardButton({ testId }: { testId?: string }) {
  const { t } = useI18n();
  const open = useOnboardingWizardStore((s) => s.open);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-9 shrink-0"
      onClick={open}
      aria-label={t('onboarding.reopen')}
      data-testid={testId}
    >
      <CircleHelp aria-hidden />
    </Button>
  );
}

export function OnboardingWizard() {
  const { t } = useI18n();
  const isOpen = useOnboardingWizardStore((s) => s.isOpen);
  const step = useOnboardingWizardStore((s) => s.step);
  const openAtStep = useOnboardingWizardStore((s) => s.openAtStep);
  const dismiss = useOnboardingWizardStore((s) => s.dismiss);

  // Mount-only check by design: the wizard reads the seen flag once, when
  // the posts page mounts. A later localStorage change (another tab) must
  // not reopen it mid-session, so the readers stay out of the deps.
  useEffect(() => {
    if (!readOnboardingWizardSeen()) openAtStep(readOnboardingWizardStep());
  }, [openAtStep]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-md" data-testid="onboarding-wizard-dialog">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
          {t('onboarding.stepOf', { step })}
        </p>
        {step === 1 && <WizardStepOne />}
        {step === 2 && <WizardStepTwo />}
        {step === 3 && <WizardStepThree />}
        {step === 4 && <WizardStepFour />}
      </DialogContent>
    </Dialog>
  );
}

function WizardStepOne() {
  const { t } = useI18n();
  const next = useOnboardingWizardStore((s) => s.next);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('onboarding.step1Title')}</DialogTitle>
        <DialogDescription>{t('onboarding.step1Body')}</DialogDescription>
      </DialogHeader>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={next}>
          {t('onboarding.continue')}
        </Button>
      </div>
    </>
  );
}

function WizardStepTwo() {
  const { t } = useI18n();
  const next = useOnboardingWizardStore((s) => s.next);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('onboarding.step2Title')}</DialogTitle>
        <DialogDescription>{t('onboarding.step2Body')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((provider) => (
          <Button
            key={provider}
            asChild
            variant="outline"
            size="sm"
            data-testid={`onboarding-provider-${provider.toLowerCase()}`}
          >
            <Link href="/accounts">{provider}</Link>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={next}>
          {t('onboarding.skip')}
        </Button>
        <Button asChild size="sm">
          <Link href="/accounts">{t('onboarding.connectAccount')}</Link>
        </Button>
      </div>
    </>
  );
}

const STEP3_KEYS = ['onboarding.step3Step1', 'onboarding.step3Step2', 'onboarding.step3Step3'] as const;

function WizardStepThree() {
  const { t } = useI18n();
  const next = useOnboardingWizardStore((s) => s.next);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('onboarding.step3Title')}</DialogTitle>
      </DialogHeader>
      <ol className="space-y-2">
        {STEP3_KEYS.map((key, index) => (
          <li key={key} className="flex gap-2 text-sm text-primary">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold">
              {index + 1}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ol>
      <div>
        <Button asChild variant="link" size="sm" className="px-0">
          <Link href={CREATE_POSTS_HREF} target="_blank" rel="noreferrer">
            {t('onboarding.step3SetupLink')} ↗
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={next}>
          {t('onboarding.skip')}
        </Button>
        <Button type="button" size="sm" onClick={next}>
          {t('onboarding.step3Done')}
        </Button>
      </div>
    </>
  );
}

function WizardStepFour() {
  const { t } = useI18n();
  const dismiss = useOnboardingWizardStore((s) => s.dismiss);
  const whatsappHref = whatsappUrl(t('onboarding.step4Whatsapp'));
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('onboarding.step4Title')}</DialogTitle>
        <DialogDescription>{t('onboarding.step4Body')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        {whatsappHref && (
          <Button asChild size="sm">
            <a href={whatsappHref} target="_blank" rel="noreferrer" data-testid="onboarding-whatsapp-cta">
              {t('onboarding.talkToUs')} ↗
            </a>
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${SUPPORT_EMAIL}`} data-testid="onboarding-email-cta">
            {t('onboarding.talkToUs')} · {SUPPORT_EMAIL}
          </a>
        </Button>
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={dismiss}>
          {t('onboarding.startPublishing')}
        </Button>
      </div>
    </>
  );
}
