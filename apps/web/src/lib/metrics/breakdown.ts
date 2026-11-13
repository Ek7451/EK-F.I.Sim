/**
 * What a bar is made of. Each chart segment (a spending category on Cash flow, a tax type on Taxes) can be
 * opened into the engine's own component figures for that year, with what moved since the year before, so a
 * spike explains itself. Nothing here re-derives a figure: every line is a field of the YearRecord, and the
 * lines of a breakdown always add up to the bar it explains.
 */
import { toReal, type Plan, type YearRecord } from '@fisim/engine';
import { formatMoney, formatPct } from '@fisim/ui';
import { annualMetrics, type DollarBasis } from './index';

export type BreakdownKey =
  'spending' | 'living' | 'housing' | 'healthcare' | 'taxes' | 'federal' | 'payroll' | 'state' | 'penalties';

export interface BreakdownLine {
  id: string;
  label: string;
  /** Display dollars (today's or future, as asked for). Negative for a credit. */
  amount: number;
  note?: string;
  /** Where the inputs behind this line are edited. */
  route?: string;
  /** A line that is itself a category: opening it shows that category's breakdown. */
  drill?: BreakdownKey;
}
export interface BreakdownChange {
  id: string;
  label: string;
  /** This year minus the year before, in display dollars. */
  delta: number;
  reason?: string;
}
export interface Breakdown {
  key: BreakdownKey;
  label: string;
  year: number;
  /** The value of the bar: the lines add up to this. */
  total: number;
  lines: BreakdownLine[];
  /** Context that drives the lines but is not part of the sum (coverage, income, filing status). */
  facts: { label: string; value: string }[];
  notes: string[];
  previousYear: number | null;
  previousTotal: number | null;
  /** The lines that moved most since the previous year, largest first. */
  changes: BreakdownChange[];
  /** The screen where this category's inputs live. */
  route: string;
  routeLabel: string;
}

export const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  spending: 'Spending and taxes',
  living: 'Living',
  housing: 'Housing and debt',
  healthcare: 'Healthcare',
  taxes: 'Taxes',
  federal: 'Federal income tax',
  payroll: 'Payroll tax',
  state: 'State income tax',
  penalties: 'Penalties',
};

const SPENDING_CATEGORY: Record<string, string> = {
  housing: 'Rent and home bills',
  food: 'Food and everyday',
  transport: 'Transport',
  travel: 'Travel and leisure',
  healthcare: 'Health (entered as spending)',
  education: 'Education',
  childcare: 'Childcare',
  insurance: 'Insurance',
  giving: 'Giving',
  discretionary: 'Discretionary',
  other: 'Other',
};
const COVERAGE: Record<string, string> = {
  employer: 'an employer plan',
  spouseEmployer: "a spouse's employer plan",
  cobra: 'COBRA',
  aca: 'a marketplace plan',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  none: 'no coverage',
};
const coverage = (c: string | undefined): string => COVERAGE[c ?? 'none'] ?? c ?? 'no coverage';

interface Raw {
  id: string;
  label: string;
  /** Nominal dollars of the record's own year. */
  amount: number;
  note?: string;
  route?: string;
  drill?: BreakdownKey;
}

