import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { UiDiffError } from './log.js';
import { realpathIfExists } from './paths.js';

const envName = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]{0,127}$/, 'must be the NAME of an environment variable (UPPER_SNAKE_CASE), never the secret value itself');

export const StepSchema = z.union([
  z.object({ hover: z.string() }).strict(),
  z.object({ click: z.string() }).strict(),
  z.object({ focus: z.string() }).strict(),
  z.object({ press: z.string() }).strict(),
  z.object({ fill: z.string(), value: z.string() }).strict(),
  z.object({ scroll: z.union([z.number(), z.string()]), smooth: z.boolean().optional() }).strict(),
  z.object({ wait: z.number().int().min(0).max(15000) }).strict(),
  z.object({ waitFor: z.string() }).strict(),
  z.object({ mouse: z.tuple([z.number(), z.number()]) }).strict(),
]);
export type Step = z.infer<typeof StepSchema>;

const ViewportSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    width: z.number().int().min(200).max(4096).optional(),
    height: z.number().int().min(200).max(4096).optional(),
    device: z.string().optional().describe('Playwright device descriptor name, e.g. "iPhone 13"'),
    deviceScaleFactor: z.number().min(1).max(4).optional(),
    isMobile: z.boolean().optional(),
    hasTouch: z.boolean().optional(),
    userAgent: z.string().optional(),
  })
  .strict();

const ThemeSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    query: z.record(z.string(), z.string()).optional().describe('Query params added to every URL, e.g. { "theme": "dark" }'),
    colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
    localStorage: z.record(z.string(), z.string()).optional().describe('localStorage entries set before the page loads'),
  })
  .strict();

const VariantSchema = z
  .object({
    param: z.string().min(1),
    values: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).describe('"1..4", "a,b,c" or an array'),
    viewports: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
  })
  .strict();

const RouteMotionSchema = z
  .object({
    steps: z.array(StepSchema).optional(),
    durationMs: z.number().int().min(500).max(15000).optional(),
    viewport: z.string().optional(),
    theme: z.string().optional(),
    fromNavigation: z.boolean().optional(),
  })
  .strict();

const RouteObjectSchema = z
  .object({
    path: z.string().startsWith('/'),
    name: z.string().optional(),
    files: z.array(z.string()).optional().describe('Globs (relative to the config file) whose changes affect this route'),
    waitFor: z.string().optional(),
    actions: z.array(StepSchema).optional().describe('Steps to run before the static screenshot'),
    mask: z.array(z.string()).optional(),
    hide: z.array(z.string()).optional(),
    fullPage: z.boolean().optional(),
    viewports: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
    variants: VariantSchema.optional(),
    motion: z.union([z.boolean(), RouteMotionSchema]).optional(),
  })
  .strict();

const CaptureSchema = z
  .object({
    fullPage: z.boolean().default(true),
    maxHeight: z.number().int().min(200).max(16000).default(4000),
    disableAnimations: z.boolean().default(true),
    waitForFonts: z.boolean().default(true),
    fixedTime: z
      .union([z.string(), z.literal(false)])
      .default(false)
      .describe('Freeze Date: an ISO timestamp, "run-start" (same instant on both sides) or false'),
    stableRandom: z.boolean().default(true).describe('Seed Math.random so random content renders the same on both sides'),
    mask: z.array(z.string()).default([]),
    maskColor: z.string().default('#A3A3A3'),
    hide: z.array(z.string()).default([]),
    hideDevOverlays: z.boolean().default(true),
    scrollToLoad: z.boolean().default(true).describe('Scroll through the page first to trigger lazy content, then back to the top'),
    stableShots: z.number().int().min(1).max(5).default(2).describe('Retake until this many consecutive screenshots match'),
    settleMs: z.number().int().min(0).max(10000).default(250),
    timeoutMs: z.number().int().min(1000).default(30000),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load'),
    networkIdleTimeoutMs: z.number().int().min(0).default(3000),
    locale: z.string().default('en-US'),
    timezoneId: z.string().default('UTC'),
  })
  .strict();

