# Post Engineer

[![CI](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/post-engineer-mcp.svg)](https://www.npmjs.com/package/post-engineer-mcp)

[🇬🇧 Read in English](README.md)

Crie personas de vídeo com IA que geram e publicam vídeos curtos no piloto automático.

Dê a uma persona um nicho e uma voz; o Post Engineer escreve o roteiro, gera a
narração, monta o vídeo e publica nas suas redes sociais conforme o cronograma.
Gerencie tudo pelo painel web, controle programaticamente via API, ou deixe
seu agente de IA operar pelo servidor MCP — tudo neste único monorepo.

> Prefere a versão hospedada? A mesma plataforma roda em
> [post-engineer.com](https://post-engineer.com) — você pode pular a
> instalação local e conectar o servidor MCP direto na sua conta (veja
> [Servidor MCP](#servidor-mcp)).

## O que ele faz

- **Personas de IA** — personagens persistentes com voz, rosto, idioma e nicho.
  Clipes de introdução com sincronização labial opcionais para um apresentador
  humanizado, além de uma biblioteca de imagens da persona para manter o rosto
  consistente entre os vídeos.
- **Geração automática de vídeos** — entra um tema, sai um vídeo curto em HD:
  roteiro (LLM), narração (TTS), legendas, vídeos de banco de imagens e música
  de fundo, montados em um vídeo finalizado.
- **Agendamento e publicação** — agende posts para YouTube, Instagram, LinkedIn
  e Bluesky; acompanhe posts futuros e passados com status por conta.
- **Painel web** — personas, histórico de posts, contas sociais conectadas,
  chaves de API e cobrança por tokens em um único app Next.js.
- **Controle por agentes** — um servidor MCP ([`apps/mcp/`](apps/mcp/)) expõe
  as mesmas funcionalidades para agentes de IA (Claude, Cursor, Codex,
  OpenCode): criar personas, gerar vídeos, checar status e agendar posts.

## Estrutura do repositório

Este é um monorepo pnpm/Nx — web, engine e MCP vivem juntos:

```text
apps/web/       Painel Next.js 15 + rotas de API (TypeScript)
apps/engine/    Motor de geração de vídeo em Python/FastAPI
apps/mcp/       Servidor MCP para agentes de IA (pacote npm: post-engineer-mcp)
```

O app web cuida de autenticação, personas, agendamento, OAuth, cobrança e da
API. Ele chama o motor via HTTP (autenticado com um segredo compartilhado,
`MONEYPRINT_API_SECRET`) para geração de vídeo, TTS e publicação. O servidor
MCP fala com a API web usando uma chave de API do usuário. O Postgres (via
Supabase) é o sistema de registro: personas, agendamentos, tokens OAuth
(criptografados em repouso), chaves de API e saldos de tokens.

## Pré-requisitos

- **Node.js** 20+ e **pnpm** 10 (`npm install -g pnpm` ou via corepack)
- **Python** 3.11–3.12 e **uv** (`curl -LsSf astral.sh/uv/install.sh | sh`)
- **ffmpeg** no `PATH` (o motor o utiliza via moviepy)
- Um projeto **Supabase** (hospedado em [supabase.com](https://supabase.com) ou
  self-hosted) com um banco Postgres
- Chaves de API para os serviços externos que você pretende usar (veja a tabela
  abaixo)

## Configuração local do zero

### 1. Instale as dependências

```bash
git clone https://github.com/Ryan-Carloso/post-engineer.git
cd post-engineer
pnpm install
```

### 2. Configure o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (ou aponte para sua
   instância self-hosted).
2. No SQL editor do Supabase, aplique os scripts do banco. O script da
   biblioteca de imagens da persona está neste repositório:
   [`supabase/persona-images.sql`](supabase/persona-images.sql)
   (aplicação manual, por design).

   > **Precisa de ajuda?** Se você está configurando um projeto novo e precisa
   > do snapshot atual do schema, entre em contato:
   > **E-mail:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com) ·
   > **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

### 3. Crie os três arquivos de env (nunca faça commit deles)

Por design existem exatamente três arquivos de env — copie cada um a partir do
seu exemplo e preencha com seus próprios valores:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/engine/.env.example apps/engine/.env
cp apps/engine/config.example.toml apps/engine/config.toml
```

| Arquivo | Finalidade | Variáveis principais |
|---|---|---|
| `apps/web/.env` | App web + rotas de API | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (somente servidor), `TOKEN_ENCRYPTION_KEY` (gere com: `openssl rand -base64 32`), `MONEYPRINT_API_SECRET`, `MONEYPRINT_API_URL`, client ids/secrets de OAuth + redirect URIs, chaves do Stripe, `MCP_OAUTH_PRIVATE_KEY_PEM` |
| `apps/engine/.env` | Runtime do motor | `MONEYPRINT_API_SECRET` (deve ser **idêntico** ao valor do web), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (para o agendador de preenchimento in-process), opcionais `DISCORD_WEBHOOK_URL`, `POSTHOG_API_KEY` (rastreamento de erros + funil de analytics) |
| `apps/engine/config.toml` | Configuração de comportamento do motor | Chaves de provedores de LLM/TTS/vídeos de banco (OpenAI-compatible, Pexels, Pixabay, …), `listen_port` (padrão `8080`) |

O app falha rapidamente em caso de variáveis ausentes (sem fallbacks silenciosos)
— veja `apps/web/.env.example` para a lista completa documentada.

### 4. Registre os apps de OAuth (para publicação social)

Para conectar contas do YouTube, Instagram ou LinkedIn você precisa de apps de
OAuth cujos **redirect URIs correspondam exatamente** aos valores em
`apps/web/.env`:

- **Google / YouTube** — [Google Cloud Console](https://console.cloud.google.com):
  crie um Client ID OAuth 2.0, adicione os redirect URIs autorizados de
  `GOOGLE_REDIRECT_URI` / `GOOGLE_REDIRECT_URI_LOCAL` e preencha
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **Instagram** — [Meta for Developers](https://developers.facebook.com): um app
  Business com o produto Instagram (permissões `instagram_business_basic` e
  `instagram_business_content_publish`); defina `INSTAGRAM_CLIENT_ID` /
  `INSTAGRAM_CLIENT_SECRET` e registre `INSTAGRAM_REDIRECT_URI`.
- **LinkedIn** — [LinkedIn Developers](https://developer.linkedin.com): crie um
  app, registre `LINKEDIN_REDIRECT_URI` e defina `LINKEDIN_CLIENT_ID` /
  `LINKEDIN_CLIENT_SECRET`.
- **Bluesky** usa uma app password inserida no painel (criptografada em repouso)
  — não é necessário registrar app de OAuth.

### 5. Configuração do Stripe (cobrança por tokens)

1. Crie uma conta [Stripe](https://stripe.com) e obtenha as chaves secreta +
   pública (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
2. Crie os produtos de pacotes de tokens e coloque os price IDs em
   `STRIPE_PRICE_PACK_10` / `_50` / `_100`.
3. Adicione um endpoint de webhook apontando para `/api/billing/webhook` e
   guarde o signing secret em `STRIPE_WEBHOOK_SECRET`. O handler do webhook
   verifica a assinatura e é idempotente.

### 6. Gere os segredos autogerenciados

Esses você mesmo cria — nada a registrar:

```bash
# Segredo compartilhado web <-> motor (idêntico nos dois arquivos .env)
openssl rand -hex 32

# Chave de criptografia dos tokens OAuth (AES-256-GCM)
openssl rand -base64 32

# Chave de assinatura OAuth do MCP (PEM, com \n escapado em MCP_OAUTH_PRIVATE_KEY_PEM)
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
```

## Executando

```bash
pnpm dev:web      # painel em http://localhost:3434
pnpm dev:engine   # API do motor de vídeo em http://127.0.0.1:8080 (veja /docs lá)
```

Comandos úteis (todos verificados em `package.json` / `project.json`):

```bash
pnpm test        # todos os testes (web + engine + MCP, via Nx)
pnpm lint        # ESLint (web + MCP) + ruff (engine)
pnpm typecheck   # tsc --noEmit (web + MCP) + checagens do engine
pnpm build       # build de produção do app web
pnpm graph       # grafo de projetos do Nx
```

Detalhes por app: [apps/web/README.md](apps/web/README.md),
[apps/engine/README.md](apps/engine/README.md),
[apps/mcp/README.md](apps/mcp/README.md).

## Servidor MCP

O servidor MCP ([`apps/mcp/`](apps/mcp/), pacote npm
[`post-engineer-mcp`](https://www.npmjs.com/package/post-engineer-mcp)) permite
que agentes de IA criem personas, gerem vídeos, chequem o status da geração e
agendem posts na sua conta. Você não precisa clonar este repositório para
usá-lo com a plataforma hospedada:

```json
{
  "mcpServers": {
    "post-engineer": {
      "type": "local",
      "command": ["npx", "-y", "post-engineer-mcp@latest"],
      "environment": {
        "POST_ENGINEER_API_KEY": "<MY_API_KEY>"
      }
    }
  }
}
```

Gere `<MY_API_KEY>` em
[post-engineer.com/api-keys](https://post-engineer.com/api-keys). A tag
`@latest` é importante: o `npx` reutiliza a cópia em cache sem verificar
atualizações. Para apontar
o servidor para sua própria instância self-hosted, defina
`POST_ENGINEER_API_URL` (veja [apps/mcp/README.md](apps/mcp/README.md) para a
lista completa de tools, dicas de timeout no OpenCode e desenvolvimento local).

## Serviços externos que você precisa provisionar

| Serviço | Obrigatório? | Para quê | Onde obter |
|---|---|---|---|
| Supabase | **Sim** | Postgres, auth, storage | [supabase.com](https://supabase.com) ou self-hosted |
| App OAuth Google | Para publicar no YouTube | OAuth client id/secret | Google Cloud Console |
| App Instagram (Meta) | Para publicar no Instagram | OAuth client id/secret | developers.facebook.com |
| App LinkedIn | Para publicar no LinkedIn | OAuth client id/secret | developer.linkedin.com |
| Stripe | Para cobrança por tokens | Chaves secretas/públicas, price IDs, webhook secret | stripe.com |
| Chave de provedor LLM **ou** Ollama | Para geração de roteiros | Chave OpenAI-compatible, ou rode Ollama localmente | Seu provedor / ollama.com |
| Pexels / Pixabay / Coverr / TwelveLabs | Para vídeos de banco de imagens | Chaves de API | Portais de desenvolvedor respectivos |
| `MONEYPRINT_API_SECRET` | **Sim** | Autenticação web ↔ motor | Gere você mesmo (`openssl rand -hex 32`) |
| `TOKEN_ENCRYPTION_KEY` | **Sim** | Criptografa tokens OAuth em repouso | Gere você mesmo (`openssl rand -base64 32`) |
| `MCP_OAUTH_PRIVATE_KEY_PEM` | Para OAuth do servidor MCP | Assina tokens MCP | Gere você mesmo (chave EC, veja acima) |
| Chave de projeto PostHog (`NEXT_PUBLIC_POSTHOG_KEY`) | Opcional | Rastreamento de erros + analytics de produto | Configurações do projeto PostHog |
| Webhook do Discord | Opcional | Notificações de preenchimento de agenda | Configurações do canal do Discord |
| `ZAI_API_KEY` | Somente CI | Workflow de code-review com IA | Não é dependência de runtime |

## Suporte e contato

Dúvidas, entre em contato:

- **E-mail:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com)
- **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

## Licença

Licenciado sob a [Apache License, Version 2.0](LICENSE) — veja
[CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md).

## Créditos

Motor de vídeo derivado de
[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)
(MIT © 2024 Harry), estendido com lip-sync de personas, catálogo de música de
fundo, fila em lote, agendamento e publicação.
