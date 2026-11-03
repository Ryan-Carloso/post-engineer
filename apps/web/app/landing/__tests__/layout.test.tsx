import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ptDictionary } from '@/lib/i18n/pt';
import LandingLayout from '../layout';

describe('app/landing/layout — FAQ structured data', () => {
  it('renders children unchanged', () => {
    render(
      <LandingLayout>
        <span data-testid="child">landing</span>
      </LandingLayout>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('emits one FAQPage script whose questions match the visible PT FAQ verbatim', () => {
    render(
      <LandingLayout>
        <span>landing</span>
      </LandingLayout>,
    );
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const jsonLd = JSON.parse(script?.textContent ?? '') as {
      '@type': string;
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity.map((item) => item.name)).toEqual([
      ptDictionary.landing.faq1Q,
      ptDictionary.landing.faq2Q,
      ptDictionary.landing.faq3Q,
      ptDictionary.landing.faq4Q,
    ]);
    expect(jsonLd.mainEntity.map((item) => item.acceptedAnswer.text)).toEqual([
      ptDictionary.landing.faq1A,
      ptDictionary.landing.faq2A,
      ptDictionary.landing.faq3A,
      ptDictionary.landing.faq4A,
    ]);
  });
});
