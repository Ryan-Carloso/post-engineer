import type { A11yIssue, FocusDelta } from './a11y.js';
import type { Box } from './image.js';
import type { AggregatedFinding } from './tokens.js';

export type CaptureStatus = 'changed' | 'unchanged' | 'added' | 'removed' | 'error';

export interface RouteRef {
  path: string;
  name: string;
  slug: string;
}

export interface CaptureResult {
  id: string;
  route: RouteRef;
  viewport: string;
  theme: string;
  status: CaptureStatus;
  error?: string;
  /** Display URLs (sanitized), only for deployed previews. */
  urls: { base?: string; head?: string };
  diff?: {
    changedPixels: number;
    ratio: number;
    regions: Box[];
    scale: number;
    sizeBefore: [number, number];
    sizeAfter: [number, number];
    sizeChanged: boolean;
    /** Content that only moved vertically (CSS px; dy = after − before). Not counted in ratio. */
    shifted?: ShiftedRun[];
    /** Height (CSS px) of base content with no counterpart on head. */
    removedHeight?: number;
  };
  /** Paths relative to the output directory. */
  images: { base?: string; head?: string; diff?: string; compare?: string; focus: string[] };
  warnings: string[];
  truncated: boolean;
}

export interface ShiftedRun {
  beforeY: number;
  afterY: number;
  height: number;
  dy: number;
}

export interface VariantGroup {
  id: string;
  route: RouteRef;
  param: string;
  viewport: string;
  theme: string;
  items: Array<{ value: string; image?: string; error?: string }>;
  strip?: string;
}

export interface MotionResult {
  id: string;
  route: RouteRef;
  viewport: string;
  theme: string;
  steps: string[];
  gif?: string;
  webm?: { base?: string; head?: string };
  /** Distinct frames recorded per side; 1 means nothing moved. */
  frames?: { base: number; head: number };
  warnings?: string[];
  error?: string;
}

export interface TokenReport {
  files: string[];
  scope: 'changed-regions' | 'page';
  audited: string[];
  skipped: string[];
  findings: AggregatedFinding[];
}

export interface A11yReport {
  tags: string[];
  audited: string[];
  added: Array<A11yIssue & { captures: string[] }>;
  fixed: Array<A11yIssue & { captures: string[] }>;
  focus: Array<{ capture: string; delta: FocusDelta }>;
  errors: string[];
}

export interface SideSummary {
  label: string;
  mode: 'worktree' | 'url';
  sha?: string;
  shortSha?: string;
  ref?: string;
  url?: string;
  includesUncommitted?: boolean;
}

export interface Report {
  version: 1;
  tool: { name: 'ui-diff'; version: string };
  createdAt: string;
  base: SideSummary;
  head: SideSummary;
  routes: Array<{ path: string; name: string; reasons: string[]; confidence: string }>;
  detect?: { uiFiles: string[]; unmatched: string[]; skippedRoutes: string[]; needsExample: Array<{ file: string; route: string }>; notes: string[] };
  viewports: string[];
  themes: string[];
  captures: CaptureResult[];
  variants: VariantGroup[];
  motion: MotionResult[];
  /** Routes whose motion clip was skipped because no capture of them changed (use --motion-all to record anyway). */
  motionSkipped?: string[];
  tokens?: TokenReport;
  a11y?: A11yReport;
  warnings: string[];
  stats: { captures: number; changed: number; unchanged: number; added: number; removed: number; errors: number };
}

export function computeStats(captures: CaptureResult[]): Report['stats'] {
  const count = (s: CaptureStatus) => captures.filter((c) => c.status === s).length;
  return { captures: captures.length, changed: count('changed'), unchanged: count('unchanged'), added: count('added'), removed: count('removed'), errors: count('error') };
}

export function pct(ratio: number): string {
  const p = ratio * 100;
  if (p === 0) return '0%';
  if (p < 0.01) return '<0.01%';
  return `${p < 10 ? p.toFixed(2) : p.toFixed(1)}%`;
}

export function captureLabel(c: { route: RouteRef; viewport: string; theme: string }, themes: number): string {
  return `${c.route.path} · ${c.viewport}${themes > 1 || c.theme !== 'light' ? ` · ${c.theme}` : ''}`;
}

function sizeNote(c: CaptureResult): string | undefined {
  if (!c.diff?.sizeChanged) return undefined;
  const [bw, bh] = c.diff.sizeBefore.map((n) => Math.round(n / c.diff!.scale));
  const [aw, ah] = c.diff.sizeAfter.map((n) => Math.round(n / c.diff!.scale));
  if (bw === aw) return `page height ${bh} → ${ah}px`;
  return `page size ${bw}×${bh} → ${aw}×${ah}px`;
}

function px(n: number): string {
  return `${Math.abs(n)}px`;
}

/** "content shifted down 60px" — moved-but-identical content, reported apart from real changes. */
export function shiftNote(c: CaptureResult): string | undefined {
  const runs = c.diff?.shifted ?? [];
  if (runs.length === 0) return undefined;
  const moves = [...new Set(runs.map((r) => r.dy))];
  const words = moves.slice(0, 3).map((dy) => `${dy > 0 ? 'down' : 'up'} ${px(dy)}`);
  const what = runs.length === 1 ? 'content' : `${runs.length} sections`;
  return `${what} shifted ${words.join(', ')}${moves.length > 3 ? ', …' : ''} (unchanged, not counted)`;
}

