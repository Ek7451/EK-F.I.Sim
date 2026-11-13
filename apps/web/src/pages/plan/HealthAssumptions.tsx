import { ASSET_CLASSES, type Coverage } from '@fisim/engine';
import {
  Badge,
  Button,
  Fold,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  Stat,
  Switch,
  TextField,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { useProjection } from '../../engine/useResults';
import { AllocationEditor, CLASS_LABELS, WhenField, describeWhen } from '../../lib/fields';
import { helpText } from '../../lib/help';
import { LifespanSwitch, lifespansVary } from '../../lib/lifespan';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useUpdate } from '../../state/store';
import { Choice, Dial, FoldColumns, Lead } from './InputsB';
import './inputs-b.css';

const COVERAGE: { value: Coverage['type']; label: string }[] = [
  { value: 'employer', label: 'My employer plan' },
  { value: 'spouseEmployer', label: "Partner's employer plan" },
  { value: 'cobra', label: 'COBRA' },
  { value: 'aca', label: 'Marketplace (ACA) plan' },
  { value: 'medicaid', label: 'Medicaid' },
  { value: 'medicare', label: 'Medicare' },
  { value: 'none', label: 'No coverage' },
];
/** Classes the bundled market history covers: history supplies their averages or their ups and downs. */
const HISTORY_SETS = new Set<string>(['usStocks', 'usBonds', 'cash']);
const COVER_LABEL: Record<string, string> = {
  employer: 'Employer',
  spouseEmployer: "Partner's plan",
  cobra: 'COBRA',
  aca: 'Marketplace',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  none: 'None',
};
const SUPPLEMENT_SHORT: Record<string, string> = {
  medigapG: 'Medigap G',
  medigapN: 'Medigap N',
  advantage: 'Medicare Advantage',
  none: 'Original Medicare only',
};
const USE_SHORT: Record<string, string> = { low: 'Little care', typical: 'Typical care', high: 'A lot of care' };

