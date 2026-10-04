import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

//---------------
// Tests for the persona screen's token section: face quality and the estimated
// cost per video. There is no face-mix slider anymore (every persona has a
// face; "no face" is a per-post choice in /posts/new). The cost comes from
// computeVideoTokens (the real price, the same one the server charges).
//---------------

vi.mock('@/lib/i18n/provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  const dictionary: Record<string, string> = {
    'tokens.qualityLabel': 'Qualidade da face',
    'tokens.qualityOk': 'OK (480p)',
    'tokens.qualityVeryGood': 'Muito boa (720p)',
    'tokens.costLabel': 'Custo estimado por vídeo',
    'tokens.costValue': '≈ {cost} tokens',
  };
  const t = (key: string, vars?: Record<string, string | number>) => {
    const template = dictionary[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  };
  const useI18n = () => {
    const [locale, setLocale] = react.useState<'pt' | 'en'>('pt');
    return { locale, setLocale, t };
  };
  function I18nProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { useI18n, I18nProvider };
});

import { PersonaTokensSection } from '../persona-tokens';
import { usePersonaStore } from '@/lib/store';

function resetStore() {
  usePersonaStore.getState().resetForm();
}

describe('PersonaTokensSection', () => {
  beforeEach(() => {
    resetStore();
  });

  it('no longer renders any face-mix slider', () => {
    render(<PersonaTokensSection />);
    expect(screen.queryByTestId('face-mix-slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('escolhe a qualidade da face', () => {
    render(<PersonaTokensSection />);
    expect(screen.getByTestId('face-quality-ok')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('face-quality-very_good')).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the estimated video cost with the face (ok → 2 tokens)', () => {
    render(<PersonaTokensSection />);
    expect(screen.getByTestId('token-cost-preview')).toHaveTextContent('≈ 2 tokens');
  });

  it('qualidade very_good custa mais (3 tokens)', () => {
    render(<PersonaTokensSection />);
    fireEvent.click(screen.getByTestId('face-quality-very_good'));
    expect(screen.getByTestId('token-cost-preview')).toHaveTextContent('≈ 3 tokens');
    expect(screen.getByTestId('face-quality-very_good')).toHaveAttribute('aria-checked', 'true');
  });
});