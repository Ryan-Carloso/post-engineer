# v4 — Análise (Inspirador, mídia mista)

**Ficheiro:** `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v4.mp4`
**Verificado:** 39,53 s · 1080×1920 · h264 + aac · 11.026.264 bytes
**Task:** `a5834ae0-04b6-4794-aa34-f0092b66af79` (state 1, done, progress 100)
**Custo visível:** nenhum (self-host local, secrets dev). Não publicado.
**Método:** 10 frames (1 a cada 4 s) + transcrição faster-whisper (tiny, EN) do áudio.
Transcrição fiel ao guião (Whisper ouviu "quit" como "put" no fecho e "measuring cup"
como "measuring cut" — artefactos de ASR, verificar de ouvido).

## Nota: 6,5 / 10 (dura, de propósito)

Melhor que a v3, mas a queixa central do user — monotonia, nenhuma sensação passou —
só está parcialmente resolvida. O arco EXISTE no guião; no vídeo, o contraste
emocional é modesto e o ritmo é o mesmo de sempre.

## Pontos fortes

1. **Mara consistente em todos os frames em que aparece** (f-01, f-05, f-06, f-07,
   f-09, f-10): mesma mulher, cabelo castanho em coque baixo, sardas, t-shirt
   verde-sálvia, jeans. Zero troca de persona.
2. **Mídia mista quebra a monotonia visual da v3.** Fotos reais (pés na balança,
   ovos, sapatos de corrida, prato) têm textura diferente das fotos IA — vê-se
   a diferença a olho nu. A v3 era 100% IA e parecia um slideshow; a v4 não.
3. **O fecho funciona.** f-10 (~36 s): Mara sorri, mão na anca, confiante,
   "Save this for the day" — a subida aterra no último frame. É o frame mais
   forte do vídeo.
4. **Nit da v3 corrigido:** só há UMA foto de balança e o visor mostra ~80 —
   não há dois números contraditórios na mesma manhã (v3: 79,4 → 67,4 kg).
5. **Legendas sem travessão.** O SRT da tentativa 1 tem 0 ocorrências de —/–
   (o guião não tinha; PR #637 ainda não está no engine, mas aqui não fez falta).
6. **Factos pesquisados, não inventados:** "study followed people for a full
   year… hunger still louder, fullness signal still weaker" = Sumithran et al.
   2011, NEJM (leptina −35,5% ao fim de 1 ano, grelina elevada) — só a forma
   qualitativa, sem números inventados.

## Pontos fracos (o que importa)

1. **O ponto baixo não é baixo (~0–10 s).** f-01: Mara preocupada ao espelho,
   f-02: pés na balança, f-03: jeans. Preocupação, não derrota — sem ombros
   caídos, sem lágrimas, sem vergonha visível. O guião diz "I felt like I had
   failed"; a imagem diz "estou preocupada". A vergonha não passa.
2. **A viragem não tem momento visual (~11–16 s).** A foto do telefone/pesquisa
   (o "descobri que não foi culpa minha") passa entre as amostras; aos ~12 s
   o ecrã mostra OVOS FRITOS enquanto a narração diz "A study followed people
   for a full year". O beat mais importante do arco é invisível.
3. **Ritmo: o contraste planeado NÃO aconteceu.** Hook 6 fotos / ~11,6 s,
   conteúdo1 7 / ~13,2 s, conteúdo2 8 / ~14,8 s → **~1,9 s por foto em todo o
   vídeo**. O engine divide as fotos uniformemente por segmento e o teto de 2 s
   achata tudo. "Lento e pesado no hook, cortes rápidos na subida" era o plano;
   o vídeo é um metrónomo de 1,9 s do início ao fim — igual à v3, só mais longo
   (39,5 s vs 34,9 s).
4. **Texto/imagem condiz só ~5/10 nos frames amostrados.**
   - ~12 s: ovos fritos sobre "A study followed people for a full year" ✗
   - ~28 s: sapatos de corrida sobre "the measuring cup back" ✗
   - ~32 s: prato de comida (vista de cima) sobre "jeans fit again" ✗
   - ~0 s: espelho/jeans sobre "scale in my kitchen" (a balança só aparece ~4 s)
   As fotos ilustram o segmento em geral, não a frase no ecrã — limitação do
   engine (painéis divididos por duração, não por frase), mas mostra.
5. **Meio dominado pela cozinha.** 5 dos 10 frames amostrados são cozinha/comida
   (f-04 a f-07 + f-09) — ~16 s de tons quentes iguais no meio do vídeo.
   A mídia mista ajuda na textura, não na variedade de cenário.
6. **Uma só voz, um só ritmo.** O TTS é calmo e igual do início ao fim; a frase
   da viragem ("Then that week I learned it was not willpower") não tem pausa
   nem mudança de tom. O user já tinha apontado isto na v3 — continua igual.
7. **As duas fotos mais dinâmicas caem entre amostras:** a foto da corrida
   (energia da subida) e a do telefone (descoberta) são fáceis de perder.

## O que mudaria para a v5

- **Ponto baixo mais baixo:** foto de Mara sentada, ombros caídos, luz fria —
  contraste de luz quente/fria entre baixo e subida.
- **Viragem visível:** manter a foto do telefone/pesquisa ≥ 2 s e pô-la a abrir
  o take 2, não no meio; ou foto de Mara a ler com expressão de alívio.
- **Ritmo:** o engine não permite variar o ritmo por segmento (teto de 2 s +
  divisão uniforme). Ou se aceita o metrónomo, ou se pede mudança de produto
  (duração por foto variável / painéis alinhados por frase).
- **Texto/imagem:** alinhar as fotos às FRASES, não ao segmento — ou aceitar
  que o mismatch é estrutural e escrever frases genéricas o suficiente para
  qualquer foto do segmento.
- **Voz:** variar a entrega (pausa antes da viragem, ritmo mais rápido na
  subida) — hoje o TTS local não faz isto; é outra limitação do stack.

## Limitações do stack (reportar, não contornar em silêncio)

- **Mídia de segmento é só FOTOS** (verificado em `app/services/user_media.py`:
  `_validate_photo` via PIL, `not_image` em vídeo). B-roll de vídeo não entra
  como mídia de segmento neste build — precisa de mudança de produto.
- **O endpoint de download dá 404 após restart do engine** (ficheiros da task
  apagados após arquivar no R2 dev). O vídeo foi recuperado por fetch DIRETO
  ao R2 (`download_r2_v4.py`, boto3, bucket `videos`, resume por Range) —
  caminho a reutilizar em v5.
- **4 restarts do runtime durante a v4** (VM reboot ~23:48); o engine perdeu a
  task em memória 2 vezes; o manifesto (`manifest-v4.json`) sobreviveu e o
  re-drive funcionou.
