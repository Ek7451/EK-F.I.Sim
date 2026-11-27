import type { YearRecord } from '@fisim/engine';
import { Card, Segmented, SelectField, Switch, formatMoney, formatPct } from '@fisim/ui';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chart, axis, barFill, short, tooltip } from '../../charts/Chart';
import { useProjection } from '../../engine/useResults';
import { chartYearLabels, yearWithAges } from '../../lib/chartYears';
import { ACCOUNT_LABELS } from '../../lib/fields';
import { PageHead } from '../../shell/Shell';
import { usePreviewPlan } from '../../state/draft';
import { useUpdate } from '../../state/store';
import { useSelectedYear } from '../../state/workspace';
import { YearPicker, useMoney } from '../explore/shared';
import { CalculationStatus } from '../workspace/CalculationStatus';
import { ContributionRules } from './ContributionRules';
import './inputs-c.css';
import './savings.css';

type Credit = YearRecord['contributions']['byAccount'][string];
const sources = [
  { key: 'personal', label: 'Personal' },
  { key: 'employer', label: 'Employer' },
  { key: 'automatic', label: 'Automatic' },
] as const;
const rateText = (value: number, income: number) => (income > 0 ? formatPct(value / income, 1) : '—');

export function SavingsPage() {
  const plan = usePreviewPlan()!;
  const update = useUpdate();
  const { result } = useProjection();
  const money = useMoney();
  const [year, setYear] = useSelectedYear();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('account') ?? '';
  const chooseAccount = (id: string) => setParams(id ? { account: id } : {}, { replace: true });
  const [person, setPerson] = useState('');
  const [type, setType] = useState('');
  const [unit, setUnit] = useState<'dollars' | 'rate'>('dollars');
  const [automatic, setAutomatic] = useState(false);
  const records = result?.records ?? [];
  const current = records.find((r) => r.year === year) ?? records[0];
  const activeYear = current?.year ?? plan.settings.startYear;
  const years = records.length ? records.map((r) => r.year) : [activeYear];
  const accounts = result?.contributionAccounts ?? plan.accounts;
  const ownerName = (id: string) =>
    id === 'joint' ? 'Joint' : (plan.people.find((p) => p.id === id)?.name ?? id);
  const available = accounts.filter(
    (a) =>
      (!type || a.type === type) &&
      (!person ||
        a.ownerId === person ||
        records.some((r) => r.contributions.byAccount[a.id]?.ownerId === person)),
  );
  const selected = available.find((a) => a.id === selectedId);
  const visible = selected ? [selected] : available;
  const editable = plan.accounts.find((a) => a.id === selected?.id);
  const credit = (r: YearRecord, id: string): Credit | undefined => {
    const entry = r.contributions.byAccount[id];
    return !person || entry?.ownerId === person ? entry : undefined;
  };
  const columns = sources.filter((s) => automatic || s.key !== 'automatic');
  const annual = records.map((r) => {
    const sums = { personal: 0, employer: 0, automatic: 0 };
    for (const a of visible) {
      const entry = credit(r, a.id);
      if (entry) for (const { key } of sources) sums[key] += entry[key];
    }
    return sums;
  });
  const selectPerson = (id: string) => {
    setPerson(id);
    chooseAccount('');
  };
  const selectType = (id: string) => {
    setType(id);
    chooseAccount('');
  };
  return (
    <>
      <PageHead
        group="plan"
        title="Savings and contributions"
        intro="Follow deposits into each account over the life of your plan. Select an account to change its contribution rules."
      />
      <CalculationStatus />
      <div className="savings-page">
        <div className="saving-filters">
          <SelectField
            label="Account owner"
            help={null}
            value={person}
            options={[
              { value: '', label: 'Everyone' },
              ...plan.people.map((p) => ({ value: p.id, label: p.name })),
              ...(accounts.some((a) => a.ownerId === 'joint')
                ? [{ value: 'joint', label: 'Joint accounts' }]
                : []),
            ]}
            onChange={selectPerson}
          />
          <SelectField
            label="Account type"
            help={null}
            value={type}
            options={[
              { value: '', label: 'All types' },
              ...[...new Set(accounts.map((a) => a.type))].map((t) => ({
                value: t,
                label: ACCOUNT_LABELS[t],
              })),
            ]}
            onChange={selectType}
          />
          <SelectField
            label="Contribution account"
            help={null}
            value={selected?.id ?? ''}
            options={[
              { value: '', label: 'All accounts' },
              ...available.map((a) => ({ value: a.id, label: a.name + ' · ' + ownerName(a.ownerId) })),
            ]}
            onChange={chooseAccount}
          />
        </div>
        <Card
          title="Projected annual contributions"
          actions={
            <Segmented
              label="Contribution chart unit"
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'dollars', label: 'Dollars' },
                { value: 'rate', label: 'Savings rate' },
              ]}
            />
          }
        >
          <p className="lv-small">
            {unit === 'rate'
              ? 'Savings rate is deposits divided by household income before tax. Years without positive income have no rate.'
              : 'Deposits in ' + money.unit + '.'}{' '}
            Personal includes savings from pay and scheduled deposits from surplus.
          </p>
          <Switch
            label="Include automatic deposits"
            help="Includes leftover cash and designated sale proceeds deposited automatically. These can continue after scheduled contributions stop."
            checked={automatic}
            onChange={setAutomatic}
          />
          {current && (
            <Chart
              label="Projected contributions by year and source"
              deps={[records, person, type, selected?.id, unit, automatic, money.real, activeYear]}
              height={280}
              onClick={({ dataIndex }) => {
                if (records[dataIndex]) setYear(records[dataIndex].year);
              }}
              table={() => ({
                columns: ['Year', ...columns.map((s) => s.label), 'Total', 'Share of household income'],
                rows: records.map((r, i) => {
                  const total = columns.reduce((sum, s) => sum + annual[i][s.key], 0);
                  return [
                    yearWithAges(r),
                    ...columns.map((s) =>
                      unit === 'rate'
                        ? rateText(annual[i][s.key], r.income.total)
                        : formatMoney(money.flow(r, annual[i][s.key])),
                    ),
                    formatMoney(money.flow(r, total)),
                    rateText(total, r.income.total),
                  ];
                }),
              })}
              build={(c) => ({
                grid: { left: 60, right: 16, top: 42, bottom: 35 },
                legend: { top: 4, selectedMode: false },
                tooltip: {
                  ...tooltip(c),
                  trigger: 'axis',
                  valueFormatter: (v: unknown) =>
                    v == null ? '—' : unit === 'rate' ? formatPct(Number(v), 1) : formatMoney(Number(v)),
                },
                xAxis: { type: 'category', data: years, ...axis(c), ...chartYearLabels(c, records) },
                yAxis: {
                  type: 'value',
                  ...axis(c),
                  axisLabel: {
                    color: c.ink3,
                    formatter: unit === 'rate' ? (v: number) => formatPct(v, 0) : short,
                  },
                },
                series: columns.map(({ key, label }, i) => ({
                  name: label,
                  type: 'bar',
                  stack: 'deposits',
                  itemStyle: { color: barFill(c.series[i]) },
                  markLine:
                    i === 0
                      ? {
                          silent: true,
                          symbol: 'none',
                          label: { show: false },
                          lineStyle: { color: c.ink2 },
                          data: [{ xAxis: String(activeYear) }],
                        }
                      : undefined,
                  data: records.map((r, j) =>
                    unit === 'rate'
                      ? r.income.total > 0
                        ? annual[j][key] / r.income.total
                        : null
                      : money.flow(r, annual[j][key]),
                  ),
                })),
              })}
            />
          )}
          {current && <YearPicker records={records} year={activeYear} onChange={setYear} />}
        </Card>
        {current && (
          <Card title={'Account breakdown · ' + yearWithAges(current)}>
            <p className="lv-small">
              Amounts in {money.unit}. Each rate uses household income of{' '}
              {formatMoney(money.flow(current, current.income.total))}. The last deposit is the final
              projected year with a deposit from the sources shown.
            </p>
            <div className="lv-table-wrap">
              <table className="lv-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    {columns.map((s) => (
                      <th scope="col" key={s.key}>
                        {s.label}
                      </th>
                    ))}
                    <th scope="col">Total</th>
                    <th scope="col">Savings rate</th>
                    <th scope="col">Last deposit</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => {
                    const entry = credit(current, a.id);
                    const total = columns.reduce((sum, s) => sum + (entry?.[s.key] ?? 0), 0);
                    const history = records.map((r) => {
                      const deposit = credit(r, a.id);
                      return columns.map(({ key }) => money.flow(r, deposit?.[key] ?? 0));
                    });
                    const totals = history.map((parts) => parts.reduce((sum, v) => sum + v, 0));
                    const peak = Math.max(1, ...totals);
                    const last = years[totals.map((v) => v > 0).lastIndexOf(true)];
                    return (
                      <tr key={a.id}>
                        <th scope="row">
                          <button
                            type="button"
                            className="saving-account"
                            onClick={() => chooseAccount(a.id)}
                          >
                            {a.name}
                          </button>
                          <small>
                            {ownerName(entry?.ownerId ?? a.ownerId)} · {ACCOUNT_LABELS[a.type]}
                          </small>
                        </th>
                        {columns.map((s) => (
                          <td key={s.key}>{formatMoney(money.flow(current, entry?.[s.key] ?? 0))}</td>
                        ))}
                        <td>{formatMoney(money.flow(current, total))}</td>
                        <td>{rateText(total, current.income.total)}</td>
                        <td>
                          {last ?? 'No deposits'}
                          <div className="saving-history" aria-hidden="true">
                            {history.map((parts, i) => (
                              <span key={years[i]} title={years[i] + ' · ' + formatMoney(totals[i])}>
                                {parts.map((v, j) => (
                                  <i
                                    key={j}
                                    style={{
                                      height: (v / peak) * 100 + '%',
                                      background: `var(--chart-${j + 1})`,
                                    }}
                                  />
                                ))}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!visible.length && <p>No accounts match these filters.</p>}
          </Card>
        )}
        <Card title={selected ? 'Contribution rules · ' + selected.name : 'Contribution rules'}>
          {editable ? (
            <ContributionRules
              key={editable.id}
              plan={plan}
              account={editable}
              update={update}
              years={years}
              year={activeYear}
              setYear={setYear}
            />
          ) : (
            <p>
              {selected
                ? 'The projection created this account automatically.'
                : 'Choose an account above to set annual amounts, employer contributions and contribution years.'}{' '}
              <Link to="/plan/snapshot">Manage accounts</Link>
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
