import type { Page } from 'playwright';

/** Finishes CSS animations/transitions immediately and removes carets, smooth scrolling and scrollbars. */
export const FREEZE_CSS = `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
* { scrollbar-width: none !important; }
*::-webkit-scrollbar { display: none !important; }
`;

/** Framework dev-mode overlays and toolbars that differ between runs. */
export const DEV_OVERLAY_SELECTORS = [
  'nextjs-portal',
  '#__next-build-watcher',
  '[data-nextjs-toast]',
  '[data-next-badge-root]',
  'vite-error-overlay',
  '#vercel-live-feedback',
  'vercel-live-feedback',
  '#webpack-dev-server-client-overlay',
  'astro-dev-toolbar',
  '#svelte-announcer',
  '[data-tsd-source]',
];

export function hideCss(selectors: string[]): string {
  if (selectors.length === 0) return '';
  return `${selectors.join(',\n')} { visibility: hidden !important; }`;
}

export interface InitOptions {
  stableRandom: boolean;
  localStorage?: Record<string, string>;
}

/**
 * Runs in every document before page scripts: seeded Math.random, theme localStorage, and the
 * helpers ui-diff evaluates later (selectors, accessible names, style snapshots).
 */
export function initScript(opts: InitOptions): string {
  return `(() => {
  const opts = ${JSON.stringify(opts)};
  if (opts.stableRandom) {
    const seeded = (seed) => () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    Math.random = seeded(0x2f6b3a1d);
    if (window.crypto) {
      const next = seeded(0x1b873593);
      try {
        window.crypto.getRandomValues = function (array) {
          const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
          for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
          return array;
        };
        window.crypto.randomUUID = function () {
          const b = window.crypto.getRandomValues(new Uint8Array(16));
          b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
          const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
          return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
        };
      } catch (e) {}
    }
  }
  if (opts.localStorage) {
    try { for (const [k, v] of Object.entries(opts.localStorage)) window.localStorage.setItem(k, v); } catch (e) {}
  }
  ${PAGE_HELPERS}
})();`;
}

/** Helpers installed as window.__uiDiff (plain JS, evaluated inside the page). */
const PAGE_HELPERS = String.raw`
  const IDENT = /^[A-Za-z_][\w-]*$/;
  const HASHY = /^(?:css|sc|jsx|emotion|svelte|astro)-[\w-]+$|__[A-Za-z0-9_-]{5,}$/;
  function unique(selector) {
    try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; }
  }
  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id && IDENT.test(el.id) && unique('#' + el.id)) return '#' + el.id;
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) return '[' + attr + '="' + v.replace(/"/g, '\\"') + '"]';
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 6) {
      if (cur !== el && cur.id && IDENT.test(cur.id)) { parts.unshift('#' + cur.id); break; }
      let part = cur.tagName.toLowerCase();
      const classes = Array.from(cur.classList).filter((c) => IDENT.test(c) && !HASHY.test(c)).slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName && (classes.length === 0 || classes.every((k) => c.classList.contains(k))));
        if (same.length > 1) part += ':nth-of-type(' + (Array.from(parent.children).filter((c) => c.tagName === cur.tagName).indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      if (cur === document.body) break;
      cur = parent;
    }
    for (let k = 1; k < Math.min(parts.length, 4); k++) {
      const candidate = parts.slice(-k).join(' > ');
      if (unique(candidate)) return candidate;
    }
    return parts.join(' > ');
  }
  function autoMarginX(el, cs) {
    const parent = el.parentElement;
    const ml = parseFloat(cs.marginLeft);
    const mr = parseFloat(cs.marginRight);
    if (!parent || !(ml > 0) || Math.abs(ml - mr) > 1) return false;
    const pcs = getComputedStyle(parent);
    if (pcs.display.includes('flex') || pcs.display.includes('grid')) return false;
    const inner = parent.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
    return Math.abs(inner - el.getBoundingClientRect().width - ml - mr) < 1.5;
  }
  function textOf(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function accessibleName(el) {
    const label = el.getAttribute('aria-label');
    if (label) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(textOf).join(' '); if (t) return t; }
    if (el.labels && el.labels.length) { const t = textOf(el.labels[0]); if (t) return t; }
    for (const attr of ['alt', 'title', 'placeholder']) { const v = el.getAttribute(attr); if (v) return v.trim(); }
    return textOf(el).slice(0, 80);
  }
  function role(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider' }[type] || 'textbox';
    }
    if (tag === 'summary') return 'button';
    return tag;
  }
  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }
  function visible(el, cs, r) {
    if (r.width < 1 || r.height < 1) return false;
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    return true;
  }
  function snapshotStyles(maxElements, ignore) {
    const out = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      if (out.length >= maxElements) break;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'HEAD', 'META', 'LINK'].includes(el.tagName)) continue;
      if (ignore.length && ignore.some((s) => { try { return el.closest(s); } catch (e) { return false; } })) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!visible(el, cs, r)) continue;
      const borderColor = [];
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (cs['border' + side + 'Style'] !== 'none' && parseFloat(cs['border' + side + 'Width']) > 0) borderColor.push(cs['border' + side + 'Color']);
      }
      out.push({
        selector: cssPath(el),
        box: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height },
        text: hasOwnText(el),
        autoMarginX: autoMarginX(el, cs),
        styles: {
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          borderColor: Array.from(new Set(borderColor)),
          margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft],
          padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
          gap: [cs.rowGap, cs.columnGap],
          radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily,
          lineHeight: cs.lineHeight,
        },
      });
    }
    return out;
  }
  function normalizeColors(list) {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const result = {};
    for (const value of list) {
      if (!ctx) break;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#010203';
      ctx.fillStyle = value;
      if (ctx.fillStyle === '#010203' && value.trim().toLowerCase() !== '#010203') { result[value] = null; continue; }
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      result[value] = [d[0], d[1], d[2], Math.round((d[3] / 255) * 100) / 100];
    }
    return result;
  }
  Object.defineProperty(window, '__uiDiff', { value: { cssPath, accessibleName, role, snapshotStyles, normalizeColors }, configurable: true });
`;

export async function freezeAnimations(page: Page): Promise<void> {
  await page.evaluate((css) => {
    if (document.querySelector('style[data-ui-diff="freeze"]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-ui-diff', 'freeze');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    for (const animation of document.getAnimations?.() ?? []) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
  }, FREEZE_CSS);
}

export async function waitForFontsAndImages(page: Page, timeoutMs: number): Promise<void> {
  await page
    .evaluate(async (timeout) => {
      const deadline = new Promise((resolve) => setTimeout(resolve, timeout));
      const work = (async () => {
        if (document.fonts) await document.fonts.ready;
        const images = Array.from(document.images);
        await Promise.all(
          images.map((img) =>
            img.complete
              ? img.decode?.().catch(() => undefined)
              : new Promise((resolve) => {
                  img.addEventListener('load', resolve, { once: true });
                  img.addEventListener('error', resolve, { once: true });
                }),
          ),
        );
      })();
      await Promise.race([work, deadline]);
    }, timeoutMs)
    .catch(() => undefined);
}

/** Scrolls through the page in viewport steps so lazy content loads, then returns to the top. */
export async function scrollThrough(page: Page, maxHeight: number): Promise<void> {
  await page
    .evaluate(async (limit) => {
      const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
      const total = Math.min(limit, document.documentElement.scrollHeight);
      for (let y = 0; y < total; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
      }
      window.scrollTo(0, 0);
    }, maxHeight)
    .catch(() => undefined);
}

export async function pageHeight(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => 0);
}
