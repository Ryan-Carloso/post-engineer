'use client';

import type { ComponentType, ReactNode } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { buildInstallPrompt } from '@/lib/mcp-install-prompt';
import { useCopyText } from '@/lib/use-copy-text';
import { whatsappUrl } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';
import {
  AccountsIcon,
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  CoinsIcon,
  ComposeIcon,
  ExternalLinkIcon,
  FilmIcon,
  GlobeIcon,
  HistoryIcon,
  ImageIcon,
  KeyIcon,
  MicIcon,
  SparklesIcon,
  SpinnerIcon,
  TrashIcon,
  UploadIcon,
} from '@/lib/ui';

interface McpToolCard {
  id: string;
  descKey: TranslationKey;
  Icon: ComponentType;
}

const MCP_TOOL_CARDS: McpToolCard[] = [
  { id: 'list_personas', descKey: 'apiKeys.toolDescListPersonas', Icon: AccountsIcon },
  { id: 'list_voices', descKey: 'apiKeys.toolDescListVoices', Icon: MicIcon },
  { id: 'list_cloned_voices', descKey: 'apiKeys.toolDescListClonedVoices', Icon: MicIcon },
  { id: 'create_cloned_voice', descKey: 'apiKeys.toolDescCreateClonedVoice', Icon: UploadIcon },
  { id: 'get_cloned_voice', descKey: 'apiKeys.toolDescGetClonedVoice', Icon: MicIcon },
  { id: 'delete_cloned_voice', descKey: 'apiKeys.toolDescDeleteClonedVoice', Icon: TrashIcon },
  { id: 'preview_cloned_voice', descKey: 'apiKeys.toolDescPreviewClonedVoice', Icon: MicIcon },
  { id: 'preview_house_voice', descKey: 'apiKeys.toolDescPreviewHouseVoice', Icon: MicIcon },
  { id: 'list_faces', descKey: 'apiKeys.toolDescListFaces', Icon: ImageIcon },
  { id: 'create_persona', descKey: 'apiKeys.toolDescCreatePersona', Icon: SparklesIcon },
  { id: 'update_persona', descKey: 'apiKeys.toolDescUpdatePersona', Icon: ComposeIcon },
  { id: 'list_persona_images', descKey: 'apiKeys.toolDescListPersonaImages', Icon: ImageIcon },
  { id: 'add_persona_image', descKey: 'apiKeys.toolDescAddPersonaImage', Icon: UploadIcon },
  { id: 'update_persona_image', descKey: 'apiKeys.toolDescUpdatePersonaImage', Icon: ComposeIcon },
  { id: 'remove_persona_image', descKey: 'apiKeys.toolDescRemovePersonaImage', Icon: TrashIcon },
  { id: 'publish_video_direct', descKey: 'apiKeys.toolDescPublishVideoDirect', Icon: UploadIcon },
  { id: 'get_token_balance', descKey: 'apiKeys.toolDescGetTokenBalance', Icon: CoinsIcon },
  { id: 'generate_persona_video', descKey: 'apiKeys.toolDescGeneratePersonaVideo', Icon: FilmIcon },
  { id: 'validate_script', descKey: 'apiKeys.toolDescValidateScript', Icon: CheckIcon },
  { id: 'score_draft', descKey: 'apiKeys.toolDescScoreDraft', Icon: CheckIcon },
  { id: 'upload_media', descKey: 'apiKeys.toolDescUploadMedia', Icon: UploadIcon },
  { id: 'check_media', descKey: 'apiKeys.toolDescCheckMedia', Icon: CheckIcon },
  { id: 'list_prompts', descKey: 'apiKeys.toolDescListPrompts', Icon: GlobeIcon },
  { id: 'get_prompt', descKey: 'apiKeys.toolDescGetPrompt', Icon: ComposeIcon },
  { id: 'get_video_status', descKey: 'apiKeys.toolDescGetVideoStatus', Icon: CheckIcon },
  { id: 'get_video_task_progress', descKey: 'apiKeys.toolDescGetVideoTaskProgress', Icon: SpinnerIcon },
  { id: 'list_social_accounts', descKey: 'apiKeys.toolDescListSocialAccounts', Icon: GlobeIcon },
  { id: 'get_persona_publishing_accounts', descKey: 'apiKeys.toolDescGetPersonaPublishingAccounts', Icon: GlobeIcon },
  { id: 'set_persona_publishing_accounts', descKey: 'apiKeys.toolDescSetPersonaPublishingAccounts', Icon: ComposeIcon },
  { id: 'connect_account', descKey: 'apiKeys.toolDescConnectAccount', Icon: KeyIcon },
  { id: 'list_schedules', descKey: 'apiKeys.toolDescListSchedules', Icon: HistoryIcon },
  { id: 'list_posts', descKey: 'apiKeys.toolDescListPosts', Icon: CalendarIcon },
  { id: 'cancel_schedule', descKey: 'apiKeys.toolDescCancelSchedule', Icon: TrashIcon },
  { id: 'get_slot', descKey: 'apiKeys.toolDescGetSlot', Icon: ExternalLinkIcon },
  { id: 'update_slot_title', descKey: 'apiKeys.toolDescUpdateSlotTitle', Icon: ComposeIcon },
  { id: 'delete_slot', descKey: 'apiKeys.toolDescDeleteSlot', Icon: TrashIcon },
  { id: 'list_video_generations', descKey: 'apiKeys.toolDescListVideoGenerations', Icon: HistoryIcon },
  { id: 'get_video_generation', descKey: 'apiKeys.toolDescGetVideoGeneration', Icon: FilmIcon },
  { id: 'get_post', descKey: 'apiKeys.toolDescGetPost', Icon: ExternalLinkIcon },
  { id: 'get_post_metrics', descKey: 'apiKeys.toolDescGetPostMetrics', Icon: HistoryIcon },
  { id: 'get_youtube_retention_curve', descKey: 'apiKeys.toolDescGetYouTubeRetentionCurve', Icon: HistoryIcon },
  { id: 'create_experiment', descKey: 'apiKeys.toolDescCreateExperiment', Icon: SparklesIcon },
  { id: 'list_experiments', descKey: 'apiKeys.toolDescListExperiments', Icon: HistoryIcon },
  { id: 'add_experiment_pair', descKey: 'apiKeys.toolDescAddExperimentPair', Icon: FilmIcon },
  { id: 'get_experiment_results', descKey: 'apiKeys.toolDescGetExperimentResults', Icon: CheckIcon },
  { id: 'cancel_video_task', descKey: 'apiKeys.toolDescCancelVideoTask', Icon: TrashIcon },
  { id: 'list_token_transactions', descKey: 'apiKeys.toolDescListTokenTransactions', Icon: CoinsIcon },
  { id: 'get_persona_delete_preview', descKey: 'apiKeys.toolDescGetPersonaDeletePreview', Icon: AlertIcon },
  { id: 'delete_persona', descKey: 'apiKeys.toolDescDeletePersona', Icon: TrashIcon },
  { id: 'disconnect_account', descKey: 'apiKeys.toolDescDisconnectAccount', Icon: KeyIcon },
];

