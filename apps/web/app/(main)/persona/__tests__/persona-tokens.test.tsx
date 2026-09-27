import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

//---------------
// Testes da seção de tokens na criação de persona: slider de mix
// faceless/face, qualidade da face e custo estimado por vídeo.
// O custo é derivado de computeVideoTokens (mock de preço, sem backend).
//---------------

vi.mock('@/lib/i18n/provider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  const dictionary: Record<string, string> = {
    'tokens.mixLabel': 'Mix de face',
    'tokens.mixHint': 'Quanto do vídeo usa o avatar da persona.',
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

  it('exibe o slider de mix com o valor padrão (100 = façon completa)', () => {
    render(<PersonaTokensSection />);
    const slider = screen.getByTestId('face-mix-slider');
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveValue('100');
    expect(screen.getByText('Mix de face')).toBeInTheDocument();
  });

  it('exibe o custo estimado para a configuração atual (mock)', () => {
    render(<PersonaTokensSection />);
    // Default: mix 100 + ok → 2 tokens.
    expect(screen.getByTestId('token-cost-preview')).toHaveTextContent('≈ 2 tokens');
  });

  it('qualidade very_good custa mais: mix 100 → 3 tokens', () => {
    render(<PersonaTokensSection />);
    fireEvent.click(screen.getByTestId('face-quality-very_good'));
    expect(screen.getByTestId('token-cost-preview')).toHaveTextContent('≈ 3 tokens');
  });

  it('reduzir o mix para 50% com qualidade very_good custa 2 tokens', () => {
    render(<PersonaTokensSection />);
    fireEvent.click(screen.getByTestId('face-quality-very_good'));
    const slider = screen.getByTestId('face-mix-slider');
    fireEvent.change(slider, { target: { value: '50' } });
    expect(screen.getByTestId('token-cost-preview')).toHaveTextContent('≈ 2 tokens');
  });

  it('mix 0 (100% faceless) custa 1 token mesmo com qualidade selecionada', () => {
    render(<PersonaTokensSection />);
    const slider = screen.getByTestId('face-mix-slider');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByTestId('token-cost-preview')).toHaveTextContent('≈ 1 tokens');
    expect(screen.queryByText('Qualidade da face')).not.toBeInTheDocument();
  });
});
