# NOTAS-v11 — vídeo faceless v11 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v10 (corrige TUDO isto — sem números, só os factos)

- A frase-chave "It was not me" continua sem a sua imagem: o rosto de realização EXISTE (34–36 s), mas as palavras caem 0,02 s no rosto e 0,9 s sobre a foto de apertar os ténis. O momento existe agora, mas falha por ~1 s. Causa medida: a frase começa 0,1 s antes de uma fronteira de 2 s (35,90 s), por isso nenhum slot de 2 s a consegue segurar com o rosto.
- "Eggs for breakfast" sobre a foto da água: a foto dos ovos corre 38–40 s e nunca se cruza com a palavra (dita aos 40,32 s). A foto da água+café cobre os ovos e depois a água. Causa: o ritmo por take varia sem lei (118–242 palavras por minuto) — a estimativa a 190 wpm não serve para dimensionar fotos.
- O fim sai do casamento: "and this time I knew why it would hold" cai sobre uma foto genérica dela sozinha num campo ao pôr-do-sol, e o CTA corre sobre o campo e depois uma selfie na casa de banho. Nenhuma das duas imagens mostra "guardar" nada nem fecha o payoff do vestido. O clímax tem de ficar no casamento, com o vestido.
- O CTA continua a ser o take mais rápido (12 palavras em 2,48 s). Dobrar o CTA de 6 para 12 palavras não resolveu — é uma propriedade do TTS no take final. Não tentes um CTA mais longo outra vez; mantém 12 palavras e foca no resto.
- Três imagens chegam ~1,5 s adiantadas (caderno, dança).
- Ritmo: 28 das 29 fotos duram exatamente 2,0 s (82% do vídeo). A estrutura muda QUAL foto, nunca QUANDO — só o engine muda isto (PR #652, ainda não neste build). Não tentes corrigir o ritmo por contagem de fotos; aceita o teto e foca no resto.
- Música: os intervalos entre frases são só 0,4–0,6 s e a cama sonora é demasiado ténue para se perceber como música. Não persigas isto nesta ronda — o `music_mood` está posto, a mistura é do engine.
- NOTA: os "4 flashes em branco" que a análise da v10 reportou NÃO EXISTEM no vídeo — foram um artefacto da primeira extração de frames, verificado 3 vezes por vias independentes. Não tentes corrigir flashes que não estão lá.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## O desenho desta versão (o coração — lê com atenção)

**O mapeamento texto/imagem vive na ESTRUTURA DO GUIÃO, não num procedimento.** Não escrevas lista de planos, não faças verificação depois — o guião É o mapeamento:

1. **Cada segmento é UMA batida: uma frase, ou uma parte de uma lista.** "Eggs for breakfast" é um segmento; "water before coffee" é outro; "a walk after dinner" é outro. Uma frase com duas ideias separadas por vírgula divide-se em dois segmentos. NUNCA fundas duas ideias num só segmento. As fotos de um segmento mostram SÓ o que esse segmento diz — nunca a frase seguinte, nunca o tema geral.
2. **O corpo muda de verdade: dois estados corporais, mesma pessoa.** A história é sobre engordar de novo — a diferença antes/depois tem de ser VISÍVEL NO CORPO, não só na balança ou no fecho. Gera DUAS versões da persona a partir da mesma foto-base: a versão MAGRA (o antes — o vestido fecha, o corpo do fim da dieta) e a versão MAIS PESADA (o depois — o vestido não fecha, o corpo do peso recuperado). Mesma cara, mesmo cabelo, mesmo estilo de roupa — só o corpo muda, de forma visível. Usa a versão magra nas cenas do antes e do recomeço final, e a versão mais pesada nas cenas do vestido que não fecha, da balança e do ponto baixo. **Regra de reutilização: NUNCA reutilizes uma foto de uma versão anterior sem a veres em tamanho real e confirmares o estado do corpo — se um corpo é visível na foto, ele tem de corresponder à fase em que a foto vai entrar.** Se as duas versões não ficarem claramente diferentes no corpo, refaz — a diferença tem de se ver sem a narração.
3. **Fotos por segmento = (segundos de áudio MEDIDOS + pausas) ÷ 2.** O motor põe as fotos numa fila de 2 s ancorada no início, por isso o número de fotos de cada segmento tem de cobrir os seus segundos de áudio MAIS ~0,7 s por cada fronteira de take. **Não uses 190 palavras por minuto para estimar — o ritmo por take varia sem lei (118–242 wpm).** Depois de gerares o áudio (ou na primeira submissão falhada), mede os segundos reais de cada take com os timestamps e recalcula as fotos a partir daí. Escreve o número de fotos ao lado de cada segmento ANTES de gerar, e confere a soma no fim.
4. **O CTA tem 12 palavras e não se mexe mais.** O disparo é uma propriedade do TTS no take final — dobrar de 6 para 12 palavras não resolveu. Mantém 12 palavras, distribuídas por 2 fotos. Não dividas o CTA à espera de pausa (o motor junta takes sem intervalo) e não tentes um CTA mais longo outra vez.
5. **O hook é UM segmento só** (25–40 palavras), com as suas fotos a mostrar o hook como um todo — mas com as fotos contadas pela regra 3, nunca a menos.
6. **Ritmo pela estrutura:** frases curtas = takes curtos; frases longas = takes longos. Varia o tamanho das frases de propósito. Não tentes controlar o ritmo por contagem de fotos além da regra 3.
7. **A roupa é sempre a mesma dentro de cada fase.** Se a persona veste um vestido numa cena, é o MESMO vestido — mesmo decote, mesmas mangas — em todos os frames dessa cena. Sapatos sempre em eventos formais; nunca descalça num casamento.
8. **Adereços com texto dizem o mesmo que a narração, e sem marcas.** Se a narração diz "a full year", o papel não pode dizer "12 Week". Nada de marcas legíveis em frigoríficos, embalagens ou roupa. Se não conseguires controlar o texto do adereço, usa um adereço sem texto.
9. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo. A viragem TEM de ter um momento visual. A subida visivelmente triunfante. Uma batida invisível é um falhanço. **A frase-chave "It was not me" tem a SUA imagem: um rosto de realização/alívio — não o caderno, não os sapatos, não uma imagem tematicamente adjacente. E tem de CAIR no rosto: desloca o guião para a frase começar logo DEPOIS de uma fronteira de 2 s (nunca 0,1 s antes dela), para um slot inteiro de 2 s segurar a frase com o rosto.** A frase mais importante do vídeo merece o seu próprio momento. **O clímax fica no casamento:** as últimas fotos são o vestido, a dança, o abraço à irmã — nunca um campo genérico nem uma selfie na casa de banho.
10. **A persona, quando aparece, é sempre a mesma.** Foto-base original em `~/workspace/video-selfhost/images-v2/`, edições sempre a partir da original, nunca encadeadas. Qualquer parte do corpo em frame (mão, braço) tem de ser DA PERSONA — nada de mãos anónimas.
11. **Qualidade de imagem sem exceção.** Todas as fotos nítidas, BEM ILUMINADAS, no tema. Vê cada foto em tamanho real antes de submeter e descarta qualquer uma que esteja escura demais, desfocada ou sem assunto visível. Nada de foto neutra de enchimento, nada de composições repetidas, nada de foto de stock com data visível. **E cada imagem tem de mostrar o que a frase diz, literalmente:** "same mirror" precisa de um ESPELHO no frame; o estudo precisa de uma imagem de estudo (papel, ecrã, gráfico — nunca um frigorífico); nunca pés descalços em pé sobre roupa no chão.

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
- NOTA DO STACK: neste build o engine só aceita FOTOS como mídia de segmento (o suporte a vídeo existe numa PR aberta, ainda não neste build). Se trouxeres b-roll, guarda-o em `~/workspace/video-selfhost/media-v11/` com `sources-v11.json` (fonte + licença de cada ficheiro) e USA-O SÓ onde o engine o aceitar — se o engine recusar vídeo, usa fotos e regista o bloqueio na análise. Não percas tempo a lutar com o engine.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v11/`. Mídia real: `~/workspace/video-selfhost/media-v11/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v10 (`drive_v10.py`, `resume_v10.py`, `download_r2_v10.py` em `~/workspace/video-selfhost/`), adaptando nomes para v11. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v11.mp4`.
- A limpeza de legendas (PR #637) já foi MERGEADA e confirmada ao vivo na v10 — regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v10 (`download_r2_v10.py` em `~/workspace/video-selfhost/`, adapta para v11).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes (mede os cortes)? Cada frase tem a sua imagem, no momento certo? A diferença de corpo antes/depois é VISÍVEL sem a narração? Persona e roupa consistentes em cada fase? Algum adereço a contradizer a narração ou com marca legível? O CTA corre à velocidade certa? Há música audível? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou. Escreve a análise em `~/workspace/video-selfhost/analysis-v11.md` e reporta de volta com a nota.
