export const VENDORED_UIDIFF_COMMIT = '3075b4c8';

export const VENDORED_UIDIFF_FILES = new Set([
  '.opencode/skills/ui-diff/bin/ui-diff.mjs',
  '.opencode/skills/ui-diff/scripts/build-schema.ts',
  '.opencode/skills/ui-diff/src/a11y.ts',
  '.opencode/skills/ui-diff/src/align.ts',
  '.opencode/skills/ui-diff/src/auth.ts',
  '.opencode/skills/ui-diff/src/capture.ts',
  '.opencode/skills/ui-diff/src/cli.ts',
  '.opencode/skills/ui-diff/src/config.ts',
  '.opencode/skills/ui-diff/src/conventions.ts',
  '.opencode/skills/ui-diff/src/detect.ts',
  '.opencode/skills/ui-diff/src/determinism.ts',
  '.opencode/skills/ui-diff/src/diff.ts',
  '.opencode/skills/ui-diff/src/exec.ts',
  '.opencode/skills/ui-diff/src/font.ts',
  '.opencode/skills/ui-diff/src/gifenc.d.ts',
  '.opencode/skills/ui-diff/src/git.ts',
  '.opencode/skills/ui-diff/src/github.ts',
  '.opencode/skills/ui-diff/src/glob.ts',
  '.opencode/skills/ui-diff/src/image.ts',
  '.opencode/skills/ui-diff/src/imports.ts',
  '.opencode/skills/ui-diff/src/log.ts',
  '.opencode/skills/ui-diff/src/markdown.ts',
  '.opencode/skills/ui-diff/src/motion.ts',
  '.opencode/skills/ui-diff/src/paths.ts',
  '.opencode/skills/ui-diff/src/pipeline.ts',
  '.opencode/skills/ui-diff/src/publish.ts',
  '.opencode/skills/ui-diff/src/report.ts',
  '.opencode/skills/ui-diff/src/schema.ts',
  '.opencode/skills/ui-diff/src/server.ts',
  '.opencode/skills/ui-diff/src/sides.ts',
  '.opencode/skills/ui-diff/src/steps.ts',
  '.opencode/skills/ui-diff/src/stylex.ts',
  '.opencode/skills/ui-diff/src/tokens.ts',
  '.opencode/skills/ui-diff/src/unsettled.ts',
  '.opencode/skills/ui-diff/src/version.ts',
]);

export function isVendoredUiDiff(repoPath) {
  return VENDORED_UIDIFF_FILES.has(repoPath);
}
