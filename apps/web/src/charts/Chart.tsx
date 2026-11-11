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
    series: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--chart-${i}`)),
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
  onClick,
  ...rest
}: {
  /** Builds the ECharts option from the current theme colours. */
  build: (c: ChartColors) => EChartsCoreOption;
  deps: unknown[];
  height?: number;
  label: string;
  table?: () => ChartTable;
  onClick?: (params: { dataIndex: number; name: string; seriesName?: string }) => void;
} & Record<`data-${string}`, string | undefined>): ReactNode {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<ReturnType<ECharts['init']> | null>(null);
  const theme = useStore((s) => s.settings.theme);
  const [showTable, setShowTable] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (): void => setDark(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    let live = true;
    let ro: ResizeObserver | null = null;
    void loadECharts().then((echarts) => {
      if (!live || !el.current) return;
      if (!inst.current) {
        inst.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
        inst.current.on('click', (p) =>
          onClick?.({ dataIndex: p.dataIndex ?? 0, name: String(p.name), seriesName: p.seriesName }),
        );
      }
      const c = readColors();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const base: EChartsCoreOption = {
        color: c.series,
        animation: !reduce,
        animationDuration: 350,
        animationDurationUpdate: 300,
        textStyle: { color: c.ink2, fontFamily: getComputedStyle(document.body).fontFamily },
        aria: { enabled: true, label: { description: label } },
      };
      inst.current.setOption({ ...base, ...build(c) }, { notMerge: true });
      ro = new ResizeObserver(() => inst.current?.resize());
      ro.observe(el.current);
    });
    return () => {
      live = false;
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, theme, dark, showTable]);
  useEffect(
    () => () => {
      inst.current?.dispose();
      inst.current = null;
    },
    [],
  );

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
          ref={(node) => {
            if (node !== el.current) {
              inst.current?.dispose();
              inst.current = null;
            }
            (el as { current: HTMLDivElement | null }).current = node;
          }}
          style={{ width: '100%', height, touchAction: 'pan-y pinch-zoom' }}
          role="img"
          aria-label={label}
        />
      )}
      {table ? (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? 'Show chart' : 'Show as table'}
          </Button>
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
    axisLabel: { color: c.ink3, fontSize: 12 },
    splitLine: { lineStyle: { color: c.line, type: 'dashed' } },
  };
}
export function tooltip(c: ChartColors): object {
  return {
    backgroundColor: c.surface,
    borderColor: c.line,
    textStyle: { color: c.ink, fontSize: 13 },
    confine: true,
    extraCssText: 'box-shadow:0 8px 28px rgba(0,0,0,.18);border-radius:8px;',
  };
}
export const short = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
};
