'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CREATE_POSTS_HREF, readMcpOnboardSeen, useMcpOnboardStore } from '@/lib/mcp-onboard';

//---------------
// New post, explained. The button is the thing people look for on the
// calendar. It opens the dialog. The card is the first-visit onboard:
// it sits under the page title until they dismiss it or open the
// recipes hub. Neither one is a create form.
//---------------

const STEP_KEYS = ['posts.mcpOnboardStep1', 'posts.mcpOnboardStep2', 'posts.mcpOnboardStep3'] as const satisfies readonly TranslationKey[];

export function NewPostButton({ className, testId }: { className?: string; testId?: string }) {
  const { t } = useI18n();
  const show = useMcpOnboardStore((s) => s.show);
  return (
    <Button type="button" size="sm" className={cn('shrink-0', className)} data-testid={testId} onClick={show}>
      <CalendarPlus aria-hidden />
      {t('posts.newPostAction')}
    </Button>
  );
}

function McpOnboardSteps() {
  const { t } = useI18n();
  return (
    <ol className="mt-3 space-y-2">
      {STEP_KEYS.map((key, index) => (
        <li key={key} className="flex gap-2 text-sm text-primary">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold">{index + 1}</span>
          <span>{t(key)}</span>
        </li>
      ))}
    </ol>
  );
}

function McpOnboardActions() {
  const { t } = useI18n();
  const dismiss = useMcpOnboardStore((s) => s.dismiss);
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button asChild size="sm">
        <Link href={CREATE_POSTS_HREF} onClick={dismiss}>
          {t('posts.mcpOnboardSetup')}
        </Link>
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={dismiss}>
        {t('posts.mcpOnboardDismiss')}
      </Button>
    </div>
  );
}

export function McpOnboardCard() {
  const { t } = useI18n();
  const cardVisible = useMcpOnboardStore((s) => s.cardVisible);
  const revealCard = useMcpOnboardStore((s) => s.revealCard);

  useEffect(() => {
    if (!readMcpOnboardSeen()) revealCard();
  }, [revealCard]);

  if (!cardVisible) return null;

  return (
    <section data-testid="mcp-onboard-card" aria-labelledby="mcp-onboard-title" className="mt-4 rounded-xl border border-line bg-card p-4 sm:px-5">
      <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">{t('posts.mcpOnboardBadge')}</p>
      <p id="mcp-onboard-title" className="mt-1 text-base font-semibold text-primary">
        {t('posts.mcpOnboardTitle')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t('posts.mcpOnboardLead')}</p>
      <p className="mt-2 text-sm text-primary">{t('posts.mcpOnboardBody')}</p>
      <McpOnboardSteps />
      <McpOnboardActions />
    </section>
  );
}

export function McpOnboardDialog() {
  const { t } = useI18n();
  const isOpen = useMcpOnboardStore((s) => s.isOpen);
  const dismiss = useMcpOnboardStore((s) => s.dismiss);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next || !useMcpOnboardStore.getState().isOpen) return;
        dismiss();
      }}
    >
      <DialogContent className="max-w-md" data-testid="mcp-onboard-dialog">
        <DialogHeader>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">{t('posts.mcpOnboardBadge')}</p>
          <DialogTitle>{t('posts.mcpOnboardTitle')}</DialogTitle>
          <DialogDescription>{t('posts.mcpOnboardLead')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-primary">{t('posts.mcpOnboardBody')}</p>
        <McpOnboardSteps />
        <McpOnboardActions />
      </DialogContent>
    </Dialog>
  );
}
