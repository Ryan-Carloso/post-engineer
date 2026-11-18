# NOTAS-v12 — vídeo faceless v12 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v11 (corrige TUDO isto — sem números, só os factos)

- Ritmo: grelha rígida de 2,0 s/foto nos primeiros 40 s (71% do vídeo). A variação só chega depois dos 40 s. **NOVO NESTE BUILD: o engine agora aceita `SegmentMedia.duration` (0,5–6 s por foto) — usa-o para quebrar a grelha (ver regra 3).**
- As legendas andam 1–2 s fora das palavras em três pontos: aos 34 s a legenda diz "their fullness still weaker" quando o áudio já está no caderno; aos 36 s diz "So I started again" quando o áudio diz "It was not me" (~1,8 s de avanço). As legendas são por take, não por palavra — seguem o take, e quando o take desliza, a legenda desliza com ele. A correção é reduzir o desvio (regra 3), não mexer nas legendas.
- O telemóvel aparece cedo demais (~18 s): ela está sentada na cama, triste, a olhar para o telemóvel, 4 s antes da viragem. O objeto da viragem não pode chegar antes da viragem.
- Duas imagens chegam ~1 s adiantadas (caderno, dança).
- O gráfico do estudo é uma curva sem rótulos que sobe, desce e volta a subir — não contradiz nada, mas também não diz nada sozinho. Um gráfico tem de dizer alguma coisa sem a narração, ou não entra.
- A foto de apertar os ténis volta pela quarta vez como motivo — desta vez funciona como "preparar-se para recomeçar", mas não repitas um motivo por hábito; cada repetição tem de ganhar o seu lugar.
- NOTA: os "4 flashes em branco" que a análise da v10 reportou NÃO EXISTEM no vídeo — foram um artefacto da primeira extração de frames, verificado 3 vezes por vias independentes. Não tentes corrigir flashes que não estão lá.
- A 30ª foto (cabide) mostra-se depois da última palavra: 0,7 s de silêncio numa imagem pré-casamento. O último frame do vídeo tem de ser a dança, nunca uma foto de cobertura.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## O desenho desta versão (o coração — lê com atenção)

**O mapeamento texto/imagem vive na ESTRUTURA DO GUIÃO, não num procedimento.** Não escrevas lista de planos, não faças verificação depois — o guião É o mapeamento:

