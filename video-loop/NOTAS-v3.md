# NOTAS v3 — Refazer o vídeo faceless (arquétipos de valor)

Única fonte de verdade. Não usar nenhum outro contexto.

## Porquê refazer

O vídeo v2 levou 8/10 mas o conteúdo continua básico: medir porções todo o
mundo já sabe, não agrega nada na vida de quem vê.

## Objetivo

Gerar UM vídeo faceless COMPLETO com história real E valor, e analisá-lo com
rigor (nota 0–10). Entregar o ficheiro pronto. Não publicar.

## Regras (todas as anteriores + a nova)

1. **UM arquétipo por vídeo — INFORMATIVE desta vez.** O vídeo tem de
   ENSINAR algo útil e não-óbvio, que agregue valor real na vida de quem vê.
   Os 5 arquétipos (escolher UM por vídeo): Informativo (ensina algo útil e
   não-óbvio), Engraçado (humor), Inspirador (motivação, superação),
   Identificação ("isso acontece comigo"), Provocativo (hot take, desafia o
   senso comum). Nunca conteúdo básico sem valor.
   - Ângulo informativo para este vídeo: o mecanismo NÃO-ÓBVIO por trás do
     peso que volta (ex: hormonas da fome elevadas após a dieta, o corpo a
     defender o peso antigo, a janela das 3 semanas) — ensinar o PORQUÊ, não
     só "mede as porções".
2. **História real, 1ª pessoa** — "o dia que aconteceu alguma coisa": dia
   concreto, evento, plausível na vida real. A lição informativa nasce
   DENTRO da história, não como lista.
   - Regras mecânicas: `segments` [{kind:'hook'|'content', text}], primeiro
     é o hook, exatamente um hook, hook 25–40 palavras, total 60–200
     palavras, máx 12 segmentos, sem markdown/links/emojis.
3. **Imagens 100% geradas por IA, zero stock. UMA só persona: a "Mara" da
   v2** (32 anos, cabelo castanho em coque baixo, olhos verdes, sardas,
   t-shirt verde-sálvia, jeans) — REUTILIZAR a foto-base da v2 em
   `~/workspace/video-selfhost/images-v2/` como referência; cada foto de
   cena é gerada A PARTIR dessa foto-base ORIGINAL, nunca encadear edições.
4. Faceless: sem persona de lip sync, sem lip sync. Voz TTS local.
5. Tema: o mesmo — "why you regain weight after a diet" (HabitLoom / Daily
   Dose, EN).
6. Legendas: a limpeza de legendas (script) ainda NÃO está no engine — não
   tentar corrigir legendas à mão; gerar normal.

## Fontes e stack

- Engine local em `~/workspace/pe-local-selfhost` (:8080) e TTS (:4123) —
  verificar se ainda estão no ar; se não, levantar de novo com as secrets dev
  de `Ryan-Carloso/post-enginner-repos` `secrets/dev`.
- Scripts da run anterior em `~/workspace/video-selfhost/` (`drive_v2.py`,
  `poll_v2.py`, `download_v2.py`) — reutilizar o caminho
  `POST /api/v1/temp_assets` + `mediaId` nos segmentos.
- Fotos novas: gerar com a ferramenta de imagem; guardar em
  `~/workspace/video-selfhost/images-v3/`.
- Vídeo final em `~/workspace/video-selfhost/` (nome:
  `daily-dose-weight-regain-faceless-v3.mp4`).

## Análise (rigorosa)

Ver frames do vídeo pronto + transcrever o áudio. Nota 0–10. Avaliar com
rigor: a história ENSINA algo não-óbvio? O valor é real ou básico? Persona
consistente em TODAS as fotos, história real (dia/evento) vs explicação
genérica, texto/imagem a condizer. Listar pontos fortes e fracos concretos
com timestamps.

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

Caminho do vídeo, duração, roteiro usado, arquétipo usado e o que ele ensina,
método das imagens, análise + nota, custo se visível, bloqueios.

## Resultado v3 — GERADO (2026-11-17, ~20:24 UTC / 17:24 -03)

