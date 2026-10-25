import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBuildInfo, formatBuildInfo, parseBuildInfo } from '../version';

describe('getBuildInfo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the deploy-generated MAJOR.MINOR.PR metadata', () => {
    vi.stubEnv('VERSION', '1.28.152');
    vi.stubEnv('PR_NUMBER', '152');
    vi.stubEnv('BUILD', '152');
    vi.stubEnv('COMMIT', '8f31abc');
    expect(getBuildInfo()).toEqual({
      version: '1.28.152',
      pr: 152,
      build: 152,
      commit: '8f31abc',
      builtAt: null,
    });
  });

  it('falls back to dev with nothing injected', () => {
    vi.stubEnv('VERSION', '');
    vi.stubEnv('PR_NUMBER', '');
    vi.stubEnv('BUILD', '');
    vi.stubEnv('COMMIT', '');
    vi.stubEnv('BUILT_AT', '');
    expect(getBuildInfo()).toEqual({ version: 'dev', pr: null, build: null, commit: null, builtAt: null });
  });

  it('degrades malformed BUILD/PR_NUMBER to null instead of NaN', () => {
    vi.stubEnv('VERSION', '1.28.152');
    vi.stubEnv('PR_NUMBER', '#152');
    vi.stubEnv('BUILD', 'not-a-number');
    const info = getBuildInfo();
    expect(info.pr).toBeNull();
    expect(info.build).toBeNull();
  });

  it('mirrors the PR number into build when BUILD is absent', () => {
    vi.stubEnv('VERSION', '1.28.152');
    vi.stubEnv('PR_NUMBER', '152');
    vi.stubEnv('BUILD', '');
    expect(getBuildInfo().build).toBe(152);
  });

  it('trims surrounding whitespace', () => {
    vi.stubEnv('VERSION', '  1.28.152\n');
    vi.stubEnv('PR_NUMBER', ' 152 ');
    // Hermetic: CI injects BUILD=<run number> (old scheme); stub it so the
    // PR_NUMBER -> build fallback is what the test actually exercises.
    vi.stubEnv('BUILD', '');
    vi.stubEnv('COMMIT', ' 8f31abc\n');
    expect(getBuildInfo()).toEqual({
      version: '1.28.152',
      pr: 152,
      build: 152,
      commit: '8f31abc',
      builtAt: null,
    });
  });

  it('reports the ISO builtAt stamp when injected', () => {
    vi.stubEnv('VERSION', '1.28.152');
    vi.stubEnv('BUILT_AT', '2026-10-25T12:00:00Z');
    expect(getBuildInfo().builtAt).toBe('2026-10-25T12:00:00Z');
  });
});

describe('formatBuildInfo', () => {
  it('renders "1.28.152 (#152)" for a deployment build', () => {
    expect(formatBuildInfo({ version: '1.28.152', pr: 152, build: 152 })).toBe(
      '1.28.152 (#152)',
    );
  });

  it('falls back to the build number when no PR is known', () => {
    expect(formatBuildInfo({ version: '1.8.0', pr: null, build: 502 })).toBe('1.8.0 (502)');
  });

  it('omits the build when unknown', () => {
    expect(formatBuildInfo({ version: '1.28', pr: null, build: null })).toBe('1.28');
  });
});

describe('parseBuildInfo', () => {
  it('parses a well-formed engine payload', () => {
    expect(
      parseBuildInfo({
        version: '1.28.152',
        pr: 152,
        build: 152,
        commit: '8f31abc',
        builtAt: '2026-10-25T12:00:00Z',
      }),
    ).toEqual({
      version: '1.28.152',
      pr: 152,
      build: 152,
      commit: '8f31abc',
      builtAt: '2026-10-25T12:00:00Z',
    });
  });

  it('mirrors pr into build when the payload omits build', () => {
    expect(parseBuildInfo({ version: '1.28.152', pr: 152 })).toEqual({
      version: '1.28.152',
      pr: 152,
      build: 152,
      commit: null,
      builtAt: null,
    });
  });

  it('accepts null pr/build/commit', () => {
    expect(parseBuildInfo({ version: '1.28', pr: null, build: null, commit: null })).toEqual({
      version: '1.28',
      pr: null,
      build: null,
      commit: null,
      builtAt: null,
    });
  });

  it('rejects non-objects and empty versions', () => {
    expect(parseBuildInfo(null)).toBeNull();
    expect(parseBuildInfo('1.28.152')).toBeNull();
    expect(parseBuildInfo({ version: '', pr: 1, build: 1, commit: 'x' })).toBeNull();
    expect(parseBuildInfo({ pr: 1 })).toBeNull();
  });

  it('degrades malformed pr/build/commit to null', () => {
    expect(
      parseBuildInfo({ version: '1.28.152', pr: '#152', build: '502', commit: 123 }),
    ).toEqual({ version: '1.28.152', pr: null, build: null, commit: null, builtAt: null });
  });
});