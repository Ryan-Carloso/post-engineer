# NOTAS-v4 — vídeo faceless v4 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## Veredicto do utilizador sobre a v3 (2026-11-17 18:16)

Não gostou: ainda muito monótona, nenhuma sensação passou. O Informativo saiu como aula. A v4 tem de ter EMOÇÃO — esta é a correção nº 1.

## Arquétipo: INSPIRADOR (superação)

- Sensação a passar: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco emocional obrigatório, com contraste claro entre os takes: ponto baixo (vergonha, balança, roupa apertada) → viragem (descoberta ou decisão) → subida (plano, vitória pequena, fechar com força).
- Cada take tem de SENTIR-SE diferente do anterior: ritmo, imagens e tom variam. Monotonia = falhanço. Nada de aula, nada de lista.
- O valor continua lá dentro (o mecanismo da fome pode aparecer), mas como parte da superação, nunca como exposição.

## História: real, concreta e vivida

- 1ª pessoa, plausível na vida real, com momento concreto vivido. "Um dia me aconteceu" é UMA forma; valem outras: "a primeira vez que...", "a semana que...", "o dia em que percebi...", um ritual, um arco antes/depois. Nunca genérico, nunca aleatório, nunca explicação sem história.

## Roteiro — regras mecânicas (não negociar)

- `segments`: `[{kind:'hook'|'content', text}]`. Só `hook`|`content`. Primeiro segmento é o hook, exatamente UM hook.
- Hook: 25–40 palavras, termina com pontuação final. Conteúdo total ≥30 palavras. Total do guião 60–200 palavras. Máx 12 segmentos. Sem markdown, links, emojis, parênteses/colchetes, placeholders. Sem texto de segmento repetido. CTA é só um take de conteúdo, em qualquer posição.
- Valida o guião sem renderizar: `POST /api/videos/validate-script` no engine local (ver drive_v2.py).

## PESQUISAR, NÃO INVENTAR (regra nova)

- Qualquer facto (ex.: hormonas da fome, grelina/leptina, prazos) tem de ser VERIFICADO antes de entrar no guião. Não inventes números, prazos nem mecanismos.
- Se não conseguires confirmar um dado, CORTA-O do guião — nunca o afirmes na mesma.
- Pesquisa na web a partir daqui (search/fetch). Se tiveres acesso a Tavily ou Exa, usa; se não, usa a pesquisa web normal. O que importa é o facto verificado, não a ferramenta.

## Imagens — MÍDIA MISTA (regra nova, revoga o "100% IA" da v2)

- NÃO precisam de ser todas geradas por IA, nem todas dela.
- A MARA (a persona) quando aparece: SEMPRE a mesma pessoa (foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas). Consistência dela é inegociável.
- Tudo o resto pode ser: foto real de comida, objeto, lugar, balança, roupa — ou VÍDEO (b-roll) de bancos de imagem com licença (ex.: Pexels). Nunca vídeo arrancado ao acaso da internet sem licença.
- Misturar foto real + IA + vídeo é DESEJADO: o movimento do b-roll mata a monotonia dos painéis estáticos da v3. Mantém um look coerente (mesma luz/tons) para não parecer colagem.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v4/`. Mídia real/b-roll: `~/workspace/video-selfhost/media-v4/` (guarda a fonte/licença de cada ficheiro num `sources-v4.json`).

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v2 (`drive_v2.py`, `poll_v2.py`, `download_v2.py` em `~/workspace/video-selfhost/`), adaptando nomes para v4. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF — DNS resolve para 198.18.164.63).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v4.mp4`.
- A limpeza de legendas (PR #637) ainda NÃO está no engine — não corrijas legendas à mão; regista se aparecer travessão/vírgula/ponto na análise.

## Análise final (rigorosa, 0–10)

Depois de gerar: vê 9 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? Cada take sente-se diferente? Há contraste baixo → viragem → subida? Persona consistente em todos os frames em que aparece? Texto/imagem condizem? Alguma monotonia restante? Nota 0–10 com pontos fortes e fracos com timestamps. Não inflacionar a nota: a v2 levou 8 e o utilizador deu 3; a v3 levou 8,5 e ele não gostou. Sê duro.
