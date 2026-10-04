import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

//---------------
// Testes da seção de tokens na criação de persona: qualidade da face e custo
// estimado por vídeo. Não existe mais slider de mix (a persona sempre tem
// rosto; "sem rosto" é escolha do post, em /posts/new). O custo é derivado de
// computeVideoTokens (preço real, o mesmo do servidor).
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

  it('não renderiza mais nenhum slider de mix de rosto', () => {
    render(<PersonaTokensSection />);
    expect(screen.queryByTestId('face-mix-slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('escolhe a qualidade da face', () => {
    render(<PersonaTokensSection />);
    expect(screen.getByTestId('face-quality-ok')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('face-quality-very_good')).toHaveAttribute('aria-checked', 'false');
  });

  it('exibe o custo estimado do vídeo com o rosto (ok → 2 tokens)', () => {
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