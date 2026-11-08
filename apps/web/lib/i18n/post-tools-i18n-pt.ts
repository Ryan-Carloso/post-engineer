// apiKeys tool descriptions for the post/slot/generation MCP tools.
// Split out of pt.ts, which is over the file-size cap and may not grow.
export const postToolDescPt = {
  toolDescGetSlot: 'Ver o detalhe de um post agendado',
  toolDescUpdateSlotTitle: 'Editar o título de um post agendado',
  toolDescDeleteSlot: 'Deletar um slot de post agendado',
  toolDescListVideoGenerations: 'Listar histórico de gerações de vídeo',
  toolDescGetVideoGeneration: 'Ver o detalhe de uma geração de vídeo',
  toolDescGetPost: 'Ver o detalhe de um post (slot ou geração)',
  toolDescGetPostMetrics: 'Ver métricas de desempenho por vídeo',
  toolDescGetYouTubeRetentionCurve: 'Ver a curva de retenção de um vídeo seu do YouTube',
  toolDescCancelVideoTask: 'Cancelar/remover uma das suas tarefas de vídeo',
  toolDescCreateExperiment: 'Criar um teste A/B de dois estilos de hook',
  toolDescListExperiments: 'Listar os seus testes A/B',
  toolDescAddExperimentPair: 'Criar os dois vídeos de um par do teste A/B',
  toolDescGetExperimentResults: 'Comparar as duas variantes de um teste A/B',
} as const;
