# NOTAS-v7 — vídeo faceless v7 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v6 (corrige TUDO isto — sem números, só os factos)

- Os primeiros 36 segundos eram um metrónomo: exatamente 2,0 s por foto do início ao fim do hook, do ponto baixo e da viragem. O contraste de ritmo só chegava no último terço. O mecanismo de "número de fotos por take" NÃO moveu o ritmo no início — o piso de densidade do engine (mínimo de fotos por segmento) + o teto de 2 s por foto travaram tudo a 2,0 s.
- Três frases com a imagem errada: um copo de água sobre "Eggs for breakfast" (a água era da frase seguinte); um telemóvel sobre "I wrote three words in my notebook" (não havia caderno nenhum no frame); um calendário de stock "October 2020" sobre "A study had followed people for a full year" (não mostra um estudo e a data denuncia stock antigo).
- O vestido mudava de decote entre frames: mangas curtas com costas abertas, depois alças finas, depois ombros caídos. Mesma cor, mesmo tecido — mas não um só vestido.
- Sem música audível: os intervalos entre frases estavam quase em silêncio. Regista na análise se continua sem música; não percas tempo a tentar corrigir o áudio, é limite do stack.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## O desenho desta versão (o coração — lê com atenção)

**O mapeamento texto/imagem vive na ESTRUTURA DO GUIÃO, não num procedimento.** Não escrevas lista de planos, não faças verificação depois — o guião É o mapeamento:

1. **Cada segmento é UMA batida: uma frase, ou uma parte de uma lista.** "Eggs for breakfast" é um segmento; "water before coffee" é outro; "a walk after dinner" é outro. Uma frase com duas ideias separadas por vírgula divide-se em dois segmentos. As fotos de um segmento mostram SÓ o que esse segmento diz — nunca a frase seguinte, nunca o tema geral.
2. **O hook é a exceção: UM segmento só** (25–40 palavras), com as suas fotos a mostrar o hook como um todo.
3. **Ritmo pela estrutura:** frases curtas = takes curtos; frases longas = takes longos. Varia o tamanho das frases de propósito — uma frase curta e seca a seguir a uma longa cria o contraste. Não tentes controlar o ritmo por contagem de fotos; o piso de densidade do engine impede-o.
4. **A roupa é sempre a mesma.** Se a persona veste um vestido numa cena, é o MESMO vestido — mesmo decote, mesmas mangas — em todos os frames dessa cena. Se não conseguires gerar o mesmo vestido, muda a cena para roupa que consigas repetir (ex.: a t-shirt verde-sálvia + jeans que já funcionam).
5. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo. A viragem TEM de ter um momento visual. A subida visivelmente triunfante. Uma batida invisível é um falhanço.
6. **A persona, quando aparece, é sempre a mesma.** Foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas. Qualquer parte do corpo em frame (mão, braço) tem de ser DA PERSONA — nada de mãos anónimas.
7. **Qualidade de imagem sem exceção.** Todas as fotos nítidas, BEM ILUMINADAS, no tema. Vê cada foto em tamanho real antes de submeter e descarta qualquer uma que esteja escura demais, desfocada ou sem assunto visível. Nada de foto neutra de enchimento, nada de composições repetidas, nada de foto de stock com data visível.

## História: real, concreta e vivida

- 1ª pessoa, plausível na vida real, com momento concreto vivido. "Um dia me aconteceu" é UMA forma; valem outras: "a primeira vez que...", "a semana que...", "o dia em que percebi...", um ritual, um arco antes/depois. Nunca genérico, nunca aleatório, nunca explicação sem história.

## Roteiro — regras mecânicas (não negociar)

- `segments`: `[{kind:'hook'|'content', text}]`. Só `hook`|`content`. Primeiro segmento é o hook, exatamente UM hook.
- Hook: 25–40 palavras, termina com pontuação final. Conteúdo total ≥30 palavras. Total do guião 60–200 palavras. **Máx 12 segmentos no total** — conta antes de submeter: hook (1) + uma batida por segmento. Se passares de 12, junta as duas batidas mais curtas num só segmento.
- Máx 30 fotos por vídeo (limite do engine). O engine exige um mínimo de fotos por segmento (piso de densidade) — se a submissão for rejeitada por densidade, aumenta as fotos do segmento curto em vez de juntar segmentos.
- Sem markdown, links, emojis, parênteses/colchetes, placeholders. Sem texto de segmento repetido. CTA é só um take de conteúdo, em qualquer posição.
- Valida o guião sem renderizar: `POST /api/videos/validate-script` no engine local (ver drive_v2.py).

## PESQUISAR, NÃO INVENTAR

- Qualquer facto (ex.: hormonas da fome, grelina/leptina, prazos) tem de ser VERIFICADO antes de entrar no guião. Não inventes números, prazos nem mecanismos.
- Se não conseguires confirmar um dado, CORTA-O do guião — nunca o afirmes na mesma.
- Pesquisa na web a partir daqui (search/fetch). Se tiveres acesso a Tavily ou Exa, usa; se não, usa a pesquisa web normal.

## Imagens — MÍDIA MISTA

- NÃO precisam de ser todas geradas por IA, nem todas da persona.
- A persona quando aparece: SEMPRE a mesma (regra 6 acima).
- Tudo o resto pode ser: foto real de comida, objeto, lugar, balança, roupa — ou VÍDEO (b-roll) de bancos de imagem com licença (ex.: Pexels). Nunca vídeo arrancado ao acaso da internet sem licença.
- NOTA DO STACK: neste build o engine só aceita FOTOS como mídia de segmento (o suporte a vídeo existe numa PR aberta, ainda não neste build). Se trouxeres b-roll, guarda-o em `~/workspace/video-selfhost/media-v7/` com `sources-v7.json` (fonte + licença de cada ficheiro) e USA-O SÓ onde o engine o aceitar — se o engine recusar vídeo, usa fotos e regista o bloqueio na análise. Não percas tempo a lutar com o engine.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v7/`. Mídia real: `~/workspace/video-selfhost/media-v7/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v6 (`drive_v2.py`, `resume_v5.py`, `download_r2_v6.py` em `~/workspace/video-selfhost/`), adaptando nomes para v7. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v7.mp4`.
- A limpeza de legendas (PR #637) ainda NÃO está no engine — não corrijas legendas à mão; regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v6 (`download_r2_v6.py` em `~/workspace/video-selfhost/`, adapta para v7).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes (mede os cortes)? Cada frase tem a sua imagem, no momento certo? Persona e roupa consistentes? Alguma foto de enchimento ou de stock com data? Há música audível? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou. Escreve a análise em `~/workspace/video-selfhost/analysis-v7.md` e reporta de volta com a nota.
