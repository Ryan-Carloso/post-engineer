# Post Engineer

[![CI](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml/badge.svg)](https://github.com/Ryan-Carloso/post-engineer/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/post-engineer-mcp.svg)](https://www.npmjs.com/package/post-engineer-mcp)

[🇬🇧 Read in English](README.md)

Agende e publique automaticamente os vídeos e imagens que você faz, em todas as
redes de uma vez.

Faça a mídia com as suas próprias ferramentas, envie uma vez, e o Post
Engineer publica nas suas redes sociais agora ou no horário que você escolher,
tenta de novo uma conta que falhou e mede o desempenho de cada post. Personas
agrupam as contas de publicação de uma marca ou personagem. Gerencie tudo pelo
painel web, controle programaticamente via API, ou deixe seu agente de IA operar
pelo servidor MCP — tudo neste único monorepo. O Post Engineer não gera mídia.
Contas novas têm 7 dias de teste grátis.

> Prefere a versão hospedada? A mesma plataforma roda em
> [post-engineer.com](https://post-engineer.com) — você pode pular a
> instalação local e conectar o servidor MCP direto na sua conta (veja
> [Servidor MCP](#servidor-mcp)).

## O que ele faz

- **Personas** — agrupam as contas de publicação de uma marca ou personagem, com
  um cartão de identidade opcional que gera prompts de imagem para a sua
  ferramenta de imagem.
- **Agendamento e publicação** — agende posts para YouTube, Instagram, LinkedIn,
  Bluesky, Threads, Facebook, Pinterest, 3Speak, Rumble, Fanvue e Telegram
  (canais e grupos); acompanhe
  posts futuros e passados com status por conta.
- **Métricas e experimentos** — views e engajamento por post, retenção do
  YouTube e comparação de prompts por conta.
- **Painel web** — personas, calendário e histórico de posts, contas sociais
  conectadas, métricas e chaves de API em um único app Next.js.
- **Controle por agentes** — um servidor MCP ([`apps/mcp/`](apps/mcp/)) expõe
  as mesmas funcionalidades para agentes de IA (Claude, Cursor, Codex,
  OpenCode): enviar e publicar mídia, agendar posts, gerenciar personas e ler
  métricas.

## Estrutura do repositório

Este é um monorepo pnpm/Nx — o app web e o servidor MCP vivem juntos:

```text
apps/web/       Painel Next.js 15, rotas de API e agendador de publicação (TypeScript)
apps/mcp/       Servidor MCP para agentes de IA (pacote npm: post-engineer-mcp)
```

O app web cuida de autenticação, personas, agendamento, uploads, OAuth, do
teste grátis, da API e da publicação: um agendador no próprio processo pega
cada slot vencido no Postgres e publica pelo mesmo núcleo de upload que a API
usa. O servidor MCP fala com a API web usando uma chave de API do usuário. O
Postgres (via Supabase) é o sistema de registro: personas, agendamentos,
uploads, tokens OAuth (criptografados em repouso) e chaves de API.

## Pré-requisitos

- **Node.js** 20+ e **pnpm** 10 (`npm install -g pnpm` ou via corepack)
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
   [`supabase/migrations/002_persona-images.sql`](supabase/migrations/002_persona-images.sql)
   (aplicação manual, por design).

   > **Precisa de ajuda?** Se você está configurando um projeto novo e precisa
   > do snapshot atual do schema, entre em contato:
   > **E-mail:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com) ·
   > **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

### 3. Crie o arquivo de env (nunca faça commit dele)

Por design existe exatamente um arquivo de env — copie-o a partir do exemplo e
preencha com seus próprios valores:

```bash
cp apps/web/.env.example apps/web/.env
```

| Arquivo | Finalidade | Variáveis principais |
|---|---|---|
| `apps/web/.env` | App web, rotas de API e agendador | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (somente servidor), `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (Instagram/Threads/Facebook baixam o vídeo de uma URL assinada do R2), `TOKEN_ENCRYPTION_KEY` (gere com: `openssl rand -base64 32`), client ids/secrets de OAuth + redirect URIs, chaves do Stripe, `MCP_OAUTH_PRIVATE_KEY_PEM`, `DISCORD_WEBHOOK_URL` opcional, `RESEND_API_KEY` + `ACCOUNT_BREAK_FROM` opcionais, `POSTHOG_API_KEY` opcional |

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
- **Threads** — ([Threads API](https://developers.facebook.com/docs/threads)).
  O caso de uso "Access the Threads API" do app da Meta tem App ID e App Secret
  próprios (`THREADS_CLIENT_ID` / `THREADS_CLIENT_SECRET`), diferentes dos do
  Instagram. Adicione o produto Threads (permissões `threads_basic`,
  `threads_content_publish`, `threads_manage_insights` e
  `threads_manage_replies`) e registre
  `THREADS_REDIRECT_URI`.
- **Páginas do Facebook** — [Meta for Developers](https://developers.facebook.com):
  adicione o Facebook Login for Business com as permissões `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts` e
  `pages_manage_engagement`, defina
  `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` e registre
  `FACEBOOK_REDIRECT_URI`. Conectar uma vez adiciona todas as Páginas que o
  usuário gerencia.
- **Fanvue** — [Fanvue Developer Area](https://www.fanvue.com/dev): crie um app
  **API only** a partir de uma conta de creator, adicione os redirect URIs de
  `FANVUE_REDIRECT_URI` / `FANVUE_REDIRECT_URI_LOCAL` e marque os scopes
  `read:self`, `read:post`, `write:post`, `read:media` e `write:media` (os
  system scopes `openid`, `offline_access` e `offline` entram automaticamente).
  Defina `FANVUE_CLIENT_ID` / `FANVUE_CLIENT_SECRET`. Não existe API key: o
  creator autoriza o app via OAuth 2.0 + PKCE. Todo post é subscribers-only.
- **Bluesky** usa uma app password inserida no painel (criptografada em repouso)
  — não é necessário registrar app de OAuth.
- **3Speak** usa uma posting key Hive inserida no painel (criptografada em
  repouso) — não é necessário registrar app de OAuth. A posting key só
  autoriza posts; nunca cole a senha owner, active ou master.
- **Rumble** usa um token de acesso manual de 40 caracteres da Simple Upload API
  (pedido por email para bd@rumble.com), inserido no painel com o ID do canal
  — sem OAuth, sem registro de app, sem variáveis de ambiente.
- **Telegram** publica pelo bot do próprio usuário: crie-o no @BotFather,
  adicione-o a um canal (como administrador que pode publicar) ou a um grupo
  (como membro que pode enviar mensagens) e cole o token do bot e o ID ou
  @usuário do chat no painel (criptografado em repouso). A conexão confere a
  permissão do bot nesse chat. Sem OAuth, sem variáveis de ambiente. A Bot API
  em nuvem limita uploads a 50 MB e legendas a 1.024 caracteres.

### 5. Gere os segredos autogerenciados

Esses você mesmo cria — nada a registrar:

```bash
# Chave de criptografia dos tokens OAuth (AES-256-GCM)
openssl rand -base64 32

# Chave de assinatura OAuth do MCP (PEM, com \n escapado em MCP_OAUTH_PRIVATE_KEY_PEM)
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
```

## Executando

```bash
pnpm dev:web      # painel em http://localhost:3434
```

Comandos úteis (todos verificados em `package.json` / `project.json`):

```bash
pnpm test        # todos os testes (web + MCP, via Nx)
pnpm lint        # ESLint (web + MCP)
pnpm typecheck   # tsc --noEmit (web + MCP)
pnpm build       # build de produção do app web
pnpm graph       # grafo de projetos do Nx
```

Detalhes por app: [apps/web/README.md](apps/web/README.md),
[apps/mcp/README.md](apps/mcp/README.md).

## Servidor MCP

O servidor MCP ([`apps/mcp/`](apps/mcp/), pacote npm
[`post-engineer-mcp`](https://www.npmjs.com/package/post-engineer-mcp)) permite
que agentes de IA enviem e publiquem mídia, agendem posts, gerenciem personas e
leiam métricas na sua conta. Você não precisa clonar este repositório para
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
[post-engineer.com/recipes](https://post-engineer.com/recipes). A tag
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
| `TOKEN_ENCRYPTION_KEY` | **Sim** | Criptografa tokens OAuth em repouso | Gere você mesmo (`openssl rand -base64 32`) |
| `MCP_OAUTH_PRIVATE_KEY_PEM` | Para OAuth do servidor MCP | Assina tokens MCP | Gere você mesmo (chave EC, veja acima) |
| Chave de projeto PostHog (`NEXT_PUBLIC_POSTHOG_KEY`) | Opcional | Rastreamento de erros + analytics de produto | Configurações do projeto PostHog |
| Webhook do Discord | Opcional | Notificações do agendador de publicação | Configurações do canal do Discord |
| `ZAI_API_KEY` | Somente CI | Workflow de code-review com IA | Não é dependência de runtime |

## Suporte e contato

Dúvidas, entre em contato:

- **E-mail:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com)
- **WhatsApp:** [+351 962 248 268](https://wa.me/351962248268)

## Licença

Licenciado sob a [Apache License, Version 2.0](LICENSE) — veja
[CONTRIBUTING.md](CONTRIBUTING.md) e [SECURITY.md](SECURITY.md).
