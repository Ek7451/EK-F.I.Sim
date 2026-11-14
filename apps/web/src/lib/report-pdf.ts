/**
 * The PDF plan report, drawn in the app's own visual language ("First light", docs/design/brand.md): a night
 * headline band with the dawn hairline and the plan's four headline figures, the net-worth path in the dawn
 * spectrum, quiet paper cards for everything else, and tabular figures throughout.
 *
 * Everything is vector (no images), so the file stays small and sharp at any zoom and prints cleanly. pdf-lib has
 * no gradients, so the dawn spectrum is laid down as thin slices of interpolated colour. Figures come from the same
 * records the screens show; nothing is recomputed here.
 */
import type { McSummary, Plan, ProjectionResult, YearRecord } from '@fisim/engine';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { formatShare } from '@fisim/ui';
import { DISCLAIMER } from '../shell/nav';
import { agesText, fundedStat } from './outcome';

type Lib = typeof import('pdf-lib');

// ------------------------------------------------------------------ the palette (brand tokens, light theme)

const HEX = {
  night0: '#060818',
  night1: '#0c1030',
  night2: '#171c4d',
  nightInk: '#f5f6ff',
  nightInk2: '#d2d6f5',
  nightInk3: '#a9aedb',
  ink: '#131432',
  ink2: '#3a3d5e',
  ink3: '#5f627f',
  line: '#e3e4f3',
  lineStrong: '#c3c6e0',
  surface2: '#f4f4fc',
  primary: '#4a41e6',
  primarySoft: '#ecebff',
  danger: '#c22b3f',
  ok: '#07775c',
  indigo: '#5b4dff',
  violet: '#a14dff',
  rose: '#ff4d94',
  amber: '#ffb02e',
} as const;
const DAWN = [HEX.indigo, HEX.violet, HEX.rose, HEX.amber];

const parse = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
/** A colour `t` of the way (0–1) along a list of stops. */
function along(stops: readonly string[], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(k));
  const a = parse(stops[i]);
  const b = parse(stops[i + 1]);
  const f = k - i;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ------------------------------------------------------------------ figures

