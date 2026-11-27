'use client';
import { useMemo, useState } from 'react';
import {
  Area,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { number, timeLabel } from '@/lib/api';
import type { Forecast, Overview, Research, Series, Weather } from '@/lib/types';

const grid = { stroke: 'var(--chart-grid)', strokeDasharray: '3 5', vertical: false };
const axis = { fill: 'var(--muted)', fontSize: 11 };
const tooltip = {
  background: 'var(--elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--text)',
};
export const COLORS = [
  '#c4ee69',
  '#69cfd9',
  '#8b9fdb',
  '#e2b275',
  '#bc9ed3',
  '#6daa9f',
  '#c7c9ce',
  '#cd8598',
  '#6f91ad',
  '#a4b683',
  '#9b90ad',
];
const valueFormat = (value: unknown) =>
  Array.isArray(value)
    ? value.map((v) => number(Number(v), 1)).join(' – ')
    : typeof value === 'number'
      ? number(value, 1)
      : String(value);
const labelFormat = (label: unknown) => timeLabel(String(label));

export function MarketChart({
  series,
  forecast,
  showForecast = true,
}: {
  series?: Series;
  forecast?: Forecast;
  showForecast?: boolean;
}) {
  const [baseline, setBaseline] = useState(false);
  const data = useMemo(() => {
    const rows = new Map<
      string,
      { time: string; actual?: number | null; forecast?: number; band?: [number, number]; baseline?: number }
    >();
    for (const p of series?.points || []) rows.set(p.time, { time: p.time, actual: p.value });
    if (showForecast)
      for (const p of forecast?.points || [])
        rows.set(p.time, {
          ...rows.get(p.time),
          time: p.time,
          forecast: p.value,
          band: [p.lower, p.upper],
          baseline: p.baseline ?? undefined,
        });
    const sorted = [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
    if (sorted.length) {
      for (
        let t = new Date(sorted[0].time).getTime();
        t <= new Date(sorted[sorted.length - 1].time).getTime();
        t += 1800000
      ) {
        const time = new Date(t).toISOString().replace('.000Z', 'Z');
        if (!rows.has(time)) rows.set(time, { time, actual: null });
      }
    }
    return [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
  }, [series, forecast, showForecast]);
  if (!data.length)
    return (
      <div className="chart-empty">
        <span className="empty-orbit" />
        <strong>Waiting for source observations</strong>
        <p>Sync market data to populate this chart. Missing data stays visible.</p>
      </div>
    );
  return (
    <>
      <div className="chart-key">
        <span>
          <i className="dot lime" />
          Published actuals
        </span>
        {showForecast && forecast?.available && (
          <>
            <span>
              <i className="dot cyan" />
              Forecast
            </span>
            <span>
              <i className="band-key" />
              90% calibrated band
            </span>
            <label className="check-label">
              <input type="checkbox" checked={baseline} onChange={(e) => setBaseline(e.target.checked)} />
              Weekly baseline
            </label>
          </>
        )}
      </div>
      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height={310}>
          <ComposedChart data={data} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c4ee69" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#c4ee69" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...grid} />
            <XAxis
              dataKey="time"
              tick={axis}
              axisLine={false}
              tickLine={false}
              minTickGap={70}
              tickFormatter={(v) => timeLabel(v)}
            />
            <YAxis
              tick={axis}
              axisLine={false}
              tickLine={false}
              width={58}
              domain={['auto', 'auto']}
              tickFormatter={(v) => (series?.unit === 'MW' ? number(v / 1000, 0) + 'k' : number(v, 0))}
            />
            <Tooltip contentStyle={tooltip} labelFormatter={labelFormat} formatter={valueFormat} />
            <Area
              dataKey="band"
              name="Calibrated interval"
              stroke="none"
              fill="#69cfd9"
              fillOpacity={0.13}
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="actual"
              name={`Actual (${series?.unit || 'MW'})`}
              stroke="#c4ee69"
              strokeWidth={2}
              fill="url(#actualFill)"
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast (MW)"
              stroke="#69cfd9"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            {baseline && (
              <Line
                isAnimationActive={false}
                dataKey="baseline"
                name="Weekly baseline"
                stroke="#989ca8"
                strokeWidth={1}
                strokeDasharray="3 4"
                dot={false}
              />
            )}
            <Brush
              dataKey="time"
              height={20}
              stroke="var(--border-strong)"
              fill="var(--surface)"
              travellerWidth={6}
              tickFormatter={() => ''}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function GenerationChart({ data }: { data: Overview['generation'] }) {
  const total = data.reduce((a, r) => a + Math.max(0, r.value), 0);
  if (!total) return <div className="small-empty">Generation observations are not available yet.</div>;
  return (
    <div className="generation-chart">
      <div className="donut">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie
              isAnimationActive={false}
              data={data.filter((r) => r.value > 0)}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={81}
              paddingAngle={2}
              stroke="none"
            >
              {data
                .filter((r) => r.value > 0)
                .map((r, i) => (
                  <Cell key={r.metric} fill={COLORS[i % COLORS.length]} />
                ))}
            </Pie>
            <Tooltip contentStyle={tooltip} formatter={(v) => number(Number(v), 0) + ' MW'} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <strong>{number(total / 1000, 1)}</strong>
          <span>GW output</span>
        </div>
      </div>
      <div className="fuel-legend">
        {data
          .filter((r) => r.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 6)
          .map((r) => (
            <div key={r.metric}>
              <span>
                <i
                  style={{
                    background:
                      COLORS[
                        data.filter((r) => r.value > 0).findIndex((x) => x.metric === r.metric) %
                          COLORS.length
                      ],
                  }}
                />
                {r.name}
              </span>
              <strong>
                {number((r.value / total) * 100, 1)}
                <small>%</small>
              </strong>
            </div>
          ))}
      </div>
    </div>
  );
}

export function TestChart({ forecast }: { forecast: Forecast }) {
  const points = forecast.metadata?.test_points[forecast.model || ''] || [];
  if (!points.length)
    return (
      <div className="chart-empty">
        <strong>No evaluated model yet</strong>
        <p>Run evaluation after at least sixty days of real demand history are stored.</p>
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={points} margin={{ right: 15, left: 0, top: 14 }}>
        <CartesianGrid {...grid} />
        <XAxis dataKey="time" tick={axis} minTickGap={65} tickFormatter={(v) => timeLabel(v)} />
        <YAxis
          tick={axis}
          width={58}
          tickFormatter={(v) => number(v / 1000) + 'k'}
          domain={['auto', 'auto']}
        />
        <Tooltip contentStyle={tooltip} labelFormatter={labelFormat} formatter={valueFormat} />
        <Line
          isAnimationActive={false}
          dataKey="actual"
          name="Actual (MW)"
          stroke="#c4ee69"
          dot={false}
          strokeWidth={2}
        />
        <Line
          isAnimationActive={false}
          dataKey="predicted"
          name="Prediction (MW)"
          stroke="#69cfd9"
          dot={false}
          strokeWidth={1.7}
        />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function WeatherChart({ data }: { data?: Weather }) {
  const [location, setLocation] = useState('London');
  const points = data?.points.filter((p) => p.location === location) || [];
  return (
    <>
      <div className="location-tabs">
        {(data?.locations || ['London', 'Manchester', 'Glasgow']).map((l) => (
          <button key={l} className={location === l ? 'selected' : ''} onClick={() => setLocation(l)}>
            {l}
          </button>
        ))}
      </div>
      {points.length ? (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={points}>
            <CartesianGrid {...grid} />
            <XAxis
              dataKey="valid_time"
              tick={axis}
              minTickGap={55}
              tickFormatter={(v) => new Date(v).getUTCHours() + ':00'}
            />
            <YAxis yAxisId="temp" tick={axis} width={35} unit="°" />
            <YAxis yAxisId="wind" orientation="right" tick={axis} width={35} />
            <Tooltip contentStyle={tooltip} labelFormatter={labelFormat} formatter={valueFormat} />
            <Line
              isAnimationActive={false}
              yAxisId="temp"
              dataKey="temperature"
              name="Temperature (°C)"
              stroke="#e2b275"
              strokeWidth={2}
              dot={false}
            />
            <Line
              isAnimationActive={false}
              yAxisId="wind"
              dataKey="wind_speed"
              name="Wind at 100m (m/s)"
              stroke="#69cfd9"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="small-empty">No weather forecast stored. Sync to request Open-Meteo data.</div>
      )}
      <p className="chart-footnote">Forecast inputs · six-city sample · published availability preserved</p>
    </>
  );
}

export function ScatterPlot({ research }: { research?: Research }) {
  if (!research?.pairs.length)
    return (
      <div className="chart-empty">
        <strong>No paired observations</strong>
        <p>Demand and price must share the same settlement timestamp.</p>
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={310}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 5 }}>
        <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" />
        <XAxis
          type="number"
          dataKey="demand"
          name="Demand"
          unit=" MW"
          tick={axis}
          tickFormatter={(v) => number(v / 1000) + 'k'}
          domain={['auto', 'auto']}
        />
        <YAxis type="number" dataKey="price" name="Imbalance price" unit=" £/MWh" tick={axis} />
        <Tooltip contentStyle={tooltip} formatter={valueFormat} cursor={{ strokeDasharray: '3 3' }} />
        <Scatter
          isAnimationActive={false}
          name="Matched settlement periods"
          data={research.pairs}
          fill="#c4ee69"
          fillOpacity={0.5}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function PriceHeatmap({ data }: { data: Research['heatmap'] }) {
  const values = data.map((r) => r.mean),
    min = Math.min(...values),
    max = Math.max(...values);
  return (
    <div className="heatmap">
      <div className="heatmap-hours">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h}>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>
        ))}
      </div>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, w) => (
        <div className="heatmap-row" key={day}>
          <span>{day}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const cell = data.find((r) => r.weekday === w && r.hour === h);
            const level = cell ? (cell.mean - min) / (max - min || 1) : 0;
            return (
              <div
                key={h}
                title={
                  cell
                    ? `${day} ${h}:00 · £${number(cell.mean, 2)}/MWh · ${cell.n} observations`
                    : 'No observations'
                }
                style={{ background: cell ? `rgba(196,238,105,${0.12 + level * 0.8})` : 'var(--elevated)' }}
              />
            );
          })}
        </div>
      ))}
      <div className="heatmap-legend">
        <span>Europe/London hour</span>
        <span>
          Lower <i /> Higher mean imbalance price
        </span>
      </div>
    </div>
  );
}