export function describeCapture(c: CaptureResult): string {
  if (c.status === 'error') return `capture failed: ${c.error ?? 'unknown error'}`;
  if (c.status === 'added') return 'new page (no base version)';
  if (c.status === 'removed') return 'page no longer renders on head';
  if (!c.diff) return '';
  const parts = [`${pct(c.diff.ratio)} of pixels changed`];
  if (c.diff.regions.length) parts.push(`${c.diff.regions.length} area${c.diff.regions.length === 1 ? '' : 's'}`);
  const shift = shiftNote(c);
  if (shift) parts.push(shift);
  if (c.diff.removedHeight) parts.push(`${c.diff.removedHeight}px of content removed`);
  const size = sizeNote(c);
  if (size) parts.push(size);
  return parts.join(' · ');
}

/** Report-level warning when some pages were taller than capture.maxHeight and only their top part was compared. */
export function truncationWarning(captures: CaptureResult[], maxHeight: number): string | undefined {
  const cut = captures.filter((c) => c.truncated);
  if (cut.length === 0) return undefined;
  const names = cut.slice(0, 5).map((c) => c.id).join(', ');
  const more = cut.length > 5 ? ` and ${cut.length - 5} more` : '';
  return `${cut.length} capture${cut.length === 1 ? ' was' : 's were'} cut at capture.maxHeight (${maxHeight}px): ${names}${more}. Changes below that line are not compared; raise capture.maxHeight to include them.`;
}

/** Data-driven summary used when no agent/human summary is supplied. */
export function autoSummary(report: Report): string {
  const lines: string[] = [];
  const s = report.stats;
  const changed = report.captures.filter((c) => c.status === 'changed' || c.status === 'added' || c.status === 'removed');
  if (s.captures === 0) {
    lines.push('No routes were captured.');
  } else if (changed.length === 0 && s.errors === 0) {
    lines.push(`No visual changes across ${s.captures} capture${s.captures === 1 ? '' : 's'} (${report.routes.length} route${report.routes.length === 1 ? '' : 's'}).`);
  } else {
    const byRoute = new Map<string, CaptureResult[]>();
    for (const c of changed) byRoute.set(c.route.path, [...(byRoute.get(c.route.path) ?? []), c]);
    for (const [route, items] of byRoute) {
      const worst = items.reduce((a, b) => ((b.diff?.ratio ?? 0) > (a.diff?.ratio ?? 0) ? b : a));
      const where = items.map((i) => `${i.viewport}${report.themes.length > 1 ? `/${i.theme}` : ''}`).join(', ');
      lines.push(`- \`${route}\` changed on ${where}; largest: ${describeCapture(worst)}.`);
    }
  }
  if (s.errors) lines.push(`- ${s.errors} capture${s.errors === 1 ? '' : 's'} failed — see the details below.`);
  if (report.a11y) {
    const { added, fixed } = report.a11y;
    if (added.length || fixed.length) {
      const top = added.slice(0, 3).map((i) => `${i.rule} on \`${i.target}\``).join(', ');
      lines.push(`- Accessibility: ${added.length} new issue${added.length === 1 ? '' : 's'}${top ? ` (${top})` : ''}, ${fixed.length} fixed.`);
    } else {
      lines.push('- Accessibility: no new or fixed axe issues.');
    }
    const focus = report.a11y.focus.filter((f) => f.delta.changed);
    if (focus.length) lines.push(`- Keyboard focus order changed on ${focus.map((f) => f.capture).join(', ')}.`);
  }
  if (report.tokens) {
    const fresh = report.tokens.findings.filter((f) => f.isNew);
    const notAudited = report.tokens.skipped.length ? ` Not audited (no tokens of that kind recognized): ${report.tokens.skipped.join(', ')}.` : '';
    if (fresh.length) {
      const top = fresh.slice(0, 3).map((f) => `${f.property} \`${f.value}\``).join(', ');
      lines.push(`- Design tokens: ${fresh.length} new off-token value${fresh.length === 1 ? '' : 's'} (${top}).${notAudited}`);
    } else {
      lines.push(`- Design tokens: no new off-token values in the changed areas.${notAudited}`);
    }
  }
  const cut = report.captures.filter((c) => c.truncated);
  if (cut.length) lines.push(`- ⚠️ ${cut.length} capture${cut.length === 1 ? '' : 's'} only cover the top of the page (capture.maxHeight); changes further down were not compared.`);
  if (report.variants.length) lines.push(`- ${report.variants.length} variant set${report.variants.length === 1 ? '' : 's'} to choose from below.`);
  if (report.motion.length) lines.push(`- ${report.motion.length} motion clip${report.motion.length === 1 ? '' : 's'} recorded for interactions static screenshots miss.`);
  const still = report.motion.filter((m) => m.warnings?.some((w) => w.startsWith('no motion detected')));
  if (still.length) lines.push(`- No motion detected in ${still.map((m) => `\`${m.route.path}\``).join(', ')} (single-frame clip).`);
  if (report.motionSkipped?.length) lines.push(`- Motion not recorded for unchanged routes: ${report.motionSkipped.map((r) => `\`${r}\``).join(', ')}.`);
  if (report.detect?.skippedRoutes.length) lines.push(`- Not captured (over the route limit): ${report.detect.skippedRoutes.map((r) => `\`${r}\``).join(', ')}.`);
  if (report.detect?.needsExample.length) lines.push(`- Not captured (dynamic routes need example values): ${report.detect.needsExample.map((n) => `\`${n.route}\``).join(', ')}.`);
  return lines.join('\n');
}
