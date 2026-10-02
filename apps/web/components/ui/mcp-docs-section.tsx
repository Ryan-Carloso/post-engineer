'use client';

import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import { whatsappUrl } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';
import {
  AccountsIcon,
  CalendarIcon,
  CheckIcon,
  CoinsIcon,
  ComposeIcon,
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
  { id: 'list_faces', descKey: 'apiKeys.toolDescListFaces', Icon: ImageIcon },
  { id: 'create_persona', descKey: 'apiKeys.toolDescCreatePersona', Icon: SparklesIcon },
  { id: 'update_persona', descKey: 'apiKeys.toolDescUpdatePersona', Icon: ComposeIcon },
  { id: 'list_persona_images', descKey: 'apiKeys.toolDescListPersonaImages', Icon: ImageIcon },
  { id: 'add_persona_image', descKey: 'apiKeys.toolDescAddPersonaImage', Icon: UploadIcon },
  { id: 'update_persona_image', descKey: 'apiKeys.toolDescUpdatePersonaImage', Icon: ComposeIcon },
  { id: 'remove_persona_image', descKey: 'apiKeys.toolDescRemovePersonaImage', Icon: TrashIcon },
  { id: 'get_token_balance', descKey: 'apiKeys.toolDescGetTokenBalance', Icon: CoinsIcon },
  { id: 'generate_persona_videos', descKey: 'apiKeys.toolDescGeneratePersonaVideos', Icon: FilmIcon },
  { id: 'get_video_status', descKey: 'apiKeys.toolDescGetVideoStatus', Icon: CheckIcon },
  { id: 'get_video_task_progress', descKey: 'apiKeys.toolDescGetVideoTaskProgress', Icon: SpinnerIcon },
  { id: 'list_social_accounts', descKey: 'apiKeys.toolDescListSocialAccounts', Icon: GlobeIcon },
  { id: 'connect_account', descKey: 'apiKeys.toolDescConnectAccount', Icon: KeyIcon },
  { id: 'list_schedules', descKey: 'apiKeys.toolDescListSchedules', Icon: HistoryIcon },
  { id: 'list_posts', descKey: 'apiKeys.toolDescListPosts', Icon: CalendarIcon },
  { id: 'cancel_schedule', descKey: 'apiKeys.toolDescCancelSchedule', Icon: TrashIcon },
];

