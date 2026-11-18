# NOTAS-v8 — vídeo faceless v8 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v7 (corrige TUDO isto — sem números, só os factos)

- Ritmo: os primeiros 38 segundos eram uma grelha rígida de 2,0 s por foto — 72% do vídeo à mesma cadência. Hook, ponto baixo, descoberta e recomeço andavam todos iguais. O contraste só chegava na cauda, tarde demais, e era um aperto, não um contraste deliberado.
- Texto/imagem deslizou UMA FOTO PARA A FRENTE entre ~30 s e ~36 s: o caderno apareceu sobre "their fullness still weaker" (a frase do caderno só começava ~1 s depois); ela de pé com o telemóvel a sorrir sobre "I wrote three words in my notebook" (o caderno devia estar AQUI); ela a apertar os ténis sobre "It was not me" (os sapatos pertencem à caminhada). A frase-chave do vídeo ficou com a imagem errada.
- Causa medida: o hook tinha 5 fotos (10 s) para 12,2 s de áudio — um défice de 2,2 s que desalinhou tudo o que veio depois. A regra nova da lição 2 existe para isto.
- O gráfico do estudo contradizia a narração: o papel dizia "12 Week Study" enquanto a narração dizia que o estudo seguiu pessoas "for a full year". Qualquer adereço com texto tem de dizer o mesmo que a narração.
- Ela a dançar DESCALÇA no casamento — vestido de festa, pista cheia, pés descalços no chão de madeira. Detalhe estranho que distrai no momento triunfante. Sapatos sempre em eventos formais.
- Música não verificável: a narração é contínua sem intervalos entre frases, por isso não há janela para medir uma cama musical. Não afirmes que há música sem a ouvires nos intervalos.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## O desenho desta versão (o coração — lê com atenção)

**O mapeamento texto/imagem vive na ESTRUTURA DO GUIÃO, não num procedimento.** Não escrevas lista de planos, não faças verificação depois — o guião É o mapeamento:

1. **Cada segmento é UMA batida: uma frase, ou uma parte de uma lista.** "Eggs for breakfast" é um segmento; "water before coffee" é outro; "a walk after dinner" é outro. Uma frase com duas ideias separadas por vírgula divide-se em dois segmentos. As fotos de um segmento mostram SÓ o que esse segmento diz — nunca a frase seguinte, nunca o tema geral.
2. **Fotos por segmento = segundos de áudio ÷ 2.** O motor põe as fotos numa fila de 2 s ancorada no início, por isso o número de fotos de cada segmento tem de cobrir os seus segundos de áudio — senão o défice desalinha tudo o que vem depois. Conta as palavras do segmento e estima: a ~190 palavras por minuto, fotos ≈ palavras ÷ 6,3 (arredonda para cima), sempre dentro do piso de densidade do engine. Exemplos: hook de 12 s de áudio precisa de 6 fotos, não 5; um segmento de 8 s precisa de 4 fotos, não 3. Escreve o número de fotos ao lado de cada segmento ANTES de gerar, e confere a soma no fim.
3. **O hook é UM segmento só** (25–40 palavras), com as suas fotos a mostrar o hook como um todo — mas com as fotos contadas pela regra 2, nunca a menos.
4. **O CTA precisa de guarda de ritmo:** divide-o em 2 segmentos, ou dá-lhe um lead-in maior — nunca deixes a frase final correr a dobrar da velocidade do hook.
5. **Ritmo pela estrutura:** frases curtas = takes curtos; frases longas = takes longos. Varia o tamanho das frases de propósito. Não tentes controlar o ritmo por contagem de fotos além da regra 2.
6. **A roupa é sempre a mesma.** Se a persona veste um vestido numa cena, é o MESMO vestido — mesmo decote, mesmas mangas — em todos os frames dessa cena. Sapatos sempre em eventos formais; nunca descalça num casamento.
7. **Adereços com texto dizem o mesmo que a narração.** Se a narração diz "a full year", o papel não pode dizer "12 Week". Se não conseguires controlar o texto do adereço, usa um adereço sem texto.
8. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo. A viragem TEM de ter um momento visual. A subida visivelmente triunfante. Uma batida invisível é um falhanço.
9. **A persona, quando aparece, é sempre a mesma.** Foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas. Qualquer parte do corpo em frame (mão, braço) tem de ser DA PERSONA — nada de mãos anónimas.
10. **Qualidade de imagem sem exceção.** Todas as fotos nítidas, BEM ILUMINADAS, no tema. Vê cada foto em tamanho real antes de submeter e descarta qualquer uma que esteja escura demais, desfocada ou sem assunto visível. Nada de foto neutra de enchimento, nada de composições repetidas, nada de foto de stock com data visível.

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
- A persona quando aparece: SEMPRE a mesma (regra 9 acima).
- Tudo o resto pode ser: foto real de comida, objeto, lugar, balança, roupa — ou VÍDEO (b-roll) de bancos de imagem com licença (ex.: Pexels). Nunca vídeo arrancado ao acaso da internet sem licença.
- NOTA DO STACK: neste build o engine só aceita FOTOS como mídia de segmento (o suporte a vídeo existe numa PR aberta, ainda não neste build). Se trouxeres b-roll, guarda-o em `~/workspace/video-selfhost/media-v8/` com `sources-v8.json` (fonte + licença de cada ficheiro) e USA-O SÓ onde o engine o aceitar — se o engine recusar vídeo, usa fotos e regista o bloqueio na análise. Não percas tempo a lutar com o engine.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v8/`. Mídia real: `~/workspace/video-selfhost/media-v8/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v7 (`drive_v2.py`, `resume_v5.py`, `download_r2_v7.py` em `~/workspace/video-selfhost/`), adaptando nomes para v8. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v8.mp4`.
- A limpeza de legendas (PR #637) já foi MERGEADA mas pode ainda não estar no engine local — não corrijas legendas à mão; regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v7 (`download_r2_v7.py` em `~/workspace/video-selfhost/`, adapta para v8).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes (mede os cortes)? Cada frase tem a sua imagem, no momento certo, sem deslizar uma foto para a frente? Persona e roupa consistentes? Algum adereço a contradizer a narração? Há música audível? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou. Escreve a análise em `~/workspace/video-selfhost/analysis-v8.md` e reporta de volta com a nota.