- Vídeo: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v3.mp4`
  — 34,90 s, 1080×1920, 9.326.351 bytes (8,9 MB). Task 2ª tentativa
  `7b5c4dc2-b503-4d12-aeda-8f2fc194d6cf`, state=1, final-1.mp4 descarregado
  via URL assinada R2 com Range resume (24 tentativas, short reads).
- Roteiro (106 palavras, voz `chatterbox:phonon_everly`):
  - hook (35w): "Three weeks after my diet ended, I stepped on the scale on
    a Tuesday morning, and the number was back. Same jeans, same mirror —
    and I had no idea how it happened so fast."
  - content1 (38w): "That week I found out it wasn't willpower. After a
    diet, your hunger hormone stays high for months, and the fullness signal
    stays low. My body was defending its old weight — the hunger was
    biology, not failure."
  - content2 (33w): "So now I plan for it. Protein at breakfast, the
    measuring cup back on the counter, same plate every night. Save this for
    your week three — that's when the hunger hits hardest."
  - Título: "Three weeks after my diet, my body fought back".
- Arquétipo: **Informativo**. Ensina o mecanismo não-óbvio: após a dieta a
  grelina (fome) fica alta durante meses e a leptina (saciedade) fica baixa;
  o corpo defende o peso antigo; a fome é biologia, não falta de força de
  vontade. A lição nasce DENTRO da história (ela descobre "that week") e é
  explícita no segmento do meio. Título do vídeo: "Three weeks after my
  diet, my body fought back".
- Imagens: 21 fotos 100% IA, zero stock, em `images-v3/`, todas geradas a
  partir da foto-base ORIGINAL da v2 (nunca edições encadeadas), 1152×2048.
  Persona Mara em todas (cabelo castanho coque baixo, olhos verdes, sardas,
  t-shirt verde-sálvia, jeans).
- Transcrição (faster-whisper tiny, EN, `transcript-v3.json`): fiel ao
  guião, exceto Whisper ouvir "same play" em vez de "same plate" (~27s —
  erro de ASR ou dicção do TTS; a legenda no ecrã diz "same plate" correto).
- Análise (9 frames, 1 a cada 4s, `frames-v3/` + frames t=0–3s):
  - Fortes: história real 1ª pessoa com arco completo (choque → descoberta
    → plano → CTA "Save this for your week three"); valor real e não-óbvio;
    persona consistente 9/9 frames; hook ABRE com a balança (t=0–2s,
    display legível "79.4 kg") — corrige o ponto fraco da v2; diário de
    comida visível (~12s), frigorífico à noite (~20s, fome), prato de
    proteína (~24s), diário/plano (~28s), caminhada de fecho (~32s).
  - Fracos: (1) **legenda com travessão no ecrã ~20s**: "weight — the hunger
    was biology" — o guião tinha "—" e o cleanup de legendas (PR #637,
    aberta, à espera do tap) ainda não está no engine; viola a regra
    "sem traço, só ?" no vídeo entregue. (2) **Continuidade do visor**: a
    balança marca 79.4 kg em t=0 (foto 01) e 67.4 kg em t≈8s (foto 07) —
    mesma manhã, dois pesos; o gerador inventou dígitos diferentes por
    edição. (3) ~4s: "and the number was back" sobre foto neutra de cozinha
    com caneca (o número não está no ecrã nesse instante).
- **Nota: 8,5/10** — melhor que a v2 (8/10): valor real, hook corrigido,
  visor legível; travado pelo travessão visível na legenda e pelo nit de
  continuidade dos dois pesos.
- Custo: nenhum visível — self-host local, secrets dev, sem tokens.
- Incidentes: tentativa 1 (task `39cc9b48…`, 18:15 UTC) morreu quando a VM
  reiniciou ~19:49 UTC (engine+TTS+ffmpeg mortos, clip sem moov); stack
  reerguido com `start-stack.py`, mediaIds da tentativa 1 expirados (TTL 1h
  dos temp_assets) — manifest apagado e 21 fotos re-enviadas; tentativa 2
  criada 19:53 UTC, concluída ~20:23 UTC. `~/.transcribe-venv` desapareceu
  no swap da VM — transcrição feita com o faster-whisper do venv do engine.
  Duas interrupções do runtime durante a análise; recuperado a partir dos
  ficheiros em disco. Load da caixa 6–32 durante toda a noite (agentes
  irmãos); render da tentativa 2 ~30 min.
