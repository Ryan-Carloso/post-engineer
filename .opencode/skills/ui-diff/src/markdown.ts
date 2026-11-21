import { categorize } from './a11y.js';
import { autoSummary, captureLabel, describeCapture, type CaptureResult, type Report } from './report.js';

export const MAX_COMMENT_LENGTH = 65000;

export function stickyMarker(id: string): string {
  return `<!-- ui-diff:sticky id=${id} -->`;
}

const PICK_RE = /^\s*[-*] \[([ xX])\][^\n]*<!-- ui-diff-pick:([^ ]+) -->/gm;

/** Keys of variant checkboxes that reviewers ticked in a previous version of the comment. */
export function extractPicks(body: string | undefined): Set<string> {
  const picks = new Set<string>();
  if (!body) return picks;
  for (const m of body.matchAll(PICK_RE)) if (m[1].toLowerCase() === 'x') picks.add(m[2]);
  return picks;
}

export function code(text: string): string {
  const clean = text.replace(/\r?\n/g, ' ');
  return clean.includes('`') ? `\`\` ${clean} \`\`` : `\`${clean}\``;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escapes text placed in markdown prose (quotes stay readable). */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "/ (all 4)" or "/ desktop/light, mobile/light" from labels shaped "<route> <viewport>/<theme>". */
export function compressWhere(labels: string[], totals: Map<string, number>): string {
  const byRoute = new Map<string, string[]>();
  for (const label of labels) {
    const i = label.lastIndexOf(' ');
    const route = i > 0 ? label.slice(0, i) : label;
    byRoute.set(route, [...(byRoute.get(route) ?? []), i > 0 ? label.slice(i + 1) : '']);
  }
  return [...byRoute]
    .map(([route, where]) => {
      const total = totals.get(route) ?? 0;
      if (total > 1 && where.length >= total) return `${code(route)} (all ${total})`;
      return `${code(route)} ${where.filter(Boolean).join(', ')}`.trim();
    })
    .join('; ');
}

function captureHeading(c: CaptureResult, themes: number): string {
  return `**${code(c.route.path)}** · ${c.viewport}${themes > 1 || c.theme !== 'light' ? ` · ${c.theme}` : ''}`;
}

let imagesEnabled = true;

function img(src: string, alt: string, width?: number): string {
  if (!imagesEnabled) return `_${escapeHtml(alt)} — image not uploaded_`;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${width ? ` width="${width}"` : ''}>`;
}

export interface RenderOptions {
  id: string;
  title: string;
  link: (relPath: string) => string;
  summary?: string;
  previousBody?: string;
  storageNote?: string;
  showUnchanged?: boolean;
  maxLength?: number;
  /** Rendering tiers: 0 = everything, higher drops detail to fit the size limit. */
  compact?: number;
  /** False for text-only comments (nothing uploaded). */
  images?: boolean;
}

function sideLabel(side: Report['base']): string {
  return side.includesUncommitted ? `${side.label} + uncommitted changes` : side.label;
}

function changedSection(report: Report, captures: CaptureResult[], opts: RenderOptions): string[] {
  const out: string[] = [];
  const themes = report.themes.length;
  for (const c of captures) {
    out.push(`${captureHeading(c, themes)} — ${describeCapture(c)}`);
    if (c.urls.head) out.push(`<sub>head: ${c.urls.head}</sub>`);
    out.push('');
    const alt = `${captureLabel(c, themes)}: before, after and highlighted diff`;
    if (c.images.focus.length && (opts.compact ?? 0) < 3) {
      for (const f of c.images.focus) out.push(img(opts.link(f), `${alt} (zoomed)`), '');
      if (c.images.compare && (opts.compact ?? 0) < 1) {
        out.push('<details><summary>Full page</summary>', '', img(opts.link(c.images.compare), alt), '', '</details>', '');
      }
    } else if (c.images.compare) {
      out.push(img(opts.link(c.images.compare), alt), '');
    } else if (c.status === 'removed' && c.images.base) {
      out.push(img(opts.link(c.images.base), `${captureLabel(c, themes)} (base; missing on head)`, 480), '');
    } else if (c.images.head) {
      out.push(img(opts.link(c.images.head), `${captureLabel(c, themes)} (head)`, 480), '');
    }
    for (const w of c.warnings.slice(0, 3)) out.push(`> ${w}`, '');
  }
  return out;
}

function variantSection(report: Report, opts: RenderOptions): string[] {
  if (report.variants.length === 0) return [];
  const picks = extractPicks(opts.previousBody);
  const out: string[] = ['#### Variants', ''];
  for (const group of report.variants) {
    out.push(`**${code(group.route.path)} · ${group.viewport}${report.themes.length > 1 ? ` · ${group.theme}` : ''}** — compare \`?${group.param}=\` and pick one`, '');
    const width = Math.max(140, Math.min(360, Math.floor(880 / Math.max(1, group.items.length))));
    out.push('<table><tr>');
    for (const item of group.items) out.push(`<th>${escapeHtml(`${group.param}=${item.value}`)}</th>`);
    out.push('</tr><tr>');
    for (const item of group.items) {
      if (item.image && !imagesEnabled) {
        out.push(`<td valign="top">${img('', `${group.param}=${item.value}`)}</td>`);
      } else if (item.image) {
        const href = escapeHtml(opts.link(item.image));
        out.push(`<td valign="top"><a href="${href}">${img(opts.link(item.image), `${group.route.path} ${group.param}=${item.value}`, width)}</a></td>`);
      } else {
        out.push(`<td valign="top">capture failed: ${escapeHtml(item.error ?? 'unknown')}</td>`);
      }
    }
    out.push('</tr></table>', '');
    for (const item of group.items) {
      const key = `${group.route.slug}:${group.viewport}:${group.param}=${item.value}`;
      out.push(`- [${picks.has(key) ? 'x' : ' '}] ${code(`${group.param}=${item.value}`)} <!-- ui-diff-pick:${key} -->`);
    }
    out.push('');
  }
  return out;
}

