import '@testing-library/jest-dom/vitest';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Providers from '../providers';

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
});
