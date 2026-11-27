import type { Account, ContributionSchedule, Plan, WaterfallStep } from '@fisim/engine';
import { Button, MoneyField, SelectField, Switch } from '@fisim/ui';
import { Link } from 'react-router-dom';
import { PAYROLL, PayrollSavings, WATERFALL_OK } from './PayrollSavings';

type EditPlan = (edit: (plan: Plan) => void) => void;

function YearAmount({
  label,
  fieldLabel,
  amount,
  change,
}: {
  label: string;
  fieldLabel: string;
  amount: number | undefined;
  change: (amount: number | undefined) => void;
}) {
  return (
    <div>
      <Switch label={label} checked={amount !== undefined} onChange={(on) => change(on ? 0 : undefined)} />
      {amount !== undefined && (
        <MoneyField label={fieldLabel} cents={amount} onChange={(v) => change(Math.max(0, v))} />
      )}
    </div>
  );
}

function ScheduleFields({
  schedule = {},
  change,
  years,
  year,
  setYear,
  employerAmounts,
  setEmployerAmount,
}: {
  schedule?: ContributionSchedule;
  change: (s: ContributionSchedule) => void;
  years: number[];
  year: number;
  setYear: (year: number) => void;
  employerAmounts?: Record<string, number>;
  setEmployerAmount?: (amount: number | undefined) => void;
}) {
  const options = [
    ...new Set(
      [
        ...years,
        schedule.firstYear,
        schedule.lastYear,
        ...Object.keys(schedule.amountByYear ?? {}).map(Number),
        ...Object.keys(employerAmounts ?? {}).map(Number),
      ].filter((y): y is number => y !== undefined),
    ),
  ]
    .sort((a, b) => a - b)
    .map((y) => ({ value: String(y), label: String(y) }));
  const active = year >= (schedule.firstYear ?? -Infinity) && year <= (schedule.lastYear ?? Infinity);
  return (
    <div className="saving-schedule">
      <div className="form-grid">
        <SelectField
          label="First contribution year"
          help="Contributions can start in this year, subject to available funds and account eligibility."
          value={String(schedule.firstYear ?? '')}
          options={[
            { value: '', label: 'Plan start' },
            ...options.filter((o) => +o.value <= (schedule.lastYear ?? Infinity)),
          ]}
          onChange={(v) => change({ ...schedule, firstYear: v ? Number(v) : undefined })}
        />
        <SelectField
          label="Last contribution year"
          help="This year is included. Scheduled deposits stop the following year."
          value={String(schedule.lastYear ?? '')}
          options={[
            { value: '', label: 'Plan end' },
            ...options.filter((o) => +o.value >= (schedule.firstYear ?? -Infinity)),
          ]}
          onChange={(v) => change({ ...schedule, lastYear: v ? Number(v) : undefined })}
        />
      </div>
      <details className="pic-more">
        <summary>Change an individual year</summary>
        <div className="saving-schedule">
          <SelectField
            label="Override year"
            help="A one-year amount replaces the recurring amount for that year. All dollar amounts are in today’s dollars."
            value={String(year)}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => setYear(+v)}
          />
          {active ? (
            <>
              <YearAmount
                label="Set personal amount for this year"
                fieldLabel={`Personal contribution in ${year}`}
                amount={schedule.amountByYear?.[year]}
                change={(v) => {
                  const amounts = { ...schedule.amountByYear };
                  if (v === undefined) delete amounts[year];
                  else amounts[year] = v;
                  change({ ...schedule, amountByYear: amounts });
                }}
              />
              {setEmployerAmount && (
                <YearAmount
                  label="Set total employer amount for this year"
                  fieldLabel={`Employer contribution in ${year}`}
                  amount={employerAmounts?.[year]}
                  change={setEmployerAmount}
                />
              )}
              <small>
                Amounts replace the usual rule for this year. A zero pauses that source. Income, available
                surplus and account limits still apply.
              </small>
            </>
          ) : (
            <p className="lv-muted">This year is outside the contribution schedule.</p>
          )}
        </div>
      </details>
    </div>
  );
}