function motionSection(report: Report, opts: RenderOptions): string[] {
  if (report.motion.length === 0) return [];
  const out: string[] = ['#### Motion', ''];
  for (const clip of report.motion) {
    const steps = clip.steps.length ? clip.steps.join(', ') : 'page load';
    out.push(`**${code(clip.route.path)}** · ${clip.viewport} — ${escapeText(steps)}`, '');
    if (clip.error) {
      out.push(`> clip failed: ${clip.error}`, '');
      continue;
    }
    if (clip.gif) out.push(img(opts.link(clip.gif), `${clip.route.path} motion: before and after`), '');
    for (const w of clip.warnings ?? []) out.push(`> ⚠️ ${escapeText(w)}`, '');
    const links = imagesEnabled
      ? [clip.webm?.base && `[before.webm](${opts.link(clip.webm.base)})`, clip.webm?.head && `[after.webm](${opts.link(clip.webm.head)})`].filter(Boolean)
      : [];
    if (links.length) out.push(links.join(' · '), '');
  }
  return out;
}

function a11ySection(report: Report, opts: RenderOptions): string[] {
  const a = report.a11y;
  if (!a) return [];
  const out: string[] = [`#### Accessibility — ${a.added.length} new, ${a.fixed.length} fixed`, ''];
  if (a.added.length === 0 && a.fixed.length === 0) out.push('No axe issues were introduced or fixed by this change.', '');
  const limit = (opts.compact ?? 0) >= 2 ? 8 : 25;
  const rows = [...a.added.map((i) => ({ kind: 'New', i })), ...a.fixed.map((i) => ({ kind: 'Fixed', i }))];
  const totals = new Map<string, number>();
  for (const id of a.audited) {
    const c = report.captures.find((x) => x.id === id);
    if (c) totals.set(c.route.path, (totals.get(c.route.path) ?? 0) + 1);
  }
  if (rows.length) {
    out.push('| | Issue | Impact | Element | Where |', '|---|---|---|---|---|');
    for (const { kind, i } of rows.slice(0, limit)) {
      const category = categorize(i.rule);
      const label = category === 'other' ? '' : ` _(${category})_`;
      out.push(`| ${kind} | [${cell(i.help)}](${i.helpUrl}) ${code(i.rule)}${label} | ${i.impact ?? '—'} | ${cell(code(i.target))} | ${cell(compressWhere(i.captures, totals))} |`);
    }
    if (rows.length > limit) out.push(`| | …and ${rows.length - limit} more in \`report.json\` | | | |`);
    out.push('');
  }
  for (const { capture, delta } of a.focus) {
    if (!delta.changed && delta.fixedOrderJumps.length === 0) continue;
    const notes: string[] = [];
    if (delta.newOrderJumps.length) notes.push(`focus now jumps against reading order: ${delta.newOrderJumps.slice(0, 3).map(escapeText).join('; ')}`);
    if (delta.reordered) notes.push('tab order of existing controls changed');
    if (delta.added.length) notes.push(`new tab stops: ${delta.added.slice(0, 5).map(escapeText).join(', ')}`);
    if (delta.removed.length) notes.push(`no longer focusable: ${delta.removed.slice(0, 5).map(escapeText).join(', ')}`);
    if (delta.renamed.length) notes.push(`accessible name changed: ${delta.renamed.slice(0, 5).map(escapeText).join(', ')}`);
    if (delta.fixedOrderJumps.length) notes.push(`fixed reading-order jumps: ${delta.fixedOrderJumps.slice(0, 3).map(escapeText).join('; ')}`);
    out.push(`**Focus order** on ${code(capture)}: ${notes.join('; ')}.`, '');
    if ((opts.compact ?? 0) < 2 && (delta.reordered || delta.newOrderJumps.length)) {
      out.push('<details><summary>Tab sequence</summary>', '', `Before: ${delta.before.map(escapeText).join(' → ')}`, '', `After: ${delta.after.map(escapeText).join(' → ')}`, '', '</details>', '');
    }
  }
  if (a.errors.length) out.push(`> axe could not run on: ${a.errors.join(', ')}`, '');
  return out;
}

