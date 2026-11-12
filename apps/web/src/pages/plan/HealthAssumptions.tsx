import { ASSET_CLASSES, type Coverage } from '@fisim/engine';
import { Badge, Button, Card, MoneyField, NumberField, PercentField, SelectField, Switch, TextField, formatMoney } from '@fisim/ui';
import type { ReactNode } from 'react';
import { useProjection } from '../../engine/useResults';
import { AllocationEditor, CLASS_LABELS, WhenField } from '../../lib/fields';
import { LifespanSwitch } from '../../lib/lifespan';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useUpdate } from '../../state/store';

const COVERAGE: { value: Coverage['type']; label: string }[] = [
  { value: 'employer', label: 'My employer plan' }, { value: 'spouseEmployer', label: "Partner's employer plan" }, { value: 'cobra', label: 'COBRA' },
  { value: 'aca', label: 'Marketplace (ACA) plan' }, { value: 'medicaid', label: 'Medicaid' }, { value: 'medicare', label: 'Medicare' }, { value: 'none', label: 'No coverage' },
];
const COVER_LABEL: Record<string, string> = { employer: 'Employer', spouseEmployer: "Partner's plan", cobra: 'COBRA', aca: 'Marketplace', medicaid: 'Medicaid', medicare: 'Medicare', none: 'None' };

