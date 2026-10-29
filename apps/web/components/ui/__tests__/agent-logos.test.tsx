import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AgentLogos from '../agent-logos';

describe('AgentLogos', () => {
  it('renders one decorative tile per agent, in order', () => {
    const { container } = render(<AgentLogos agents={['cursor', 'claude', 'opencode']} />);
    const row = container.firstElementChild;
    expect(row).toHaveAttribute('aria-hidden', 'true');
    const ids = [...container.querySelectorAll('[data-agent]')].map((el) => el.getAttribute('data-agent'));
    expect(ids).toEqual(['cursor', 'claude', 'opencode']);
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });

  it('uses the small tile size when asked', () => {
    const { container } = render(<AgentLogos agents={['openai']} size="sm" />);
    expect(container.querySelector('[data-agent="openai"]')).toHaveClass('size-10');
  });
});
