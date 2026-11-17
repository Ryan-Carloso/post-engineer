# NOTAS v2 — Refazer o vídeo faceless (correção do utilizador)

Única fonte de verdade. Não usar nenhum outro contexto.

## Porquê refazer

O vídeo anterior levou 3/10 do utilizador (o agente tinha dado 7/10 — generoso
demais):
- Fotos eram stock (Pexels), pessoas aleatórias, sem persona.
- Roteiro era explicação genérica, não uma história.

## Objetivo

Gerar UM vídeo faceless COMPLETO com as regras corrigidas, e analisá-lo com
rigor (nota 0–10). Entregar o ficheiro pronto. Não publicar.

## Regras corrigidas (duras)

1. **Imagens 100% geradas por IA pelo agente. Nunca stock, nunca Pexels.**
2. **UMA só persona consistente no vídeo inteiro** — a mesma pessoa, mesmo
   look, em todas as fotos. Se for grupo, um grupo fixo. Nunca várias
   personas diferentes como protagonista.
   - Método: gerar 1 foto-base da persona e CONGELAR a descrição dela; cada
     foto de cena é gerada A PARTIR da foto-base ORIGINAL (image edit), nunca
     encadear edições.
3. **Roteiro TEM de ser uma história real** — "o dia que aconteceu alguma
   coisa": dia concreto, evento, 1ª pessoa, plausível na vida real. Ex:
   "The day I stepped on the scale three weeks after my diet ended...".
   Nunca explicação genérica nem lista de palavras.
   - Regras mecânicas mantêm-se: `segments` [{kind:'hook'|'content', text}],
     primeiro é o hook, exatamente um hook, hook 25–40 palavras, total 60–200
     palavras, máx 12 segmentos, sem markdown/links/emojis.
4. Faceless: sem persona de lip sync, sem lip sync. Voz TTS local.
5. Tema: o mesmo — "why you regain weight after a diet" (HabitLoom / Daily
   Dose, EN).

## Fontes e stack

- Engine local em `~/workspace/pe-local-selfhost` (:8080) e TTS (:4123) —
  verificar se ainda estão no ar; se não, levantar de novo com as secrets dev
  de `Ryan-Carloso/post-enginner-repos` `secrets/dev`.
- Scripts da run anterior em `/tmp/video-selfhost/` (`drive_video.py`,
  `upload_photos.py`, `manifest2.json`) — reutilizar o caminho
  `POST /api/v1/temp_assets` + `mediaId` nos segmentos (o guarda SSRF do
  engine bloqueia URLs externas; upload é o caminho do produto).
- Fotos novas: gerar com a ferramenta de imagem; guardar em
  `~/workspace/video-selfhost/images-v2/`.
- Vídeo final em `~/workspace/video-selfhost/` (nome:
  `daily-dose-weight-regain-faceless-v2.mp4`).

## Análise (rigorosa)

Ver frames do vídeo pronto + transcrever o áudio. Nota 0–10. Avaliar com
rigor: consistência da persona em TODAS as fotos, história real
(dia/evento) vs explicação genérica, texto/imagem a condizer. Listar pontos
fortes e fracos concretos com timestamps.

## Regras duras (gerais)

- NUNCA imprimir, colar ou guardar valores de secrets em lado nenhum. Só
  nomes de chaves e se existem/faltam.
- NUNCA tocar em produção (`post-engineer.com`, keys prod, `secrets/prod`
  proibido).
- NUNCA publicar/agendar o vídeo. Só gerar e entregar o ficheiro.
- Não gastar tokens de prod. Dev apenas.
- Se bloquear, parar e reportar o bloqueio exato — não inventar persona,
  tópico ou credencial.

## Report de volta (para o coordenador, não para o utilizador)

Caminho do vídeo, duração, roteiro usado, método das imagens, análise + nota,
custo se visível, bloqueios.
