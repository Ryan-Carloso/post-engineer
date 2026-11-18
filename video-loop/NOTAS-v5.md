# NOTAS-v5 — vídeo faceless v5 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v4 (corrige TUDO isto — sem números, só os factos)

- O ponto baixo não era baixo: preocupação leve, não derrota. Sem vergonha visível.
- A viragem não tinha momento visual: ovos fritos no ecrã enquanto a narração falava do estudo. O beat mais importante do arco era invisível.
- O ritmo não variou: ~1,9 s/foto em todo o vídeo. O engine divide uniformemente por segmento e o teto de 2 s achata tudo.
- Texto/imagem fraco: ovos sobre "study", sapatos sobre "measuring cup", prato sobre "jeans fit again". As fotos ilustravam o segmento, não a frase.
- Meio dominado pela cozinha (5 de 10 frames); uma só voz, um só ritmo.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## As 5 lições (o coração desta versão)

1. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo (vergonha/derrota na imagem, não só na narração). A viragem TEM de ter um momento visual — uma imagem que É a viragem. A subida visivelmente triunfante. Uma batida invisível é um falhanço.
2. **Contraste de ritmo pelos tamanhos dos takes.** Varia DELIBERADAMENTE o tamanho dos segmentos: hook curto e direto, descoberta mais longa, fecho curto. Como o engine divide uniformemente dentro de cada segmento, segmentos de tamanhos muito diferentes produzem ritmos diferentes. Nunca três segmentos do mesmo tamanho.
3. **Texto/imagem por FRASE, não por segmento.** Cada frase tem de ter uma imagem que mostre o que a frase diz. Se a frase diz "study", a imagem é o estudo/pesquisa. Se diz "measuring cup", a imagem é o copo medidor. Nunca ilustrar só o tema geral do segmento.
4. **Qualidade de imagem sem exceção.** Todas as fotos nítidas, bem iluminadas, no tema. Nada de foto neutra de enchimento, nada de composições repetidas, nada de foto que só "está lá". Cada foto tem de merecer o seu lugar.
5. **A persona, quando aparece, é sempre a mesma.** Foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas.

## História: real, concreta e vivida

- 1ª pessoa, plausível na vida real, com momento concreto vivido. "Um dia me aconteceu" é UMA forma; valem outras: "a primeira vez que...", "a semana que...", "o dia em que percebi...", um ritual, um arco antes/depois. Nunca genérico, nunca aleatório, nunca explicação sem história.

## Roteiro — regras mecânicas (não negociar)

- `segments`: `[{kind:'hook'|'content', text}]`. Só `hook`|`content`. Primeiro segmento é o hook, exatamente UM hook.
- Hook: 25–40 palavras, termina com pontuação final. Conteúdo total ≥30 palavras. Total do guião 60–200 palavras. Máx 12 segmentos. Sem markdown, links, emojis, parênteses/colchetes, placeholders. Sem texto de segmento repetido. CTA é só um take de conteúdo, em qualquer posição.
- Valida o guião sem renderizar: `POST /api/videos/validate-script` no engine local (ver drive_v2.py).

## PESQUISAR, NÃO INVENTAR

- Qualquer facto (ex.: hormonas da fome, grelina/leptina, prazos) tem de ser VERIFICADO antes de entrar no guião. Não inventes números, prazos nem mecanismos.
- Se não conseguires confirmar um dado, CORTA-O do guião — nunca o afirmes na mesma.
- Pesquisa na web a partir daqui (search/fetch). Se tiveres acesso a Tavily ou Exa, usa; se não, usa a pesquisa web normal.

## Imagens — MÍDIA MISTA

- NÃO precisam de ser todas geradas por IA, nem todas da persona.
- A persona quando aparece: SEMPRE a mesma (regra 5 acima).
- Tudo o resto pode ser: foto real de comida, objeto, lugar, balança, roupa — ou VÍDEO (b-roll) de bancos de imagem com licença (ex.: Pexels). Nunca vídeo arrancado ao acaso da internet sem licença.
- NOTA DO STACK: neste build o engine só aceita FOTOS como mídia de segmento (verificado na v4). Se trouxeres b-roll, guarda-o em `~/workspace/video-selfhost/media-v5/` com `sources-v5.json` (fonte + licença de cada ficheiro) e USA-O SÓ onde o engine o aceitar — se o engine recusar vídeo, usa fotos e regista o bloqueio na análise. Não percas tempo a lutar com o engine; outro agente está a tratar do suporte a vídeo em paralelo.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v5/`. Mídia real: `~/workspace/video-selfhost/media-v5/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v2 (`drive_v2.py`, `poll_v2.py`, `download_v2.py` em `~/workspace/video-selfhost/`), adaptando nomes para v5. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v5.mp4`.
- A limpeza de legendas (PR #637) ainda NÃO está no engine — não corrijas legendas à mão; regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v4 (`download_r2_v4.py` em `~/workspace/video-selfhost/`, adapta para v5).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes? Cada frase tem a sua imagem? Persona consistente? Alguma foto de enchimento? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou.