export function HealthcarePage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const { result } = useProjection();
  const hc = plan.healthcare;
  /** The one coverage period being edited ("personId:index"); the rest stay as one-line summaries. */
  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const ensure = (pid: string): number => {
    let i = hc.people.findIndex((h) => h.personId === pid);
    if (i < 0) {
      update((d) => {
        d.healthcare.people.push({
          personId: pid,
          coverage: [],
          utilization: 'typical',
          tobacco: false,
          medicare: {
            partAPremiumFree: true,
            supplement: 'medigapG',
            dentalVisionHearing: true,
            irmaaAppeal: false,
          },
          ltc: { mode: 'none', careType: 'assistedLiving', onsetAge: 85, years: 3 },
        });
      });
      i = hc.people.length;
    }
    return i;
  };
  const recs = result?.records ?? [];
  const net = (r: (typeof recs)[number]): number => (r.expenses.healthcare.total - r.taxes.ptc) / r.cpi;
  const bridge = recs.filter((r) => r.coverage.some((c) => c === 'aca' || c === 'cobra'));
  const bridgeCost = bridge.reduce((s, r) => s + net(r), 0);
  const lifetime = recs.reduce((s, r) => s + net(r), 0);
  const lastYear = recs.at(-1)?.year ?? plan.settings.startYear;

  const personFolds = plan.people.map((p, pIndex) => {
    const i = hc.people.findIndex((h) => h.personId === p.id);
    const h = hc.people[i];
    const timeline = recs.reduce<{ from: number; type: string }[]>((acc, r) => {
      const t = r.coverage[pIndex];
      if (t && t !== 'none' && acc.at(-1)?.type !== t) acc.push({ from: r.year, type: t });
      return acc;
    }, []);
    const coverage = (
      <Fold
        key={`${p.id}-coverage`}
        title={`${p.name}'s coverage`}
        icon="shield"
        summary={
          timeline.length
            ? timeline.map((t, k) => (k === 0 ? COVER_LABEL[t.type] : `${COVER_LABEL[t.type]} ${t.from}`)).join(' → ')
            : 'Worked out from wages, then the marketplace, then Medicare'
        }
        defaultOpen
        storageKey={`health:coverage:${p.id}`}
        data-tour="coverage"
      >
        <div className="pib-cover" data-tour="coverage-timeline">
          {timeline.length ? (
            <div className="pib-cover-bar" aria-hidden="true">
              {timeline.map((t, k) => (
                <span
                  key={k}
                  data-type={t.type}
                  title={`${COVER_LABEL[t.type]} from ${t.from}`}
                  style={{ flexGrow: Math.max(1, (timeline[k + 1]?.from ?? lastYear + 1) - t.from) }}
                />
              ))}
            </div>
          ) : null}
          <div className="pib-cover-key" role="group" aria-label="Coverage in this projection">
            {timeline.map((t, k) => (
              <Badge
                key={k}
                tone={t.type === 'aca' || t.type === 'cobra' ? 'warn' : t.type === 'medicare' ? 'ok' : undefined}
              >
                {t.from}: {COVER_LABEL[t.type]}
              </Badge>
            ))}
          </div>
        </div>
        {!h || h.coverage.length === 0 ? (
          <Lead>
            No periods entered, so the plan assumes an employer plan while there are wages, the marketplace after
            that, and Medicare at 65.
          </Lead>
        ) : null}
        {h?.coverage.map((cv, k) => (
          <details
            key={k}
            className="pib-period"
            open={openPeriod === `${p.id}:${k}`}
            onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setOpenPeriod((cur) => (open ? `${p.id}:${k}` : cur === `${p.id}:${k}` ? null : cur));
            }}
          >
            <summary>
              <span className="pib-period-dot" data-type={cv.type} aria-hidden="true" />
              <strong>{COVER_LABEL[cv.type]}</strong>
              <span className="pib-period-what">
                {[
                  `from ${describeWhen(plan, cv.from)}`,
                  cv.type === 'aca' ? `${cv.metal[0].toUpperCase()}${cv.metal.slice(1)} plan` : null,
                  cv.type === 'cobra' ? `${cv.cobraMonths} months` : null,
                  cv.premiumAnnual && cv.type !== 'aca' ? `${formatMoney(cv.premiumAnnual / 100)} a year` : null,
                  cv.hdhp ? 'HSA-eligible' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="pib-period-edit">Edit</span>
            </summary>
            <div className="form-grid">
              <SelectField
                label="Coverage"
                value={cv.type}
                options={COVERAGE}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].coverage[k].type = v;
                  })
                }
              />
              <div className="span-2">
                <WhenField
                  plan={plan}
                  label="From"
                  value={cv.from}
                  onChange={(v) =>
                    update((d) => {
                      if (v) d.healthcare.people[i].coverage[k].from = v;
                    })
                  }
                />
              </div>
              {cv.type === 'aca' ? (
                <SelectField
                  label="Metal tier"
                  value={cv.metal}
                  options={['catastrophic', 'bronze', 'silver', 'gold', 'platinum'].map((m) => ({
                    value: m as Coverage['metal'],
                    label: m[0].toUpperCase() + m.slice(1),
                  }))}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].coverage[k].metal = v;
                    })
                  }
                />
              ) : null}
              {cv.type === 'cobra' ? (
                <NumberField
                  label="Months of COBRA"
                  help="COBRA usually lasts up to 18 months; 29 or 36 in some cases."
                  value={cv.cobraMonths}
                  min={1}
                  max={36}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].coverage[k].cobraMonths = v;
                    })
                  }
                />
              ) : null}
              {cv.type === 'cobra' ? (
                <MoneyField
                  label="Full yearly premium"
                  help={helpText('Full yearly premium (before the 2% fee)')}
                  hint="Before the 2% fee; 0 = average."
                  cents={cv.premiumAnnual ?? 0}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].coverage[k].premiumAnnual = v > 0 ? v : undefined;
                    })
                  }
                />
              ) : null}
              {cv.type === 'employer' || cv.type === 'spouseEmployer' ? (
                <MoneyField
                  label="Your premium per year"
                  help={helpText('Your share of the yearly premium')}
                  hint="0 = national average"
                  cents={cv.premiumAnnual ?? 0}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].coverage[k].premiumAnnual = v > 0 ? v : undefined;
                    })
                  }
                />
              ) : null}
            </div>
            <div className="pib-period-foot">
              {cv.type === 'employer' ||
              cv.type === 'spouseEmployer' ||
              cv.type === 'cobra' ||
              cv.type === 'aca' ? (
                <Switch
                  label="HSA-eligible plan"
                  help={`${cv.type === 'aca' ? 'Bronze and catastrophic marketplace plans qualify by default. ' : 'Turn on for a high-deductible plan. '}${helpText('HSA-eligible plan (bronze and catastrophic plans qualify by default)')}`}
                  checked={cv.hdhp}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].coverage[k].hdhp = v;
                    })
                  }
                />
              ) : (
                <span />
              )}
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                onClick={() => {
                  setOpenPeriod(null);
                  update((d) => {
                    d.healthcare.people[i].coverage.splice(k, 1);
                  });
                }}
              >
                Remove
              </Button>
            </div>
          </details>
        ))}
        <div style={{ marginTop: 8 }}>
          <Button
            size="sm"
            icon="plus"
            data-tour="add-coverage"
            onClick={() => {
              const k = ensure(p.id);
              setOpenPeriod(`${p.id}:${h?.coverage.length ?? 0}`);
              update((d) => {
                d.healthcare.people[k].coverage.push({
                  type: 'aca',
                  from: { type: 'year', year: d.settings.startYear },
                  hdhp: false,
                  metal: 'silver',
                  cobraMonths: 18,
                });
              });
            }}
          >
            Add a coverage period
          </Button>
        </div>
      </Fold>
    );
    const choices = (
      <Fold
        key={`${p.id}-choices`}
        title={`${p.name}: care and Medicare`}
        icon="heart"
        kind="debt"
        summary={
          h
            ? [
                USE_SHORT[h.utilization],
                `${SUPPLEMENT_SHORT[h.medicare.supplement]} at 65`,
                h.ltc.mode === 'none'
                  ? 'no long-term care'
                  : h.ltc.mode === 'expected'
                    ? `long-term care from ${h.ltc.onsetAge} for ${h.ltc.years} years`
                    : 'long-term care by chance',
                h.tobacco ? 'tobacco' : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Typical care, Medigap G at 65 (defaults)'
        }
        storageKey={`health:choices:${p.id}`}
      >
        {h ? (
          <>
            <div className="form-grid" data-tour="medicare-choices">
              <Choice
                label="How much care you use"
                help={helpText('How much care you use')}
                value={h.utilization}
                options={[
                  { value: 'low', label: 'Little' },
                  { value: 'typical', label: 'Typical' },
                  { value: 'high', label: 'A lot' },
                ]}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].utilization = v;
                  })
                }
              />
              <div className="span-2">
                <SelectField
                  label="At 65"
                  value={h.medicare.supplement}
                  options={[
                    { value: 'medigapG', label: 'Original Medicare + Medigap Plan G + Part D' },
                    { value: 'medigapN', label: 'Original Medicare + Medigap Plan N + Part D' },
                    { value: 'advantage', label: 'Medicare Advantage' },
                    { value: 'none', label: 'Original Medicare + Part D only' },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].medicare.supplement = v;
                    })
                  }
                  data-tour="medicare-supplement"
                />
              </div>
              <SelectField
                label="Long-term care"
                value={h.ltc.mode}
                options={[
                  { value: 'none', label: 'Not modelled' },
                  { value: 'expected', label: 'Assume it happens' },
                  { value: 'stochastic', label: 'By chance, in simulations' },
                ]}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].ltc.mode = v;
                  })
                }
              />
              {h.ltc.mode !== 'none' ? (
                <SelectField
                  label="Kind of care"
                  value={h.ltc.careType}
                  options={[
                    { value: 'homeCare', label: 'Care at home' },
                    { value: 'assistedLiving', label: 'Assisted living' },
                    { value: 'nursingHomeSemiPrivate', label: 'Nursing home, shared room' },
                    { value: 'nursingHomePrivate', label: 'Nursing home, private room' },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.careType = v;
                    })
                  }
                />
              ) : null}
            </div>
            {h.ltc.mode === 'expected' ? (
              <div className="pib-dials" style={{ marginTop: 10 }}>
                <Dial
                  value={h.ltc.onsetAge}
                  min={50}
                  max={110}
                  step={1}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.onsetAge = v;
                    })
                  }
                >
                  <NumberField
                    label="Starting at age"
                    value={h.ltc.onsetAge}
                    min={50}
                    max={110}
                    onChange={(v) =>
                      update((d) => {
                        d.healthcare.people[i].ltc.onsetAge = v;
                      })
                    }
                  />
                </Dial>
                <Dial
                  value={h.ltc.years}
                  min={0}
                  max={20}
                  step={1}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.years = v;
                    })
                  }
                >
                  <NumberField
                    label="For how many years"
                    value={h.ltc.years}
                    min={0}
                    max={20}
                    onChange={(v) =>
                      update((d) => {
                        d.healthcare.people[i].ltc.years = v;
                      })
                    }
                  />
                </Dial>
              </div>
            ) : null}
            <div className="pib-switches" style={{ marginTop: 6 }}>
              <Switch
                label="Uses tobacco"
                help={helpText('Uses tobacco (raises marketplace premiums in most states)')}
                checked={h.tobacco}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].tobacco = v;
                  })
                }
              />
              <Switch
                label="Part A is premium-free"
                help={helpText('Part A is premium-free (40 quarters of work)')}
                checked={h.medicare.partAPremiumFree}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].medicare.partAPremiumFree = v;
                  })
                }
              />
              <Switch
                label="Dental, vision and hearing"
                help={`Include dental, vision and hearing costs on Medicare. ${helpText('Include dental, vision and hearing costs on Medicare')}`}
                checked={h.medicare.dentalVisionHearing}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].medicare.dentalVisionHearing = v;
                  })
                }
              />
              <Switch
                label="Appeal Medicare surcharges"
                help={helpText('Appeal higher Medicare premiums after retiring')}
                checked={h.medicare.irmaaAppeal}
                onChange={(v) =>
                  update((d) => {
                    d.healthcare.people[i].medicare.irmaaAppeal = v;
                  })
                }
              />
              {h.ltc.mode !== 'none' ? (
                <Switch
                  label="Has long-term care insurance"
                  checked={!!h.ltc.insurance}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.insurance = v
                        ? { premiumAnnual: 300000, annualBenefit: 6000000, benefitYears: 3 }
                        : undefined;
                    })
                  }
                />
              ) : null}
            </div>
            {h.ltc.insurance ? (
              <div className="form-grid" style={{ marginTop: 4 }}>
                <MoneyField
                  label="Premium per year"
                  cents={h.ltc.insurance.premiumAnnual}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.insurance!.premiumAnnual = Math.max(0, v);
                    })
                  }
                />
                <MoneyField
                  label="Benefit per year of care"
                  cents={h.ltc.insurance.annualBenefit}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.insurance!.annualBenefit = Math.max(0, v);
                    })
                  }
                />
                <NumberField
                  label="Benefit years"
                  value={h.ltc.insurance.benefitYears}
                  min={1}
                  max={20}
                  onChange={(v) =>
                    update((d) => {
                      d.healthcare.people[i].ltc.insurance!.benefitYears = v;
                    })
                  }
                />
              </div>
            ) : null}
          </>
        ) : (
          <Button size="sm" onClick={() => ensure(p.id)}>
            Set Medicare and care choices
          </Button>
        )}
      </Fold>
    );
    return { coverage, choices };
  });

  const benchmark = (
    <Fold
      key="slcsp"
      title="Marketplace benchmark premium"
      icon="target"
      kind="expense"
      summary={
        hc.slcspOverrideAge21Monthly
          ? `${formatMoney(hc.slcspOverrideAge21Monthly / 100)} a month for a 21-year-old (your figure)`
          : 'Using the bundled county or state figure'
      }
      storageKey="health:slcsp"
      data-tour="slcsp"
    >
      <Lead more="County figures come from HealthCare.gov data. States that run their own exchange use a statewide estimate, so enter your own figure from your state's site for a precise result.">
        Subsidies are measured against the second-lowest-cost silver plan where you live.
      </Lead>
      <div className="form-grid">
        <MoneyField
          label="Monthly benchmark, age 21"
          help={helpText('Monthly benchmark for a 21-year-old (0 = use the dataset)')}
          hint="0 = use the dataset."
          cents={hc.slcspOverrideAge21Monthly ?? 0}
          onChange={(v) =>
            update((d) => {
              d.healthcare.slcspOverrideAge21Monthly = v > 0 ? v : undefined;
            })
          }
        />
      </div>
    </Fold>
  );
  const two = personFolds.length > 1;

  return (
    <>
      <PageHead
        group="plan"
        title="Healthcare"
        intro="Coverage from now to the end of the plan: employer, COBRA, the marketplace or Medicaid, then Medicare at 65. Your taxable income drives both marketplace subsidies and Medicare surcharges, so this screen and the tax engine work together."
      />
      <section className="lv-kpis pib-health-kpis" aria-label="Healthcare costs" data-tour="health-summary">
        <div className="lv-stat">
          <Switch
            label="Model healthcare costs"
            checked={hc.enabled}
            onChange={(v) =>
              update((d) => {
                d.healthcare.enabled = v;
              })
            }
          />
          <span className="lv-stat-note">
            {hc.enabled
              ? 'Leave medical costs out of your spending while this is on.'
              : 'Off: include medical costs in your spending instead.'}
          </span>
        </div>
        {hc.enabled ? (
          <>
            <Stat
              label="Bridge to Medicare"
              value={formatCompact(bridgeCost)}
              note={`${bridge.length} ${bridge.length === 1 ? 'year' : 'years'} on COBRA or the marketplace, after credits`}
            />
            <Stat
              label="Lifetime healthcare"
              value={formatCompact(lifetime)}
              note="Premiums and out-of-pocket, today's dollars"
            />
            <Stat
              label={recs[0] ? `In ${recs[0].year}` : 'This year'}
              value={recs[0] ? formatCompact(net(recs[0])) : '—'}
              note="After premium credits"
            />
          </>
        ) : null}
      </section>
      {hc.enabled ? (
        <FoldColumns
          left={
            two ? (
              <>
                {personFolds[0].coverage}
                {personFolds[0].choices}
                {benchmark}
              </>
            ) : (
              personFolds[0]?.coverage
            )
          }
          right={
            two ? (
              <>
                {personFolds.slice(1).map((f) => [f.coverage, f.choices])}
              </>
            ) : (
              <>
                {personFolds[0]?.choices}
                {benchmark}
              </>
            )
          }
        />
      ) : null}
    </>
  );
}