export function ContributionRules({
  plan,
  account,
  update,
  year,
  years,
  setYear,
}: {
  plan: Plan;
  account: Account;
  update: EditPlan;
  year: number;
  years: number[];
  setYear: (y: number) => void;
}) {
  const setAccount = (edit: (a: Account) => void) =>
    update((d) => {
      const a = d.accounts.find((x) => x.id === account.id);
      if (a) edit(a);
    });
  const timing = { year, years, setYear };
  const steps = plan.strategies.surplusWaterfall;
  const canUseSurplus = WATERFALL_OK.includes(account.type);
  const payroll = PAYROLL.includes(account.type);
  return (
    <div className="saving-rules">
      {payroll && (
        <>
          <PayrollSavings account={account} plan={plan} setAccount={setAccount} />
          {account.contribution && (
            <ScheduleFields
              {...timing}
              schedule={account.contribution.schedule}
              change={(s) =>
                setAccount((a) => {
                  a.contribution!.schedule = s;
                })
              }
              employerAmounts={account.contribution.employerAmountByYear}
              setEmployerAmount={
                account.type === 'sepIra'
                  ? undefined
                  : (v) =>
                      setAccount((a) => {
                        const amounts = (a.contribution!.employerAmountByYear ??= {});
                        if (v === undefined) delete amounts[year];
                        else amounts[year] = v;
                      })
              }
            />
          )}
        </>
      )}
      {canUseSurplus && (
        <section>
          <h3>Contributions from surplus</h3>
          <p className="lv-small">
            After spending and taxes, the plan funds each savings priority in order, up to the annual amount
            in today’s dollars.
          </p>
          {steps.map((step, index) => {
            if (step.type !== 'account' || step.accountId !== account.id) return null;
            const setStep = (edit: (s: Extract<WaterfallStep, { type: 'account' }>) => void) =>
              update((d) => {
                const current = d.strategies.surplusWaterfall[index];
                if (current?.type === 'account' && current.accountId === account.id) edit(current);
              });
            return (
              <fieldset className="pic-group" key={index}>
                <legend>Savings priority {index + 1}</legend>
                <Switch
                  label="Save all available surplus up to the account limit"
                  help="Turn this off to enter an annual cap. Higher priorities are funded first."
                  checked={step.maxAnnual === undefined}
                  onChange={(on) =>
                    setStep((s) => {
                      s.maxAnnual = on ? undefined : 0;
                    })
                  }
                />
                {step.maxAnnual !== undefined && (
                  <MoneyField
                    label="Annual savings amount"
                    help="The maximum deposited from surplus in a full year, in today’s dollars."
                    cents={step.maxAnnual}
                    onChange={(v) =>
                      setStep((s) => {
                        s.maxAnnual = Math.max(0, v);
                      })
                    }
                  />
                )}
                <ScheduleFields
                  {...timing}
                  schedule={step.schedule}
                  change={(schedule) =>
                    setStep((s) => {
                      s.schedule = schedule;
                    })
                  }
                />
                <Button
                  size="sm"
                  onClick={() =>
                    update((d) => {
                      d.strategies.surplusWaterfall.splice(index, 1);
                    })
                  }
                >
                  Remove this priority
                </Button>
              </fieldset>
            );
          })}
          {!steps.some((s) => s.type === 'account' && s.accountId === account.id) && (
            <Button
              size="sm"
              icon="plus"
              onClick={() =>
                update((d) => {
                  const order = d.strategies.surplusWaterfall;
                  const remainder = order.findIndex(
                    (s) =>
                      s.type === 'account' &&
                      s.maxAnnual === undefined &&
                      d.accounts.some(
                        (a) =>
                          a.id === s.accountId && ['taxable', 'cash', 'tBill', 'annuity'].includes(a.type),
                      ),
                  );
                  order.splice(remainder < 0 ? order.length : remainder, 0, {
                    type: 'account',
                    accountId: account.id,
                    maxAnnual: 0,
                  });
                })
              }
            >
              Set annual savings amount
            </Button>
          )}
          <p className="lv-small">
            <Link to="/plan/strategy">Edit savings priority order and where leftover money goes</Link>
          </p>
        </section>
      )}
      {!payroll && !canUseSurplus && (
        <p>This account type does not accept new contributions in the projection.</p>
      )}
    </div>
  );
}