export default function McpDocsSection(): ReactNode {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);

  const buildInstallPrompt = (): string => {
    if (locale === 'en') {
      return [
        'Add the Post Engineer MCP server to my AI agent configuration.',
        '',
        'I already generated my API key on https://post-engineer.com/api-keys.',
        '',
        'Installation:',
        '1. Configure the MCP server (opencode.json, claude_desktop_config.json, .mcp.json, or Cursor settings) with:',
        '   {',
        '     "mcpServers": {',
        '       "post-engineer": {',
        '         "type": "local",',
        '         "command": ["npx", "-y", "post-engineer-mcp"],',
        '         "environment": {',
        '           "POST_ENGINEER_API_KEY": "<MY_API_KEY>"',
        '         }',
        '       }',
        '     }',
        '   }',
        '2. Replace <MY_API_KEY> with my real API key. No repository clone or local build is required.',
        '',
        'Available tools after connecting:',
        '- list_personas: list my existing personas (id, name, voice, language, niche).',
        '- list_voices: list available persona voices (live catalog, never hardcoded).',
        '- list_faces: list stock avatar faces (id, url, name, gender, age, ethnicity, hair, description in English); pass a face url as avatarUrl when calling create_persona.',
        '- create_persona: create an AI persona (name, avatarUrl, voiceId, language, videoAspect 9:16|16:9, scriptPrompt, paragraphNumber 1-5, niche).',
        '- update_persona: update an existing persona (only provided fields change).',
        '- list_persona_images: list a persona\'s image library (id, tag, description, is_primary); pass an id as imageId to generate_persona_videos to force a specific image for one video.',
        '- add_persona_image: add an image to a persona\'s library from a local file path (JPG/JPEG, PNG, or WebP, max 9MB). Optional tag and description drive the deterministic per-video image selection.',
        '- update_persona_image: update a library image\'s tag, description, or primary flag.',
        '- remove_persona_image: remove an image from a persona\'s library.',
        '- get_token_balance: get my prepaid token wallet balance.',
        '- generate_persona_videos: generate AND schedule 1-10 persona videos in ONE operation (personaId required, even for faceless via options.faceless; topics is one topic per video; providers plus per-provider account IDs from list_social_accounts; startAt ISO datetime, times ["HH:MM"], timezone; slots must be 3h-30d ahead; optional overrides: scriptPrompt/scriptPrompts, audioUrl overriding the persona voice, imageId from list_persona_images, webhookUrl). Each video is generated then auto-published at its slot; there is no separate schedule step. Poll each slot\'s taskId with get_video_task_progress. Costs tokens per video.',
        '- get_video_status: check generation status with a taskId and get the final video URL.',
        '- get_video_task_progress: poll one video task for machine-readable progress ({task_id, state, progress, stage, error}); error is the failure reason when state is -1, null otherwise; use per video (1/6, 2/6, ...) after generate_persona_videos.',
        '- list_social_accounts: list my connected social accounts with the account IDs needed for scheduling.',
        '- connect_account: connect a social account (youtube/instagram/linkedin return an authorization URL for me to open in a browser; bluesky connects directly with handle + app password).',
        '- list_schedules: list my automation schedules.',
        // list_posts limit contract mirrors the MCP server (verified): the
        // ListPostsSchema (mcp src/tools.ts) defaults limit to 20 (max 500),
        // and the MCP client (mcp src/client.ts listPosts) always sends an
        // explicit ?limit=, so the endpoint's own default (10) never applies
        // to MCP calls. The MCP client test pins listPosts() -> ?limit=20.
        // Keep in lockstep.
        '- list_posts: list my upcoming (scheduled) and past posts across all connected accounts (optional limit, default 20, max 500).',
        '- cancel_schedule: cancel a schedule by its ID.',
        '',
        'How to work with me (agent instructions):',
        '1. Start by calling list_personas and showing me what I already have (name, language, niche). If I have none, say so.',
        '2. Ask me what I want before doing anything that costs tokens. Check get_token_balance first and warn me if the balance is low. Use an existing persona or create a new one? If new, call list_voices and show me the real voice options, then ask for: language (e.g. pt-BR, en-US), niche/topic, avatar (photo URL, a stock face from list_faces, or faceless), voice choice, video format 9:16 or 16:9, and the script style/prompt.',
        '3. Confirm the persona details with me before calling create_persona. To fix a persona later, use update_persona (never create a duplicate). Never invent a personaId: always use the id returned by list_personas or create_persona.',
        '4. For videos, confirm the script/prompt with me first, then call generate_persona_videos (one topic per video) and poll each slot\'s taskId with get_video_task_progress until it finishes. Share the final video URL with me.',
        '5. For publishing, call list_social_accounts first to discover my connected accounts and their IDs. Then ask for the platforms, start date, publish times, and timezone. Only schedule between 3h and 30 days in advance. Show my schedules with list_schedules on request, and use cancel_schedule to remove one.',
        '6. When I ask about my posts (what is coming next, what already went out), call list_posts and summarize the upcoming and past posts, including any failure errors.',
      ].join('\n');
    }

    return [
      'Adicione o servidor MCP do Post Engineer na configuração do meu agente de IA.',
      '',
      'Eu já gerei minha API key em https://post-engineer.com/api-keys.',
      '',
      'Instalação:',
      '1. Configure o servidor MCP (opencode.json, claude_desktop_config.json, .mcp.json ou Cursor) com:',
      '   {',
      '     "mcpServers": {',
      '       "post-engineer": {',
      '         "type": "local",',
      '         "command": ["npx", "-y", "post-engineer-mcp"],',
      '         "environment": {',
      '           "POST_ENGINEER_API_KEY": "<MINHA_API_KEY>"',
      '         }',
      '       }',
      '     }',
      '   }',
      '2. Substitua <MINHA_API_KEY> pela minha API key real. Não é necessário clonar o repositório nem fazer build local.',
      '',
      'Tools disponíveis após conectar:',
      '- list_personas: listar minhas personas existentes (id, nome, voz, idioma, nicho).',
      '- list_voices: listar as vozes disponíveis (catálogo vivo, nunca hardcoded).',
      '- list_faces: listar rostos de avatar padrão (id, url, nome, gênero, idade, etnia, cabelo, descrição em inglês); use a url como avatarUrl ao chamar create_persona.',
      '- create_persona: criar uma persona de IA (name, avatarUrl, voiceId, language, videoAspect 9:16|16:9, scriptPrompt, paragraphNumber 1-5, niche).',
      '- update_persona: atualizar uma persona existente (só os campos enviados mudam).',
      '- list_persona_images: listar a biblioteca de imagens de uma persona (id, tag, description, is_primary); passe um id como imageId no generate_persona_videos para forçar uma imagem específica em um vídeo.',
      '- add_persona_image: adicionar uma imagem à biblioteca de uma persona a partir de um arquivo local (JPG/JPEG, PNG ou WebP, máx 9MB). Tag e descrição opcionais guiam a seleção determinística de imagem por vídeo.',
      '- update_persona_image: atualizar a tag, a descrição ou o flag de principal de uma imagem da biblioteca.',
      '- remove_persona_image: remover uma imagem da biblioteca de uma persona.',
      '- get_token_balance: ver o saldo da minha carteira de tokens.',
      '- generate_persona_videos: gerar E agendar de 1 a 10 vídeos de uma persona em UMA operação (personaId obrigatório, mesmo para faceless via options.faceless; topics é um tópico por vídeo; providers mais account IDs por provider do list_social_accounts; startAt datetime ISO, times ["HH:MM"], timezone; slots devem estar de 3h a 30 dias à frente). Cada vídeo é gerado e publicado automaticamente no seu slot; não há etapa separada de agendamento. Acompanhe o taskId de cada slot com get_video_task_progress. Custa tokens por vídeo.',
      '- get_video_status: conferir o status da geração com o taskId e pegar a URL do vídeo final.',
      '- get_video_task_progress: acompanhar o progresso legível por máquina de uma tarefa de vídeo ({task_id, state, progress, stage, error}); error é o motivo da falha quando state é -1, null caso contrário; use por vídeo (1/6, 2/6, ...) após generate_persona_videos.',
      '- list_social_accounts: listar minhas contas sociais conectadas com os IDs necessários para agendar.',
      '- connect_account: conectar uma conta social (youtube/instagram/linkedin retornam uma URL de autorização para eu abrir no navegador; bluesky conecta direto com handle + app password).',
      '- list_schedules: listar meus agendamentos.',
      // list_posts limit contract mirrors the MCP server (verified): the
      // ListPostsSchema (mcp src/tools.ts) defaults limit to 20 (max 500),
      // and the MCP client (mcp src/client.ts listPosts) always sends an
      // explicit ?limit=, so the endpoint's own default (10) never applies
      // to MCP calls. The MCP client test pins listPosts() -> ?limit=20.
      // Keep in lockstep.
      '- list_posts: listar meus posts futuros (agendados) e passados em todas as contas conectadas (limit opcional, padrão 20, máx 500).',
      '- cancel_schedule: cancelar um agendamento pelo ID.',
      '',
      'Como trabalhar comigo (instruções para o agente):',
      '1. Comece chamando list_personas e me mostrando o que eu já tenho (nome, idioma, nicho). Se eu não tiver nenhuma, diga isso.',
      '2. Pergunte o que eu quero antes de qualquer ação que custe tokens. Consulte get_token_balance primeiro e me avise se o saldo estiver baixo. Usar uma persona existente ou criar uma nova? Se for nova, chame list_voices e me mostre as opções reais de voz, depois pergunte: idioma (ex. pt-BR, en-US), nicho/tema, avatar (foto por URL, um rosto padrão do list_faces ou faceless), escolha de voz, formato 9:16 ou 16:9 e o estilo/prompt do roteiro.',
      '3. Confirme os detalhes da persona comigo antes de chamar create_persona. Para corrigir uma persona depois, use update_persona (nunca crie uma duplicada). Nunca invente um personaId: use sempre o id retornado por list_personas ou create_persona.',
      '4. Para vídeos, confirme o roteiro/prompt comigo primeiro, depois chame generate_persona_videos (um tópico por vídeo) e acompanhe o taskId de cada slot com get_video_task_progress até concluir. Compartilhe a URL final do vídeo comigo.',
      '5. Para publicar, chame list_social_accounts primeiro para descobrir minhas contas conectadas e seus IDs. Depois pergunte as plataformas, data de início, horários de publicação e timezone. Agende somente de 3h a 30 dias de antecedência. Mostre meus agendamentos com list_schedules quando eu pedir, e use cancel_schedule para remover um.',
      '6. Quando eu perguntar sobre meus posts (o que vem aí, o que já saiu), chame list_posts e resuma os próximos e os passados, incluindo os erros de falha.',
    ].join('\n');
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(buildInstallPrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const steps = [
    { title: t('apiKeys.connectStep1Title'), desc: t('apiKeys.connectStep1Desc') },
    { title: t('apiKeys.connectStep2Title'), desc: t('apiKeys.connectStep2Desc') },
    { title: t('apiKeys.connectStep3Title'), desc: t('apiKeys.connectStep3Desc') },
  ];
  const helpHref = whatsappUrl(t('apiKeys.docsHelpMessage'));

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe5ec] bg-white shadow-[0_1px_2px_rgba(16,23,40,0.02)]">
      <div className="p-4 lg:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[#edf0f4] bg-white text-[#101728] shadow-[0_4px_12px_rgba(16,23,40,0.06)] [&>svg]:size-6">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-6" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5 14.25 2.25 12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-[#101728]">{t('apiKeys.connectTitle')}</h2>
              <p className="mt-1 text-sm leading-6 text-[#718096]">{t('apiKeys.connectSubtitle')}</p>
            </div>
          </div>
          {helpHref && (
            <a
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="mcp-docs-help-cta"
              className="flex shrink-0 items-center gap-2 self-start rounded-xl border border-[#dfe5ec] bg-white px-4 py-2.5 text-sm font-semibold text-[#101728] transition-colors hover:bg-slate-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
              </svg>
              {t('apiKeys.needHelp')}
            </a>
          )}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
          <ol className="flex flex-col">
            {steps.map((step, index) => (
              <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
                {index < steps.length - 1 ? (
                  <span aria-hidden="true" className="absolute top-9 left-[17px] h-[calc(100%-2.25rem)] w-px bg-[#e3e8ef]" />
                ) : null}
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    index === 0 ? 'bg-[#101728] text-white' : 'bg-[#edf0f4] text-[#60758a]'
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm font-bold text-[#101728]">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[#718096]">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="overflow-hidden rounded-xl bg-[#101728] shadow-[0_8px_24px_rgba(16,23,40,0.25)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-300">{t('apiKeys.installPromptTitle')}</span>
              <Button
                type="button"
                data-testid="copy-mcp-prompt-btn"
                onClick={handleCopy}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
              >
                {copied ? t('apiKeys.docsCopied') : t('apiKeys.copy')}
              </Button>
            </div>
            <pre
              data-testid="mcp-install-prompt"
              className="max-h-80 overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-slate-300 select-text"
            >
              {buildInstallPrompt()}
            </pre>
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
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
        </div>

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

        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          {t('apiKeys.docsSecurityNote')}
        </p>
      </div>
    </section>
  );
}
