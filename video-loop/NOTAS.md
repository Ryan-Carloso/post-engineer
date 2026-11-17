# NOTAS — Gerar 1 vídeo self-hosted (dev)

Única fonte de verdade para esta tarefa. Não usar nenhum outro contexto.

## Objetivo

Gerar UM vídeo **faceless** (sem persona, sem lip sync) com o engine do Post Engineer a correr self-hosted (nesta VM),
com as secrets de DEV. Vídeo COMPLETO, não clipe de teste.
Entregar o ficheiro de vídeo pronto.
Não publicar em nenhuma conta pública.

Depois de gerar: o agente ANALISA o vídeo pronto — as imagens e o roteiro — e dá uma NOTA (0–10) com os pontos fortes e fracos.

## Fontes (únicas)

- Secrets dev: repo `Ryan-Carloso/post-enginner-repos`, pasta `secrets/dev`
  (subpastas `engine` e `web`). Buscar via `gh api .../contents/...`.
- Código: `~/workspace/post-engineer` — engine em `apps/engine`
  (tem `docker-compose.yml`, `Dockerfile`, `README.md`, `config.example.toml`).
- Defaults de teste: workflow test-flight no repo `Ryan-Carloso/post-engineer`
  (branch `ci/test-flight`, `.github/workflows/test-flight.yml`).
  Persona/tópico vêm de repo vars/secrets (`TEST_FLIGHT_PERSONA_ID` etc.),
  precedência inputs > vars > secrets. Usar esses defaults para persona e
  tópico quando nada mais estiver especificado.

## Passos

1. Listar só os NOMES dos ficheiros em `secrets/dev/engine` (e `web` se preciso).
   Nunca imprimir valores.
2. Levantar o engine local (docker compose) com as env vars de dev.
3. Gerar 1 vídeo FACELESS completo (sem persona, sem lip sync) com os
   defaults do test-flight-faceless (tópico dos repo vars/secrets; sem tópico
   configurado, usar o tópico gerado por LLM do próprio fluxo).
4. Confirmar o vídeo renderizado, guardar o ficheiro em
   `~/workspace/video-selfhost/` e reportar o caminho + duração.
5. ANALISAR o vídeo pronto: ver as imagens e ler o roteiro, dar NOTA 0–10
   com pontos fortes e fracos, e incluir a análise no report.

## Regras duras

- NUNCA imprimir, colar ou guardar valores de secrets em chat, ficheiros de
  log ou output. Só nomes de chaves e se existem/faltam.
- NUNCA tocar em produção: nada de VPS, nada de `post-engineer.com`, nada de
  keys de prod (`secrets/prod` é proibido).
- NUNCA dar push no main; se precisar de branch, não abrir PR sem pedir.
- NUNCA publicar/agendar o vídeo em conta pública. Só gerar e entregar o
  ficheiro.
- Não gastar tokens de prod. Dev apenas.
- Se bloquear (falta secret, persona sem foto, engine não sobe), parar e
  reportar o bloqueio exato — não inventar persona, tópico ou credencial.

## Report de volta (para o coordenador, não para o utilizador)

Caminho do vídeo, duração, persona/tópico usados (só nomes/IDs), custo se
visível, e qualquer bloqueio.