export function AssumptionsPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const A = plan.assumptions;
  const mc = A.monteCarlo;
  const historical = A.returns.mode === 'historicalAverage';
  const custom = Object.keys(A.returns.stdDev ?? {}).length;
  const varies = lifespansVary(plan);
  return (
    <>
      <PageHead
        group="plan"
        title="Assumptions"
        intro="The outlook the projection uses. The single-path projection uses the expected returns below; simulations vary them."
      />
      <FoldColumns
        left={
          <>
            <Fold
              title="Returns and inflation"
              icon="trendUp"
              kind="income"
              summary={`${historical ? 'Historical averages' : `US stocks ${formatPct(A.returns.fixed.usStocks, 1)}, bonds ${formatPct(A.returns.fixed.usBonds, 1)}`} · inflation ${formatPct(A.inflation.rate, 1)}`}
              defaultOpen
              storageKey="assume:returns"
              data-tour="returns"
            >
              <div className="form-grid">
                <div className="span-2">
                  <SelectField
                    label="Expected returns"
                    value={A.returns.mode}
                    options={[
                      { value: 'fixed', label: 'The figures I set below' },
                      { value: 'historicalAverage', label: 'Long-run historical averages' },
                    ]}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.returns.mode = v;
                      })
                    }
                    data-tour="return-mode"
                  />
                </div>
              </div>
              <Lead>
                Compound rates per year, before inflation is taken out.
                {historical ? ' History sets US stocks, US bonds, cash and inflation while this is on.' : ''}
              </Lead>
              <div className="pib-dials">
                {ASSET_CLASSES.map((k) => (
                  <Dial
                    key={k}
                    value={A.returns.fixed[k]}
                    min={-0.02}
                    max={0.12}
                    step={0.0025}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.returns.fixed[k] = v;
                      })
                    }
                  >
                    <PercentField
                      label={`${CLASS_LABELS[k]} return`}
                      hint={historical && HISTORY_SETS.has(k) ? 'Not used: history sets this.' : undefined}
                      value={A.returns.fixed[k]}
                      onChange={(v) =>
                        update((d) => {
                          d.assumptions.returns.fixed[k] = v;
                        })
                      }
                    />
                  </Dial>
                ))}
                <Dial
                  value={A.inflation.rate}
                  min={0}
                  max={0.08}
                  step={0.0025}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.inflation.rate = v;
                    })
                  }
                >
                  <PercentField
                    label="Inflation"
                    hint={historical ? 'Not used: history sets this.' : undefined}
                    value={A.inflation.rate}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.inflation.rate = v;
                      })
                    }
                    data-tour="inflation"
                  />
                </Dial>
                <Dial
                  value={A.healthcareInflation.excessOverCpi}
                  min={0}
                  max={0.05}
                  step={0.0025}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.healthcareInflation.excessOverCpi = v;
                    })
                  }
                >
                  <PercentField
                    label="Extra healthcare inflation"
                    help={`On top of general inflation. ${helpText('Healthcare inflation above general inflation')}`}
                    value={A.healthcareInflation.excessOverCpi}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.healthcareInflation.excessOverCpi = v;
                      })
                    }
                  />
                </Dial>
                <Dial
                  value={A.inflation.educationExcess}
                  min={0}
                  max={0.05}
                  step={0.0025}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.inflation.educationExcess = v;
                    })
                  }
                >
                  <PercentField
                    label="Extra education inflation"
                    help={`On top of general inflation. ${helpText('Education inflation above general inflation')}`}
                    value={A.inflation.educationExcess}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.inflation.educationExcess = v;
                      })
                    }
                  />
                </Dial>
                <Dial
                  value={A.dividendYield}
                  min={0}
                  max={0.06}
                  step={0.0025}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.dividendYield = Math.max(0, v);
                    })
                  }
                >
                  <PercentField
                    label="Dividend yield on stocks"
                    value={A.dividendYield}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.dividendYield = Math.max(0, v);
                      })
                    }
                  />
                </Dial>
                <Dial
                  value={A.bondYield}
                  min={0}
                  max={0.08}
                  step={0.0025}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.bondYield = Math.max(0, v);
                    })
                  }
                >
                  <PercentField
                    label="Bond interest yield"
                    value={A.bondYield}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.bondYield = Math.max(0, v);
                      })
                    }
                  />
                </Dial>
              </div>
            </Fold>
            <Fold
              title="Volatility for simulations"
              icon="assumptions"
              summary={
                custom
                  ? `${custom} of ${ASSET_CLASSES.length} set by you; the rest measured from market history`
                  : 'Measured from market history'
              }
              storageKey="assume:volatility"
              data-tour="volatility"
            >
              <Lead>
                Optional. Leave a class at 0 to use the value measured from market history.
                {mc.method === 'bootstrap'
                  ? ' Replayed history brings its own ups and downs for US stocks, US bonds and cash.'
                  : ''}
              </Lead>
              <div className="form-grid">
                {ASSET_CLASSES.map((k) => (
                  <PercentField
                    key={k}
                    label={`${CLASS_LABELS[k]} volatility`}
                    value={A.returns.stdDev?.[k] ?? 0}
                    hint={mc.method === 'bootstrap' && HISTORY_SETS.has(k) ? 'Not used with replayed history.' : undefined}
                    onChange={(v) =>
                      update((d) => {
                        const s = { ...(d.assumptions.returns.stdDev ?? {}) };
                        if (v > 0) s[k] = v;
                        else delete s[k];
                        d.assumptions.returns.stdDev = Object.keys(s).length ? s : undefined;
                      })
                    }
                  />
                ))}
              </div>
            </Fold>
          </>
        }
        right={
          <>
            <Fold
              title="Plan settings"
              icon="settings"
              summary={`${plan.name} · from ${plan.settings.startYear} · ${plan.settings.display === 'real' ? "today's dollars" : 'future dollars'}`}
              defaultOpen
              storageKey="assume:settings"
              data-tour="plan-settings"
            >
              <div className="form-grid">
                <div className="span-2">
                  <TextField
                    label="Plan name"
                    value={plan.name}
                    onChange={(v) =>
                      update((d) => {
                        d.name = v;
                      })
                    }
                    data-tour="plan-name"
                  />
                </div>
                <NumberField
                  label="First year of the plan"
                  value={plan.settings.startYear}
                  min={2020}
                  max={2100}
                  onChange={(v) =>
                    update((d) => {
                      d.settings.startYear = v;
                    })
                  }
                />
                <div className="span-2">
                  <Choice
                    label="Show money in"
                    help={helpText('Show money in')}
                    value={plan.settings.display}
                    options={[
                      { value: 'real', label: "Today's dollars" },
                      { value: 'nominal', label: 'Future dollars' },
                    ]}
                    onChange={(v) =>
                      update((d) => {
                        d.settings.display = v;
                      })
                    }
                    data-tour="display-dollars"
                  />
                </div>
                <div className="span-2">
                  <SelectField
                    label="Cash flows happen"
                    value={plan.settings.timing}
                    options={[
                      { value: 'mid', label: 'Through the year (mid-year)' },
                      { value: 'start', label: 'At the start of the year' },
                      { value: 'end', label: 'At the end of the year' },
                    ]}
                    onChange={(v) =>
                      update((d) => {
                        d.settings.timing = v;
                      })
                    }
                  />
                </div>
              </div>
            </Fold>
            <Fold
              title="Simulations"
              icon="success"
              kind="milestone"
              summary={[
                `${mc.runs.toLocaleString('en-US')} runs`,
                mc.method === 'bootstrap' ? `replayed history in ${mc.blockLength}-year blocks` : 'random draws',
                varies ? 'lifespans vary' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              storageKey="assume:simulations"
              data-tour="mc-settings"
            >
              <div className="form-grid">
                <div className="span-2">
                  <SelectField
                    label="Method"
                    value={mc.method}
                    options={[
                      { value: 'bootstrap', label: 'Replay blocks of real history' },
                      { value: 'parametric', label: 'Random draws around my assumptions' },
                    ]}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.monteCarlo.method = v;
                      })
                    }
                    data-tour="mc-method"
                  />
                </div>
                <NumberField
                  label="Number of runs"
                  value={mc.runs}
                  min={100}
                  max={10000}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.monteCarlo.runs = Math.max(100, Math.min(10000, v));
                    })
                  }
                  data-tour="mc-runs"
                />
                <NumberField
                  label="Seed"
                  value={mc.seed}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.monteCarlo.seed = v;
                    })
                  }
                  data-tour="mc-seed"
                />
                {mc.method === 'bootstrap' ? (
                  <div className="span-2">
                    <SelectField
                      label="Averages in replayed history"
                      help={helpText('Average returns in replayed history')}
                      value={mc.bootstrapMeans}
                      options={[
                        { value: 'assumptions', label: 'Shifted to my expected returns' },
                        { value: 'historical', label: 'As they happened' },
                      ]}
                      onChange={(v) =>
                        update((d) => {
                          d.assumptions.monteCarlo.bootstrapMeans = v;
                        })
                      }
                      data-tour="mc-bootstrap-means"
                    />
                  </div>
                ) : null}
                <Choice
                  label="Inflation in simulations"
                  help={helpText('Inflation in simulations')}
                  value={mc.inflation}
                  options={[
                    { value: 'sampled', label: 'Varies' },
                    { value: 'fixed', label: 'Fixed' },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.monteCarlo.inflation = v;
                    })
                  }
                />
              </div>
              <div className="pib-dials" style={{ marginTop: 10 }}>
                {mc.method === 'bootstrap' ? (
                  <Dial
                    value={mc.blockLength}
                    min={1}
                    max={30}
                    step={1}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.monteCarlo.blockLength = v;
                      })
                    }
                  >
                    <NumberField
                      label="Block length (years)"
                      value={mc.blockLength}
                      min={1}
                      max={30}
                      onChange={(v) =>
                        update((d) => {
                          d.assumptions.monteCarlo.blockLength = v;
                        })
                      }
                    />
                  </Dial>
                ) : null}
                {varies ? (
                  <Dial
                    value={A.mortalityImprovement}
                    min={0}
                    max={0.03}
                    step={0.001}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.mortalityImprovement = v;
                      })
                    }
                  >
                    <PercentField
                      label="Death-rate improvement"
                      help={helpText('Yearly improvement in death rates')}
                      hint="Per year."
                      digits={1}
                      value={A.mortalityImprovement}
                      onChange={(v) =>
                        update((d) => {
                          d.assumptions.mortalityImprovement = Math.max(0, Math.min(0.03, v));
                        })
                      }
                    />
                  </Dial>
                ) : null}
              </div>
              <div className="pib-switches" style={{ marginTop: 6 }}>
                <LifespanSwitch plan={plan} />
                <Switch
                  label="Vary healthcare inflation"
                  help={helpText('Let healthcare inflation vary in simulations')}
                  checked={A.healthcareInflation.stochastic}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.healthcareInflation.stochastic = v;
                    })
                  }
                />
              </div>
            </Fold>
            <Fold
              title="Glide paths"
              icon="projection"
              summary={
                plan.glidePaths.length
                  ? plan.glidePaths.map((g) => `${g.name} (${g.points.length} points)`).join(' · ')
                  : 'None: each account keeps its own mix'
              }
              storageKey="assume:glide"
              data-tour="glide-paths"
            >
              <Lead>
                A glide path shifts an account's investment mix as its owner ages. Create one here, then choose it
                on an account.
              </Lead>
              {plan.glidePaths.map((g, gi) => (
                <div key={g.id} className="pib-glide">
                  <div className="pib-line">
                    <div className="pib-grow">
                      <TextField
                        label="Name"
                        value={g.name}
                        onChange={(v) =>
                          update((d) => {
                            d.glidePaths[gi].name = v;
                          })
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      icon="plus"
                      onClick={() =>
                        update((d) => {
                          const last = d.glidePaths[gi].points.at(-1)!;
                          d.glidePaths[gi].points.push({ age: last.age + 10, allocation: { ...last.allocation } });
                        })
                      }
                    >
                      Add a point
                    </Button>
                    <Button
                      variant="ghost"
                      icon="trash"
                      label={`Remove ${g.name}`}
                      onClick={() =>
                        update((d) => {
                          const id = d.glidePaths[gi].id;
                          d.glidePaths.splice(gi, 1);
                          d.accounts.forEach((a) => {
                            if (a.glidePathId === id) a.glidePathId = undefined;
                          });
                        })
                      }
                    />
                  </div>
                  {g.points.map((pt, pi) => (
                    <div key={pi} className="pib-glide-point">
                      <div className="pib-line">
                        <div className="pib-narrow">
                          <NumberField
                            label="At age"
                            value={pt.age}
                            min={18}
                            max={110}
                            onChange={(v) =>
                              update((d) => {
                                d.glidePaths[gi].points[pi].age = v;
                              })
                            }
                          />
                        </div>
                        {g.points.length > 1 ? (
                          <Button
                            variant="ghost"
                            icon="trash"
                            label="Remove this point"
                            onClick={() =>
                              update((d) => {
                                d.glidePaths[gi].points.splice(pi, 1);
                              })
                            }
                          />
                        ) : null}
                      </div>
                      <AllocationEditor
                        value={pt.allocation}
                        onChange={(v) =>
                          update((d) => {
                            d.glidePaths[gi].points[pi].allocation = v;
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    update((d) => {
                      d.glidePaths.push({
                        id: newId('g'),
                        name: 'Glide path',
                        points: [
                          {
                            age: 40,
                            allocation: { usStocks: 0.8, usBonds: 0.2, cash: 0, intlStocks: 0, reits: 0 },
                          },
                          {
                            age: 70,
                            allocation: { usStocks: 0.5, usBonds: 0.45, cash: 0.05, intlStocks: 0, reits: 0 },
                          },
                        ],
                      });
                    })
                  }
                >
                  Add a glide path
                </Button>
              </div>
            </Fold>
            <Fold
              title="Social Security outlook"
              icon="shield"
              kind="expense"
              summary={`${
                A.socialSecurityCut.enabled
                  ? `${formatPct(A.socialSecurityCut.payablePct)} of benefits paid from ${A.socialSecurityCut.fromYear}`
                  : 'Benefits paid in full'
              } · wages grow ${formatPct(A.realWageGrowth, 1)} above inflation`}
              storageKey="assume:ss"
              data-tour="ss-cut"
            >
              <Switch
                label="Plan for a benefit cut"
                help={helpText('Assume benefits are cut if the trust fund runs short')}
                checked={A.socialSecurityCut.enabled}
                onChange={(v) =>
                  update((d) => {
                    d.assumptions.socialSecurityCut.enabled = v;
                  })
                }
              />
              <div className="pib-dials" style={{ marginTop: 4 }}>
                {A.socialSecurityCut.enabled ? (
                  <>
                    <Dial
                      value={A.socialSecurityCut.fromYear}
                      min={2026}
                      max={2060}
                      step={1}
                      onChange={(v) =>
                        update((d) => {
                          d.assumptions.socialSecurityCut.fromYear = v;
                        })
                      }
                    >
                      <NumberField
                        label="From year"
                        help="The first year benefits are cut. The 2026 Trustees Report projects the trust funds running short in 2034."
                        value={A.socialSecurityCut.fromYear}
                        min={2026}
                        max={2100}
                        onChange={(v) =>
                          update((d) => {
                            d.assumptions.socialSecurityCut.fromYear = v;
                          })
                        }
                      />
                    </Dial>
                    <Dial
                      value={A.socialSecurityCut.payablePct}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) =>
                        update((d) => {
                          d.assumptions.socialSecurityCut.payablePct = v;
                        })
                      }
                    >
                      <PercentField
                        label="Share of benefits still paid"
                        digits={0}
                        value={A.socialSecurityCut.payablePct}
                        onChange={(v) =>
                          update((d) => {
                            d.assumptions.socialSecurityCut.payablePct = Math.max(0, Math.min(1, v));
                          })
                        }
                      />
                    </Dial>
                  </>
                ) : null}
                <Dial
                  value={A.realWageGrowth}
                  min={-0.01}
                  max={0.03}
                  step={0.0025}
                  onChange={(v) =>
                    update((d) => {
                      d.assumptions.realWageGrowth = v;
                    })
                  }
                >
                  <PercentField
                    label="Wage growth above inflation"
                    value={A.realWageGrowth}
                    onChange={(v) =>
                      update((d) => {
                        d.assumptions.realWageGrowth = v;
                      })
                    }
                  />
                </Dial>
              </div>
            </Fold>
          </>
        }
      />
    </>
  );
}
