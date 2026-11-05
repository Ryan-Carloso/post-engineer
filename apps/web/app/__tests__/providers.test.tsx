import '@testing-library/jest-dom/vitest';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import Providers from '../providers';
import { shouldRetryQuery } from '@/lib/query-retry';

describe('app/providers — Providers', () => {
  it('renders children inside providers', () => {
    render(
      <Providers>
        <span data-testid="inner">content</span>
      </Providers>,
    );
    expect(screen.getByTestId('inner')).toHaveTextContent('content');
  });

  it('wraps children in QueryClientProvider', () => {
    const { container } = render(
      <Providers>
        <div>test</div>
      </Providers>,
    );
    expect(container.textContent).toBe('test');
  });

  it('uses the no-4xx-retry policy as the default query retry (issue #385)', () => {
    let retry: unknown;
    function ReadDefaults(): null {
      retry = useQueryClient().getDefaultOptions().queries?.retry;
      return null;
    }
    render(
      <Providers>
        <ReadDefaults />
      </Providers>,
    );
    expect(retry).toBe(shouldRetryQuery);
  });
});
