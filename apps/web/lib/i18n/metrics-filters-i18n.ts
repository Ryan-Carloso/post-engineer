//---------------
// metrics-filters-i18n — copy for the shadcn filter toolbar on the
// metrics dashboard (window Tabs caption, Filters Sheet, active-filter
// chips). Merged into `metrics` in ./index.ts
// (metrics-i18n.ts is over the file-size cap and may not grow).
//---------------

export const metricsFiltersStrings = {
  en: {
    metrics: {
      windowCaption: 'Video age at snapshot — not activity in the last 24 hours.',
      filtersButton: 'Filters',
      filtersTitle: 'Filters',
      filtersDescription: 'Narrow the videos below by persona and network.',
      filtersApply: 'Apply filters',
      filtersSearchPersona: 'Search personas…',
      filtersNoResults: 'No results found',
      filtersActive: '{count} filters active',
      filtersRemoveFilter: 'Remove {label}',
    },
  },
  pt: {
    metrics: {
      windowCaption: 'Idade do vídeo no snapshot — não é o que rolou nas últimas 24h.',
      filtersButton: 'Filtros',
      filtersTitle: 'Filtros',
      filtersDescription: 'Filtre os vídeos abaixo por persona e rede.',
      filtersApply: 'Aplicar filtros',
      filtersSearchPersona: 'Buscar personas…',
      filtersNoResults: 'Nenhum resultado',
      filtersActive: '{count} filtros ativos',
      filtersRemoveFilter: 'Remover {label}',
    },
  },
};