export function HealthcarePage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const { result } = useProjection();
  const hc = plan.healthcare;
  const ensure = (pid: string): number => {
    let i = hc.people.findIndex((h) => h.personId === pid);
    if (i < 0) {
      update((d) => { d.healthcare.people.push({ personId: pid, coverage: [], utilization: 'typical', tobacco: false, medicare: { partAPremiumFree: true, supplement: 'medigapG', dentalVisionHearing: true, irmaaAppeal: false }, ltc: { mode: 'none', careType: 'assistedLiving', onsetAge: 85, years: 3 } }); });
      i = hc.people.length;
    }
    return i;
  };
  const recs = result?.records ?? [];
  const bridge = recs.filter((r) => r.coverage.some((c) => c === 'aca' || c === 'cobra'));
  const bridgeCost = bridge.reduce((s, r) => s + (r.expenses.healthcare.total - r.taxes.ptc) / r.cpi, 0);
  const lifetime = recs.reduce((s, r) => s + (r.expenses.healthcare.total - r.taxes.ptc) / r.cpi, 0);

  return (
    <>
      <PageHead group="plan" title="Healthcare" intro="Coverage from now to the end of the plan: employer, COBRA, the marketplace or Medicaid, then Medicare at 65. Your taxable income drives both marketplace subsidies and Medicare surcharges, so this screen and the tax engine work together." />
      <Card>
        <Switch label="Model healthcare costs" checked={hc.enabled} onChange={(v) => update((d) => { d.healthcare.enabled = v; })} />
        {hc.enabled ? (
          <div className="lv-grid" style={{ marginTop: 16 }} data-tour="health-summary">
            <div className="lv-stat"><span className="lv-stat-label">Bridge to Medicare</span><span className="lv-stat-value">{formatMoney(bridgeCost)}</span><span className="lv-stat-note">{bridge.length} years on COBRA or the marketplace, after credits, in today's dollars</span></div>
            <div className="lv-stat"><span className="lv-stat-label">Lifetime healthcare</span><span className="lv-stat-value">{formatMoney(lifetime)}</span><span className="lv-stat-note">Premiums and out-of-pocket, today's dollars</span></div>
          </div>
        ) : null}
      </Card>
      {hc.enabled ? (
        <>
          {plan.people.map((p) => {
            const i = hc.people.findIndex((h) => h.personId === p.id);
            const h = hc.people[i];
            const timeline = recs.reduce<{ from: number; type: string }[]>((acc, r) => { const t = r.coverage[plan.people.indexOf(p)]; if (t && t !== 'none' && acc.at(-1)?.type !== t) acc.push({ from: r.year, type: t }); return acc; }, []);
            return (
              <Card key={p.id} title={`${p.name}'s coverage`} data-tour="coverage" actions={<Button size="sm" icon="plus" data-tour="add-coverage" onClick={() => { const k = ensure(p.id); update((d) => { d.healthcare.people[k].coverage.push({ type: 'aca', from: { type: 'year', year: d.settings.startYear }, hdhp: false, metal: 'silver', cobraMonths: 18 }); }); }}>Add a coverage period</Button>}>
                <div className="lv-row" style={{ marginBottom: 12 }} data-tour="coverage-timeline" aria-label="Coverage in this projection">
                  {timeline.map((t, k) => <Badge key={k} tone={t.type === 'aca' || t.type === 'cobra' ? 'warn' : t.type === 'medicare' ? 'ok' : undefined}>{t.from}: {COVER_LABEL[t.type]}</Badge>)}
                </div>
                {!h || h.coverage.length === 0 ? <p className="lv-muted lv-small">No periods entered, so the plan assumes an employer plan while there are wages, the marketplace after that, and Medicare at 65.</p> : null}
                <div className="lv-stack">
                  {h?.coverage.map((cv, k) => (
                    <div key={k} className="lv-stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                      <div className="form-grid">
                        <SelectField label="Coverage" value={cv.type} options={COVERAGE} onChange={(v) => update((d) => { d.healthcare.people[i].coverage[k].type = v; })} />
                        {cv.type === 'aca' ? <SelectField label="Metal tier" value={cv.metal} options={['catastrophic', 'bronze', 'silver', 'gold', 'platinum'].map((m) => ({ value: m as Coverage['metal'], label: m[0].toUpperCase() + m.slice(1) }))} onChange={(v) => update((d) => { d.healthcare.people[i].coverage[k].metal = v; })} /> : null}
                        {cv.type === 'cobra' ? <NumberField label="Months of COBRA" hint="18 is standard; 29 or 36 in some cases." value={cv.cobraMonths} min={1} max={36} onChange={(v) => update((d) => { d.healthcare.people[i].coverage[k].cobraMonths = v; })} /> : null}
                        {cv.type === 'employer' || cv.type === 'spouseEmployer' || cv.type === 'cobra' ? <MoneyField label={cv.type === 'cobra' ? 'Full yearly premium (before the 2% fee)' : 'Your share of the yearly premium'} hint="Leave at 0 to use a national average." cents={cv.premiumAnnual ?? 0} onChange={(v) => update((d) => { d.healthcare.people[i].coverage[k].premiumAnnual = v > 0 ? v : undefined; })} /> : null}
                      </div>
                      <WhenField plan={plan} label="From" value={cv.from} onChange={(v) => update((d) => { if (v) d.healthcare.people[i].coverage[k].from = v; })} />
                      <div className="lv-spread">
                        {cv.type === 'employer' || cv.type === 'spouseEmployer' || cv.type === 'cobra' || cv.type === 'aca' ? <Switch label={cv.type === 'aca' ? 'HSA-eligible plan (bronze and catastrophic plans qualify by default)' : 'High-deductible plan (HSA-eligible)'} checked={cv.hdhp} onChange={(v) => update((d) => { d.healthcare.people[i].coverage[k].hdhp = v; })} /> : <span />}
                        <Button size="sm" variant="ghost" icon="trash" onClick={() => update((d) => { d.healthcare.people[i].coverage.splice(k, 1); })}>Remove</Button>
                      </div>
                    </div>
                  ))}
                </div>
                {h ? (
                  <>
                    <h3 style={{ marginTop: 20 }}>Use and Medicare choices</h3>
                    <div className="form-grid" style={{ marginTop: 8 }} data-tour="medicare-choices">
                      <SelectField label="How much care you use" value={h.utilization} options={[{ value: 'low', label: 'Little' }, { value: 'typical', label: 'Typical' }, { value: 'high', label: 'A lot' }]} onChange={(v) => update((d) => { d.healthcare.people[i].utilization = v; })} />
                      <SelectField label="At 65" value={h.medicare.supplement} options={[{ value: 'medigapG', label: 'Original Medicare + Medigap Plan G + Part D' }, { value: 'medigapN', label: 'Original Medicare + Medigap Plan N + Part D' }, { value: 'advantage', label: 'Medicare Advantage' }, { value: 'none', label: 'Original Medicare + Part D only' }]} onChange={(v) => update((d) => { d.healthcare.people[i].medicare.supplement = v; })} data-tour="medicare-supplement" />
                      <SelectField label="Long-term care" value={h.ltc.mode} options={[{ value: 'none', label: 'Not modelled' }, { value: 'expected', label: 'Assume it happens' }, { value: 'stochastic', label: 'By chance, in simulations' }]} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.mode = v; })} />
                      {h.ltc.mode !== 'none' ? <SelectField label="Kind of care" value={h.ltc.careType} options={[{ value: 'homeCare', label: 'Care at home' }, { value: 'assistedLiving', label: 'Assisted living' }, { value: 'nursingHomeSemiPrivate', label: 'Nursing home, shared room' }, { value: 'nursingHomePrivate', label: 'Nursing home, private room' }]} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.careType = v; })} /> : null}
                      {h.ltc.mode === 'expected' ? <NumberField label="Starting at age" value={h.ltc.onsetAge} min={50} max={110} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.onsetAge = v; })} /> : null}
                      {h.ltc.mode === 'expected' ? <NumberField label="For how many years" value={h.ltc.years} min={0} max={20} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.years = v; })} /> : null}
                    </div>
                    <div className="lv-stack" style={{ marginTop: 12 }}>
                      <Switch label="Uses tobacco (raises marketplace premiums in most states)" checked={h.tobacco} onChange={(v) => update((d) => { d.healthcare.people[i].tobacco = v; })} />
                      <Switch label="Part A is premium-free (40 quarters of work)" checked={h.medicare.partAPremiumFree} onChange={(v) => update((d) => { d.healthcare.people[i].medicare.partAPremiumFree = v; })} />
                      <Switch label="Include dental, vision and hearing costs on Medicare" checked={h.medicare.dentalVisionHearing} onChange={(v) => update((d) => { d.healthcare.people[i].medicare.dentalVisionHearing = v; })} />
                      {h.ltc.mode !== 'none' ? <Switch label="Has long-term care insurance" checked={!!h.ltc.insurance} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.insurance = v ? { premiumAnnual: 300000, annualBenefit: 6000000, benefitYears: 3 } : undefined; })} /> : null}
                      {h.ltc.insurance ? (
                        <div className="form-grid">
                          <MoneyField label="Premium per year" cents={h.ltc.insurance.premiumAnnual} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.insurance!.premiumAnnual = Math.max(0, v); })} />
                          <MoneyField label="Benefit per year of care" cents={h.ltc.insurance.annualBenefit} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.insurance!.annualBenefit = Math.max(0, v); })} />
                          <NumberField label="Benefit years" value={h.ltc.insurance.benefitYears} min={1} max={20} onChange={(v) => update((d) => { d.healthcare.people[i].ltc.insurance!.benefitYears = v; })} />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : <div style={{ marginTop: 12 }}><Button size="sm" onClick={() => ensure(p.id)}>Set Medicare and care choices</Button></div>}
              </Card>
            );
          })}
          <Card title="Marketplace benchmark premium" data-tour="slcsp">
            <p className="lv-muted lv-small" style={{ marginBottom: 12 }}>Subsidies are measured against the second-lowest-cost silver plan where you live. County figures come from HealthCare.gov data. States that run their own exchange use a statewide estimate, so enter your own figure from your state's site for a precise result.</p>
            <div style={{ maxWidth: 360 }}>
              <MoneyField label="Monthly benchmark for a 21-year-old (0 = use the dataset)" cents={hc.slcspOverrideAge21Monthly ?? 0} onChange={(v) => update((d) => { d.healthcare.slcspOverrideAge21Monthly = v > 0 ? v : undefined; })} />
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}

