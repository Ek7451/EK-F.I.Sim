import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngineData } from '@fisim/data/src/node';
import { SAMPLE_PLANS, compilePlan, project, runMonteCarlo } from '@fisim/engine';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildReportPdf } from './report-pdf';

const data = loadEngineData();

describe('PDF plan report', () => {
  it.each(Object.keys(SAMPLE_PLANS))(
    '%s: builds a valid multi-page report, with and without a simulation',
    async (id) => {
      const plan = SAMPLE_PLANS[id as keyof typeof SAMPLE_PLANS](2026);
      const result = project(plan, data);
      const mc = runMonteCarlo(compilePlan(plan, data), { runs: 200 });
      for (const [tag, summary] of [
        ['plain', null],
        ['simulated', mc],
      ] as const) {
        const bytes = await buildReportPdf(plan, result, summary, 'As planned');
        expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
        const doc = await PDFDocument.load(bytes);
        // Page 1 is the summary; the year table needs at least one more page.
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
        expect(doc.getTitle()).toBe(`${plan.name}: plan report`);
        // Set REPORT_OUT to a folder to look at the pages.
        if (process.env.REPORT_OUT) writeFileSync(join(process.env.REPORT_OUT, `${id}-${tag}.pdf`), bytes);
      }
    },
    60_000,
  );

  it('does not fail on characters the built-in PDF fonts lack', async () => {
    const plan = { ...SAMPLE_PLANS[Object.keys(SAMPLE_PLANS)[0] as keyof typeof SAMPLE_PLANS](2026) };
    plan.name = 'Plan 🌅 für Zoë − 退休 “quoted”';
    const bytes = await buildReportPdf(plan, project(plan, data), null, 'What-if: 退休');
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  }, 30_000);
});
