/** Thin React wrapper around Apache ECharts (D3) with the Longview theme layer and a data-table alternative for a11y. */
import { Button } from '@fisim/ui';
import type { EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';

type ECharts = typeof import('echarts/core');
let echartsPromise: Promise<ECharts> | null = null;
/** Charts are lazy-loaded so they stay out of the initial bundle (plan 13). */
function loadECharts(): Promise<ECharts> {
  if (!echartsPromise) {
    echartsPromise = (async () => {
      const [core, charts, comps, renderer] = await Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ]);
      core.use([
        charts.LineChart,
        charts.BarChart,
        charts.SankeyChart,
        charts.CustomChart,
        comps.GridComponent,
        comps.TooltipComponent,
        comps.LegendComponent,
        comps.MarkLineComponent,
        comps.MarkAreaComponent,
        comps.DataZoomComponent,
        comps.AriaComponent,
        renderer.CanvasRenderer,
      ]);
      return core;
    })();
  }
  return echartsPromise;
}

export interface ChartColors {
  financial: Record<
    | 'cash'
    | 'taxable'
    | 'pretax'
    | 'roth'
    | 'hsa'
    | 'property'
    | 'debts'
    | 'income'
    | 'expense'
    | 'tax'
    | 'baseline'
    | 'draft',
    string
  >;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  lineStrong: string;
  surface: string;
  bg: string;
  series: string[];
  primary: string;
  accent: string;
  danger: string;
  ok: string;
  /** The brand spectrum, night indigo to first light, for headline paths. */
  dawn: [string, string, string, string];
}
export function readColors(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string): string => s.getPropertyValue(n).trim();
  return {
    financial: Object.fromEntries(
      [
        'cash',
        'taxable',
        'pretax',
        'roth',
        'hsa',
        'property',
        'debts',
        'income',
        'expense',
        'tax',
        'baseline',
        'draft',
      ].map((key) => [key, v(`--financial-${key}`)]),
    ) as ChartColors['financial'],
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    line: v('--line'),
    lineStrong: v('--line-strong'),
    surface: v('--surface'),
    bg: v('--bg'),
    primary: v('--primary'),
    accent: v('--accent-fill'),
    danger: v('--danger'),
    ok: v('--ok'),
    dawn: [v('--dawn-indigo'), v('--dawn-violet'), v('--dawn-rose'), v('--dawn-amber')],
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--chart-${i}`)),
  };
}

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

export function Chart({
  build,
  deps,
  height = 340,
  label,
  table,
  footer,
  onClick,
  onHover,
  onZoom,
  ...rest
}: {
  /** Builds the ECharts option from the current theme colours. */
  build: (c: ChartColors) => EChartsCoreOption;
  deps: unknown[];
  /** Pixels, or a CSS length such as var(--chart-h) so the chart fills the screen. */
  height?: number | string;
  label: string;
  table?: () => ChartTable;
  /** A key or note shown on the same row as the table toggle, under the chart. */
  footer?: ReactNode;
  onClick?: (params: { dataIndex: number }) => void;
  onHover?: (params: { dataIndex: number } | null) => void;
  onZoom?: (range: [number, number]) => void;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<ReturnType<ECharts['init']> | null>(null);
  const keyboardIndex = useRef(0);
  // Keep the latest click handler without re-initialising the chart (it would otherwise go stale).
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  const theme = useStore((s) => s.settings.theme);
  const [showTable, setShowTable] = useState(false);
  const [dark, setDark] = useState(false);
  /** Bumped when a chart instance is created so the option effect runs against it. */
  const [ready, setReady] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (): void => setDark(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // The chart instance lives exactly as long as its container: created on mount (or when the
  // table view is closed again) and disposed on unmount (or when the table view opens).
  useEffect(() => {
    if (showTable && table) return;
    let live = true;
    let ro: ResizeObserver | null = null;
    void loadECharts().then((echarts) => {
      const node = el.current;
      if (!live || !node) return;
      const chart = echarts.init(node, undefined, { renderer: 'canvas' });
      inst.current = chart;
      // Clicks anywhere in the plot area pick the nearest category, not only clicks on a mark.
      chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
        const pt = [e.offsetX, e.offsetY];
        if (!clickRef.current || !chart.containPixel({ gridIndex: 0 }, pt)) return;
        // For a category x axis the first coordinate is the category index.
        const x = chart.convertFromPixel({ gridIndex: 0 }, pt) as number[] | null;
        const idx = Math.round(x?.[0] ?? NaN);
        if (Number.isFinite(idx)) {
          // Arrow keys continue from the year just clicked, not from the first year.
          keyboardIndex.current = idx;
          clickRef.current({ dataIndex: idx });
        }
      });
      chart.getZr().on('mousemove', (e: { offsetX: number; offsetY: number }) => {
        if (!hoverRef.current) return;
        const pt = [e.offsetX, e.offsetY];
        if (!chart.containPixel({ gridIndex: 0 }, pt)) {
          hoverRef.current(null);
          return;
        }
        const x = chart.convertFromPixel({ gridIndex: 0 }, pt) as number[] | null;
        if (x && Number.isFinite(x[0])) hoverRef.current({ dataIndex: Math.round(x[0]) });
      });
      chart.getZr().on('globalout', () => hoverRef.current?.(null));
      chart.on('datazoom', () => {
        const z = (chart.getOption() as { dataZoom?: { start: number; end: number }[] }).dataZoom?.[0];
        if (z) zoomRef.current?.([z.start, z.end]);
      });
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(node);
      setReady((n) => n + 1);
    });
    return () => {
      live = false;
      ro?.disconnect();
      inst.current?.dispose();
      inst.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTable]);

  // Rebuild the option whenever the data, theme or instance changes.
  useEffect(() => {
    const chart = inst.current;
    if (!chart) return;
    const c = readColors();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const base: EChartsCoreOption = {
      color: c.series,
      animation: !reduce,
      animationDuration: 900,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 260,
      animationEasingUpdate: 'cubicOut',
      textStyle: { color: c.ink2, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 12 },
      aria: { enabled: true, label: { description: label } },
    };
    const legendStyle = {
      textStyle: { color: c.ink2, fontSize: 12 },
      icon: 'circle',
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 16,
      inactiveColor: c.lineStrong,
    };
    // Keep the user's zoom window across rebuilds.
    const prev = chart.getOption() as
      | { dataZoom?: { start?: number; end?: number }[]; legend?: { selected?: Record<string, boolean> }[] }
      | undefined;
    const opt = { ...base, ...build(c) } as EChartsCoreOption & { dataZoom?: object[]; legend?: object };
    // Charts that ask for a legend get the shared legend style (charts without one stay without).
    if (opt.legend && !Array.isArray(opt.legend))
      opt.legend = { ...legendStyle, selected: prev?.legend?.[0]?.selected, ...opt.legend };
    if (prev?.dataZoom?.length && Array.isArray(opt.dataZoom)) {
      opt.dataZoom = opt.dataZoom.map((z, i) => ({
        ...z,
        start: prev.dataZoom?.[i]?.start ?? 0,
        end: prev.dataZoom?.[i]?.end ?? 100,
      }));
    }
    const typed = opt as typeof opt & { series?: { id?: string; name?: string; type?: string }[] };
    if (Array.isArray(typed.series))
      typed.series = typed.series.map((s, i) => ({
        ...s,
        id: s.id ?? `${s.type}:${s.name ?? 'series'}:${i}`,
      }));
    chart.setOption(typed, { replaceMerge: ['series', 'xAxis', 'yAxis', 'grid', 'dataZoom'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, theme, dark, ready]);

  const t = showTable && table ? table() : null;
  return (
    <div {...rest}>
      {t ? (
        <div
          className="lv-table-wrap"
          style={{ maxHeight: height, overflowY: 'auto' }}
          tabIndex={0}
          role="region"
          aria-label={`${label}: data table`}
        >
          <table className="lv-table">
            <thead>
              <tr>
                {t.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) =>
                    j === 0 ? (
                      <th key={j} scope="row">
                        {v}
                      </th>
                    ) : (
                      <td key={j}>{v}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={el}
          style={{ width: '100%', height, touchAction: 'pan-y pinch-zoom' }}
          role="img"
          aria-label={label}
          tabIndex={onClick ? 0 : undefined}
          aria-description={
            onClick
              ? 'Use left and right arrow keys to select a year; Home and End select the first and last year.'
              : undefined
          }
          onKeyDown={(e) => {
            if (!onClick || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const axes = inst.current?.getOption().xAxis as { data?: unknown[] }[] | undefined;
            const count = axes?.[0]?.data?.length ?? 0;
            if (!count) return;
            e.preventDefault();
            keyboardIndex.current = Math.max(
              0,
              Math.min(
                count - 1,
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? count - 1
                    : keyboardIndex.current + (e.key === 'ArrowRight' ? 1 : -1),
              ),
            );
            onClick({ dataIndex: keyboardIndex.current });
            inst.current?.dispatchAction({
              type: 'showTip',
              seriesIndex: 0,
              dataIndex: keyboardIndex.current,
            });
          }}
        />
      )}
      {table || footer ? (
        <div className="chart-foot">
          {table ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
            >
              {showTable ? 'Show chart' : 'Show as table'}
            </Button>
          ) : null}
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Shared axis/tooltip styling so every chart reads as one family. */
export function axis(c: ChartColors): {
  axisLine: object;
  axisLabel: object;
  splitLine: object;
  axisTick: object;
} {
  return {
    axisLine: { lineStyle: { color: c.lineStrong, opacity: 0.6 } },
    axisTick: { show: false },
    axisLabel: { color: c.ink3, fontSize: 11, margin: 10 },
    splitLine: { lineStyle: { color: c.line, type: [3, 5], width: 1 } },
  };
}
/** A floating pane of frosted glass with a lit crosshair. */
export function tooltip(c: ChartColors): object {
  return {
    backgroundColor: alpha(c.surface, 0.86),
    borderColor: alpha(c.primary, 0.28),
    borderWidth: 1,
    padding: [12, 14],
    textStyle: { color: c.ink, fontSize: 12 },
    confine: true,
    transitionDuration: 0.12,
    axisPointer: {
      type: 'line',
      z: 3,
      lineStyle: {
        width: 1.5,
        type: 'solid',
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: alpha(c.dawn[3], 0.95) },
            { offset: 0.5, color: alpha(c.dawn[2], 0.8) },
            { offset: 1, color: alpha(c.dawn[0], 0.15) },
          ],
        },
        shadowColor: alpha(c.dawn[2], 0.6),
        shadowBlur: 10,
      },
    },
    extraCssText:
      'box-shadow:0 22px 54px rgba(18,14,80,.28),0 2px 8px rgba(18,14,80,.12);border-radius:16px;' +
      'backdrop-filter:blur(16px) saturate(1.6);-webkit-backdrop-filter:blur(16px) saturate(1.6);',
  };
}

/** Hex colour with an alpha, for gradient stops. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (x) => x + x) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A vertical fade from the series colour (brand.md §4.2). Stacked layers stay denser so the stack reads. */
export function fade(color: string, stacked = false): object {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: stacked
      ? [
          { offset: 0, color: alpha(color, 0.92) },
          { offset: 1, color: alpha(color, 0.62) },
        ]
      : [
          { offset: 0, color: alpha(color, 0.5) },
          { offset: 0.55, color: alpha(color, 0.16) },
          { offset: 1, color: alpha(color, 0) },
        ],
  };
}

/**
 * The dawn spectrum laid along the time axis: the stroke of a plan's headline path (brand.md §4). It starts
 * at night indigo and ends in first light, so the line itself says "this runs forward in time".
 */
export function dawn(c: ChartColors): object {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 1,
    y2: 0,
    colorStops: c.dawn.map((color, i) => ({ offset: i / (c.dawn.length - 1), color })),
  };
}

/** Line styling for a headline path: the dawn stroke with a soft bloom beneath it. */
export function dawnLine(c: ChartColors, width = 3): object {
  return {
    width,
    color: dawn(c),
    cap: 'round',
    join: 'round',
    shadowColor: alpha(c.dawn[1], 0.55),
    shadowBlur: 16,
    shadowOffsetY: 6,
  };
}

/** The fill under a headline path: the same spectrum, fading out toward the axis. */
export function dawnFill(c: ChartColors, strength = 0.34): object {
  return {
    opacity: 1,
    color: {
      type: 'linear',
      x: 0,
      y: 0,
      x2: 1,
      y2: 1,
      colorStops: [
        { offset: 0, color: alpha(c.dawn[0], strength) },
        { offset: 0.45, color: alpha(c.dawn[1], strength * 0.7) },
        { offset: 0.8, color: alpha(c.dawn[2], strength * 0.38) },
        { offset: 1, color: alpha(c.dawn[3], 0) },
      ],
    },
  };
}

/** One area series in the Longview style: a glowing line, a fading fill, focus on hover. */
export function areaSeries(
  name: string,
  color: string,
  data: number[],
  opts: { stack?: string; smooth?: boolean } = {},
): object {
  return {
    id: name,
    name,
    type: 'line',
    stack: opts.stack,
    symbol: 'circle',
    symbolSize: 9,
    showSymbol: false,
    smooth: opts.smooth ? 0.25 : false,
    color,
    itemStyle: { color, borderColor: '#fff', borderWidth: 2 },
    lineStyle: opts.stack
      ? { width: 1.25, color: alpha(color, 0.95) }
      : { width: 2.5, color, shadowColor: alpha(color, 0.5), shadowBlur: 14, shadowOffsetY: 5 },
    areaStyle: { color: fade(color, !!opts.stack), opacity: 1 },
    emphasis: { focus: 'series' },
    data,
  };
}

/** A bar in the Longview style: a lit top edge fading down, softly rounded where it ends. */
export function barFill(color: string): object {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color },
      { offset: 1, color: alpha(color, 0.72) },
    ],
  };
}

const esc = (x: string): string =>
  x.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);

/**
 * The tooltip card every chart shares: a header, a swatch row per value, an optional bold total and notes.
 * Values are preformatted strings; nothing here is user HTML except escaped names.
 */
export function tooltipCard(
  c: ChartColors,
  t: {
    title: string;
    subtitle?: string;
    rows: { name: string; color?: string; value: string }[];
    total?: { name: string; value: string };
    notes?: { text: string; tone?: 'danger' | 'muted' }[];
  },
): string {
  const row = (r: { name: string; color?: string; value: string }): string =>
    `<tr><td style="padding:2px 12px 2px 0;color:${c.ink2}">${r.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color};box-shadow:0 0 0 3px ${alpha(r.color, 0.18)};margin-right:8px"></span>` : ''}${esc(r.name)}</td><td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${r.value}</td></tr>`;
  return [
    `<div style="font-weight:700;font-size:14px;letter-spacing:-0.01em">${esc(t.title)}</div>`,
    t.subtitle
      ? `<div style="color:${c.ink3};font-size:11px;margin-bottom:6px">${esc(t.subtitle)}</div>`
      : '<div style="height:6px"></div>',
    `<table style="border-collapse:collapse;font-size:12px">${t.rows.map(row).join('')}`,
    t.total
      ? `<tr><td style="padding:6px 12px 0 0;border-top:1px solid ${c.line};font-weight:650">${esc(t.total.name)}</td><td style="padding-top:6px;border-top:1px solid ${c.line};text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${t.total.value}</td></tr>`
      : '',
    '</table>',
    ...(t.notes ?? []).map(
      (n) =>
        `<div style="margin-top:6px;font-size:12px;color:${n.tone === 'danger' ? c.danger : c.ink3};font-weight:${n.tone === 'danger' ? 600 : 400}">${esc(n.text)}</div>`,
    ),
  ].join('');
}

/** Which hue a kind of holding gets, everywhere (colour follows the thing, brand.md §4.1). */
export function kindColor(
  c: ChartColors,
  kind: 'cash' | 'taxable' | 'pretax' | 'roth' | 'hsa' | 'property' | 'debts',
): string {
  return c.financial[kind];
}
/** Axis money: "-$1.0M" (sign before the dollar), rolling over at each unit instead of printing "$1000k". */
export const short = (v: number): string => {
  const a = Math.abs(v);
  const sign = v < 0 && Math.round(a) > 0 ? '-' : '';
  if (a >= 999.5e6) return `${sign}$${(a / 1e9).toFixed(a >= 9.995e9 ? 0 : 1)}B`;
  if (a >= 999.5e3) return `${sign}$${(a / 1e6).toFixed(a >= 9.995e6 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
};
