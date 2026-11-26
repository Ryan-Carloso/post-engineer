import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ptDictionary } from '@/lib/i18n/pt';
import { buildFaqJsonLd } from '@/lib/seo';
import LandingLayout from '../layout';

function scriptByType(type: string): unknown {
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  const found = scripts.find((script) => {
    const parsed = JSON.parse(script.textContent ?? '') as { '@type'?: string };
    return parsed['@type'] === type;
  });
  expect(found).not.toBeUndefined();
  return JSON.parse(found?.textContent ?? '');
}

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
    const jsonLd = scriptByType('FAQPage') as {
      '@type': string;
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity.map((item) => item.name)).toEqual([
      ptDictionary.landing.faq1Q,
      ptDictionary.landing.faq2Q,
      ptDictionary.landing.faq4Q,
    ]);
    expect(jsonLd.mainEntity.map((item) => item.acceptedAnswer.text)).toEqual([
      ptDictionary.landing.faq1A,
      ptDictionary.landing.faq2A,
      ptDictionary.landing.faq4A,
    ]);
  });

  it('emits FAQPage JSON-LD identical to buildFaqJsonLd of the landing FAQ', () => {
    render(
      <LandingLayout>
        <span>landing</span>
      </LandingLayout>,
    );
    expect(scriptByType('FAQPage')).toEqual(
      buildFaqJsonLd([
        { question: ptDictionary.landing.faq1Q, answer: ptDictionary.landing.faq1A },
        { question: ptDictionary.landing.faq2Q, answer: ptDictionary.landing.faq2A },
        { question: ptDictionary.landing.faq4Q, answer: ptDictionary.landing.faq4A },
      ]),
    );
  });

  it('emits FAQPage, Organization and WebSite, one script each', () => {
    render(
      <LandingLayout>
        <span>landing</span>
      </LandingLayout>,
    );
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    const types = scripts.map(
      (script) => (JSON.parse(script.textContent ?? '') as { '@type': string })['@type'],
    );
    expect(types).toEqual(['FAQPage', 'Organization', 'WebSite']);
  });
});
