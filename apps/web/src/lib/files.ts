/** Encrypted backups (SYNC-03), CSV (RPT-05) and PDF reports (RPT-04), all generated on this device. */
import { exportEncrypted, importEncrypted } from '@fisim/crypto';
import { recordsToCsv, type McSummary, type Plan, type ProjectionResult } from '@fisim/engine';

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

/** The PDF plan report (lib/report-pdf.ts, loaded on demand), in the app's own visual style. */
export async function exportPdf(
  plan: Plan,
  result: ProjectionResult,
  mc: McSummary | null,
  label: string,
): Promise<void> {
  const { buildReportPdf } = await import('./report-pdf');
  const bytes = await buildReportPdf(plan, result, mc, label);
  download(
    `${slug(plan.name)}-${slug(label)}-report.pdf`,
    bytes as Uint8Array<ArrayBuffer>,
    'application/pdf',
  );
}