const money = (v: number): string => {
  const r = Math.round(v) || 0;
  return `${r < 0 ? '-' : ''}$${Math.abs(r).toLocaleString('en-US')}`;
};
/** Short money for headline figures and axes: $2.6M, $412K, -$1.2M. */
const short = (v: number): string => {
  const a = Math.abs(v);
  const sign = v < 0 && Math.round(a) > 0 ? '-' : '';
  if (a >= 999.5e6) return `${sign}$${(a / 1e9).toFixed(a >= 9.995e9 ? 0 : 1)}B`;
  if (a >= 999.5e3) return `${sign}$${(a / 1e6).toFixed(a >= 9.995e6 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
};
const pct = (v: number, digits = 0): string => `${(v * 100).toFixed(digits)}%`;

// ------------------------------------------------------------------ the report

const W = 612; // US Letter, points
const H = 792;
const M = 44; // page margin
const CW = W - 2 * M;

export async function buildReportPdf(
  plan: Plan,
  result: ProjectionResult,
  mc: McSummary | null,
  label: string,
): Promise<Uint8Array> {
  const lib: Lib = await import('pdf-lib');
  const {
    PDFDocument,
    StandardFonts,
    rgb,
    LineCapStyle,
    pushGraphicsState,
    popGraphicsState,
    moveTo,
    lineTo,
    appendQuadraticCurve,
    closePath,
    clip,
    endPath,
  } = lib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${plan.name}: plan report`);
  doc.setSubject(`Longview Planner report, ${label}`);
  doc.setCreator('Longview Planner');
  doc.setProducer('Longview Planner');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = (hex: string): RGB => rgb(...parse(hex));
  const cAt = (stops: readonly string[], t: number): RGB => rgb(...along(stops, t));

  // The standard PDF fonts cover Western European text only. Anything else in a plan name or note is replaced
  // rather than failing the whole report.
  const cache = new Map<string, boolean>();
  const safe = (s: string): string =>
    [...s.replace(/−/g, '-')]
      .map((ch) => {
        if (!cache.has(ch)) {
          try {
            font.encodeText(ch);
            cache.set(ch, true);
          } catch {
            cache.set(ch, false);
          }
        }
        return cache.get(ch) ? ch : '?';
      })
      .join('');

  const s = result.summary;
  const recs = result.records;
  const last = recs[recs.length - 1];
  const bal = (r: YearRecord, x: number): number => x / r.cpiEnd;
  const flow = (r: YearRecord, x: number): number => x / r.cpi;
  const generated = new Date().toISOString().slice(0, 10);

  // ---------------------------------------------------------------- drawing helpers

  const text = (
    page: PDFPage,
    t: string,
    x: number,
    y: number,
    size: number,
    opts: { f?: PDFFont; color?: string; align?: 'left' | 'right' | 'center'; opacity?: number } = {},
  ): void => {
    const f = opts.f ?? font;
    const str = safe(t);
    const w = f.widthOfTextAtSize(str, size);
    const dx = opts.align === 'right' ? -w : opts.align === 'center' ? -w / 2 : 0;
    page.drawText(str, {
      x: x + dx,
      y,
      size,
      font: f,
      color: c(opts.color ?? HEX.ink),
      opacity: opts.opacity,
    });
  };
  /** Word-wrapped lines that fit `width`. */
  const wrap = (t: string, size: number, width: number, f: PDFFont = font): string[] => {
    const words = safe(t).split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  /** A rounded rectangle; (x, y) is its lower-left corner, as everywhere in PDF space. */
  const rounded = (
    page: PDFPage,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    opts: { fill?: string; stroke?: string; opacity?: number; strokeWidth?: number },
  ): void => {
    const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    page.drawSvgPath(d, {
      x,
      y: y + h, // SVG paths are drawn downward from their top-left corner
      color: opts.fill ? c(opts.fill) : undefined,
      opacity: opts.opacity,
      borderColor: opts.stroke ? c(opts.stroke) : undefined,
      borderWidth: opts.stroke ? (opts.strokeWidth ?? 0.75) : undefined,
    });
  };
  /**
   * Restrict drawing to a rounded rectangle until `unclip`, like CSS overflow: hidden. The night panels' soft lights
   * are large discs; without this they would spill onto the paper.
   */
  const clipTo = (page: PDFPage, x: number, y: number, w: number, h: number, r = 0): void => {
    page.pushOperators(
      pushGraphicsState(),
      moveTo(x + r, y),
      lineTo(x + w - r, y),
      appendQuadraticCurve(x + w, y, x + w, y + r),
      lineTo(x + w, y + h - r),
      appendQuadraticCurve(x + w, y + h, x + w - r, y + h),
      lineTo(x + r, y + h),
      appendQuadraticCurve(x, y + h, x, y + h - r),
      lineTo(x, y + r),
      appendQuadraticCurve(x, y, x + r, y),
      closePath(),
      clip(),
      endPath(),
    );
  };
  const unclip = (page: PDFPage): void => {
    page.pushOperators(popGraphicsState());
  };
  /** A card on paper: a soft indigo-tinted shadow, white face and a hairline edge. */
  const card = (page: PDFPage, x: number, y: number, w: number, h: number): void => {
    rounded(page, x + 0.5, y - 2, w, h, 12, { fill: '#1c1860', opacity: 0.05 });
    rounded(page, x, y, w, h, 12, { fill: '#ffffff', stroke: HEX.line });
  };
  /** Horizontal strip of the dawn spectrum (the hairline of first light). */
  const dawnBar = (page: PDFPage, x: number, y: number, w: number, h: number, opacity = 1): void => {
    const n = Math.max(24, Math.round(w / 3));
    for (let i = 0; i < n; i++)
      page.drawRectangle({
        x: x + (w * i) / n,
        y,
        width: w / n + 0.3,
        height: h,
        color: cAt(DAWN, i / (n - 1)),
        opacity,
      });
  };
  /** The night instrument panel: a deep gradient with a faint grid and soft lights of the dawn spectrum. */
  const nightPanel = (page: PDFPage, x: number, y: number, w: number, h: number, radius = 0): void => {
    clipTo(page, x, y, w, h, radius);
    const n = 48;
    for (let i = 0; i < n; i++)
      page.drawRectangle({
        x,
        y: y + (h * i) / n,
        width: w,
        height: h / n + 0.4,
        color: cAt([HEX.night0, HEX.night1, HEX.night2], i / (n - 1)),
      });
    // Soft glows: indigo top-left, rose lower-right, amber top-right (stacked translucent discs).
    const glow = (cx: number, cy: number, r: number, hex: string, strength: number): void => {
      for (let k = 6; k >= 1; k--)
        page.drawCircle({
          x: cx,
          y: cy,
          size: (r * k) / 6,
          color: c(hex),
          opacity: strength / 6,
        });
    };
    glow(x + w * 0.08, y + h * 0.95, h * 0.9, HEX.indigo, 0.22);
    glow(x + w * 0.92, y + h * 0.05, h * 0.75, HEX.rose, 0.1);
    glow(x + w * 0.85, y + h * 0.98, h * 0.5, HEX.amber, 0.08);
    for (let gx = x + 24; gx < x + w * 0.55; gx += 24)
      page.drawLine({
        start: { x: gx, y },
        end: { x: gx, y: y + h },
        thickness: 0.4,
        color: c(HEX.nightInk3),
        opacity: 0.08 * (1 - (gx - x) / (w * 0.55)),
      });
    for (let gy = y + 24; gy < y + h; gy += 24)
      page.drawLine({
        start: { x, y: gy },
        end: { x: x + w * 0.55, y: gy },
        thickness: 0.4,
        color: c(HEX.nightInk3),
        opacity: 0.05,
      });
    unclip(page);
  };
  /** A section title: bold, with a short bar of first light beneath it. */
  const sectionTitle = (page: PDFPage, title: string, x: number, y: number, note?: string): void => {
    text(page, title, x, y, 13, { f: bold });
    dawnBar(page, x, y - 7, 34, 2.2);
    if (note) text(page, note, x + CW, y + 1, 8, { color: HEX.ink3, align: 'right' });
  };
  /** The brand mark: a small rounded tile in the dawn spectrum with a horizon and its sun. */
  const mark = (page: PDFPage, x: number, y: number, size: number): void => {
    const n = 14;
    for (let i = 0; i < n; i++)
      page.drawRectangle({
        x: x + (size * i) / n,
        y,
        width: size / n + 0.2,
        height: size,
        color: cAt([HEX.indigo, HEX.violet, HEX.rose], i / (n - 1)),
      });
    page.drawLine({
      start: { x: x + size * 0.18, y: y + size * 0.3 },
      end: { x: x + size * 0.82, y: y + size * 0.3 },
      thickness: 0.9,
      color: c('#ffffff'),
      opacity: 0.8,
    });
    page.drawCircle({ x: x + size * 0.66, y: y + size * 0.58, size: size * 0.14, color: c('#ffe3a6') });
  };

  const pages: PDFPage[] = [];
  const addPage = (): PDFPage => {
    const p = doc.addPage([W, H]);
    pages.push(p);
    return p;
  };
  /** Continuation pages open with a slim night strip naming the plan and the section. */
  const runningHead = (page: PDFPage, section: string): number => {
    nightPanel(page, 0, H - 40, W, 40);
    dawnBar(page, 0, H - 2.5, W, 2.5);
    mark(page, M, H - 27, 13);
    text(page, 'Longview Planner', M + 20, H - 24, 8.5, { f: bold, color: HEX.nightInk });
    text(page, safe(plan.name), M + 104, H - 24, 8.5, { color: HEX.nightInk2 });
    text(page, section, W - M, H - 24, 8.5, { color: HEX.nightInk2, align: 'right' });
    return H - 40 - 30;
  };

  // ---------------------------------------------------------------- page 1: the headline band

  const p1 = addPage();
  const bandH = 292;
  const bandY = H - bandH;
  nightPanel(p1, 0, bandY, W, bandH);
  dawnBar(p1, 0, H - 3, W, 3);

  mark(p1, M, H - 44, 16);
  text(p1, 'Longview Planner', M + 23, H - 39.5, 10, { f: bold, color: HEX.nightInk });
  text(p1, `Plan report · ${generated}`, W - M, H - 39.5, 8.5, { color: HEX.nightInk3, align: 'right' });

  // The plan's name, set large; long names wrap to a second line and then shrink to fit.
  let titleSize = 30;
  let titleLines = wrap(plan.name, titleSize, CW, bold);
  while (titleLines.length > 2 && titleSize > 18) {
    titleSize -= 2;
    titleLines = wrap(plan.name, titleSize, CW, bold);
  }
  titleLines = titleLines.slice(0, 2);
  let ty = H - 92;
  for (const line of titleLines) {
    text(p1, line, M, ty, titleSize, { f: bold, color: '#ffffff' });
    ty -= titleSize * 1.08;
  }
  text(
    p1,
    `${label} · ${s.startYear} to ${s.endYear} · today's dollars · data release ${result.dataRelease}`,
    M,
    ty - 4,
    9,
    { color: HEX.nightInk2 },
  );

  // Journey: the plan as a line of time with its turning points, as on the Overview.
  const jy = bandY + 128;
  const jx0 = M + 6;
  const jx1 = W - M - 6;
  const at = (year: number): number =>
    jx0 + ((jx1 - jx0) * (year - s.startYear)) / Math.max(1, s.endYear - s.startYear);
  const jn = 80;
  for (let i = 0; i < jn; i++) {
    const xA = jx0 + ((jx1 - jx0) * i) / jn;
    page_line(p1, xA, jy, xA + (jx1 - jx0) / jn + 0.3, jy, 2.6, cAt(DAWN, i / (jn - 1)));
  }
  p1.drawCircle({
    x: jx0,
    y: jy,
    size: 3.2,
    color: c(HEX.night1),
    borderColor: c('#b9b1ff'),
    borderWidth: 1.2,
  });
  p1.drawCircle({
    x: jx1,
    y: jy,
    size: 3.2,
    color: c(HEX.night1),
    borderColor: c(HEX.amber),
    borderWidth: 1.2,
  });
  text(p1, String(s.startYear), jx0 - 2, jy - 15, 7.5, { color: HEX.nightInk3 });
  text(p1, String(s.endYear), jx1 + 2, jy - 15, 7.5, { color: HEX.nightInk3, align: 'right' });
  const stops: { year: number; label: string; hex: string }[] = [];
  if (s.fiYear) stops.push({ year: s.fiYear, label: `Independent ${s.fiYear}`, hex: '#ffffff' });
  if (s.retirementYear)
    stops.push({ year: s.retirementYear, label: `Retire ${s.retirementYear}`, hex: HEX.amber });
  stops.forEach((st, i) => {
    const x = at(st.year);
    p1.drawCircle({ x, y: jy, size: 7, color: c(st.hex), opacity: 0.25 });
    p1.drawCircle({ x, y: jy, size: 3.6, color: c(st.hex) });
    // Two close years take opposite sides of the line so their labels never overprint.
    const above = i % 2 === 0;
    text(p1, st.label, x - 4, above ? jy + 9 : jy - 16, 8, { f: bold, color: HEX.nightInk });
  });

  // The four headline figures, divided by hairlines, as in the app's headline band.
  const covered = fundedStat(result);
  const kpis: { label: string; value: string; note: string }[] = [
    { label: 'Net worth today', value: short(s.currentNetWorth), note: `Start of ${s.startYear}` },
    {
      label: 'Left at the end of the plan',
      value: short(s.endingNetWorthReal),
      note: last ? `In ${s.endYear}, ${agesText(last)}` : `In ${s.endYear}`,
    },
    {
      label: 'Financially independent',
      value: s.fiYear ? String(s.fiYear) : 'Not reached',
      note: '25x a year of spending',
    },
    { label: 'Spending covered', value: covered.value, note: covered.note },
  ];
  const ky = bandY + 22;
  const kw = CW / kpis.length;
  p1.drawLine({
    start: { x: M, y: ky + 66 },
    end: { x: W - M, y: ky + 66 },
    thickness: 0.5,
    color: c(HEX.nightInk3),
    opacity: 0.25,
  });
  kpis.forEach((k, i) => {
    const x = M + kw * i;
    if (i > 0)
      p1.drawLine({
        start: { x: x - 0.5, y: ky + 2 },
        end: { x: x - 0.5, y: ky + 56 },
        thickness: 0.5,
        color: c(HEX.nightInk3),
        opacity: 0.25,
      });
    const pad = i === 0 ? 0 : 12;
    text(p1, k.label, x + pad, ky + 44, 8, { color: HEX.nightInk2 });
    let vs = 21;
    while (vs > 13 && bold.widthOfTextAtSize(safe(k.value), vs) > kw - pad - 8) vs -= 1;
    text(p1, k.value, x + pad, ky + 20, vs, { f: bold, color: '#ffffff' });
    const note = wrap(k.note, 7, kw - pad - 8)[0] ?? '';
    text(p1, note, x + pad, ky + 6, 7, { color: HEX.nightInk3 });
  });

  // ---------------------------------------------------------------- page 1: the net-worth chart

  const chartTop = bandY - 18;
  const chartH = 222;
  const chartY = chartTop - chartH;
  card(p1, M, chartY, CW, chartH);
  text(p1, 'Net worth over the plan', M + 16, chartTop - 24, 11.5, { f: bold });
  text(p1, "End of each year, in today's dollars", M + 16, chartTop - 37, 8, { color: HEX.ink3 });
  const vals = recs.map((r) => bal(r, r.netWorth));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const span = hi - lo || 1;
  const stepRaw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(stepRaw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= stepRaw) ?? stepRaw;
  const gLo = Math.floor(lo / step) * step;
  const gHi = Math.ceil(hi / step) * step;
  const plotL = M + 52;
  const plotR = W - M - 18;
  const plotB = chartY + 34;
  const plotT = chartTop - 56;
  const px = (i: number): number => plotL + ((plotR - plotL) * i) / Math.max(1, recs.length - 1);
  const py = (v: number): number => plotB + ((plotT - plotB) * (v - gLo)) / Math.max(1, gHi - gLo);
  for (let g = gLo; g <= gHi + step / 2; g += step) {
    const y = py(g);
    p1.drawLine({
      start: { x: plotL, y },
      end: { x: plotR, y },
      thickness: 0.5,
      color: c(g === 0 ? HEX.lineStrong : HEX.line),
      dashArray: g === 0 ? undefined : [2, 3],
    });
    text(p1, short(g), plotL - 8, y - 2.5, 7, { color: HEX.ink3, align: 'right' });
  }
  // Year labels, about eight across.
  const every = Math.max(1, Math.round(recs.length / 8));
  recs.forEach((r, i) => {
    if (i % every === 0 || i === recs.length - 1)
      text(p1, String(r.year), px(i), plotB - 13, 7, { color: HEX.ink3, align: 'center' });
  });
  // The fill: vertical slices in the dawn spectrum, fading toward the axis.
  const zeroY = py(Math.max(gLo, 0));
  for (let i = 1; i < recs.length; i++) {
    const x0 = px(i - 1);
    const x1 = px(i);
    const y0 = py(vals[i - 1]);
    const y1 = py(vals[i]);
    const col = along(DAWN, i / (recs.length - 1));
    for (let band = 0; band < 3; band++) {
      // Three stacked layers: strongest near the line, lightest near the axis.
      const f0 = band / 3;
      const f1 = (band + 1) / 3;
      const a0 = y0 + (zeroY - y0) * f0;
      const a1 = y1 + (zeroY - y1) * f0;
      const b0 = y0 + (zeroY - y0) * f1;
      const b1 = y1 + (zeroY - y1) * f1;
      const d = `M 0 ${-a0} L ${x1 - x0} ${-a1} L ${x1 - x0} ${-b1} L 0 ${-b0} Z`;
      p1.drawSvgPath(d, { x: x0, y: 0, color: rgb(...col), opacity: [0.26, 0.15, 0.06][band] });
    }
  }
  // Milestones on the chart: a dashed rule and a small label at the top.
  const markYear = (year: number | null, name: string, hex: string): void => {
    if (!year) return;
    const i = recs.findIndex((r) => r.year === year);
    if (i < 0) return;
    const x = px(i);
    p1.drawLine({
      start: { x, y: plotB },
      end: { x, y: plotT + 4 },
      thickness: 0.7,
      color: c(hex),
      dashArray: [2, 2],
    });
    if (!name) return;
    const lw = bold.widthOfTextAtSize(name, 6.5) + 10;
    const lx = Math.min(plotR - lw, Math.max(plotL, x - lw / 2));
    rounded(p1, lx, plotT + 4, lw, 12, 6, { fill: hex, opacity: 0.16 });
    text(p1, name, lx + lw / 2, plotT + 7.6, 6.5, { f: bold, color: HEX.ink, align: 'center' });
  };
  const fiX = s.fiYear ? recs.findIndex((r) => r.year === s.fiYear) : -1;
  const reX = s.retirementYear ? recs.findIndex((r) => r.year === s.retirementYear) : -1;
  if (fiX >= 0 && reX >= 0 && fiX !== reX && Math.abs(px(fiX) - px(reX)) < 90) {
    // Close together: both rules, one shared label.
    markYear(s.fiYear, '', HEX.violet);
    markYear(s.retirementYear, `Independent ${s.fiYear} · Retire ${s.retirementYear}`, HEX.amber);
  } else {
    markYear(s.retirementYear, `Retire ${s.retirementYear ?? ''}`, HEX.amber);
    if (s.fiYear !== s.retirementYear) markYear(s.fiYear, `Independent ${s.fiYear ?? ''}`, HEX.violet);
  }
  // The headline path: a soft bloom underneath, then the line itself in the dawn spectrum.
  for (const [width, opacity] of [
    [7, 0.08],
    [4, 0.14],
  ] as const)
    for (let i = 1; i < recs.length; i++)
      p1.drawLine({
        start: { x: px(i - 1), y: py(vals[i - 1]) - 1.5 },
        end: { x: px(i), y: py(vals[i]) - 1.5 },
        thickness: width,
        color: cAt(DAWN, i / (recs.length - 1)),
        opacity,
        lineCap: LineCapStyle.Round,
      });
  for (let i = 1; i < recs.length; i++)
    p1.drawLine({
      start: { x: px(i - 1), y: py(vals[i - 1]) },
      end: { x: px(i), y: py(vals[i]) },
      thickness: 2.2,
      color: cAt(DAWN, i / (recs.length - 1)),
      lineCap: LineCapStyle.Round,
    });
  // Years when spending ran short, marked along the axis in red.
  recs.forEach((r, i) => {
    if (r.shortfall > 1)
      p1.drawRectangle({ x: px(i) - 1.5, y: plotB - 4, width: 3, height: 3, color: c(HEX.danger) });
  });
  text(p1, short(vals[vals.length - 1]), px(recs.length - 1), py(vals[vals.length - 1]) + 7, 8, {
    f: bold,
    color: HEX.ink,
    align: 'right',
  });

  // ---------------------------------------------------------------- page 1: at a glance, and the outlook

  const lowTop = chartY - 16;
  const lowY = 64;
  const leftW = CW * 0.6 - 6;
  const rightW = CW - leftW - 12;
  card(p1, M, lowY, leftW, lowTop - lowY);
  text(p1, 'At a glance', M + 16, lowTop - 22, 11.5, { f: bold });
  const facts: [string, string][] = [
    ['Retirement', s.retirementYear ? String(s.retirementYear) : 'Not set'],
    ['Financially independent', s.fiYear ? String(s.fiYear) : 'Not reached'],
    ['Peak net worth', money(s.peakNetWorthReal)],
    ['Saving this year', pct(s.savingsRate)],
    ['Lifetime spending', money(s.lifetimeSpendingReal)],
    ['Lifetime tax (estimated)', money(s.lifetimeTaxReal)],
    ['Average tax rate', pct(s.averageEffectiveTaxRate, 1)],
    ['Net to heirs', money(result.estate.netToHeirs / (last?.cpiEnd ?? 1))],
  ];
  const rowH = Math.min(18, (lowTop - lowY - 46) / facts.length);
  facts.forEach(([k, v], i) => {
    const y = lowTop - 44 - i * rowH;
    if (i > 0)
      p1.drawLine({
        start: { x: M + 16, y: y + rowH - 5 },
        end: { x: M + leftW - 16, y: y + rowH - 5 },
        thickness: 0.5,
        color: c(HEX.line),
      });
    text(p1, k, M + 16, y, 8.5, { color: HEX.ink2 });
    text(p1, v, M + leftW - 16, y, 8.5, { f: bold, align: 'right' });
  });

  const rx = M + leftW + 12;
  if (mc) {
    // The chance of success as a dial, like the Outcomes screen: a dark track lit in the dawn spectrum.
    nightCard(rx, lowY, rightW, lowTop - lowY);
    text(p1, 'Chance of success', rx + 16, lowTop - 22, 11.5, { f: bold, color: HEX.nightInk });
    const cx = rx + rightW / 2;
    const cy = lowTop - 78;
    const r = 33;
    const seg = 90;
    for (let k = 0; k < seg; k++) {
      const a0 = Math.PI / 2 - (2 * Math.PI * k) / seg;
      const a1 = Math.PI / 2 - (2 * Math.PI * (k + 1)) / seg;
      const lit = k / seg < mc.successRate;
      p1.drawLine({
        start: { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
        end: { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
        thickness: 7,
        color: lit ? cAt(DAWN, k / seg) : c(HEX.nightInk3),
        opacity: lit ? 1 : 0.18,
      });
    }
    text(p1, formatShare(mc.successRate), cx, cy - 6, 17, { f: bold, color: '#ffffff', align: 'center' });
    text(p1, `of ${mc.runs.toLocaleString('en-US')} simulated futures`, cx, cy - r - 17, 7.5, {
      color: HEX.nightInk2,
      align: 'center',
    });
    text(p1, 'Middle 80% of ending wealth', cx, cy - r - 31, 7, { color: HEX.nightInk3, align: 'center' });
    text(
      p1,
      `${short(mc.endingPercentiles.p10)} to ${short(mc.endingPercentiles.p90)}`,
      cx,
      cy - r - 43,
      9.5,
      {
        f: bold,
        color: HEX.nightInk,
        align: 'center',
      },
    );
    text(
      p1,
      `${mc.method === 'bootstrap' ? 'Replayed history' : 'Random returns'} · seed ${mc.seed}`,
      cx,
      lowY + 10,
      6.5,
      { color: HEX.nightInk3, align: 'center' },
    );
  } else {
    card(p1, rx, lowY, rightW, lowTop - lowY);
    text(p1, 'Estate', rx + 16, lowTop - 22, 11.5, { f: bold });
    const est = result.estate;
    const toReal = (v: number): number => v / (last?.cpiEnd ?? 1);
    const rowsE: [string, string][] = [
      ['Estate at the end', short(toReal(est.value))],
      ['Estate tax', short(toReal(est.estateTax))],
      ['Heirs pay on pre-tax', short(toReal(est.heirPretaxDrag))],
      ['Net to heirs', short(toReal(est.netToHeirs))],
    ];
    rowsE.forEach(([k, v], i) => {
      const y = lowTop - 48 - i * 30;
      text(p1, k, rx + 16, y + 11, 7.5, { color: HEX.ink3 });
      text(p1, v, rx + 16, y - 3, 14, { f: bold, color: i === 3 ? HEX.primary : HEX.ink });
    });
    text(p1, 'Run the simulation to add the chance of success.', rx + 16, lowY + 12, 6.5, {
      color: HEX.ink3,
    });
  }

  function nightCard(x: number, y: number, w: number, h: number): void {
    rounded(p1, x + 0.5, y - 2, w, h, 12, { fill: '#1c1860', opacity: 0.08 });
    nightPanel(p1, x, y, w, h, 12);
    clipTo(p1, x, y, w, h, 12);
    dawnBar(p1, x, y + h - 2.2, w, 2.2);
    unclip(p1);
  }

  function page_line(
    page: PDFPage,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    t: number,
    color: RGB,
  ): void {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color });
  }

  // ---------------------------------------------------------------- year by year

  const cols: { head: string; w: number; get: (r: YearRecord) => string }[] = [
    { head: 'Year', w: 44, get: (r) => String(r.year) },
    { head: 'Ages', w: 46, get: (r) => r.ages.join(' / ') },
    { head: 'Income', w: 64, get: (r) => money(flow(r, r.income.total)) },
    { head: 'Withdrawn', w: 64, get: (r) => money(flow(r, r.withdrawals.total)) },
    { head: 'Spending', w: 64, get: (r) => money(flow(r, r.expenses.total)) },
    { head: 'Tax', w: 60, get: (r) => money(flow(r, r.taxes.total)) },
    { head: 'Saved', w: 60, get: (r) => money(flow(r, r.contributions.total)) },
    { head: 'Net worth', w: CW - 402, get: (r) => money(bal(r, r.netWorth)) },
  ];
  const rowHt = 13.2;
  let page = addPage();
  let y = runningHead(page, "Year by year · today's dollars");
  sectionTitle(page, 'Year by year', M, y, "Today's dollars · net worth at the end of each year");
  y -= 26;
  const tableHead = (): void => {
    rounded(page, M, y - 16, CW, 20, 6, { fill: HEX.night1 });
    let x = M;
    cols.forEach((col, i) => {
      text(page, col.head, i === 0 ? x + 8 : x + col.w - 6, y - 9.5, 7.5, {
        f: bold,
        color: HEX.nightInk,
        align: i === 0 ? 'left' : 'right',
      });
      x += col.w;
    });
    y -= 22;
  };
  tableHead();
  recs.forEach((r, ri) => {
    if (y < 76) {
      page = addPage();
      y = runningHead(page, "Year by year · today's dollars, continued");
      tableHead();
    }
    const milestone = r.milestones.length > 0;
    const shortYear = r.shortfall > 1;
    if (milestone) rounded(page, M, y - rowHt + 3, CW, rowHt, 4, { fill: HEX.primarySoft });
    else if (ri % 2 === 1)
      page.drawRectangle({ x: M, y: y - rowHt + 3, width: CW, height: rowHt, color: c(HEX.surface2) });
    let x = M;
    cols.forEach((col, i) => {
      const v = col.get(r);
      const isNet = i === cols.length - 1;
      text(page, v, i === 0 ? x + 8 : x + col.w - 6, y - 6.5, 7.5, {
        f: i === 0 || isNet || milestone ? bold : font,
        color: isNet && shortYear ? HEX.danger : i === 0 ? HEX.ink : HEX.ink2,
        align: i === 0 ? 'left' : 'right',
      });
      x += col.w;
    });
    // Milestone years carry an amber dot; their names are listed under the table.
    if (milestone) page.drawCircle({ x: M + 3.5, y: y - 3.8, size: 2, color: c(HEX.amber) });
    y -= rowHt;
  });
  // Legend for the table's marks.
  y -= 6;
  page.drawCircle({ x: M + 3.5, y: y - 2.5, size: 2, color: c(HEX.amber) });
  text(page, 'Milestone year (highlighted)', M + 10, y - 5, 7, { color: HEX.ink3 });
  if (recs.some((r) => r.shortfall > 1)) {
    page.drawRectangle({ x: M + 140, y: y - 4.5, width: 6, height: 4, color: c(HEX.danger) });
    text(page, 'Net worth in red: spending could not be fully paid that year', M + 150, y - 5, 7, {
      color: HEX.ink3,
    });
  }
  y -= 18;

  // Milestones, named.
  const named = recs.filter((r) => r.milestones.length);
  if (named.length) {
    if (y < 140) {
      page = addPage();
      y = runningHead(page, 'Milestones and assumptions');
    }
    y -= 20;
    sectionTitle(page, 'Milestones', M, y);
    y -= 24;
    for (const r of named) {
      if (y < 80) {
        page = addPage();
        y = runningHead(page, 'Milestones and assumptions');
      }
      rounded(page, M, y - 14, 46, 17, 8.5, { fill: HEX.primarySoft });
      text(page, String(r.year), M + 23, y - 9, 8, { f: bold, color: HEX.primary, align: 'center' });
      text(page, r.milestones.join(', '), M + 56, y - 9, 8.5, { f: bold });
      text(page, r.ages.length > 1 ? `ages ${r.ages.join(' and ')}` : `age ${r.ages[0]}`, W - M, y - 9, 8, {
        color: HEX.ink3,
        align: 'right',
      });
      y -= 21;
    }
  }

  // ---------------------------------------------------------------- assumptions and sources

  const A = plan.assumptions;
  const proj = recs.find((r) => r.dataStatus === 'projected');
  const assumptions: [string, string][] = [
    [
      'Expected returns',
      A.returns.mode === 'historicalAverage'
        ? 'Long-run averages of the bundled market history (US stocks, bonds, cash)'
        : `US stocks ${pct(A.returns.fixed.usStocks, 1)}, US bonds ${pct(A.returns.fixed.usBonds, 1)}, cash ${pct(A.returns.fixed.cash, 1)}`,
    ],
    [
      'Inflation',
      A.returns.mode === 'historicalAverage'
        ? 'Long-run average of the bundled history'
        : pct(A.inflation.rate, 1),
    ],
    [
      'Healthcare costs',
      `${(A.healthcareInflation.excessOverCpi * 100).toFixed(1)} points faster than inflation`,
    ],
    ['Tax and health tables', `Data release ${result.dataRelease}`],
    [
      'Projected tables',
      proj ? `From ${proj.year}: latest enacted figures indexed for inflation` : 'None: all years enacted',
    ],
    ['Plan last changed', new Date(plan.updatedAt).toISOString().slice(0, 10)],
  ];
  const notes = result.warnings.slice(0, 6);
  const needH = 60 + assumptions.length * 17 + notes.length * 22;
  if (y - needH < 70) {
    page = addPage();
    y = runningHead(page, 'Assumptions and sources');
  }
  y -= 22;
  sectionTitle(page, 'Assumptions and sources', M, y);
  y -= 22;
  const boxH = assumptions.length * 17 + 14;
  card(page, M, y - boxH, CW, boxH);
  assumptions.forEach(([k, v], i) => {
    const yy = y - 15 - i * 17;
    if (i > 0)
      page.drawLine({
        start: { x: M + 14, y: yy + 12 },
        end: { x: W - M - 14, y: yy + 12 },
        thickness: 0.5,
        color: c(HEX.line),
      });
    text(page, k, M + 14, yy, 8.5, { color: HEX.ink2 });
    text(page, wrap(v, 8.5, CW - 190)[0] ?? '', W - M - 14, yy, 8.5, { f: bold, align: 'right' });
  });
  y -= boxH + 16;
  if (notes.length) {
    text(page, 'Notes on these figures', M, y, 9.5, { f: bold });
    y -= 14;
    for (const n of notes) {
      const lines = wrap(n, 8, CW - 14);
      if (y - lines.length * 11 < 70) {
        page = addPage();
        y = runningHead(page, 'Assumptions and sources, continued');
      }
      page.drawCircle({ x: M + 3, y: y + 2.5, size: 1.6, color: c(HEX.violet) });
      for (const l of lines) {
        text(page, l, M + 12, y, 8, { color: HEX.ink2 });
        y -= 11;
      }
      y -= 3;
    }
  }
  y -= 6;
  for (const l of wrap(
    'Sources and retrieval dates for every dataset are listed in the app under How this is calculated. Every figure in this report is an estimate from the plan and these assumptions, not a forecast.',
    7.5,
    CW,
  )) {
    text(page, l, M, y, 7.5, { color: HEX.ink3 });
    y -= 10;
  }

  // ---------------------------------------------------------------- footers: disclaimer and page numbers

  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: c(HEX.line) });
    const lines = wrap(DISCLAIMER, 6.5, CW - 110);
    lines.forEach((l, k) => text(pg, l, M, 32 - k * 8.5, 6.5, { color: HEX.ink3 }));
    text(pg, `Page ${i + 1} of ${pages.length}`, W - M, 32, 7, { f: bold, color: HEX.ink2, align: 'right' });
    text(pg, `Longview Planner · ${generated}`, W - M, 23.5, 6.5, { color: HEX.ink3, align: 'right' });
  });

  return doc.save();
}
