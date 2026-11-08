// posts-calendar-i18n — copy for the /posts calendar, the /posts/history page, the month
// calendar and the refreshed post cards. Merged into `posts` in ./index.ts
// (en.ts/pt.ts are over the file-size cap and may not grow).
export const postsCalendarStrings = {
  pt: {
    posts: {
      historyTitle: 'Histórico',
      historySubtitle: 'Posts passados e gerações de vídeo de todas as contas.',
      calendarPrevMonth: 'Mês anterior',
      calendarNextMonth: 'Próximo mês',
      calendarToday: 'Hoje',
      calendarDayLabel: '{date}: {summary}',
      calendarDayEmpty: '{date}: sem posts',
      calendarTruncated: 'Este mês tem mais posts do que o limite de {count}; alguns não aparecem.',
      calendarDayHeading: 'Posts de {date}',
      calendarDayNone: 'Nenhum post neste dia.',
      groupPublished: 'Publicado',
      groupFailed: 'Falhou',
      groupScheduled: 'Agendado',
      cardFailedRetryable: 'A geração falhou por um problema temporário. Abra o post para tentar de novo.',
      cardFailedPermanent: 'O post falhou. Abra o post para ver os detalhes.',
    },
  },
  en: {
    posts: {
      historyTitle: 'History',
      historySubtitle: 'Past posts and video generations from all accounts.',
      calendarPrevMonth: 'Previous month',
      calendarNextMonth: 'Next month',
      calendarToday: 'Today',
      calendarDayLabel: '{date}: {summary}',
      calendarDayEmpty: '{date}: no posts',
      calendarTruncated: 'This month has more posts than the {count} limit; some are not shown.',
      calendarDayHeading: 'Posts on {date}',
      calendarDayNone: 'No posts on this day.',
      groupPublished: 'Published',
      groupFailed: 'Failed',
      groupScheduled: 'Scheduled',
      cardFailedRetryable: 'Generation failed because of a temporary problem. Open the post to try again.',
      cardFailedPermanent: 'The post failed. Open the post for details.',
    },
  },
} as const;