export function AssumptionsPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const A = plan.assumptions;
  const mc = A.monteCarlo;
  return (
    <>
      <PageHead group="plan" title="Assumptions" intro="The outlook the projection uses. The single-path projection uses the expected returns below; simulations vary them." />
      <Card title="Plan settings" data-tour="plan-settings">
        <div className="form-grid">
          <TextField label="Plan name" value={plan.name} onChange={(v) => update((d) => { d.name = v; })} data-tour="plan-name" />
          <NumberField label="First year of the plan" value={plan.settings.startYear} min={2020} max={2100} onChange={(v) => update((d) => { d.settings.startYear = v; })} />
          <SelectField label="Show money in" value={plan.settings.display} options={[{ value: 'real', label: "Today's dollars" }, { value: 'nominal', label: 'Future dollars' }]} onChange={(v) => update((d) => { d.settings.display = v; })} data-tour="display-dollars" />
          <SelectField label="Cash flows happen" hint="Affects how much of a year's return applies to money moved that year." value={plan.settings.timing} options={[{ value: 'mid', label: 'Through the year (mid-year)' }, { value: 'start', label: 'At the start of the year' }, { value: 'end', label: 'At the end of the year' }]} onChange={(v) => update((d) => { d.settings.timing = v; })} />
        </div>
      </Card>
      <Card title="Returns and inflation" data-tour="returns">
        <div className="form-grid">
          <SelectField label="Expected returns" value={A.returns.mode} options={[{ value: 'fixed', label: 'The figures I set below' }, { value: 'historicalAverage', label: 'Long-run historical averages' }]} onChange={(v) => update((d) => { d.assumptions.returns.mode = v; })} data-tour="return-mode" />
          {ASSET_CLASSES.map((k) => <PercentField key={k} label={`${CLASS_LABELS[k]} return`} hint="Per year, before inflation is taken out." value={A.returns.fixed[k]} onChange={(v) => update((d) => { d.assumptions.returns.fixed[k] = v; })} />)}
          <PercentField label="Inflation" value={A.inflation.rate} onChange={(v) => update((d) => { d.assumptions.inflation.rate = v; })} data-tour="inflation" />
          <PercentField label="Healthcare inflation above general inflation" value={A.healthcareInflation.excessOverCpi} onChange={(v) => update((d) => { d.assumptions.healthcareInflation.excessOverCpi = v; })} />
          <PercentField label="Education inflation above general inflation" value={A.inflation.educationExcess} onChange={(v) => update((d) => { d.assumptions.inflation.educationExcess = v; })} />
          <PercentField label="Dividend yield on stocks" value={A.dividendYield} onChange={(v) => update((d) => { d.assumptions.dividendYield = Math.max(0, v); })} />
          <PercentField label="Bond interest yield" value={A.bondYield} onChange={(v) => update((d) => { d.assumptions.bondYield = Math.max(0, v); })} />
        </div>
        <h3 style={{ marginTop: 20 }}>Volatility for the parametric model (optional)</h3>
        <p className="lv-muted lv-small">Leave blank to use the values measured from market history.</p>
        <div className="form-grid" style={{ marginTop: 8 }} data-tour="volatility">
          {ASSET_CLASSES.map((k) => <PercentField key={k} label={`${CLASS_LABELS[k]} volatility`} value={A.returns.stdDev?.[k] ?? 0} hint="0 = use history" onChange={(v) => update((d) => { const s = { ...(d.assumptions.returns.stdDev ?? {}) }; if (v > 0) s[k] = v; else delete s[k]; d.assumptions.returns.stdDev = Object.keys(s).length ? s : undefined; })} />)}
        </div>
      </Card>
      <Card title="Simulations" data-tour="mc-settings">
        <div className="form-grid">
          <SelectField label="Method" value={mc.method} options={[{ value: 'bootstrap', label: 'Replay blocks of real history' }, { value: 'parametric', label: 'Random draws around my assumptions' }]} onChange={(v) => update((d) => { d.assumptions.monteCarlo.method = v; })} data-tour="mc-method" />
          <NumberField label="Number of runs" value={mc.runs} min={100} max={10000} onChange={(v) => update((d) => { d.assumptions.monteCarlo.runs = Math.max(10, v); })} data-tour="mc-runs" />
          <NumberField label="Seed" hint="The same seed always gives the same result." value={mc.seed} onChange={(v) => update((d) => { d.assumptions.monteCarlo.seed = v; })} data-tour="mc-seed" />
          {mc.method === 'bootstrap' ? <SelectField label="Average returns in replayed history" value={mc.bootstrapMeans} options={[{ value: 'assumptions', label: 'Shifted to my expected returns' }, { value: 'historical', label: 'As they happened' }]} onChange={(v) => update((d) => { d.assumptions.monteCarlo.bootstrapMeans = v; })} data-tour="mc-bootstrap-means" /> : null}
          {mc.method === 'bootstrap' ? <NumberField label="Block length (years)" value={mc.blockLength} min={1} max={30} onChange={(v) => update((d) => { d.assumptions.monteCarlo.blockLength = v; })} /> : null}
          <SelectField label="Inflation in simulations" value={mc.inflation} options={[{ value: 'sampled', label: 'Varies, as in history' }, { value: 'fixed', label: 'Fixed at my rate' }]} onChange={(v) => update((d) => { d.assumptions.monteCarlo.inflation = v; })} />
        </div>
        <div className="lv-stack" style={{ marginTop: 12 }}>
          <LifespanSwitch plan={plan} />
          {mc.stochasticLongevity || plan.people.some((p) => p.longevity.mode === 'stochastic') ? <div style={{ maxWidth: 320 }}><PercentField label="Yearly improvement in death rates" digits={1} value={A.mortalityImprovement} onChange={(v) => update((d) => { d.assumptions.mortalityImprovement = Math.max(0, Math.min(0.03, v)); })} /></div> : null}
          <Switch label="Let healthcare inflation vary in simulations" checked={A.healthcareInflation.stochastic} onChange={(v) => update((d) => { d.assumptions.healthcareInflation.stochastic = v; })} />
        </div>
      </Card>
      <Card title="Glide paths" data-tour="glide-paths" actions={<Button size="sm" icon="plus" onClick={() => update((d) => { d.glidePaths.push({ id: newId('g'), name: 'Glide path', points: [{ age: 40, allocation: { usStocks: 0.8, usBonds: 0.2, cash: 0, intlStocks: 0, reits: 0 } }, { age: 70, allocation: { usStocks: 0.5, usBonds: 0.45, cash: 0.05, intlStocks: 0, reits: 0 } }] }); })}>Add a glide path</Button>}>
        {plan.glidePaths.length === 0 ? <p className="lv-muted">A glide path shifts an account's investment mix as its owner ages. Create one here, then choose it on an account.</p> : null}
        {plan.glidePaths.map((g, gi) => (
          <div key={g.id} className="lv-stack" style={{ borderTop: gi ? '1px solid var(--line)' : undefined, paddingTop: gi ? 16 : 0, marginTop: gi ? 16 : 0 }}>
            <div className="lv-row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><TextField label="Name" value={g.name} onChange={(v) => update((d) => { d.glidePaths[gi].name = v; })} /></div>
              <Button size="sm" icon="plus" onClick={() => update((d) => { const last = d.glidePaths[gi].points.at(-1)!; d.glidePaths[gi].points.push({ age: last.age + 10, allocation: { ...last.allocation } }); })}>Add a point</Button>
              <Button variant="ghost" icon="trash" label={`Remove ${g.name}`} onClick={() => update((d) => { const id = d.glidePaths[gi].id; d.glidePaths.splice(gi, 1); d.accounts.forEach((a) => { if (a.glidePathId === id) a.glidePathId = undefined; }); })} />
            </div>
            {g.points.map((pt, pi) => (
              <div key={pi} className="lv-stack" style={{ paddingLeft: 12, borderLeft: '3px solid var(--line)' }}>
                <div className="lv-row" style={{ alignItems: 'flex-end' }}>
                  <div style={{ width: 110 }}><NumberField label="At age" value={pt.age} min={18} max={110} onChange={(v) => update((d) => { d.glidePaths[gi].points[pi].age = v; })} /></div>
                  {g.points.length > 1 ? <Button variant="ghost" icon="trash" label="Remove this point" onClick={() => update((d) => { d.glidePaths[gi].points.splice(pi, 1); })} /> : null}
                </div>
                <AllocationEditor value={pt.allocation} onChange={(v) => update((d) => { d.glidePaths[gi].points[pi].allocation = v; })} />
              </div>
            ))}
          </div>
        ))}
      </Card>
      <Card title="Social Security outlook" data-tour="ss-cut">
        <Switch label="Assume benefits are cut if the trust fund runs short" checked={A.socialSecurityCut.enabled} onChange={(v) => update((d) => { d.assumptions.socialSecurityCut.enabled = v; })} />
        {A.socialSecurityCut.enabled ? (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <NumberField label="From year" help="The first year benefits are cut. The 2026 Trustees Report projects the trust funds running short in 2034." value={A.socialSecurityCut.fromYear} min={2026} max={2100} onChange={(v) => update((d) => { d.assumptions.socialSecurityCut.fromYear = v; })} />
            <PercentField label="Share of benefits still paid" digits={0} value={A.socialSecurityCut.payablePct} onChange={(v) => update((d) => { d.assumptions.socialSecurityCut.payablePct = Math.max(0, Math.min(1, v)); })} />
          </div>
        ) : null}
        <div style={{ marginTop: 12, maxWidth: 320 }}><PercentField label="Wage growth above inflation" hint="Used to project future Social Security benefit formulas." value={A.realWageGrowth} onChange={(v) => update((d) => { d.assumptions.realWageGrowth = v; })} /></div>
      </Card>
    </>
  );
}
