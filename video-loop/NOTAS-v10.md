# NOTAS-v10 — vídeo faceless v10 (Inspirador)

Trabalha APENAS a partir deste ficheiro. Ignora qualquer outro contexto que tenhas herdado — estas notas são a tua única fonte de verdade e o teu único briefing.

## O que é

Vídeo faceless COMPLETO, tema "why you regain weight after a diet", marca HabitLoom / Daily Dose, inglês, 9:16, sem persona visível a falar (sem lip sync), sem publicar, sem agendar, sem custo visível (self-host local, secrets dev).

## O que falhou na v9 (corrige TUDO isto — sem números, só os factos)

- O corpo vaza em dois pontos: a abertura mostra-a MAGRA no espelho (0–2 s) e depois ela fica visivelmente mais pesada no plano do fecho (4–6 s) — mesma cena, corpo muda em 2 segundos. E aos ~36 s a foto de apertar o ténis mostra-a visivelmente MAIS MAGRA do que o caderno aos 32–34 s — magra a meio da fase pesada. Causa: 4 fotos REUTILIZADAS de versões anteriores sem verificar o estado do corpo. A linha do corpo tem de ser: pesada do início ao fim do ponto baixo, magra só no recomeço final.
- O CTA dispara: 6 palavras em ~1 s, quase 3× mais rápido que a narração. O disparo é uma propriedade do TTS em takes curtos, não um artefacto da divisão.
- Ritmo: 27 das 28 fotos duram exatamente 2,0 s (81% do vídeo). A estrutura muda QUAL foto, nunca QUANDO — só o engine muda isto (PR #652, ainda não neste build). Não tentes corrigir o ritmo por contagem de fotos além da regra 3; aceita o teto e foca no resto.
- O desvio continua: as pausas reais entre takes são em média 0,68 s, não 0,25 s — o total de ~7 s de pausas não contadas faz 3 imagens chegarem ~1,5–3 s adiantadas (caderno, ovos, dança).
- A frase-chave "It was not me" continua sem imagem própria: cai sobre o close-up de escrever no caderno — tematicamente adjacente, mas não há um rosto de realização/alívio para a frase mais importante do vídeo.
- Três imagens fracas: close-up da manga para "same mirror" (não há espelho nenhum); pés descalços em pé SOBRE o vestido amarrotado no chão (imagem estranha, confusa); frigorífico cheio para o estudo (evoca fome vagamente, não mostra um estudo; é a imagem mais fraca, genérica de stock).
- A 28ª foto corre 0,37 s e não carrega palavras — uma foto de cobertura para o check de fail-fast, não uma foto de história. Não submetas fotos de enchimento para passar o check; dimensiona as fotos de história para cobrir o áudio.

## Arquétipo: INSPIRADOR (superação)

- Sensação: da vergonha/derrota à reviravolta — "eu achei que tinha falhado, e depois percebi que podia recomeçar e consegui".
- Arco obrigatório com contraste: ponto baixo → viragem → subida. Cada take tem de SENTIR-SE diferente do anterior.

## O desenho desta versão (o coração — lê com atenção)

**O mapeamento texto/imagem vive na ESTRUTURA DO GUIÃO, não num procedimento.** Não escrevas lista de planos, não faças verificação depois — o guião É o mapeamento:

1. **Cada segmento é UMA batida: uma frase, ou uma parte de uma lista.** "Eggs for breakfast" é um segmento; "water before coffee" é outro; "a walk after dinner" é outro. Uma frase com duas ideias separadas por vírgula divide-se em dois segmentos. NUNCA fundas duas ideias num só segmento. As fotos de um segmento mostram SÓ o que esse segmento diz — nunca a frase seguinte, nunca o tema geral.
2. **O corpo muda de verdade: dois estados corporais, mesma pessoa.** A história é sobre engordar de novo — a diferença antes/depois tem de ser VISÍVEL NO CORPO, não só na balança ou no fecho. Gera DUAS versões da persona a partir da mesma foto-base: a versão MAGRA (o antes — o vestido fecha, o corpo do fim da dieta) e a versão MAIS PESADA (o depois — o vestido não fecha, o corpo do peso recuperado). Mesma cara, mesmo cabelo, mesmo estilo de roupa — só o corpo muda, de forma visível. Usa a versão magra nas cenas do antes e do recomeço final, e a versão mais pesada nas cenas do vestido que não fecha, da balança e do ponto baixo. **Regra de reutilização: NUNCA reutilizes uma foto de uma versão anterior sem a veres em tamanho real e confirmares o estado do corpo — se um corpo é visível na foto, ele tem de corresponder à fase em que a foto vai entrar.** Se as duas versões não ficarem claramente diferentes no corpo, refaz — a diferença tem de se ver sem a narração.
3. **Fotos por segmento = (segundos de áudio + pausas) ÷ 2.** O motor põe as fotos numa fila de 2 s ancorada no início, por isso o número de fotos de cada segmento tem de cobrir os seus segundos de áudio MAIS ~0,7 s por cada fronteira de take — as pausas reais entre takes são em média 0,68 s, e contá-las a 0,25 s deixou ~7 s de défice que desalinhou tudo. Conta as palavras do segmento e estima: a ~190 palavras por minuto, fotos ≈ (palavras ÷ 6,3) + 0,35 por fronteira (arredonda para cima), sempre dentro do piso de densidade do engine. Escreve o número de fotos ao lado de cada segmento ANTES de gerar, e confere a soma no fim.
4. **O CTA é longo, nunca curto.** O disparo é uma propriedade do TTS em takes curtos — um CTA de 6 palavras corre a ~3× a velocidade da narração. Escreve o CTA com 10–12 palavras, distribuídas por 2 fotos, para a velocidade ficar perto da narração. Não dividas o CTA à espera de pausa (o motor junta takes sem intervalo) e nunca deixes a frase final correr ao dobro da velocidade do hook.
5. **O hook é UM segmento só** (25–40 palavras), com as suas fotos a mostrar o hook como um todo — mas com as fotos contadas pela regra 3, nunca a menos.
6. **Ritmo pela estrutura:** frases curtas = takes curtos; frases longas = takes longos. Varia o tamanho das frases de propósito. Não tentes controlar o ritmo por contagem de fotos além da regra 3.
7. **A roupa é sempre a mesma dentro de cada fase.** Se a persona veste um vestido numa cena, é o MESMO vestido — mesmo decote, mesmas mangas — em todos os frames dessa cena. Sapatos sempre em eventos formais; nunca descalça num casamento.
8. **Adereços com texto dizem o mesmo que a narração, e sem marcas.** Se a narração diz "a full year", o papel não pode dizer "12 Week". Nada de marcas legíveis em frigoríficos, embalagens ou roupa. Se não conseguires controlar o texto do adereço, usa um adereço sem texto.
9. **Cada batida emocional tem de ser VISÍVEL na imagem.** Ponto baixo visivelmente baixo. A viragem TEM de ter um momento visual. A subida visivelmente triunfante. Uma batida invisível é um falhanço. **A frase-chave "It was not me" tem a SUA imagem: um rosto de realização/alívio — não o caderno, não os sapatos, não uma imagem tematicamente adjacente.** A frase mais importante do vídeo merece o seu próprio momento.
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
- NOTA DO STACK: neste build o engine só aceita FOTOS como mídia de segmento (o suporte a vídeo existe numa PR aberta, ainda não neste build). Se trouxeres b-roll, guarda-o em `~/workspace/video-selfhost/media-v10/` com `sources-v10.json` (fonte + licença de cada ficheiro) e USA-O SÓ onde o engine o aceitar — se o engine recusar vídeo, usa fotos e regista o bloqueio na análise. Não percas tempo a lutar com o engine.
- Fotos novas de IA: `~/workspace/video-selfhost/images-v10/`. Mídia real: `~/workspace/video-selfhost/media-v10/`.

## Stack local (reutilizar)

- Engine :8080 + TTS :4123 (ver `start-stack.py` em `~/workspace/video-selfhost/`; arranca com secrets dev se estiver em baixo; nunca `secrets/prod`, nunca prod).
- Reutiliza os drivers da v9 (`drive_v9.py`, `resume_v9.py`, `download_r2_v9.py` em `~/workspace/video-selfhost/`), adaptando nomes para v10. Caminho `POST /api/v1/temp_assets` + `mediaId` nos segmentos (URLs externas diretas são bloqueadas pelo guard SSRF).
- Voz TTS local: `chatterbox:phonon_everly`.
- Vídeo final: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v10.mp4`.
- A limpeza de legendas (PR #637) já foi MERGEADA e confirmada ao vivo na v9 — regista se aparecer travessão/vírgula/ponto na análise.
- O download via endpoint pode dar 404 após restart (ficheiros apagados após arquivar no R2 dev) — se acontecer, usa fetch direto ao R2 como na v9 (`download_r2_v9.py` em `~/workspace/video-selfhost/`, adapta para v10).

## Análise final (rigorosa)

Depois de gerar: vê 10 frames (a cada ~4s) + transcrição. Avalia com rigor: a emoção passa? O ponto baixo é baixo? A viragem tem momento visual? O ritmo varia entre takes (mede os cortes)? Cada frase tem a sua imagem, no momento certo? A diferença de corpo antes/depois é VISÍVEL sem a narração? Persona e roupa consistentes em cada fase? Algum adereço a contradizer a narração ou com marca legível? O CTA corre à velocidade certa? Há música audível? Dá uma nota 0–10 com pontos fortes e fracos com timestamps. Sê duro — as notas anteriores foram generosas demais e o utilizador discordou. Escreve a análise em `~/workspace/video-selfhost/analysis-v10.md` e reporta de volta com a nota.
