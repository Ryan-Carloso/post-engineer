'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

//---------------
// RetentionCurveChart — YouTube audience retention of one long-form video:
// x = share of the video elapsed (0-100%), y = audience watching (% of the
// starting audience; can pass 100% when viewers rewatch a part) and, when
// YouTube reports it, the relative retention vs. similar-length videos
// (0-100%). Presentational: the page fetches the points and the labels.
// A line chart is new here: MetricsBarChart compares groups, this one
// follows one value along the video.
//---------------

export interface RetentionCurveDatum {
  ratio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number | null;
}

interface RetentionCurveChartProps {
  points: RetentionCurveDatum[];
  watchingLabel: string;
  relativeLabel: string;
  axisLabel: (percent: number) => string;
}

const toPercent = (value: number): number => Math.round(value * 1000) / 10;

export function RetentionCurveChart({ points, watchingLabel, relativeLabel, axisLabel }: RetentionCurveChartProps): React.ReactElement {
  const config: ChartConfig = {
    watching: { label: watchingLabel, color: '#ff544c' },
    relative: { label: relativeLabel, color: '#94a3b8' },
  };
  const data = points.map((point) => ({
    elapsed: toPercent(point.ratio),
    watching: toPercent(point.audienceWatchRatio),
    relative: point.relativeRetentionPerformance === null ? null : toPercent(point.relativeRetentionPerformance),
  }));
  const hasRelative = data.some((datum) => datum.relative !== null);
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="elapsed"
          type="number"
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(value: number) => `${value}%`}
          tickLine={false}
          axisLine={false}
        />
        <YAxis width={44} tickFormatter={(value: number) => `${value}%`} tickLine={false} axisLine={false} />
        <ChartTooltip
          content={<ChartTooltipContent
            labelFormatter={(_label, payload) => {
              const elapsed: unknown = payload?.[0]?.payload?.elapsed;
              return typeof elapsed === 'number' ? axisLabel(elapsed) : '';
            }}
            formatter={(value, name) => `${String(config[String(name)]?.label ?? name)}: ${String(value)}%`}
          />}
        />
        <Line dataKey="watching" type="monotone" stroke="var(--color-watching)" strokeWidth={2} dot={false} />
        {hasRelative && (
          <Line dataKey="relative" type="monotone" stroke="var(--color-relative)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        )}
      </LineChart>
    </ChartContainer>
  );
}
