# v5 — análise (dura)

- Ficheiro: `~/workspace/video-selfhost/daily-dose-weight-regain-faceless-v5.mp4`
- 49,13 s, 1080×1920, h264 + aac, 13,6 MB. Task `295e6114-66e0-4fa8-9276-61e79ca2dde1`
  (2ª tentativa; a 1ª, task `42090dca`, morreu no restart da VM às ~01:46 UTC).
- Guião: 158 palavras, 5 takes (hook 37w + c1 28w + c2 41w + c3 27w + c4 25w).
  Transcrição (faster-whisper tiny) = guião palavra por palavra.
  Facto verificado: Sumithran et al. 2011 NEJM, só qualitativo, sem números.
- Mídia: 30 fotos (teto do engine: máx 30 — a 1ª submissão com 33 deu 422
  mascarado de 500 pelo bug conhecido do handler). 22 IA (Mara) + 8 reais Pexels.
- Custo: 0 tokens visíveis (dev local). Não publicado.

## Nota: 7,5 / 10

Melhor que v4 (6,5), abaixo do que o brief pedia. O arco emocional existe
desta vez e a viragem tem momento visual — mas texto/imagem falha em 4
pontos, o contraste de ritmo planeado não aconteceu (inverteu no c3) e a
voz continua a ser uma só, num só ritmo, do início ao fim.

## Pontos fortes

1. **Hook abre na balança (~0–2 s).** Mara em cima da balança, cara de choque,
   visor legível "79,4 kg". Legenda "Three weeks after my diet ended".
   É o melhor hook das 5 versões.
2. **Ponto baixo é baixo.** ~8 s sentada na cama, ombros caídos, luz fria;
   ~16 s quarto escuro, lençóis amarrotados. Vergonha visível, não dita.
3. **A viragem TEM momento visual (~20 s).** Mara à mesa da cozinha, luz da
   manhã, a ler o telemóvel com um quase-sorriso — exatamente sobre
   "Then one morning I read something that changed everything".
   Em v4 a viragem não tinha imagem nenhuma; aqui tem.
4. **O estudo tem imagem (~24 s).** Secretária vista de cima, portátil +
   livros abertos, mão com caneta — sobre "A study had followed people
   for a full year after their diet".
5. **Recomeço condiz (~32 s).** Mara a servir aveia com a chávena medidora —
   "Protein at breakfast" + "the measuring cup back on the counter".
6. **Fecho forte (~44–49 s).** Mara a correr no parque ao nascer do sol,
   sorriso grande, luz dourada — sobre "Three months later the jeans fit
   again, and this time I knew why it would hold" + CTA "Save this for the
   day you want to quit" sobre a mesma imagem de vitória.
7. **Persona consistente em 100% dos frames com ela.** 9 frames amostrados
   com a Mara: mesmo rosto (sardas, cabelo castanho em coque baixo, olhos
   verdes), mesma t-shirt verde-sálvia + jeans. Nenhuma segunda pessoa em
   lado nenhum; os planos de detalhe sem rosto (secretária, sapatos) não
   quebram a persona.
