// metrics-coverage-i18n — copy for the metrics coverage section (issue
// #525): published videos with no snapshot for the selected window, and
// why. Merged into `metrics` in ./index.ts (metrics-i18n.ts is over the
// file-size cap and may not grow).
export const metricsCoverageStrings = {
  en: {
    metrics: {
      asOf: 'Snapshots collected as of {date}',
      coverageTitle: 'Missing snapshots',
      coverageSummary: '{count} videos without a snapshot for {window}',
      coverageWaitingTitle: 'Waiting for their window',
      coverageAttentionTitle: 'Needs attention',
      coverageReasonPending: 'Window not open yet',
      coverageReasonRetrying: 'Collecting — will retry',
      coverageReasonMissed: 'Window closed — not collected',
      coverageReasonNoTarget: 'Collector never saw this video',
      coverageReasonPublishFailed: 'Publish failed',
      coverageWindow: 'Window {opens} – {closes}',
      coverageYoutubeHint: 'YouTube snapshots need the Analytics API — check the connection on Accounts.',
      coveragePublishFailedHint: 'The video may still be live: a timeout can fail the publish after the upload succeeds.',
    },
  },
  pt: {
    metrics: {
      asOf: 'Snapshots coletados até {date}',
      coverageTitle: 'Snapshots em falta',
      coverageSummary: '{count} vídeos sem snapshot para {window}',
      coverageWaitingTitle: 'Aguardando a janela',
      coverageAttentionTitle: 'Precisa de atenção',
      coverageReasonPending: 'Janela ainda não abriu',
      coverageReasonRetrying: 'Coletando — vai tentar de novo',
      coverageReasonMissed: 'Janela fechou — não coletado',
      coverageReasonNoTarget: 'O coletor nunca viu este vídeo',
      coverageReasonPublishFailed: 'Publicação falhou',
      coverageWindow: 'Janela {opens} – {closes}',
      coverageYoutubeHint: 'Os snapshots do YouTube precisam da API Analytics — confira a conexão em Contas.',
      coveragePublishFailedHint: 'O vídeo pode estar no ar mesmo assim: um timeout pode falhar a publicação depois do upload.',
    },
  },
};
