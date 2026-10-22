import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';

//---------------
// Tests for the vendored shadcn chart primitives (components/ui/chart)
// and the metrics bar chart built on them. Recharts' ResponsiveContainer
// never gets a size in jsdom, so it is stubbed with a fixed-size clone;
// everything else (container, style, tooltip, legend) is the real code.
//---------------

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  function ResponsiveContainerStub({ children }: { children: ReactNode }): React.ReactElement {
    return (
      <div data-testid="responsive-stub">
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, { width: 600, height: 300 })
            : child,
        )}
      </div>
    );
  }
  return { ...actual, ResponsiveContainer: ResponsiveContainerStub };
});

import {
  ChartContainer,
  ChartStyle,
  ChartTooltipContent,
  ChartLegendContent,
  type ChartConfig,
} from '../chart';
import { MetricsBarChart, type MetricsBarDatum } from '../metrics-bar-chart';

const CONFIG: ChartConfig = {
  average: { label: 'Views', color: '#c9d2dc' },
};

function renderWithConfig(node: ReactNode, config: ChartConfig = CONFIG): void {
  render(<ChartContainer config={config}>{node as never}</ChartContainer>);
}

function tooltipItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataKey: 'average',
    name: 'average',
    value: 120,
    color: '#0bb0bb',
    payload: { fill: '#0aa0aa' },
    ...overrides,
  };
}

describe('ChartStyle', () => {
  it('renders nothing when no config entry carries a color or theme', () => {
    render(<ChartStyle id="c-empty" config={{ average: { label: 'Views' } }} />);
    expect(document.querySelector('style')).toBeNull();
  });

  it('emits one CSS variable per color entry for both themes', () => {
    render(<ChartStyle id="c-color" config={CONFIG} />);
    const css = document.querySelector('style')?.textContent ?? '';
    expect(css).toContain('[data-chart=c-color]');
    expect(css).toContain('.dark [data-chart=c-color]');
    expect(css).toContain('--color-average: #c9d2dc;');
  });

  it('emits the per-theme color when the entry uses a theme map', () => {
    render(<ChartStyle id="c-theme" config={{ average: { theme: { light: '#111111', dark: '#eeeeee' } } }} />);
    const css = document.querySelector('style')?.textContent ?? '';
    expect(css).toContain('--color-average: #111111;');
    expect(css).toContain('--color-average: #eeeeee;');
  });
});

describe('ChartContainer', () => {
  it('renders the chart div with a generated id and the config style', () => {
    render(
      <ChartContainer config={CONFIG} id="fixed">
        <div data-testid="child" />
      </ChartContainer>,
    );
    const div = document.querySelector('[data-chart="chart-fixed"]');
    expect(div).not.toBeNull();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(document.querySelector('style')?.textContent).toContain('--color-average: #c9d2dc;');
  });
});