8. **Legendas limpas e sincronizadas.** Sem travessão em nenhum frame
   amostrado; sincronia confirmada no limite c3→c4 (legenda "Three months
   later" às 42 s, fala começa às 42,45 s). Sem "?" no guião — a regra
   "só ?" não foi testada por este guião.

## Pontos fracos (duros)

1. **Texto/imagem falha por FRASE em 4 pontos — a lição 3 não se cumpriu.**
   - ~12 s: áudio "That night I sat on the edge of the bed" sobre foto
     dela EM PÉ a segurar as jeans. A foto sentada já tinha passado no hook.
   - ~26–27 s: áudio "their hunger was still louder" sobre foto do diário
     aberto. Diário ≠ fome.
   - ~28 s: áudio "their fullness still weaker" sobre pôr-do-sol genérico
     de stock. O pôr-do-sol é imagem de alívio; cai sobre a frase da fome
     e só condiz com a frase SEGUINTE ("My body was not betraying me").
     Chega ~2 s cedo e é o único cliché de stock do vídeo.
   - ~36–40 s: áudio "and the measuring cup back on the counter" sobre
     fotos de sapatos (close-up + a apertar os ténis). A chávena medidora
     só aparece na cauda do take, já sobre a frase seguinte. Dentro do c3,
     as 3 batidas (proteína → passeio → chávena) não estão alinhadas com
     as fotos: o passeio tem 2 fotos, a chávena só 1 no fim.
   Causa estrutural: o engine divide cada take uniformemente pelas fotos;
   as batidas dentro da frase não são terços iguais. Sem alinhamento
   foto↔palavra, a lição 3 não se cumpre só com a escolha das fotos.
2. **Contraste de ritmo planeado NÃO aconteceu — inverteu no c3.**
   Medido (áudio real, não estimativa): hook ~1,51 s/foto, c1 ~1,72,
   c2 ~1,56, c3 ~1,77, c4 ~1,34. O c3 era suposto ser o mais RÁPIDO
   (~1,45) e saiu o mais LENTO: o TTS demorou 10,6 s em vez dos 8,7 s
   estimados. O c4 é o mais rápido, mas a diferença total (1,34–1,77)
   é demasiado pequena para se sentir. Contraste por tamanho de take
   não é fiável porque a velocidade do TTS varia por take.
3. **Uma voz, um ritmo, 49 s.** O problema que o user apontou na v3
   ("mesma voz, mesmo ritmo") continua intacto no áudio. O vídeo varia
   nas imagens; a voz não varia nunca.
4. **Frame ~16 s demasiado escuro.** O quarto à noite é quase preto na
   metade superior. Atmosfera certa, exposição errada — num ecrã de
   telemóvel com brilho baixo lê-se como frame vazio.
5. **Sem música audível.** O task reporta `music_mood: calm`, mas os
   intervalos entre takes têm silêncio detetado a -40 dB — não há cama
   musical audível. Voz sozinha, sem nada por baixo.

## Veredito por lição (brief v5)

1. Batida emocional VISÍVEL: quase — hook, baixo, viragem e vitória sim;
   a descoberta (fome) falha com diário + pôr-do-sol.
2. Contraste de ritmo por tamanho dos takes: NÃO — inverteu no c3.
3. Texto/imagem por FRASE: parcial — 8/12 frames condizem, 4 não.
4. Qualidade de imagem sem exceção: quase — 1 frame escuro, 1 stock cliché.
5. Persona consistente: SIM, 10/10 neste ponto.

## Problemas de entrega (não contam para a nota)

- Tentativa 1 (task `42090dca`) morreu no restart da VM 01:46 UTC, a meio
  do render (progresso 40). Stack reposto com `start-stack.py`.
- 1ª submissão da tentativa 2 com 33 fotos: 422 "At most 30 medias are
  allowed" mascarado de HTTP 500 pelo bug do `validation_exception_handler`
  (issue #638 / PR #640). Corte de 3 fotos (c2 diário v3-18, c3 frigorífico
  v3-13, c4 taça real) → 30 fotos, 7/5/7/6/5.
- O `drive_v5.py` atingiu o seu limite de 60 min de poll (task a 75%) e
  saiu; `resume_v5.py` retomou e completou. Download por endpoint deu
  401 após o arquivo (ficheiros locais apagados); download direto do R2
  dev funcionou (bucket `videos`, key em `task-v5-final.json`).

## O que falta para 10/10

1. Alinhar foto↔frase dentro do take (engine ou guião com 1 foto por
   batida da frase, não por take) — é o maior défice.
2. Ritmo que se SINTA: variar a duração real por foto (não só contar
   fotos por take) ou variar a voz/ritmo do TTS.
3. Cortar o pôr-do-sol de stock; a foto "looking-up" aliviada devia
   carregar "My body was not betraying me", não um pôr-do-sol.
4. Expor o frame escuro ou iluminar a cena da noite.
