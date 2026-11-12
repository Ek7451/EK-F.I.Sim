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
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  surface: string;
  bg: string;
  series: string[];
  primary: string;
  accent: string;
  danger: string;
}
export function readColors(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string): string => s.getPropertyValue(n).trim();
  return {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    line: v('--line'),
    surface: v('--surface'),
    bg: v('--bg'),
    primary: v('--primary'),
    accent: v('--accent-fill'),
    danger: v('--danger'),
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
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<ReturnType<ECharts['init']> | null>(null);
  // Keep the latest click handler without re-initialising the chart (it would otherwise go stale).
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
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
        if (Number.isFinite(idx)) clickRef.current({ dataIndex: idx });
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
      animationDuration: 350,
      animationDurationUpdate: 300,
      textStyle: { color: c.ink2, fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 12 },
      aria: { enabled: true, label: { description: label } },
    };
    const legendStyle = {
      textStyle: { color: c.ink2, fontSize: 12 },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
    };
    // Keep the user's zoom window across rebuilds.
    const prev = chart.getOption() as { dataZoom?: { start?: number; end?: number }[] } | undefined;
    const opt = { ...base, ...build(c) } as EChartsCoreOption & { dataZoom?: object[]; legend?: object };
    // Charts that ask for a legend get the shared legend style (charts without one stay without).
    if (opt.legend && !Array.isArray(opt.legend)) opt.legend = { ...legendStyle, ...opt.legend };
    if (prev?.dataZoom?.length && Array.isArray(opt.dataZoom)) {
      opt.dataZoom = opt.dataZoom.map((z, i) => ({
        ...z,
        start: prev.dataZoom?.[i]?.start ?? 0,
        end: prev.dataZoom?.[i]?.end ?? 100,
      }));
    }
    chart.setOption(opt, { notMerge: true });
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
    axisLine: { lineStyle: { color: c.line } },
    axisTick: { show: false },
    axisLabel: { color: c.ink3, fontSize: 11 },
    splitLine: { lineStyle: { color: c.line, type: 'solid', width: 1 } },
  };
}
export function tooltip(c: ChartColors): object {
  return {
    backgroundColor: c.surface,
    borderColor: c.line,
    borderWidth: 1,
    padding: [10, 12],
    textStyle: { color: c.ink, fontSize: 12 },
    confine: true,
    axisPointer: { type: 'line', lineStyle: { color: c.ink3, width: 1, type: 'solid' } },
    extraCssText: 'box-shadow:0 10px 30px rgba(0,0,0,.16);border-radius:10px;',
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
    colorStops: [
      { offset: 0, color: alpha(color, stacked ? 0.9 : 0.38) },
      { offset: 1, color: alpha(color, stacked ? 0.55 : 0.02) },
    ],
  };
}

/** One area series in the Longview style: 2px line, fading fill, focus on hover. */
export function areaSeries(
  name: string,
  color: string,
  data: number[],
  opts: { stack?: string; smooth?: boolean } = {},
): object {
  return {
    name,
    type: 'line',
    stack: opts.stack,
    symbol: 'none',
    smooth: opts.smooth ? 0.25 : false,
    color,
    lineStyle: { width: opts.stack ? 1 : 2, color },
    areaStyle: { color: fade(color, !!opts.stack) },
    emphasis: { focus: 'series' },
    data,
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
    `<tr><td style="padding:2px 12px 2px 0;color:${c.ink2}">${r.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.color};margin-right:6px"></span>` : ''}${esc(r.name)}</td><td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${r.value}</td></tr>`;
  return [
    `<div style="font-weight:650;font-size:13px">${esc(t.title)}</div>`,
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
  const slot = { cash: 0, taxable: 1, pretax: 2, roth: 3, hsa: 4, property: 6, debts: 7 }[kind];
  return c.series[slot];
}
export const short = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
};