const DiffSchema = z
  .object({
    threshold: z.number().min(0).max(1).default(0.1),
    includeAA: z.boolean().default(false),
    minChangedPixels: z.number().int().min(0).default(8),
    focusPadding: z.number().int().min(0).default(32),
    maxFocusCrops: z.number().int().min(0).max(6).default(2),
    compositeMaxWidth: z.number().int().min(600).default(2400),
    highlightColor: z.string().default('#FF0080'),
    alignShifts: z
      .boolean()
      .default(true)
      .describe('Match content that only moved up or down (e.g. below a taller hero) and report it as shifted instead of changed'),
  })
  .strict();

const AuthSchema = z
  .object({
    headers: z
      .array(z.object({ name: z.string().min(1), env: envName, prefix: z.string().optional() }).strict())
      .default([]),
    cookies: z
      .array(
        z
          .object({
            name: z.string().min(1),
            env: envName,
            domain: z.string().optional(),
            path: z.string().default('/'),
          })
          .strict(),
      )
      .default([]),
    origins: z.array(z.string()).optional().describe('Origins that may receive the credentials; default: the preview URL origins'),
  })
  .strict();

const MotionSchema = z
  .object({
    enabled: z.boolean().default(false),
    all: z.boolean().default(false).describe('Record clips for routes without visual changes too (same as --motion-all)'),
    format: z.enum(['gif', 'webm', 'gif+webm']).default('gif'),
    durationMs: z.number().int().min(500).max(15000).default(3000),
    fps: z.number().int().min(2).max(30).default(10),
    viewport: z.string().optional(),
    theme: z.string().optional(),
    scale: z.number().min(0.2).max(1).default(0.6),
    steps: z.array(StepSchema).default([]),
  })
  .strict();

export const TOKEN_PROPERTIES = [
  'color',
  'background-color',
  'border-color',
  'spacing',
  'radius',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
] as const;
export type TokenProperty = (typeof TOKEN_PROPERTIES)[number];

const TokensSchema = z
  .object({
    enabled: z.boolean().default(false),
    files: z.array(z.string()).default([]),
    scope: z.enum(['changed-regions', 'page']).default('changed-regions'),
    properties: z
      .array(z.enum(TOKEN_PROPERTIES))
      .default(['color', 'background-color', 'border-color', 'spacing', 'radius', 'font-size', 'font-weight', 'font-family']),
    colorTolerance: z.number().min(0).max(50).default(2),
    pxTolerance: z.number().min(0).max(4).default(0.5),
    remBase: z.number().positive().default(16),
    allow: z.array(z.string()).default([]).describe('Extra allowed values, e.g. "0px", "1px", "#ffffff"'),
    categories: z
      .partialRecord(z.enum(['color', 'spacing', 'radius', 'font-size', 'font-weight', 'font-family', 'line-height']), z.array(z.string()))
      .default({})
      .describe('Map token names to categories when their names do not say it, e.g. { "spacing": ["--s-*"], "font-size": ["--fs-*"] }'),
    ignoreSelectors: z.array(z.string()).default([]),
    maxElements: z.number().int().min(10).default(2500),
    maxFindings: z.number().int().min(1).default(40),
  })
  .strict();

const A11ySchema = z
  .object({
    enabled: z.boolean().default(false),
    tags: z.array(z.string()).default(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']),
    rules: z.record(z.string(), z.boolean()).default({ tabindex: true }),
    focusOrder: z.boolean().default(true),
    maxTabStops: z.number().int().min(1).max(200).default(40),
    viewports: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
  })
  .strict();

const PublishSchema = z
  .object({
    mode: z.enum(['branch', 'none']).default('branch'),
    branch: z.string().default('ui-diff-assets'),
    remote: z.string().default('origin'),
    keepRuns: z.number().int().min(1).default(1),
    allowPublicRepo: z.boolean().default(false),
    linkBase: z.string().optional().describe('Override the image URL prefix (e.g. for GitHub Enterprise)'),
  })
  .strict();

const CommentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).default('default'),
    title: z.string().default('UI diff'),
    showUnchanged: z.boolean().default(true),
  })
  .strict();