describe('ChartTooltipContent', () => {
  it('renders nothing while inactive or without payload', () => {
    renderWithConfig(<ChartTooltipContent active={false} payload={[tooltipItem()] as never} label="Alpha" />);
    expect(screen.queryByText('Views')).toBeNull();
  });

  it('renders the config label, the value and the indicator colors', () => {
    renderWithConfig(<ChartTooltipContent active payload={[tooltipItem()] as never} label="Alpha" />);
    expect(screen.getAllByText('Views').length).toBeGreaterThan(0);
    expect(screen.getByText('120')).toBeInTheDocument();
    const indicator = document.querySelector('.bg-\\(--color-bg\\)') as HTMLElement | null;
    expect(indicator).not.toBeNull();
    expect(indicator?.style.getPropertyValue('--color-bg')).toBe('#0aa0aa');
    expect(indicator?.style.getPropertyValue('--color-border')).toBe('#0aa0aa');
  });

  it('uses a custom labelFormatter and formatter when provided', () => {
    renderWithConfig(
      <ChartTooltipContent
        active
        payload={[tooltipItem()] as never}
        label="Alpha"
        labelFormatter={(label: unknown) => `LBL:${String(label)}`}
        formatter={() => <span data-testid="fmt-row">formatted</span>}
      />,
    );
    expect(screen.getByText('LBL:Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('fmt-row')).toBeInTheDocument();
  });

  it('renders the config icon instead of the indicator, and honors hideLabel', () => {
    const config: ChartConfig = {
      average: { label: 'Views', color: '#c9d2dc', icon: () => <span data-testid="cfg-icon" /> },
    };
    renderWithConfig(
      <ChartTooltipContent active payload={[tooltipItem()] as never} label="Alpha" hideLabel />,
      config,
    );
    expect(screen.getByTestId('cfg-icon')).toBeInTheDocument();
    expect(document.querySelector('.bg-\\(--color-bg\\)')).toBeNull();
  });

  it('nests the label for a single dashed-indicator payload and skips type none items', () => {
    renderWithConfig(
      <ChartTooltipContent
        active
        indicator="dashed"
        payload={[tooltipItem(), tooltipItem({ dataKey: 'ghost', name: 'ghost', type: 'none' })] as never}
        label="Alpha"
      />,
    );
    // The visible row is the average one; the type:none entry is filtered.
    expect(screen.getAllByText('Views').length).toBeGreaterThan(0);
    expect(screen.queryByText('ghost')).toBeNull();
    expect(document.querySelector('.border-dashed')).not.toBeNull();
  });

  it('resolves the config through labelKey against the nested payload', () => {
    renderWithConfig(
      <ChartTooltipContent
        active
        labelKey="kind"
        payload={[tooltipItem({ dataKey: undefined, name: 'mystery', payload: { kind: 'average', fill: '#123123' } })] as never}
        label="Alpha"
      />,
    );
    expect(screen.getAllByText('Views').length).toBeGreaterThan(0);
  });
});

describe('ChartLegendContent', () => {
  it('renders nothing without payload', () => {
    renderWithConfig(<ChartLegendContent payload={[]} />);
    expect(screen.queryByText('Views')).toBeNull();
  });

  it('renders the config label with a color swatch, top-aligned on request', () => {
    renderWithConfig(
      <ChartLegendContent
        verticalAlign="top"
        payload={[{ value: 'average', dataKey: 'average', color: '#999999', type: 'square' }] as never}
      />,
    );
    expect(screen.getByText('Views')).toBeInTheDocument();
    const swatch = [...document.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.style.backgroundColor === 'rgb(153, 153, 153)',
    );
    expect(swatch).toBeDefined();
    expect(screen.getByText('Views').closest('div')?.parentElement?.className).toContain('pb-3');
  });

  it('renders the config icon unless hideIcon is set, and skips type none items', () => {
    const config: ChartConfig = {
      average: { label: 'Views', color: '#c9d2dc', icon: () => <span data-testid="legend-icon" /> },
    };
    renderWithConfig(
      <ChartLegendContent
        payload={[
          { value: 'average', dataKey: 'average', color: '#999999', type: 'square' },
          { value: 'ghost', dataKey: 'ghost', color: '#000000', type: 'none' },
        ] as never}
      />,
      config,
    );
    expect(screen.getByTestId('legend-icon')).toBeInTheDocument();
    expect(screen.queryByText('ghost')).toBeNull();
  });
});

describe('MetricsBarChart', () => {
  const data: MetricsBarDatum[] = [
    { key: 'a', label: 'Alpha', average: 300, countLabel: '2 videos' },
    { key: 'b', label: 'Alpha', average: 100, countLabel: '1 video' },
    { key: 'long', label: 'a very long angle label that overflows', average: 50, countLabel: '4 videos' },
  ];

  it('renders the chart with one bar per group and truncated long axis labels', () => {
    render(<MetricsBarChart data={data} metricLabel="Views" formatValue={(v) => `${v}`} />);
    const styles = [...document.querySelectorAll('style')].map((el) => el.textContent ?? '');
    expect(styles.some((css) => css.includes('--color-average: #c9d2dc;'))).toBe(true);
    // Bars render as SVG paths once the container has a size (stubbed).
    expect(document.querySelectorAll('.recharts-bar-rectangle, .recharts-rectangle').length).toBeGreaterThan(0);
    expect(screen.getByText(/a very long angle lab…/)).toBeInTheDocument();
  });

  it('sizes the chart by group count with a floor for empty data', () => {
    const { container } = render(<MetricsBarChart data={[]} metricLabel="Views" formatValue={(v) => `${v}`} />);
    const sized = container.querySelector<HTMLElement>('[style]');
    expect(sized?.style.height).toBe('120px');
  });
});
