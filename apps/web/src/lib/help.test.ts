import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP, NO_HELP, helpText } from './help';

const FIELDS = new Set([
  'TextField',
  'MoneyField',
  'PercentField',
  'NumberField',
  'SelectField',
  'Switch',
  'Slider',
  'GrowthField',
  'WhenField',
]);
const pages = join(__dirname, '..', 'pages');
const files = [
  ...readdirSync(join(pages, 'plan')).map((f) => join(pages, 'plan', f)),
  join(pages, 'StartWizard.tsx'),
].filter((f) => f.endsWith('.tsx'));

/** Every literal `label="…"` on a field component, with the file it came from. */
function fieldLabels(): { label: string; file: string; explicit: boolean }[] {
  const out: { label: string; file: string; explicit: boolean }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/label="([^"]+)"/g)) {
      // The component this attribute belongs to is the nearest JSX tag opened before it.
      const before = src.slice(0, m.index);
      const tag = /<([A-Z]\w*)\b[^<]*$/.exec(before)?.[1];
      if (!tag || !FIELDS.has(tag)) continue;
      const after = src.slice(m.index, src.indexOf('/>', m.index));
      out.push({ label: m[1], file, explicit: /\bhelp=/.test(before.slice(before.lastIndexOf('<')) + after) });
    }
  }
  return out;
}

describe('field help', () => {
  it('every field label in the plan editors and the wizard has help text, or is listed as needing none', () => {
    const missing = fieldLabels()
      .filter((x) => !x.explicit && !NO_HELP.has(x.label) && HELP[x.label] === undefined)
      .map((x) => `${x.label}  (${x.file.split(/[\\/]/).slice(-2).join('/')})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every alias points at an entry that exists', () => {
    for (const [key, text] of Object.entries(HELP)) {
      if (!text.startsWith('@see ')) continue;
      expect(HELP[text.slice(5)], `${key} -> ${text}`).toBeDefined();
      expect(helpText(key), key).not.toMatch(/^@/);
    }
  });

  it('dollar limits quoted in help match the bundled 2026 limits', () => {
    const limits = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'data', 'limits', '2026.json'), 'utf8'),
    ) as { electiveDeferral: number; catchUp50: number; catchUp60to63: number; annualAdditions: number };
    const fmt = (n: number): string => `$${n.toLocaleString('en-US')}`;
    const contrib = helpText('Contribution (share of pay)')!;
    expect(contrib).toContain(fmt(limits.electiveDeferral));
    expect(contrib).toContain(fmt(limits.catchUp50));
    expect(contrib).toContain(fmt(limits.catchUp60to63));
    expect(helpText('Mega-backdoor Roth: after-tax contributions up to the plan limit, converted to Roth')).toContain(
      fmt(limits.annualAdditions),
    );
  });
});
