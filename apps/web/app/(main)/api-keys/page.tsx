'use client';

import { SiClaudecode, SiOpencode } from 'react-icons/si';
import { PiOpenAiLogo } from "react-icons/pi";
import ApiKeysSection from '@/components/ui/api-keys-section';
import McpDocsSection from '@/components/ui/mcp-docs-section';
import { useI18n } from '@/lib/i18n/provider';

export default function ApiKeysPage(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <ApiKeysHeader />
      <main className="flex flex-col gap-5 lg:gap-6">
        <ApiKeysHero />
        <ApiKeysSection />
        <McpDocsSection />
      </main>
    </div>
  );
}

//---------------
// Cabeçalho da tela de API Keys.
//---------------

function ApiKeysHeader(): React.ReactElement {
  return (
    <header className="flex items-center justify-between gap-4 py-1 lg:py-2">
      <div className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#17191c] text-white shadow-[0_8px_18px_rgba(16,23,40,0.14)] [&>svg]:size-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-6" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-[#101728]">API Keys</h1>
          <p className="mt-0.5 text-sm text-[#718096] lg:text-base">MCP, agentes de IA e integrações.</p>
        </div>
      </div>
    </header>
  );
}

//---------------
// Banner de integração com agentes de IA.
//---------------

function ApiKeysHero(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5 overflow-hidden rounded-2xl border border-[#f3dfe6] bg-linear-to-r from-[#fdf1f4] via-[#fbeef7] to-[#efe9fb] p-5 lg:flex-row lg:items-center lg:gap-8 lg:p-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-[0_4px_12px_rgba(16,23,40,0.08)] [&>svg]:size-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="#101728" strokeWidth="1.7" className="size-6" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-[#101728] lg:text-lg">{t('apiKeys.heroTitle')}</h2>
          <p className="mt-1 text-sm leading-6 text-[#60758a]">{t('apiKeys.heroSubtitle')}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5" aria-hidden="true">
        {/* Claude */}
        <span className="flex size-16 items-center justify-center rounded-xl border border-[#e7e2dc] bg-[#f7f5f2] text-[#D97757] shadow-[0_4px_12px_rgba(16,23,40,0.08)]">
          <SiClaudecode className="size-10" />
        </span>
        {/* OpenAI */}
        <span className="flex size-16 items-center justify-center rounded-xl border border-[#e7e2dc] bg-[#f7f5f2] text-[#D97757] shadow-[0_4px_12px_rgba(16,23,40,0.08)]">
          <PiOpenAiLogo className="size-10" />
        </span>

        {/* OpenCode */}
        <span className="flex size-16 items-center justify-center rounded-xl border border-[#dfe5ec] bg-white text-[#101728] shadow-[0_4px_12px_rgba(16,23,40,0.08)]">
          <SiOpencode className="size-10" />
        </span>
      </div>
      <div className="shrink-0 lg:text-right">
        <p className="text-sm font-bold text-[#101728]">{t('apiKeys.heroTagline')}</p>
        <p className="mt-0.5 text-sm text-[#60758a]">{t('apiKeys.heroTaglineSub')}</p>
      </div>
    </div>
  );
}
