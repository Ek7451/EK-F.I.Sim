/** Encrypted backups (SYNC-03), CSV (RPT-05) and PDF reports (RPT-04), all generated on this device. */
import { exportEncrypted, importEncrypted } from '@fisim/crypto';
import { recordsToCsv, type McSummary, type Plan, type ProjectionResult } from '@fisim/engine';
import { DISCLAIMER } from '../shell/nav';

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'plan';

export async function exportBackup(plans: Plan[], passphrase: string): Promise<string> {
  const file = await exportEncrypted(passphrase, {
    kind: 'longview-backup',
    exportedAt: new Date().toISOString(),
    plans,
  });
  const name = `${plans.length === 1 ? slug(plans[0].name) : 'longview-all-plans'}-${new Date().toISOString().slice(0, 10)}.longview`;
  download(name, file, 'application/json');
  return name;
}

export async function readBackup(file: File, passphrase: string): Promise<unknown[]> {
  const data = (await importEncrypted(passphrase, await file.text())) as { kind?: string; plans?: unknown[] };
  if (data?.kind !== 'longview-backup' || !Array.isArray(data.plans))
    throw new Error('This file is not a Longview backup.');
  return data.plans;
}

export function exportCsv(plan: Plan, result: ProjectionResult, label: string): void {
  const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const metadata = [
    plan.name,
    label,
    'nominal USD; net_worth_todays_dollars uses start-year purchasing power',
    result.dataRelease,
    plan.updatedAt,
  ]
    .map(quote)
    .join(',');
  const lines = recordsToCsv(result.records).trimEnd().split('\n');
  const csv =
    lines
      .map(
        (line, i) =>
          `${line},${i === 0 ? 'plan_name,scenario,dollar_basis,data_release,plan_updated_at' : metadata}`,
      )
      .join('\n') + '\n';
  download(`${slug(plan.name)}-${slug(label)}-yearly.csv`, csv, 'text/csv');
}

const money = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;