function tokenSection(report: Report, opts: RenderOptions): string[] {
  const t = report.tokens;
  if (!t) return [];
  const fresh = t.findings.filter((f) => f.isNew);
  const existing = t.findings.filter((f) => !f.isNew);
  const scope = t.scope === 'changed-regions' ? 'changed areas' : 'changed screens';
  const out: string[] = [`#### Design tokens — ${fresh.length} new off-token value${fresh.length === 1 ? '' : 's'}`, ''];
  if (t.audited.length === 0) {
    out.push('No changed screens to audit.', '');
    return out;
  }
  const table = (rows: typeof t.findings, limit: number) => {
    const lines = ['| Property | Value | Nearest token | Elements |', '|---|---|---|---|'];
    for (const f of rows.slice(0, limit)) {
      const more = f.count > f.selectors.length ? ` (+${f.count - f.selectors.length})` : '';
      lines.push(`| ${f.property} | ${code(f.value)} | ${f.nearest ? code(f.nearest) : '—'} | ${cell(f.selectors.map(code).join(', '))}${more} |`);
    }
    if (rows.length > limit) lines.push(`| …${rows.length - limit} more in \`report.json\` | | | |`);
    return lines;
  };
  if (fresh.length) out.push(...table(fresh, (opts.compact ?? 0) >= 2 ? 8 : 20), '');
  else out.push(`Every audited color, spacing and type value in the ${scope} maps to a token.`, '');
  if (existing.length && (opts.compact ?? 0) < 2) {
    out.push(`<details><summary>${existing.length} off-token value${existing.length === 1 ? '' : 's'} that already existed on base</summary>`, '', ...table(existing, 15), '', '</details>', '');
  }
  if (t.skipped.length) {
    out.push(
      `**Not audited:** ${t.skipped.join(', ')}: no tokens of that kind were recognized in ${t.files.map(code).join(', ')}. Name them like \`--space-4\` / \`--font-size-sm\`, or map them with \`tokens.categories\`.`,
      '',
    );
  }
  out.push(`<sub>Audited the ${scope} of ${t.audited.length} capture${t.audited.length === 1 ? '' : 's'}.</sub>`, '');
  return out;
}

