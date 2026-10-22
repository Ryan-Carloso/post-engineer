'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

//---------------
// MetricsBarChart — horizontal bars, one per group (persona, account,
// network or angle), longest first; the leader is drawn in the accent
// color. Presentational: the page computes the averages and the labels. Horizontal so long angle texts stay readable on
// a phone.
//---------------

export interface MetricsBarDatum {
  label: string;
  average: number;
  countLabel: string;
}

interface MetricsBarChartProps {
  data: MetricsBarDatum[];
  metricLabel: string;
  formatValue: (value: number) => string;
}

const BAR_HEIGHT = 44;
const LEADER_COLOR = '#ff544c';

export function MetricsBarChart({ data, metricLabel, formatValue }: MetricsBarChartProps): React.ReactElement {
  const config: ChartConfig = { average: { label: metricLabel, color: '#c9d2dc' } };
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: Math.max(data.length * BAR_HEIGHT + 24, 120) }}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 48, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" dataKey="average" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: string) => (value.length > 22 ? `${value.slice(0, 21)}…` : value)}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={(label: string) => {
            const datum = data.find((entry) => entry.label === label);
            return datum === undefined ? label : `${label} · ${datum.countLabel}`;
          }} />}
        />
        <Bar dataKey="average" fill="var(--color-average)" radius={8} maxBarSize={32}>
          {data.map((datum, index) => (
            <Cell key={datum.label} fill={index === 0 ? LEADER_COLOR : 'var(--color-average)'} />
          ))}
          <LabelList
            dataKey="average"
            position="right"
            className="fill-[#101728] font-semibold"
            fontSize={12}
            formatter={(value: number) => formatValue(value)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
