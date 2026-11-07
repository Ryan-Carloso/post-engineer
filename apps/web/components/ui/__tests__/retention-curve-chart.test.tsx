import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';

// Recharts' ResponsiveContainer never gets a size in jsdom: stub it with a
// fixed-size clone (same as chart.test.tsx); the chart itself is real.
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

import { RetentionCurveChart, type RetentionCurveDatum } from '../retention-curve-chart';

const POINTS: RetentionCurveDatum[] = Array.from({ length: 100 }, (_, index) => ({
  ratio: (index + 1) / 100,
  audienceWatchRatio: 1 - index / 200,
  relativeRetentionPerformance: 0.5,
}));

function renderChart(points: RetentionCurveDatum[]): ReturnType<typeof render> {
  return render(
    <RetentionCurveChart
      points={points}
      watchingLabel="Audience watching"
      relativeLabel="vs. similar videos"
      axisLabel={(percent) => `${percent}% of the video`}
    />,
  );
}

describe('RetentionCurveChart', () => {
  it('draws the watching and relative lines with their colors and percent ticks', () => {
    renderChart(POINTS);
    const styles = [...document.querySelectorAll('style')].map((el) => el.textContent ?? '');
    expect(styles.some((css) => css.includes('--color-watching: #ff544c;'))).toBe(true);
    expect(styles.some((css) => css.includes('--color-relative: #94a3b8;'))).toBe(true);
    expect(document.querySelectorAll('.recharts-line').length).toBe(2);
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
  });

  it('omits the relative line when YouTube reports none', () => {
    renderChart(POINTS.map((point) => ({ ...point, relativeRetentionPerformance: null })));
    expect(document.querySelectorAll('.recharts-line').length).toBe(1);
  });

  it('labels the tooltip with the elapsed share and percent values', () => {
    const { container } = renderChart(POINTS);
    const wrapper = container.querySelector('.recharts-wrapper');
    if (!(wrapper instanceof HTMLElement)) throw new Error('chart wrapper missing');
    fireEvent.mouseOver(wrapper);
    fireEvent.mouseMove(wrapper, { clientX: 300, clientY: 100 });
    expect(screen.getByText(/% of the video$/)).toBeInTheDocument();
    expect(screen.getByText(/^Audience watching: \d+(\.\d)?%$/)).toBeInTheDocument();
  });
});
