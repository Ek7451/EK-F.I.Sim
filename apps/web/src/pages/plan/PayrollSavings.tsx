import type { Account, Plan } from '@fisim/engine';
import { Button, MoneyField, PercentField, SelectField, Switch } from '@fisim/ui';
import { helpText } from '../../lib/help';
export const PAYROLL = [
  'trad401k',
  'trad403b',
  'gov457b',
  'roth401k',
  'solo401k',
  'simpleIra',
  'sepIra',
  'hsa',
];
export const WATERFALL_OK = [
  'taxable',
  'cash',
  'rothIra',
  'tradIra',
  'hsa',
  'plan529',
  'iBond',
  'annuity',
  'tBill',
];
export function PayrollSavings({
  account: a,
  plan,
  setAccount: setA,
}: {
  account: Account;
  plan: Plan;
  setAccount: (edit: (a: Account) => void) => void;
}) {
  return (
    <fieldset className="pic-group" data-tour="payroll-savings">
      <legend className="lv-label">Savings from pay</legend>
      <Switch
        label="Contribute to this account from income"
        checked={!!a.contribution}
        onChange={(v) =>
          setA((x) => {
            x.contribution = v
              ? {
                  employeePct: 0.06,
                  employeeAmount: 0,
                  maxOut: false,
                  employerMatch: [],
                  employerFixedPct: 0,
                  megaBackdoor: false,
                }
              : undefined;
          })
        }
      />
      {a.contribution ? (
        <>
          <div className="form-grid">
            <SelectField
              label="From which income"
              value={a.contribution.incomeId ?? 'auto'}
              options={[
                { value: 'auto', label: "Owner's earnings" },
                ...plan.incomes
                  .filter(
                    (i) =>
                      i.ownerId === a.ownerId &&
                      (i.taxCharacter === 'earned' || i.taxCharacter === 'selfEmployment'),
                  )
                  .map((i) => ({ value: i.id, label: i.name })),
              ]}
              onChange={(v) =>
                setA((x) => {
                  x.contribution!.incomeId = v === 'auto' ? undefined : v;
                })
              }
            />
            {!a.contribution.maxOut && (
              <>
                <PercentField
                  label="Share of pay"
                  value={a.contribution.employeePct}
                  onChange={(v) =>
                    setA((x) => {
                      x.contribution!.employeePct = Math.max(0, Math.min(1, v));
                    })
                  }
                />
                <MoneyField
                  label="Plus a flat yearly amount"
                  cents={a.contribution.employeeAmount}
                  onChange={(v) =>
                    setA((x) => {
                      x.contribution!.employeeAmount = Math.max(0, v);
                    })
                  }
                />
              </>
            )}
            {a.type !== 'sepIra' && (
              <PercentField
                label="Employer adds (share of pay)"
                hint="Paid whether or not you contribute."
                value={a.contribution.employerFixedPct}
                onChange={(v) =>
                  setA((x) => {
                    x.contribution!.employerFixedPct = Math.max(0, Math.min(1, v));
                  })
                }
              />
            )}
          </div>
          <div className="pic-pair">
            <Switch
              label="Contribute the legal maximum"
              help={helpText('Contribute the legal maximum, including catch-up amounts')}
              checked={a.contribution.maxOut}
              onChange={(v) =>
                setA((x) => {
                  x.contribution!.maxOut = v;
                })
              }
            />
            {a.type === 'trad401k' || a.type === 'trad403b' || a.type === 'roth401k' ? (
              <Switch
                label="Mega-backdoor Roth"
                help={helpText(
                  'Mega-backdoor Roth: after-tax contributions up to the plan limit, converted to Roth',
                )}
                checked={a.contribution.megaBackdoor}
                onChange={(v) =>
                  setA((x) => {
                    x.contribution!.megaBackdoor = v;
                  })
                }
              />
            ) : null}
          </div>
          {a.type !== 'hsa' && a.type !== 'sepIra' ? (
            <>
              <div className="lv-spread">
                <span className="lv-label">Employer match</span>
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    setA((x) => {
                      x.contribution!.employerMatch.push({
                        matchPct: 0.5,
                        upToPctOfSalary: Math.min(
                          1,
                          (x.contribution!.employerMatch.at(-1)?.upToPctOfSalary ?? 0) + 0.06,
                        ),
                      });
                    })
                  }
                >
                  Add a tier
                </Button>
              </div>
              {a.contribution.employerMatch.map((t, i) => (
                <div className="pic-tier" key={i}>
                  <PercentField
                    label="Employer matches"
                    value={t.matchPct}
                    digits={0}
                    onChange={(v) =>
                      setA((x) => {
                        x.contribution!.employerMatch[i].matchPct = Math.max(0, v);
                      })
                    }
                  />
                  <PercentField
                    label="Up to (share of pay)"
                    value={t.upToPctOfSalary}
                    onChange={(v) =>
                      setA((x) => {
                        x.contribution!.employerMatch[i].upToPctOfSalary = Math.max(0, Math.min(1, v));
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    icon="trash"
                    label="Remove tier"
                    onClick={() =>
                      setA((x) => {
                        x.contribution!.employerMatch.splice(i, 1);
                      })
                    }
                  />
                </div>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
