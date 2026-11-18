# NOTAS-v6 — vídeo faceless v6 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v5 (corrige TUDO isto — sem números, só os factos)

- O ritmo era um metrónomo: ~1,7 s por foto do início ao fim. Variar o TAMANHO dos takes NÃO funcionou — a velocidade da narração varia por take e anula a diferença. O mecanismo de ritmo por tamanho de take está morto; usa o mecanismo novo da lição 2.
- Texto/imagem falhou por frase em 4 pontos: pôr-do-sol sobre "fullness still weaker"; sapatos sobre "measuring cup" (a imagem ilustrava a frase ANTERIOR — estava uma frase atrasada, o copo só aparecia no frame seguinte); em pé a segurar as jeans sobre "sat on the edge of the bed". As fotos ilustravam o tema, não a frase exata.
- Um frame quase preto (~16 s): lençóis no escuro, sem pessoa nem assunto — o frame mais fraco do vídeo.
- Uma mão anónima no estudo (~24 s): manga cinzenta, não era a persona — quebra a regra de "a pessoa é sempre a mesma" por um detalhe.
- Sem música audível apesar de `music_mood: calm` — regista na análise se continua sem música; não percas tempo a tentar corrigir o áudio, é limite do stack.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## As 5 lições (o coração desta versão)

1. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo (vergonha/derrota na imagem, não só na narração). A viragem TEM de ter um momento visual — uma imagem que É a viragem. A subida visivelmente triunfante. Uma batida invisível é um falhanço.
2. **Contraste de ritmo pelo NÚMERO DE FOTOS por take — não pelo tamanho do take.** O engine divide a duração do take uniformemente pelas suas fotos, por isso é o número de fotos que manda no ritmo: take rápido = 6–8 fotos (cortes curtos); take lento = 2–3 fotos (respiração longa). Escreve o plano ANTES de gerar: para cada take, o número de fotos e o ritmo pretendido (rápido/lento). Nunca dois takes seguidos com o mesmo número de fotos. Nunca um vídeo inteiro com o mesmo ritmo.
3. **Texto/imagem por FRASE, com lista de planos e verificação.** ANTES de gerar, escreve uma lista de planos: uma linha por FRASE do guião, nomeando a imagem exata que mostra o que a frase diz. DEPOIS de escolheres as fotos, faz a verificação: percorre o vídeo frase a frase e confirma que a imagem muda QUANDO a frase muda — nunca uma foto atrasada, nunca a imagem da frase anterior sobre a frase seguinte. Se uma frase não tiver a sua imagem exata, TROCA a foto — não deixes passar.
4. **Qualidade de imagem sem exceção.** Todas as fotos nítidas, BEM ILUMINADAS, no tema. Vê cada foto em tamanho real antes de submeter e descarta qualquer uma que esteja escura demais, desfocada ou sem assunto visível. Nada de foto neutra de enchimento, nada de composições repetidas. E: qualquer parte do corpo em frame (mão, braço) tem de ser DA PERSONA — nada de mãos anónimas, nada de mangas que não são as dela.
5. **A persona, quando aparece, é sempre a mesma.** Foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas.

## História: real, concreta e vivida

- 1ª pessoa, plausível na vida real, com momento concreto vivido. "Um dia me aconteceu" é UMA forma; valem outras: "a primeira vez que...", "a semana que...", "o dia em que percebi...", um ritual, um arco antes/depois. Nunca genérico, nunca aleatório, nunca explicação sem história.

## Roteiro — regras mecânicas (não negociar)

- `segments`: `[{kind:'hook'|'content', text}]`. Só `hook`|`content`. Primeiro segmento é o hook, exatamente UM hook.
- Hook: 25–40 palavras, termina com pontuação final. Conteúdo total ≥30 palavras. Total do guião 60–200 palavras. Máx 12 segmentos. Sem markdown, links, emojis, parênteses/colchetes, placeholders. Sem texto de segmento repetido. CTA é só um take de conteúdo, em qualquer posição.
- Máx 30 fotos por vídeo (limite do engine).
- Valida o guião sem renderizar: `POST /api/videos/validate-script` no engine local (ver drive_v2.py).

## PESQUISAR, NÃO INVENTAR

- Qualquer facto (ex.: hormonas da fome, grelina/leptina, prazos) tem de ser VERIFICADO antes de entrar no guião. Não inventes números, prazos nem mecanismos.
- Se não conseguires confirmar um dado, CORTA-O do guião — nunca o afirmes na mesma.
- Pesquisa na web a partir daqui (search/fetch). Se tiveres acesso a Tavily ou Exa, usa; se não, usa a pesquisa web normal.

## Imagens — MÍDIA MISTA

- NÃO precisam de ser todas geradas por IA, nem todas da persona.
- A persona quando aparece: SEMPRE a mesma (regra 5 acima).
- Tudo o resto pode ser: foto real de comida, objeto, lugar, balança, roupa — ou VÍDEO (b-roll) de bancos de imagem com licença (ex.: Pexels). Nunca vídeo arrancado ao acaso da internet sem licença.
- NOTA DO STACK: neste build o engine só aceita FOTOS como mídia de segmento (o suporte a vídeo existe numa PR aberta, ainda não neste build). Se trouxeres b-roll, guarda-o em `~/workspace/video-selfhost/media-v6/` com `sources-v6.json` (fonte + licença de cada ficheiro) e USA-O SÓ onde o engine o aceitar — se o engine recusar vídeo, usa fotos e regista o bloqueio na análise. Não percas tempo a lutar com o engine.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v6/`. Mídia real: `~/workspace/video-selfhost/media-v6/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v5 (`drive_v2.py`, `resume_v5.py`, `download_r2_v5.py` em `~/workspace/video-selfhost/`), adaptando nomes para v6. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v6.mp4`.
- A limpeza de legendas (PR #637) ainda NÃO está no engine — não corrijas legendas à mão; regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v5 (`download_r2_v5.py` em `~/workspace/video-selfhost/`, adapta para v6).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes (mede os cortes)? Cada frase tem a sua imagem, sem atrasos? Persona consistente, sem mãos anónimas? Alguma foto escura ou de enchimento? Há música audível? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou. Escreve a análise em `~/workspace/video-selfhost/analysis-v6.md` e reporta de volta com a nota.