/** Client-side PDF built with pdf-lib (lazy-loaded). Numbers come from the same records the screens show. */
export async function exportPdf(
  plan: Plan,
  result: ProjectionResult,
  mc: McSummary | null,
  label: string,
): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`${plan.name}: plan report`);
  doc.setCreator('Longview');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = bold;
  const ink = rgb(0.11, 0.15, 0.2);
  const muted = rgb(0.36, 0.4, 0.44);
  const green = rgb(0.31, 0.36, 0.84);
  const W = 612;
  const H = 792;
  const M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const footer = (): void => {
    page.drawText(DISCLAIMER, {
      x: M,
      y: 28,
      size: 7,
      font,
      color: muted,
      maxWidth: W - 2 * M,
      lineHeight: 9,
    });
    page.drawText(`Longview · ${result.dataRelease} · generated ${new Date().toISOString().slice(0, 10)}`, {
      x: M,
      y: 16,
      size: 7,
      font,
      color: muted,
    });
  };
  const newPage = (): void => {
    footer();
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const need = (h: number): void => {
    if (y - h < 56) newPage();
  };
  const text = (s: string, size = 10, f = font, color = ink, x = M): void => {
    let rest = s;
    while (rest.length) {
      let end = rest.length;
      while (end > 1 && f.widthOfTextAtSize(rest.slice(0, end), size) > W - M - x) end--;
      const space = rest.lastIndexOf(' ', end);
      if (end < rest.length && space > end / 2) end = space;
      need(size + 4);
      page.drawText(rest.slice(0, end), { x, y: y - size, size, font: f, color });
      y -= size + 5;
      rest = rest.slice(end).trimStart();
    }
  };
  const para = (s: string, size = 9): void => {
    const words = s.split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > W - 2 * M) {
        text(line, size, font, muted);
        line = w;
      } else line = t;
    }
    if (line) text(line, size, font, muted);
  };
  const heading = (s: string): void => {
    y -= 10;
    need(30);
    page.drawText(s, { x: M, y: y - 14, size: 14, font: serif, color: ink });
    y -= 22;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: muted });
    y -= 8;
  };
  const row = (cells: string[], widths: number[], f = font, size = 8): void => {
    need(size + 5);
    let x = M;
    cells.forEach((c, i) => {
      const cellSize = Math.min(size, (size * (widths[i] - 8)) / Math.max(1, f.widthOfTextAtSize(c, size)));
      const w = f.widthOfTextAtSize(c, cellSize);
      page.drawText(c, {
        x: i === 0 ? x : x + widths[i] - w - 4,
        y: y - size,
        size: cellSize,
        font: f,
        color: ink,
      });
      x += widths[i];
    });
    y -= size + 5;
  };

  const s = result.summary;
  const recs = result.records;
  page.drawText('Longview', { x: M, y: y - 12, size: 12, font: bold, color: green });
  y -= 26;
  text(plan.name, 24, serif);
  y -= 7;
  text(
    `${label} · ${s.startYear} to ${s.endYear} · amounts in today's dollars unless marked`,
    9,
    font,
    muted,
  );
  para(DISCLAIMER);

  heading('Summary');
  const stats: [string, string][] = [
    ['Net worth today', money(s.currentNetWorth)],
    ['Net worth at the end of the plan', money(s.endingNetWorthReal)],
    ['Financially independent', s.fiYear ? String(s.fiYear) : 'Not reached'],
    ['Retirement', s.retirementYear ? String(s.retirementYear) : 'Not set'],
    ['Spending funded on the expected path', s.success ? 'Every year' : `Until ${s.failedYear}`],
    ['Lifetime tax (estimated)', money(s.lifetimeTaxReal)],
    ['Lifetime spending', money(s.lifetimeSpendingReal)],
    ['Estate, net to heirs', money(result.estate.netToHeirs / (recs[recs.length - 1]?.cpiEnd ?? 1))],
  ];
  if (mc)
    stats.push(
      [
        'Chance of success (estimated)',
        `${Math.round(mc.successRate * 100)}% of ${mc.runs.toLocaleString()} simulated runs, seed ${mc.seed}`,
      ],
      [
        'Ending wealth, 10th to 90th percentile',
        `${money(mc.endingPercentiles.p10)} to ${money(mc.endingPercentiles.p90)}`,
      ],
    );
  for (const [k, v] of stats) row([k, v], [260, 256]);

  // Net worth chart (drawn as vector lines so the report stays small and sharp).
  heading('Net worth over time');
  need(190);
  const ch = 160;
  const cw = W - 2 * M - 40;
  const x0 = M + 40;
  const y0 = y - ch;
  const vals = recs.map((r) => r.netWorth / r.cpiEnd);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  for (let i = 0; i <= 4; i++) {
    const gy = y0 + (ch * i) / 4;
    page.drawLine({
      start: { x: x0, y: gy },
      end: { x: x0 + cw, y: gy },
      thickness: 0.3,
      color: rgb(0.8, 0.8, 0.78),
    });
    const lab = money(min + ((max - min) * i) / 4);
    page.drawText(lab, {
      x: x0 - 4 - font.widthOfTextAtSize(lab, 6.5),
      y: gy - 2,
      size: 6.5,
      font,
      color: muted,
    });
  }
  const px = (i: number): number => x0 + (cw * i) / Math.max(1, recs.length - 1);
  const py = (v: number): number => y0 + (ch * (v - min)) / (max - min);
  for (let i = 1; i < recs.length; i++)
    page.drawLine({
      start: { x: px(i - 1), y: py(vals[i - 1]) },
      end: { x: px(i), y: py(vals[i]) },
      thickness: 1.6,
      color: green,
    });
  for (let i = 0; i < recs.length; i += Math.max(1, Math.round(recs.length / 8)))
    page.drawText(String(recs[i].year), { x: px(i) - 8, y: y0 - 10, size: 6.5, font, color: muted });
  y = y0 - 20;

  heading('Year by year');
  const widths = [36, 44, 72, 72, 72, 66, 72, 82];
  const head = ['Year', 'Age', 'Income', 'Withdrawn', 'Spending', 'Tax', 'Saved', 'Net worth'];
  row(head, widths, bold);
  for (const r of recs) {
    if (y < 70) {
      newPage();
      row(head, widths, bold);
    }
    row(
      [
        String(r.year),
        r.ages.join('/'),
        money(r.income.total / r.cpi),
        money(r.withdrawals.total / r.cpi),
        money(r.expenses.total / r.cpi),
        money(r.taxes.total / r.cpi),
        money(r.contributions.total / r.cpi),
        money(r.netWorth / r.cpiEnd),
      ],
      widths,
    );
  }

  heading('Assumptions and sources');
  const A = plan.assumptions;
  para(
    `Expected returns: US stocks ${(A.returns.fixed.usStocks * 100).toFixed(1)}%, US bonds ${(A.returns.fixed.usBonds * 100).toFixed(1)}%, cash ${(A.returns.fixed.cash * 100).toFixed(1)}%. Inflation ${(A.inflation.rate * 100).toFixed(1)}%; healthcare costs rise ${(A.healthcareInflation.excessOverCpi * 100).toFixed(1)} points faster.`,
  );
  const proj = recs.find((r) => r.dataStatus === 'projected');
  para(
    `Tax and health parameters: data release ${result.dataRelease}. ${proj ? `Years from ${proj.year} use projected tables (the latest enacted figures indexed for inflation).` : 'All years use enacted tables.'} Sources and retrieval dates for every dataset are listed in the app under How this is calculated.`,
  );
  for (const w of result.warnings.slice(0, 6)) para(`Note: ${w}`);
  footer();
  const bytes = await doc.save();
  download(
    `${slug(plan.name)}-${slug(label)}-report.pdf`,
    bytes as Uint8Array<ArrayBuffer>,
    'application/pdf',
  );
}