const DetectSchema = z
  .object({
    conventions: z.boolean().default(true),
    imports: z.boolean().default(true),
    aliases: z.record(z.string(), z.string()).default({}),
    maxRoutes: z.number().int().min(1).default(12),
    include: z
      .array(z.string())
      .default([
        '**/*.{html,htm,css,scss,sass,less,styl,pcss,vue,svelte,astro,jsx,tsx,mdx,js,ts,mjs,cjs}',
        '**/*.{svg,png,jpg,jpeg,gif,webp,avif,ico,woff,woff2,ttf,otf}',
        '**/*.json',
      ]),
    exclude: z
      .array(z.string())
      .default([
        '**/node_modules/**',
        '**/{dist,build,out,coverage,.next,.nuxt,.svelte-kit}/**',
        '**/*.{test,spec}.*',
        '**/{__tests__,__mocks__,test,tests,e2e,cypress}/**',
        '**/*.stories.*',
        '**/*.d.ts',
        '**/{package-lock,tsconfig,jsconfig}.json',
        '**/package.json',
        '**/.github/**',
        '**/ui-diff.config.json',
      ]),
  })
  .strict();

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    baseUrl: z
      .string()
      .default('http://localhost:{port}')
      .describe('URL of the local server; {port} is replaced with a free port. For loopback hosts the other loopback addresses are tried too'),
    startCommand: z.string().optional().describe('Starts the app; {port} is replaced and PORT is set'),
    buildCommand: z.string().optional(),
    install: z.union([z.literal('auto'), z.literal(false), z.string()]).default('auto'),
    cwd: z.string().default('.').describe('Directory (relative to this file) where commands run'),
    readyPath: z.string().default('/'),
    startTimeoutMs: z.number().int().min(1000).default(120000),
    env: z.record(z.string(), z.string()).default({}),
    copyFiles: z.array(z.string()).default(['.env', '.env.local', '.env.development.local']),
    routes: z.array(z.union([z.string().startsWith('/'), RouteObjectSchema])).default([]),
    globalFiles: z.array(z.string()).default([]).describe('Globs whose changes affect every route'),
    detect: DetectSchema.prefault({}),
    viewports: z
      .array(ViewportSchema)
      .min(1)
      .default([
        { name: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1 },
        { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      ]),
    themes: z.array(ThemeSchema).min(1).default([{ name: 'light', colorScheme: 'light' }]),
    capture: CaptureSchema.prefault({}),
    diff: DiffSchema.prefault({}),
    preview: z
      .object({ base: z.string().optional(), head: z.string().optional() })
      .strict()
      .prefault({})
      .describe('Use already-deployed preview URLs instead of local worktrees'),
    auth: AuthSchema.optional().describe('Credentials for protected previews, read from environment variables'),
    variants: z.object({ enabled: z.boolean().default(true) }).strict().prefault({}),
    motion: MotionSchema.prefault({}),
    tokens: TokensSchema.prefault({}),
    a11y: A11ySchema.prefault({}),
    publish: PublishSchema.prefault({}),
    comment: CommentSchema.prefault({}),
  })
  .strict();

export type RawConfig = z.infer<typeof ConfigSchema>;
export type ViewportConfig = z.infer<typeof ViewportSchema>;
export type ThemeConfig = z.infer<typeof ThemeSchema>;
export type RouteMotionConfig = z.infer<typeof RouteMotionSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;

export interface VariantSpec {
  param: string;
  values: string[];
  viewports?: string[];
  themes?: string[];
}

export interface ResolvedRoute {
  path: string;
  name: string;
  slug: string;
  files: string[];
  waitFor?: string;
  actions: Step[];
  mask: string[];
  hide: string[];
  fullPage?: boolean;
  viewports?: string[];
  themes?: string[];
  variants?: VariantSpec;
  motion?: RouteMotionConfig;
  configured: boolean;
}

