import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AccountCard from '@/components/account-card';

//---------------
// AccountCard — testes unitários
//---------------

// Mock next/image (não renderiza em testes unitários)
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('img', { alt: props.alt, src: props.src, ...props }),
}));

// Mock lib/ui icons
vi.mock('@/lib/ui', () => ({
  GoogleIcon: () => React.createElement('span', { 'data-testid': 'google-icon' }, 'YT'),
  InstagramIcon: () => React.createElement('span', { 'data-testid': 'instagram-icon' }, 'IG'),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return {
    useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }),
  };
});

describe('AccountCard', () => {
  const baseProps = {
    type: 'youtube' as const,
    name: 'Meu Canal',
  };

  it('renderiza nome da conta', () => {
    render(<AccountCard {...baseProps} />);
    expect(screen.getByText('Meu Canal')).toBeTruthy();
  });

  it('renderiza email quando fornecido', () => {
    render(<AccountCard {...baseProps} email="canal@example.com" />);
    expect(screen.getByText('canal@example.com')).toBeTruthy();
  });

  it('usa as iniciais quando não há thumbnail (YouTube)', () => {
    render(<AccountCard {...baseProps} />);
    expect(screen.getByRole('img', { name: 'Meu Canal' }).textContent).toBe('ME');
  });

  it('usa as iniciais quando não há thumbnail (Instagram)', () => {
    render(<AccountCard type="instagram" name="@perfil" />);
    expect(screen.getByRole('img', { name: '@perfil' }).textContent).toBe('PE');
  });

  it('usa as iniciais quando o thumbnail retorna erro', () => {
    render(<AccountCard {...baseProps} thumbnail="https://img.example/avatar.jpg" />);
    fireEvent.error(screen.getByRole('img', { name: 'Meu Canal' }));
    expect(screen.getByRole('img', { name: 'Meu Canal' }).textContent).toBe('ME');
  });

  describe('modo seleção (onSelect)', () => {
    it('renderiza checkbox quando onSelect é fornecido', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} />);
      expect(screen.getByTestId('account-card-select')).toBeTruthy();
    });

    it('renderiza como <label> quando onSelect é fornecido', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const label = container.querySelector('label');
      expect(label).toBeTruthy();
    });

    it('chama onSelect ao clicar no checkbox', () => {
      const onSelect = vi.fn();
      render(<AccountCard {...baseProps} onSelect={onSelect} />);
      fireEvent.click(screen.getByTestId('account-card-select'));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('reflete selected={true} no checkbox', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} selected />);
      expect((screen.getByTestId('account-card-select') as HTMLInputElement).checked).toBe(true);
    });

    it('reflete selected={false} no checkbox (default)', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} />);
      expect((screen.getByTestId('account-card-select') as HTMLInputElement).checked).toBe(false);
    });
  });

  describe('modo compacto (compact)', () => {
    it('renderiza apenas o avatar, sem o nome visível', () => {
      render(<AccountCard {...baseProps} compact onSelect={() => {}} />);
      expect(screen.queryByText('Meu canal')).toBeNull();
      expect(screen.getByRole('img', { name: 'Meu Canal' })).toBeTruthy();
    });

    it('sem imagem exibe o fallback com as iniciais do nome', () => {
      render(<AccountCard {...baseProps} compact />);
      const fallback = screen.getByRole('img', { name: 'Meu Canal' });
      expect(fallback.textContent).toBe('ME');
    });

    it('imagem que falha ao carregar troca para as iniciais', () => {
      render(<AccountCard {...baseProps} compact thumbnail="https://img/x.jpg" />);
      const image = screen.getByRole('img', { name: 'Meu Canal' });
      fireEvent.error(image);
      expect(screen.getByRole('img', { name: 'Meu Canal' }).textContent).toBe('ME');
    });

    it('não renderiza checkbox e usa a cor apenas quando selecionado', () => {
      const onSelect = vi.fn();
      const { rerender } = render(<AccountCard {...baseProps} compact onSelect={onSelect} />);
      expect(screen.queryByTestId('account-card-select')).toBeNull();
      expect(screen.getByTestId('account-card').className).toContain('border-neutral-200');
      expect(screen.getByRole('img', { name: 'Meu Canal' }).className).toContain('grayscale');

      rerender(<AccountCard {...baseProps} compact onSelect={onSelect} selected />);
      expect(screen.getByTestId('account-card').className).toContain('border-accent');
      expect(screen.getByRole('img', { name: 'Meu Canal' }).className).not.toContain('grayscale');
      fireEvent.click(screen.getByTestId('account-card'));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('acessibilidade', () => {
    it('card selecionável tem cursor-pointer no label', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('cursor-pointer');
    });

    it('card selecionado tem border highlight', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} selected />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('border-neutral-900');
    });

    it('card não selecionado tem border neutro', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('border-neutral-200');
    });
  });
});
