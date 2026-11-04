// apiKeys tool descriptions for the segments-script video tools and the
// recipe self-serve pair (list_prompts/get_prompt). Split out of pt.ts,
// which is over the file-size cap and may not grow.
export const segmentMediaToolDescPt = {
  toolDescGeneratePersonaVideo: 'Gerar e agendar um vídeo de persona a partir de um roteiro',
  toolDescValidateScript: 'Validar um roteiro mecanicamente, sem gastar tokens',
  toolDescScoreDraft: 'Pontuar um rascunho mecanicamente contra seus próprios posts medidos',
  toolDescUploadMedia: 'Enviar uma imagem de segmento (JPG, PNG, WebP, máx. 8MB)',
  toolDescCheckMedia: 'Verificar uma URL de imagem de segmento mecanicamente',
  toolDescListPrompts: 'Listar as receitas de prompt deste servidor',
  toolDescGetPrompt: 'Buscar uma receita de prompt pelo slug',
} as const;