export interface ResolvedConfig extends Omit<RawConfig, 'routes'> {
  routes: ResolvedRoute[];
  /** Absolute path of the config file, or undefined when running on defaults. */
  file?: string;
  /** Absolute directory of the config file (or repo root). */
  dir: string;
  /** Config directory relative to the repo root, POSIX style ('' for the root). */
  dirRel: string;
  repoRoot: string;
}

export const CONFIG_FILENAME = 'ui-diff.config.json';

export function expandValues(spec: string | Array<string | number>): string[] {
  if (Array.isArray(spec)) return spec.map(String);
  const trimmed = spec.trim();
  const range = /^(-?\d+)\.\.(-?\d+)(?:\.\.(\d+))?$/.exec(trimmed);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const step = Number(range[3] ?? 1) || 1;
    const out: string[] = [];
    if (start <= end) for (let i = start; i <= end; i += step) out.push(String(i));
    else for (let i = start; i >= end; i -= step) out.push(String(i));
    if (out.length > 12) throw new UiDiffError(`Variant range ${spec} expands to ${out.length} values; the limit is 12.`);
    return out;
  }
  return trimmed
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parses a CLI variant flag such as `hero=1..4` or `/pricing:plan=a,b`. */
export function parseVariantFlag(flag: string): { route?: string; spec: VariantSpec } {
  const match = /^(?:(\/[^:]*):)?([^=]+)=(.+)$/.exec(flag.trim());
  if (!match) throw new UiDiffError(`Invalid --variants value "${flag}"`, { hint: 'Use param=values, e.g. hero=1..4 or /pricing:plan=a,b' });
  return { route: match[1], spec: { param: match[2].trim(), values: expandValues(match[3]) } };
}