function renderOnce(report: Report, opts: RenderOptions): string {
  const compact = opts.compact ?? 0;
  const s = report.stats;
  const out: string[] = [stickyMarker(opts.id)];
  const counts = [s.changed && `${s.changed} changed`, s.added && `${s.added} new`, s.removed && `${s.removed} removed`, s.errors && `${s.errors} failed`, `${s.unchanged} unchanged`]
    .filter(Boolean)
    .join(', ');
  out.push(`### ${opts.title} — ${counts}`, '');
  out.push(
    `**Base** ${code(sideLabel(report.base))} → **Head** ${code(sideLabel(report.head))} · ${report.routes.length} route${report.routes.length === 1 ? '' : 's'} · ${report.viewports.join(', ')} · ${report.themes.join(', ')}`,
    '',
  );
  out.push('#### Summary', '', (opts.summary?.trim() || autoSummary(report)).trim(), '');

  const changed = report.captures.filter((c) => c.status === 'changed' || c.status === 'added' || c.status === 'removed');
  const failed = report.captures.filter((c) => c.status === 'error');
  const unchanged = report.captures.filter((c) => c.status === 'unchanged');
  if (changed.length) out.push('#### Changes', '', ...changedSection(report, changed, opts));
  if (failed.length) {
    out.push('#### Failed captures', '');
    for (const c of failed) out.push(`- ${code(captureLabel(c, report.themes.length))}: ${c.error ?? 'unknown error'}`);
    out.push('');
  }
  if (unchanged.length && opts.showUnchanged !== false) {
    const list = unchanged.slice(0, compact >= 2 ? 10 : 60).map((c) => `- ${code(captureLabel(c, report.themes.length))}`);
    if (unchanged.length > list.length) list.push(`- …and ${unchanged.length - list.length} more`);
    out.push(`<details><summary>Unchanged (${unchanged.length})</summary>`, '', ...list, '', '</details>', '');
  }
  out.push(...variantSection(report, opts), ...motionSection(report, opts), ...a11ySection(report, opts), ...tokenSection(report, opts));
  const notCaptured = [...(report.detect?.skippedRoutes ?? []), ...(report.detect?.needsExample ?? []).map((n) => n.route)];
  if (notCaptured.length) out.push(`<sub>Affected but not captured: ${notCaptured.map(code).join(', ')}</sub>`, '');
  const cut = report.captures.filter((c) => c.truncated);
  if (cut.length) {
    out.push(`> ⚠️ Partial captures: only the top of ${cut.map((c) => code(captureLabel(c, report.themes.length))).join(', ')} was compared (\`capture.maxHeight\`). Changes below that line are not shown.`, '');
  }
  const footer = [`ui-diff ${report.tool.version}`, report.base.shortSha && `base ${code(report.base.shortSha)}`, report.head.shortSha && `head ${code(report.head.shortSha)}`, opts.storageNote, `generated ${report.createdAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`]
    .filter(Boolean)
    .join(' · ');
  out.push(`<sub>${footer}</sub>`);
  const meta = { head: report.head.sha ?? report.head.url ?? null, base: report.base.sha ?? report.base.url ?? null, createdAt: report.createdAt };
  out.push(`<!-- ui-diff:meta ${JSON.stringify(meta)} -->`);
  if (compact >= 3) out.push('', '<sub>Some details were omitted to fit GitHub’s comment size limit; see `.ui-diff/report.json`.</sub>');
  return `${out.join('\n')}\n`;
}

/** Renders the sticky PR comment, dropping detail in tiers until it fits GitHub's size limit. */
export function renderComment(report: Report, opts: RenderOptions): string {
  const max = opts.maxLength ?? MAX_COMMENT_LENGTH;
  imagesEnabled = opts.images !== false;
  try {
    let body = '';
    for (let compact = opts.compact ?? 0; compact <= 3; compact++) {
      body = renderOnce(report, { ...opts, compact });
      if (body.length <= max) return body;
    }
    return `${body.slice(0, max - 200)}\n\n<sub>Truncated to fit GitHub’s comment size limit.</sub>\n${stickyMarker(opts.id)}\n`;
  } finally {
    imagesEnabled = true;
  }
}

/** Report-relative image paths referenced by the comment (what needs uploading). */
export function referencedImages(report: Report, opts: Omit<RenderOptions, 'link'>): string[] {
  const refs = new Set<string>();
  renderComment(report, {
    ...opts,
    maxLength: Number.MAX_SAFE_INTEGER,
    link: (p) => {
      refs.add(p);
      return p;
    },
  });
  return [...refs];
}
