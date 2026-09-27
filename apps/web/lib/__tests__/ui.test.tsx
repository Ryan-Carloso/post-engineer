import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  INPUT_CLASS,
  SECTION_LABEL_CLASS,
  formatCount,
  formatFileSize,
  PlayIcon,
  GoogleIcon,
  UploadIcon,
  FilmIcon,
  CheckIcon,
  AlertIcon,
  ExternalLinkIcon,
  SpinnerIcon,
  FacebookIcon,
  InstagramIcon,
  ImageIcon,
  AccountsIcon,
  ComposeIcon,
  HistoryIcon,
  HomeIcon,
  BoltIcon,
  KeyIcon,
  CoinsIcon,
} from '@/lib/ui';

describe('ui constants', () => {
  it('exposes input and section label classes', () => {
    expect(INPUT_CLASS).toContain('rounded-lg');
    expect(SECTION_LABEL_CLASS).toContain('uppercase');
  });
});

describe('formatCount', () => {
  it('returns 0 for empty/undefined', () => {
    expect(formatCount()).toBe('0');
    expect(formatCount('')).toBe('0');
  });

  it('returns the raw string when not a number', () => {
    expect(formatCount('abc')).toBe('abc');
  });

  it('formats billions, millions and thousands', () => {
    expect(formatCount('1500000000')).toBe('1.5B');
    expect(formatCount('2500000')).toBe('2.5M');
    expect(formatCount('3400')).toBe('3.4K');
  });

  it('returns the number as-is for small values', () => {
    expect(formatCount('42')).toBe('42');
    expect(formatCount('999')).toBe('999');
  });
});

describe('formatFileSize', () => {
  it('formats sizes under 1MB as KB', () => {
    expect(formatFileSize(512 * 1024 - 1)).toBe('512 KB');
    expect(formatFileSize(1023)).toBe('1 KB');
  });

  it('formats sizes at/above 1MB as MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
});

describe('ui icons', () => {
  const components = [
    ['play', PlayIcon],
    ['google', GoogleIcon],
    ['upload', UploadIcon],
    ['film', FilmIcon],
    ['check', CheckIcon],
    ['alert', AlertIcon],
    ['external', ExternalLinkIcon],
    ['spinner', SpinnerIcon],
    ['facebook', FacebookIcon],
    ['instagram', InstagramIcon],
    ['image', ImageIcon],
    ['accounts', AccountsIcon],
    ['compose', ComposeIcon],
    ['history', HistoryIcon],
    ['home', HomeIcon],
    ['bolt', BoltIcon],
    ['key', KeyIcon],
    ['coins', CoinsIcon],
  ] as const;

  for (const [name, Component] of components) {
    it(`renders ${name} icon`, () => {
      render(<Component />);
      expect(screen.getByText('', { selector: 'svg' })).toBeTruthy();
    });
  }
});