export function routeSlug(routePath: string, name?: string): string {
  if (name) return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route';
  const clean = routePath.split(/[?#]/)[0].replace(/\.html?$/, '');
  if (clean === '/' || clean === '') return 'home';
  return clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route';
}

/**
 * Resolves a glob written relative to the config directory into an anchored repo-root glob
 * (leading `/`). A leading `/` in the config means "relative to the repo root"; `..` is allowed.
 */
export function toRepoGlob(pattern: string, dirRel: string): string {
  const negated = pattern.startsWith('!');
  let p = toSlashes(negated ? pattern.slice(1) : pattern);
  if (p.startsWith('/')) p = p.slice(1);
  else p = path.posix.normalize(dirRel ? path.posix.join(dirRel, p) : p);
  p = p.replace(/^\.\//, '');
  return `${negated ? '!' : ''}/${p}`;
}

export function resolveRoute(input: string | z.infer<typeof RouteObjectSchema>, dirRel: string, configured: boolean): ResolvedRoute {
  const route = typeof input === 'string' ? { path: input } : input;
  const name = route.name ?? (route.path === '/' ? 'home' : route.path);
  let motion: RouteMotionConfig | undefined;
  if (route.motion === true) motion = {};
  else if (route.motion && typeof route.motion === 'object') motion = route.motion;
  return {
    path: route.path,
    name,
    slug: routeSlug(route.path, route.name),
    files: (route.files ?? []).map((g) => toRepoGlob(g, dirRel)),
    waitFor: route.waitFor,
    actions: route.actions ?? [],
    mask: route.mask ?? [],
    hide: route.hide ?? [],
    fullPage: route.fullPage,
    viewports: route.viewports,
    themes: route.themes,
    variants: route.variants
      ? {
          param: route.variants.param,
          values: expandValues(route.variants.values),
          viewports: route.variants.viewports,
          themes: route.variants.themes,
        }
      : undefined,
    motion,
    configured,
  };
}

export function formatZodError(error: z.ZodError, file: string): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => `  ${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Config paths always use "/": a Windows-style "src\\pages" means the same folder, not a glob escape. */
export function toSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

export function parseConfig(raw: unknown, opts: { file?: string; repoRoot: string }): ResolvedConfig {
  const result = ConfigSchema.safeParse(raw);
  const label = opts.file ? path.relative(process.cwd(), opts.file) || opts.file : 'config';
  if (!result.success) {
    throw new UiDiffError(`Invalid configuration:\n${formatZodError(result.error, label)}`);
  }
  const parsed = result.data;
  parsed.cwd = toSlashes(parsed.cwd);
  parsed.copyFiles = parsed.copyFiles.map(toSlashes);
  parsed.tokens.files = parsed.tokens.files.map(toSlashes);
  parsed.detect.include = parsed.detect.include.map(toSlashes);
  parsed.detect.exclude = parsed.detect.exclude.map(toSlashes);
  const repoRoot = realpathIfExists(opts.repoRoot);
  const dir = opts.file ? path.dirname(realpathIfExists(opts.file)) : repoRoot;
  const dirRel = path.relative(repoRoot, dir).split(path.sep).join('/');
  const routes = parsed.routes.map((r) => resolveRoute(r, dirRel, true));
  const seen = new Set<string>();
  for (const route of routes) {
    let slug = route.slug;
    for (let i = 2; seen.has(slug); i++) slug = `${route.slug}-${i}`;
    route.slug = slug;
    seen.add(slug);
  }
  const viewportNames = new Set(parsed.viewports.map((v) => v.name));
  const themeNames = new Set(parsed.themes.map((t) => t.name));
  for (const route of routes) {
    for (const v of [...(route.viewports ?? []), ...(route.variants?.viewports ?? [])]) {
      if (!viewportNames.has(v)) throw new UiDiffError(`Route ${route.path} references unknown viewport "${v}"`);
    }
    for (const t of [...(route.themes ?? []), ...(route.variants?.themes ?? [])]) {
      if (!themeNames.has(t)) throw new UiDiffError(`Route ${route.path} references unknown theme "${t}"`);
    }
  }
  return {
    ...parsed,
    routes,
    globalFiles: parsed.globalFiles.map((g) => toRepoGlob(g, dirRel)),
    file: opts.file,
    dir,
    dirRel,
    repoRoot,
  };
}

export function findConfigFile(repoRoot: string, cwd: string, explicit?: string): string | undefined {
  if (explicit) {
    const file = path.resolve(cwd, toSlashes(explicit));
    if (!existsSync(file)) throw new UiDiffError(`Config file not found: ${explicit}`);
    return realpathIfExists(file);
  }
  const root = realpathIfExists(repoRoot);
  let dir = realpathIfExists(path.resolve(cwd));
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (dir === root || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  return undefined;
}

export function loadConfig(repoRoot: string, cwd: string, explicit?: string): ResolvedConfig {
  const file = findConfigFile(repoRoot, cwd, explicit);
  if (!file) return parseConfig({}, { repoRoot });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UiDiffError(`Could not parse ${file}: ${(error as Error).message}`);
  }
  return parseConfig(raw, { file, repoRoot });
}

export function pickViewports(cfg: ResolvedConfig, names?: string[]): ViewportConfig[] {
  if (!names || names.length === 0) return cfg.viewports;
  return names.map((name) => {
    const found = cfg.viewports.find((v) => v.name === name);
    if (found) return found;
    const inline = /^([A-Za-z0-9_-]+):(\d+)x(\d+)(?:@(\d(?:\.\d+)?))?$/.exec(name);
    if (inline) {
      return { name: inline[1], width: Number(inline[2]), height: Number(inline[3]), deviceScaleFactor: Number(inline[4] ?? 1) };
    }
    throw new UiDiffError(`Unknown viewport "${name}"`, { hint: `Known: ${cfg.viewports.map((v) => v.name).join(', ')}; or use name:WIDTHxHEIGHT[@scale]` });
  });
}

export function pickThemes(cfg: ResolvedConfig, names?: string[]): ThemeConfig[] {
  if (!names || names.length === 0) return cfg.themes;
  return names.map((name) => {
    const found = cfg.themes.find((t) => t.name === name);
    if (!found) throw new UiDiffError(`Unknown theme "${name}"`, { hint: `Known: ${cfg.themes.map((t) => t.name).join(', ')}` });
    return found;
  });
}
