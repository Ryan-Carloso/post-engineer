import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBuildInfo, formatBuildInfo, parseBuildInfo } from '../version';

describe('getBuildInfo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns injected VERSION/BUILD/COMMIT', () => {
    vi.stubEnv('VERSION', '1.8.0');
    vi.stubEnv('BUILD', '502');
    vi.stubEnv('COMMIT', 'abc123');
    expect(getBuildInfo()).toEqual({ version: '1.8.0', build: 502, commit: 'abc123' });
  });

  it('falls back to dev with nothing injected', () => {
    vi.stubEnv('VERSION', '');
    vi.stubEnv('BUILD', '');
    vi.stubEnv('COMMIT', '');
    expect(getBuildInfo()).toEqual({ version: 'dev', build: null, commit: null });
  });

  it('degrades malformed BUILD to null instead of NaN', () => {
    vi.stubEnv('VERSION', '1.8.0');
    vi.stubEnv('BUILD', 'not-a-number');
    expect(getBuildInfo().build).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    vi.stubEnv('VERSION', '  1.8.0\n');
    vi.stubEnv('BUILD', ' 502 ');
    vi.stubEnv('COMMIT', ' abc123\n');
    expect(getBuildInfo()).toEqual({ version: '1.8.0', build: 502, commit: 'abc123' });
  });
});

describe('formatBuildInfo', () => {
  it('renders "1.8.0 (502)"', () => {
    expect(formatBuildInfo({ version: '1.8.0', build: 502 })).toBe('1.8.0 (502)');
  });

  it('omits the build when unknown', () => {
    expect(formatBuildInfo({ version: '1.8.0', build: null })).toBe('1.8.0');
  });
});

describe('parseBuildInfo', () => {
  it('parses a well-formed engine payload', () => {
    expect(parseBuildInfo({ version: '1.8.0', build: 502, commit: 'abc123' })).toEqual({
      version: '1.8.0',
      build: 502,
      commit: 'abc123',
    });
  });

  it('accepts null build/commit', () => {
    expect(parseBuildInfo({ version: '1.8.0', build: null, commit: null })).toEqual({
      version: '1.8.0',
      build: null,
      commit: null,
    });
  });

  it('rejects non-objects and empty versions', () => {
    expect(parseBuildInfo(null)).toBeNull();
    expect(parseBuildInfo('1.8.0')).toBeNull();
    expect(parseBuildInfo({ version: '', build: 1, commit: 'x' })).toBeNull();
    expect(parseBuildInfo({ build: 1 })).toBeNull();
  });

  it('degrades malformed build/commit to null', () => {
    expect(parseBuildInfo({ version: '1.8.0', build: '502', commit: 123 })).toEqual({
      version: '1.8.0',
      build: null,
      commit: null,
    });
  });
});
