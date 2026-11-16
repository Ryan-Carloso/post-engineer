'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { CircleHelp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SUPPORT_EMAIL } from '@/components/ui/pricing-contact';
import { logClientError } from '@/lib/client-logger';
import { useI18n } from '@/lib/i18n/provider';
import {
  markOnboardingWizardSeen,
  readOnboardingWizardSeen,
  shouldAutoOpenOnboardingWizard,
  useOnboardingWizardStore,
} from '@/lib/onboarding-wizard';
import { createSupabaseClient } from '@/lib/supabase/client';
import { whatsappUrl } from '@/lib/whatsapp';
import { CREATE_POSTS_HREF } from './day-section';
import { WizardStepTwo } from './onboarding-step2';

//---------------
// First-visit onboarding wizard (issue #573). Four steps with room to
// explain: what the app is, connect an account, connect the agent, tokens.
// It opens on its own once per account, on the first visit to the posts
// calendar, and is marked seen as it opens (lib/onboarding-wizard.ts);
// the header button reopens it from step 1. Step 2 connects inline, inside this dialog (issue #578): no
// step-2 action navigates away, so the dialog never unmounts mid-connect.
// Tokens are contact-only (WhatsApp / email, no billing UI).
//---------------

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
  const open = useOnboardingWizardStore((s) => s.open);
  const close = useOnboardingWizardStore((s) => s.close);

  // Mount-only check by design: the seen flag is read once, when the posts
  // page mounts, so a later change (another tab) never reopens it
  // mid-session. The cancel flag drops a late answer after unmount.
  useEffect(() => {
    // The local flag answers without a network read on every later visit.
    if (readOnboardingWizardSeen()) return;
    let cancelled = false;
    const client = createSupabaseClient();
    shouldAutoOpenOnboardingWizard(client)
      .then((show) => {
        if (cancelled || !show) return;
        open();
        return markOnboardingWizardSeen(client);
      })
      .catch((error: unknown) => {
        logClientError('[onboarding] first-visit check failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) close();
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
  const close = useOnboardingWizardStore((s) => s.close);
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
        <Button type="button" size="sm" onClick={close}>
          {t('onboarding.startPublishing')}
        </Button>
      </div>
    </>
  );
}