1. **Cada segmento é UMA batida: uma frase, ou uma parte de uma lista.** "Eggs for breakfast" é um segmento; "water before coffee" é outro; "a walk after dinner" é outro. Uma frase com duas ideias separadas por vírgula divide-se em dois segmentos. NUNCA fundas duas ideias num só segmento. As fotos de um segmento mostram SÓ o que esse segmento diz — nunca a frase seguinte, nunca o tema geral.
2. **O corpo muda de verdade: dois estados corporais, mesma pessoa.** A história é sobre engordar de novo — a diferença antes/depois tem de ser VISÍVEL NO CORPO, não só na balança ou no fecho. Gera DUAS versões da persona a partir da mesma foto-base: a versão MAGRA (o antes — o vestido fecha, o corpo do fim da dieta) e a versão MAIS PESADA (o depois — o vestido não fecha, o corpo do peso recuperado). Mesma cara, mesmo cabelo, mesmo estilo de roupa — só o corpo muda, de forma visível. Usa a versão magra nas cenas do antes e do recomeço final, e a versão mais pesada nas cenas do vestido que não fecha, da balança e do ponto baixo. **Regra de reutilização: NUNCA reutilizes uma foto de uma versão anterior sem a veres em tamanho real e confirmares o estado do corpo — se um corpo é visível na foto, ele tem de corresponder à fase em que a foto vai entrar.** Se as duas versões não ficarem claramente diferentes no corpo, refaz — a diferença tem de se ver sem a narração.
3. **Ritmo por foto, com `duration` (NOVO — o build já tem a PR #652).** Cada foto pode durar 0,5–6 s (`SegmentMedia.duration`); sem duration, o comportamento é o de sempre (fila de 2 s). **Usa-o de propósito, por emoção:** o ponto baixo segura-se mais tempo (fotos de 3–4 s na lágrima, no chão do quarto); o estudo corre mais rápido (1–1,5 s por foto); a dança segura-se (4–6 s). O hook e a viragem ficam a 2 s, salvo se a emoção pedir outra coisa. Escreve a duration ao lado de cada foto ANTES de gerar. **Não uses duration para tapar buracos de cobertura:** o número de fotos continua a ter de cobrir o áudio (regra dos 2 s por foto como base de contagem), e a duration só redistribui o tempo dentro do segmento. Se uma submissão falhar por cobertura, aumenta as fotos, não estiques durations.
4. **O CTA tem 12 palavras e não se mexe mais.** O disparo acabou na v11 (240 palavras/min contra 241 no hook) — mantém 12 palavras, distribuídas por 2 fotos, e não tentes um CTA mais longo outra vez.
5. **O hook é UM segmento só** (25–40 palavras), com as suas fotos a mostrar o hook como um todo — mas com as fotos contadas pela regra 3, nunca a menos.
6. **Ritmo pela estrutura:** frases curtas = takes curtos; frases longas = takes longos. Varia o tamanho das frases de propósito. Não tentes controlar o ritmo por contagem de fotos além da regra 3.
7. **A roupa é sempre a mesma dentro de cada fase.** Se a persona veste um vestido numa cena, é o MESMO vestido — mesmo decote, mesmas mangas — em todos os frames dessa cena. Sapatos sempre em eventos formais; nunca descalça num casamento.
8. **Adereços com texto dizem o mesmo que a narração, e sem marcas.** Se a narração diz "a full year", o papel não pode dizer "12 Week". Nada de marcas legíveis em frigoríficos, embalagens ou roupa. Se não conseguires controlar o texto do adereço, usa um adereço sem texto.
9. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo. A viragem TEM de ter um momento visual. A subida visivelmente triunfante. Uma batida invisível é um falhanço. **A frase-chave "It was not me" tem a SUA imagem: um rosto de realização/alívio — e tem de CAIR no rosto: a frase começa logo DEPOIS de uma fronteira de 2 s (nunca 0,1 s antes dela).** A frase mais importante do vídeo merece o seu próprio momento. **O clímax fica no casamento:** as últimas fotos são o vestido, a dança, o abraço à irmã — nunca um campo genérico nem uma selfie na casa de banho. **O objeto da viragem só aparece NA viragem:** o telemóvel com o estudo não entra em nenhuma foto antes do momento em que ela o lê. **O último frame é a dança:** nenhuma foto de cobertura depois da última palavra.
10. **A persona, quando aparece, é sempre a mesma.** Foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas. Qualquer parte do corpo em frame (mão, braço) tem de ser DA PERSONA — nada de mãos anónimas.
11. **Qualidade de imagem sem exceção.** Todas as fotos nítidas, BEM ILUMINADAS, no tema. Vê cada foto em tamanho real antes de submeter e descarta qualquer uma que esteja escura demais, desfocada ou sem assunto visível. Nada de foto neutra de enchimento, nada de composições repetidas, nada de foto de stock com data visível. **E cada imagem tem de mostrar o que a frase diz, literalmente:** "same mirror" precisa de um ESPELHO no frame; o estudo precisa de uma imagem de estudo (papel, ecrã, gráfico — nunca um frigorífico); um gráfico tem de dizer alguma coisa sem a narração (rótulos legíveis, uma curva com sentido), ou não entra; nunca pés descalços em pé sobre roupa no chão.

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
- A persona quando aparece: SEMPRE a mesma (regra 10 acima) — nas DUAS versões corporais da regra 2.
- Tudo o resto pode ser: foto real de comida, objeto, lugar, balança, roupa — ou VÍDEO (b-roll) de bancos de imagem com licença (ex.: Pexels). Nunca vídeo arrancado ao acaso da internet sem licença.
- NOTA DO STACK: este build JÁ aceita VÍDEO (mp4) como mídia de segmento (PR #656 mergeada; o clip é detetado pela referência `.mp4`). **Mas NÃO há API key válida do Pexels neste momento** (as do dev dão 401) — por isso não percas tempo a tentar baixar b-roll: usa fotos nesta ronda e regista o bloqueio na análise. Quando houver chave válida, os clips entram numa ronda futura.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v12/`. Mídia real: `~/workspace/video-selfhost/media-v12/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v11 (`drive_v11.py`, `resume_v11.py`, `download_r2_v11.py` em `~/workspace/video-selfhost/`), adaptando nomes para v12. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v12.mp4`.
- A limpeza de legendas (PR #637) já foi MERGEADA e confirmada ao vivo na v11 — regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v11 (`download_r2_v11.py` em `~/workspace/video-selfhost/`, adapta para v12).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes (mede os cortes)? Cada frase tem a sua imagem, no momento certo? A diferença de corpo antes/depois é VISÍVEL sem a narração? Persona e roupa consistentes em cada fase? Algum adereço a contradizer a narração ou com marca legível? O CTA corre à velocidade certa? Há música audível? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou. Escreve a análise em `~/workspace/video-selfhost/analysis-v12.md` e reporta de volta com a nota.