function names(list: string[], max = 3): string {
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} +${list.length - max} more`;
}

/** The nominal component lines of one category in one year. Their sum is the bar. */
function rawLines(key: BreakdownKey, r: YearRecord, plan: Plan | null): Raw[] {
  const e = r.expenses;
  const t = r.taxes;
  const h = e.healthcare;
  switch (key) {
    case 'spending':
      return [
        { id: 'living', label: 'Living', amount: e.living, drill: 'living' },
        {
          id: 'housing',
          label: 'Housing and debt',
          amount: annualMetrics.housing.nominal(r),
          drill: 'housing',
        },
        { id: 'healthcare', label: 'Healthcare', amount: h.total, drill: 'healthcare' },
        { id: 'taxes', label: 'Taxes', amount: Math.max(0, t.total), drill: 'taxes' },
      ];
    case 'living': {
      const lines: Raw[] = Object.entries(e.byCategory)
        .filter(([, v]) => Math.abs(v) >= 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amount]) => {
          const items = plan?.expenses.filter((x) => x.category === cat).map((x) => x.name) ?? [];
          return {
            id: `cat:${cat}`,
            label: SPENDING_CATEGORY[cat] ?? cat,
            amount,
            note: items.length ? names(items) : undefined,
            route: '/plan/spending',
          };
        });
      const rest = e.living - lines.reduce((s, l) => s + l.amount, 0);
      if (Math.abs(rest) >= 0.5)
        lines.push({ id: 'cat:rest', label: 'Other living costs', amount: rest, route: '/plan/spending' });
      return lines;
    }
    case 'housing': {
      const interest = Math.max(0, Math.min(e.debtService, e.debtInterest));
      return [
        {
          id: 'property',
          label: 'Property tax, insurance and upkeep',
          amount: e.housing,
          note: 'On homes and other property you own',
          route: '/plan/snapshot',
        },
        { id: 'interest', label: 'Loan interest', amount: interest, route: '/plan/snapshot' },
        {
          id: 'principal',
          label: 'Loan principal repaid',
          amount: e.debtService - interest,
          note: 'Reduces what you owe; not lost money',
          route: '/plan/snapshot',
        },
        {
          id: 'purchases',
          label: 'Purchases and closing costs',
          amount: e.purchases,
          note: 'Down payments, one-off purchases, refinancing costs',
          route: '/plan/snapshot',
        },
      ];
    }
    case 'healthcare': {
      const other = h.premiums - h.medicare - h.irmaa;
      const lines: Raw[] = [
        {
          id: 'premiums',
          label: 'Insurance premiums',
          amount: other,
          note: 'Employer share, marketplace, COBRA, Medigap and Part D',
          route: '/plan/healthcare',
        },
        { id: 'medicare', label: 'Medicare Part B', amount: h.medicare, route: '/plan/healthcare' },
        {
          id: 'irmaa',
          label: 'Medicare income surcharge (IRMAA)',
          amount: h.irmaa,
          note: 'Set by income two years earlier',
          route: '/explore/taxes',
        },
        {
          id: 'oop',
          label: 'Out-of-pocket care',
          amount: h.outOfPocket,
          note: 'Deductibles, copays and uncovered care',
          route: '/plan/healthcare',
        },
        { id: 'ltc', label: 'Long-term care', amount: h.ltc, route: '/plan/healthcare' },
      ];
      const rest = h.total - lines.reduce((s, l) => s + l.amount, 0);
      if (Math.abs(rest) >= 0.5) lines.push({ id: 'rest', label: 'Other adjustments', amount: rest });
      return lines;
    }
    case 'federal': {
      const before = t.ordinaryTax + t.capitalGainsTax + t.amt + t.niit;
      return [
        {
          id: 'ordinary',
          label: 'Tax at ordinary rates',
          amount: t.ordinaryTax,
          note: 'Pay, pre-tax withdrawals, conversions, interest',
        },
        {
          id: 'gains',
          label: 'Tax on gains and qualified dividends',
          amount: t.capitalGainsTax,
        },
        { id: 'amt', label: 'Alternative minimum tax', amount: t.amt },
        { id: 'niit', label: 'Net investment income tax', amount: t.niit },
        { id: 'credits', label: 'Credits', amount: t.federalIncome - before },
      ];
    }
    case 'payroll':
      return [
        {
          id: 'fica',
          label: 'Social Security and Medicare on pay',
          amount: t.fica,
          note: 'Includes the additional Medicare tax on high pay',
        },
        { id: 'se', label: 'Self-employment tax', amount: t.selfEmployment },
      ];
    case 'state':
      return [{ id: 'state', label: `${r.state} income tax`, amount: t.state }];
    case 'penalties':
      return [
        {
          id: 'penalties',
          label: 'Early-withdrawal and other penalties',
          amount: t.penalties,
          route: '/plan/strategy',
        },
      ];
    case 'taxes': {
      const before = t.ordinaryTax + t.capitalGainsTax + t.amt + t.niit;
      const lines: Raw[] = [
        { id: 'ordinary', label: 'Federal tax at ordinary rates', amount: t.ordinaryTax, drill: 'federal' },
        { id: 'gains', label: 'Federal tax on gains', amount: t.capitalGainsTax, drill: 'federal' },
        { id: 'amt', label: 'Alternative minimum tax', amount: t.amt, drill: 'federal' },
        { id: 'niit', label: 'Net investment income tax', amount: t.niit, drill: 'federal' },
        { id: 'credits', label: 'Federal credits', amount: t.federalIncome - before, drill: 'federal' },
        { id: 'fica', label: 'Payroll tax', amount: t.fica, drill: 'payroll' },
        { id: 'se', label: 'Self-employment tax', amount: t.selfEmployment, drill: 'payroll' },
        { id: 'state', label: `${r.state} income tax`, amount: t.state, drill: 'state' },
        { id: 'penalties', label: 'Penalties', amount: t.penalties, drill: 'penalties' },
        {
          id: 'ptc',
          label: 'Premium tax credit',
          amount: -t.ptc,
          note: 'Lowers marketplace premiums; counted against tax',
          route: '/plan/healthcare',
        },
      ];
      const rest = t.total - lines.reduce((s, l) => s + l.amount, 0);
      if (Math.abs(rest) >= 0.5) lines.push({ id: 'rest', label: 'Other adjustments', amount: rest });
      return lines;
    }
  }
}

/** The value of the bar a breakdown explains, in nominal dollars. */
export function breakdownTotal(key: BreakdownKey, r: YearRecord): number {
  const t = r.taxes;
  switch (key) {
    case 'spending':
      return (
        r.expenses.living +
        annualMetrics.housing.nominal(r) +
        r.expenses.healthcare.total +
        Math.max(0, t.total)
      );
    case 'living':
      return r.expenses.living;
    case 'housing':
      return annualMetrics.housing.nominal(r);
    case 'healthcare':
      return r.expenses.healthcare.total;
    case 'taxes':
      return t.total;
    case 'federal':
      return t.federalIncome;
    case 'payroll':
      return t.fica + t.selfEmployment;
    case 'state':
      return t.state;
    case 'penalties':
      return t.penalties;
  }
}

const ROUTES: Record<BreakdownKey, [string, string]> = {
  spending: ['/plan/spending', 'Edit spending'],
  living: ['/plan/spending', 'Edit spending'],
  housing: ['/plan/snapshot', 'Edit property and loans'],
  healthcare: ['/plan/healthcare', 'Edit coverage and costs'],
  taxes: ['/explore/taxes', 'Open the tax detail'],
  federal: ['/plan/strategy', 'Adjust withdrawals and conversions'],
  payroll: ['/plan/income', 'Edit income'],
  state: ['/plan/household', 'Edit where you live'],
  penalties: ['/plan/strategy', 'See penalty-free options'],
};

export function buildBreakdown(
  key: BreakdownKey,
  record: YearRecord,
  previous: YearRecord | null,
  opts: { basis: DollarBasis; plan?: Plan | null },
): Breakdown {
  const plan = opts.plan ?? null;
  const show = (r: YearRecord, x: number): number => (opts.basis === 'real' ? toReal(x, r, 'flow') : x);
  const money = (r: YearRecord, x: number): string => formatMoney(show(r, x));
  const lines: BreakdownLine[] = rawLines(key, record, plan)
    .map((l) => ({ ...l, amount: show(record, l.amount) }))
    .filter((l) => Math.abs(l.amount) >= 0.5);
  const total = show(record, breakdownTotal(key, record));

  let changes: BreakdownChange[] = [];
  let previousTotal: number | null = null;
  if (previous) {
    previousTotal = show(previous, breakdownTotal(key, previous));
    const before = new Map(rawLines(key, previous, plan).map((l) => [l.id, l]));
    const now = new Map(rawLines(key, record, plan).map((l) => [l.id, l]));
    const floor = Math.max(50, 0.02 * Math.max(Math.abs(total), Math.abs(previousTotal)));
    changes = [...new Set([...now.keys(), ...before.keys()])]
      .map((id) => {
        const a = now.get(id);
        const b = before.get(id);
        return {
          id,
          label: (a ?? b)!.label,
          delta: (a ? show(record, a.amount) : 0) - (b ? show(previous, b.amount) : 0),
          reason: reasonFor(id, key, record, previous, plan, money),
        };
      })
      .filter((c) => Math.abs(c.delta) >= floor)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);
    // One cause often moves several lines (a change of coverage moves premiums and out-of-pocket costs):
    // say it once, on the line it moved most.
    const said = new Set<string>();
    for (const c of changes) {
      if (c.reason && said.has(c.reason)) c.reason = undefined;
      else if (c.reason) said.add(c.reason);
    }
  }

  return {
    key,
    label: BREAKDOWN_LABELS[key],
    year: record.year,
    total,
    lines,
    facts: factsFor(key, record, plan, money),
    notes: notesFor(key, record, money),
    previousYear: previous?.year ?? null,
    previousTotal,
    changes,
    route: ROUTES[key][0],
    routeLabel: ROUTES[key][1],
  };
}

type Money = (r: YearRecord, x: number) => string;

/** People whose coverage changed between two years, in words. */
function coverageMoves(r: YearRecord, prev: YearRecord, plan: Plan | null): string[] {
  const out: string[] = [];
  r.coverage.forEach((c, i) => {
    const was = prev.coverage[i];
    if (was === c || !r.alive[i]) return;
    const who = plan?.people[i]?.name ?? `Person ${i + 1}`;
    out.push(`${who} moves from ${coverage(was)} to ${coverage(c)}`);
  });
  return out;
}

/** The income line that moved most between two years: what usually explains a change in tax. */
function incomeDriver(r: YearRecord, prev: YearRecord, money: Money): string | undefined {
  // [name, value, whether the name takes a singular verb]
  const drivers: [string, (x: YearRecord) => number, boolean][] = [
    ['pay', (x) => x.income.wages + x.income.selfEmployment, true],
    ['pre-tax withdrawals', (x) => x.withdrawals.pretax, false],
    ['Roth conversions', (x) => x.rothConversion, false],
    ['taxable Social Security', (x) => x.taxes.taxableSocialSecurity, true],
    ['pensions and annuities', (x) => x.income.pension + x.income.annuity, false],
    ['realized gains', (x) => x.realizedGains, false],
  ];
  let best: { name: string; d: number; now: number; was: number; one: boolean } | null = null;
  for (const [name, f, one] of drivers) {
    // Compare at one price level so plain inflation is not reported as a change.
    const now = f(r) / r.cpi;
    const was = f(prev) / prev.cpi;
    const d = now - was;
    if (!best || Math.abs(d) > Math.abs(best.d)) best = { name, d, now, was, one };
  }
  if (!best || Math.abs(best.d) < 500) return undefined;
  const from = money(prev, best.was * prev.cpi);
  const to = money(r, best.now * r.cpi);
  const s = best.one ? 's' : '';
  if (best.was < 0.5) return `${cap(best.name)} begin${s} (${to})`;
  if (best.now < 0.5) return `${cap(best.name)} stop${s} (${best.one ? 'was' : 'were'} ${from})`;
  return `${cap(best.name)} ${best.d > 0 ? 'rise' : 'fall'}${s} from ${from} to ${to}`;
}
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

function reasonFor(
  id: string,
  key: BreakdownKey,
  r: YearRecord,
  prev: YearRecord,
  plan: Plan | null,
  money: Money,
): string | undefined {
  const fired = r.milestones.length ? `After ${names(r.milestones.map((m) => `“${m}”`))}` : undefined;
  if (key === 'spending') return undefined;
  if (key === 'living') {
    if (Math.abs(r.spendingMultiplier - prev.spendingMultiplier) > 0.005)
      return `The flexible-spending rule sets spending to ${formatPct(r.spendingMultiplier)} of plan (was ${formatPct(prev.spendingMultiplier)})`;
    const lost = r.alive.filter(Boolean).length < prev.alive.filter(Boolean).length;
    if (lost) return 'Survivor spending applies from this year';
    return fired ?? 'An expense starts, ends or changes with age this year';
  }
  if (key === 'housing') {
    if (id === 'purchases')
      return r.expenses.purchases > prev.expenses.purchases
        ? 'A purchase or closing costs fall in this year'
        : 'Last year’s purchase does not repeat';
    if (id === 'interest' || id === 'principal') {
      if (r.expenses.debtService < 0.5) return 'The loans are paid off';
      if (prev.expenses.debtService < 0.5) return 'A new loan starts';
      return r.debts < prev.debts * 0.5 ? 'A loan is paid off part-way through' : fired;
    }
    return prev.expenses.housing < 0.5
      ? 'Property costs begin'
      : r.expenses.housing < 0.5
        ? 'Property sold'
        : fired;
  }
  if (key === 'healthcare') {
    const moves = coverageMoves(r, prev, plan);
    if (id === 'medicare') return moves.find((m) => /Medicare/.test(m)) ?? moves[0];
    if (id === 'irmaa')
      return r.taxes.irmaaTier !== prev.taxes.irmaaTier
        ? `Income two years earlier puts Medicare in ${r.taxes.irmaaTier === 0 ? 'the standard tier' : `surcharge tier ${r.taxes.irmaaTier}`}`
        : moves[0];
    if (id === 'ltc')
      return r.expenses.healthcare.ltc > prev.expenses.healthcare.ltc
        ? 'Long-term care costs begin'
        : 'Long-term care ends';
    if (moves.length) return moves.join('; ');
    if (id === 'oop' && Math.abs(r.taxes.fplRatio - prev.taxes.fplRatio) > 0.1 && r.coverage.includes('aca'))
      return `Income is ${formatPct(r.taxes.fplRatio)} of the poverty line (was ${formatPct(prev.taxes.fplRatio)}), which changes cost-sharing help`;
    return r.expenses.healthcare.total / r.cpi >= prev.expenses.healthcare.total / prev.cpi
      ? 'Premiums rise with age, and health costs grow faster than general prices'
      : undefined;
  }
  // Taxes, and the tax types within them.
  if (id === 'state')
    return r.state !== prev.state
      ? `You move from ${prev.state} to ${r.state}`
      : incomeDriver(r, prev, money);
  if (id === 'ptc') {
    const moves = coverageMoves(r, prev, plan);
    if (moves.length) return moves.join('; ');
    return formatPct(r.taxes.fplRatio) === formatPct(prev.taxes.fplRatio)
      ? 'The benchmark premium the credit is measured against changes with age and prices'
      : `Income is ${formatPct(r.taxes.fplRatio)} of the poverty line (was ${formatPct(prev.taxes.fplRatio)})`;
  }
  if (id === 'penalties')
    return r.taxes.penalties > prev.taxes.penalties
      ? 'Money is taken from retirement accounts before 59½ without an exception'
      : 'No early withdrawals this year';
  if (id === 'fica' || id === 'se') {
    const now = r.income.wages + r.income.selfEmployment;
    const was = prev.income.wages + prev.income.selfEmployment;
    if (now < 0.5 && was >= 0.5) return fired ? `${fired}: pay stops` : 'Pay stops';
    return `Pay ${now > was ? 'rises' : 'falls'} from ${money(prev, was)} to ${money(r, now)}`;
  }
  if (id === 'gains') {
    const moreGains = r.realizedGains / r.cpi > prev.realizedGains / prev.cpi;
    const moreTax = r.taxes.capitalGainsTax / r.cpi > prev.taxes.capitalGainsTax / prev.cpi;
    // Gains are taxed in layers above other income, so the tax can fall while the gains rise.
    if (moreGains !== moreTax)
      return moreTax
        ? 'Other income rises, pushing gains into a higher rate'
        : 'Other income falls, so more of the gains are taxed at 0%';
    return moreGains
      ? `Gains realized rise to ${money(r, r.realizedGains)} as taxable investments are sold`
      : `Gains realized fall to ${money(r, r.realizedGains)}`;
  }
  if (r.filingStatus !== prev.filingStatus)
    return `Filing status changes from ${prev.filingStatus.toUpperCase()} to ${r.filingStatus.toUpperCase()}`;
  return incomeDriver(r, prev, money) ?? fired;
}

function factsFor(
  key: BreakdownKey,
  r: YearRecord,
  plan: Plan | null,
  money: Money,
): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: string): void => void facts.push({ label, value });
  const t = r.taxes;
  if (key === 'healthcare') {
    r.coverage.forEach((c, i) => {
      if (r.alive[i]) add(plan?.people[i]?.name ?? `Person ${i + 1}`, cap(coverage(c)));
    });
    if (r.expenses.healthcare.hsaPaid >= 0.5)
      add('Paid from the HSA', money(r, r.expenses.healthcare.hsaPaid));
    if (t.ptc >= 0.5) add('Premium tax credit (shown under taxes)', money(r, t.ptc));
    if (r.coverage.includes('aca')) add('Income against the poverty line', formatPct(t.fplRatio));
    if (r.coverage.includes('medicare'))
      add('Medicare income tier', t.irmaaTier === 0 ? 'Standard' : `Tier ${t.irmaaTier}`);
  } else if (key === 'living') {
    if (Math.abs(r.spendingMultiplier - 1) > 0.005)
      add('Flexible-spending rule', `${formatPct(r.spendingMultiplier)} of planned spending`);
    if (r.shortfall >= 0.5) add('Spending that could not be paid', money(r, r.shortfall));
  } else if (key === 'housing') {
    if (r.debts >= 0.5) add('Owed at year end', money(r, r.debts));
    if (r.assets >= 0.5) add('Property value at year end', money(r, r.assets));
  } else if (key === 'payroll') {
    add('Pay and self-employment income', money(r, r.income.wages + r.income.selfEmployment));
  } else if (key === 'state') {
    add('State', r.state);
    add('Adjusted gross income', money(r, t.agi));
  } else if (key === 'penalties') {
    if (r.withdrawals.pretax >= 0.5) add('Pre-tax withdrawals', money(r, r.withdrawals.pretax));
  } else if (key === 'taxes' || key === 'federal') {
    add('Adjusted gross income', money(r, t.agi));
    add('Deduction', money(r, t.deduction));
    add('Taxable income', money(r, t.taxableIncome));
    add('Federal bracket on the next dollar', formatPct(t.marginalRate));
    if (r.rothConversion >= 0.5) add('Roth conversion', money(r, r.rothConversion));
    if (r.realizedGains >= 0.5) add('Gains realized', money(r, r.realizedGains));
    if (r.withdrawals.rmd >= 0.5) add('Required distributions', money(r, r.withdrawals.rmd));
  }
  if (key !== 'healthcare' && r.milestones.length) add('Milestones this year', names(r.milestones));
  return facts;
}

function notesFor(key: BreakdownKey, r: YearRecord, money: Money): string[] {
  const notes: string[] = [];
  if (key === 'taxes' && r.taxes.total < -0.5)
    notes.push(
      `Credits exceed tax this year, a net refund of ${money(r, -r.taxes.total)}. The chart shows that as zero.`,
    );
  if (key === 'healthcare')
    notes.push(
      'Gross cost before the premium tax credit. HSA payments are a way of paying, not an extra cost.',
    );
  if (key === 'housing') notes.push('Rent and utilities you entered as spending are counted under Living.');
  if (key === 'state')
    notes.push('State tax is a rough estimate: brackets, deductions and main retirement exclusions only.');
  if (r.dataStatus === 'projected' && key !== 'living' && key !== 'housing' && key !== 'spending')
    notes.push('Uses projected tables: the latest enacted figures indexed for inflation.');
  return notes;
}