//---------------
// McpDocsSection — step 2 of the prompts hub: the MCP install prompt the
// user pastes into their agent (with the key they just created filled in,
// or the placeholder when there is none), the tools grid (collapsed by
// default so the prompt stays the focus), and the security note. The hub numbers the steps, so this section has no
// heading of its own. The prompt text lives in lib/mcp-install-prompt.ts.
//---------------

export default function McpDocsSection({ apiKey }: { apiKey: string | null }): ReactNode {
  const { t, locale } = useI18n();
  const { copied, copy } = useCopyText();
  const prompt = buildInstallPrompt(locale, apiKey);
  const helpHref = whatsappUrl(t('apiKeys.docsHelpMessage'));

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe5ec] bg-white shadow-[0_1px_2px_rgba(16,23,40,0.02)]">
      <div className="p-4 lg:p-6">
        <div className="overflow-hidden rounded-xl bg-[#101728] shadow-[0_8px_24px_rgba(16,23,40,0.25)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-300">{t('apiKeys.installPromptTitle')}</span>
            <Button
              type="button"
              data-testid="copy-mcp-prompt-btn"
              onClick={() => copy(prompt)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              {copied ? t('apiKeys.docsCopied') : t('apiKeys.copy')}
            </Button>
          </div>
          <pre
            data-testid="mcp-install-prompt"
            className="max-h-80 overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-slate-300 select-text"
          >
            {prompt}
          </pre>
        </div>

        <details data-testid="mcp-tools" className="group mt-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-[#ff544c] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#edf0f4] bg-white text-[#101728] [&>svg]:size-5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                </svg>
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[#101728]">{t('apiKeys.toolsTitle')}</h3>
                <p className="text-sm text-[#718096]">{t('apiKeys.toolsSubtitle')}</p>
              </div>
            </div>
            <span aria-hidden="true" className="shrink-0 text-[#718096] transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="mcp-tools-grid">
            {MCP_TOOL_CARDS.map((tool) => (
              <div
                key={tool.id}
                className="flex items-start gap-2.5 rounded-xl border border-[#e8edf3] bg-slate-50/60 px-3 py-2.5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#4a5a75] shadow-[0_1px_2px_rgba(16,23,40,0.08)] [&>svg]:size-4">
                  <tool.Icon />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-bold text-[#101728]">{tool.id}</p>
                  <p className="mt-0.5 truncate text-xs text-[#718096]">{t(tool.descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </details>

        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          {t('apiKeys.docsSecurityNote')}
        </p>

        {helpHref !== null ? (
          <a
            href={helpHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="mcp-docs-help-cta"
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#dfe5ec] bg-white px-4 py-2.5 text-sm font-semibold text-[#101728] transition-colors hover:bg-slate-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
            </svg>
            {t('apiKeys.needHelp')}
          </a>
        ) : null}
      </div>
    </section>
  );
}
