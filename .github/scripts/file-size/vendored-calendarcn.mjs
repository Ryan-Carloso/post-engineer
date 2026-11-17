//---------------
// Vendored CalendarCN files — third-party code copied into the repo by the
// shadcn CLI registry from vmnog/calendarcn (MIT), pinned at upstream
// commit 6e15924d (2026-11-17). The gates below treat these files as
// third-party, not as code we wrote:
// - the file-size ratchet exempts them (file-size/check.mjs): their line
//   counts are upstream’s, not ours — splitting them would fork the lib;
// - Stryker never mutates them (ui-gates/changed-ranges.mjs): no test in
//   this repo targets lib internals, so mutating them can only produce
//   survivors and timeouts;
// - the UI coverage gates skip them (ui-gates/ui-files.mjs): their
//   coverage is upstream’s, not ours.
// - Codecov ignores them (codecov.yml coverage.ignore): their lines
//   would fail the patch gate with zero coverage, since no test in this
//   repo targets lib internals. The ignore list is pinned to this module
//   by vendored-calendarcn.test.mjs.
// Our own files in the same directories (posts/calendar-provider.tsx,
// calendar-adapter.ts, page.tsx, the posts i18n module) are NOT on this
// list and stay gated.
//---------------

export const VENDORED_CALENDARCN_COMMIT = '6e15924d';

/** Repo-relative paths of every file vendored from CalendarCN. */
export const VENDORED_CALENDARCN_FILES = new Set([
  'apps/web/components/agenda-view.tsx',
  'apps/web/components/availability-layer.tsx',
  'apps/web/components/calendar-day-headers.tsx',
  'apps/web/components/calendar-event-item.tsx',
  'apps/web/components/calendar-header.tsx',
  'apps/web/components/calendar-loading-bar.tsx',
  'apps/web/components/calendar-people.tsx',
  'apps/web/components/calendar-popover-context.tsx',
  'apps/web/components/calendar-provider.tsx',
  'apps/web/components/calendar-toaster.tsx',
  'apps/web/components/calendar-types.ts',
  'apps/web/components/calendar.tsx',
  'apps/web/components/day-view.tsx',
  'apps/web/components/event-context-menu.tsx',
  'apps/web/components/event-detail-ai-notes.tsx',
  'apps/web/components/event-detail-availability.tsx',
  'apps/web/components/event-detail-calendar.tsx',
  'apps/web/components/event-detail-conferencing.tsx',
  'apps/web/components/event-detail-date-field.tsx',
  'apps/web/components/event-detail-description.tsx',
  'apps/web/components/event-detail-field-popover.tsx',
  'apps/web/components/event-detail-links.tsx',
  'apps/web/components/event-detail-location.tsx',
  'apps/web/components/event-detail-panel.tsx',
  'apps/web/components/event-detail-participants.tsx',
  'apps/web/components/event-detail-parts.tsx',
  'apps/web/components/event-detail-popover.tsx',
  'apps/web/components/event-detail-recurrence.tsx',
  'apps/web/components/event-detail-reminders.tsx',
  'apps/web/components/event-detail-suggestions.tsx',
  'apps/web/components/event-detail-time-field.tsx',
  'apps/web/components/event-detail-time.tsx',
  'apps/web/components/event-detail-timezone.tsx',
  'apps/web/components/event-series-scope-dialog.tsx',
  'apps/web/components/event-title-focus-context.tsx',
  'apps/web/components/month-view-day-cell.tsx',
  'apps/web/components/month-view-event-bar.tsx',
  'apps/web/components/month-view-event-item.tsx',
  'apps/web/components/month-view-grid.tsx',
  'apps/web/components/month-view.tsx',
  'apps/web/components/scheduling-provider.tsx',
  'apps/web/components/time-grid.tsx',
  'apps/web/components/time-zone-axis-label.tsx',
  'apps/web/components/time-zone-list.tsx',
  'apps/web/components/ui/avatar.tsx',
  'apps/web/components/ui/dropdown-menu.tsx',
  'apps/web/components/ui/kbd.tsx',
  'apps/web/components/ui/separator.tsx',
  'apps/web/components/ui/switch.tsx',
  'apps/web/components/ui/tooltip.tsx',
  'apps/web/components/view-dropdown.tsx',
  'apps/web/components/week-view-all-day-row.tsx',
  'apps/web/components/week-view-grid.tsx',
  'apps/web/components/week-view-people.tsx',
  'apps/web/components/week-view-time-axis.tsx',
  'apps/web/components/week-view-time-indicator.tsx',
  'apps/web/components/week-view-types.ts',
  'apps/web/components/week-view.tsx',
  'apps/web/components/year-view.tsx',
  'apps/web/hooks/use-all-day-resize.ts',
  'apps/web/hooks/use-calendar-shortcuts.ts',
  'apps/web/hooks/use-controllable-state.ts',
  'apps/web/hooks/use-event-drag.ts',
  'apps/web/hooks/use-event-keyboard.ts',
  'apps/web/hooks/use-event-resize.ts',
  'apps/web/hooks/use-field-popover.ts',
  'apps/web/hooks/use-horizontal-scroll.ts',
  'apps/web/hooks/use-hover-tooltip.ts',
  'apps/web/hooks/use-inline-edit.ts',
  'apps/web/hooks/use-media-query.ts',
  'apps/web/hooks/use-month-event-drag.ts',
  'apps/web/hooks/use-month-event-resize.ts',
  'apps/web/hooks/use-now.ts',
  'apps/web/hooks/use-pointer-gesture.ts',
  'apps/web/hooks/use-popover-dismiss.ts',
  'apps/web/hooks/use-timezone-label.ts',
  'apps/web/hooks/use-vertical-scroll.ts',
  'apps/web/lib/availability.ts',
  'apps/web/lib/event-history.ts',
  'apps/web/lib/event-selection.ts',
  'apps/web/lib/event-utils.ts',
  'apps/web/lib/free-busy.ts',
  'apps/web/lib/keyboard-shortcuts.ts',
  'apps/web/lib/people.ts',
  'apps/web/lib/recurrence.ts',
  'apps/web/lib/time-input.ts',
  'apps/web/lib/time-zones.ts',
  'apps/web/lib/timezone-label.ts',
]);

/** True for a repo-relative path vendored from CalendarCN. */
export function isVendoredCalendarCN(repoPath) {
  return VENDORED_CALENDARCN_FILES.has(repoPath);
}
