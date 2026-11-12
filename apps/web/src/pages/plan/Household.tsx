import type { Person } from '@fisim/engine';
import { Button, Card, MoneyField, NumberField, SelectField, TextField, formatMoney } from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { EditDialog, STATES, STATUS_LABELS } from '../../lib/fields';
import { LifespanSwitch, lifespansVary, survivalNote } from '../../lib/lifespan';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useUpdate } from '../../state/store';

export function HouseholdPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const [editing, setEditing] = useState<string | null>(null);
  const [earningsFor, setEarningsFor] = useState<string | null>(null);
  const person = plan.people.find((p) => p.id === editing);
  const idx = plan.people.findIndex((p) => p.id === editing);
  const set = (fn: (p: Person) => void): void => update((d) => fn(d.people[idx]));
  const status = plan.household.filingStatus.length ? plan.household.filingStatus : [{ fromYear: plan.settings.startYear, status: plan.people.length > 1 ? ('mfj' as const) : ('single' as const) }];
  const ePerson = plan.people.find((p) => p.id === earningsFor);
  const eIdx = plan.people.findIndex((p) => p.id === earningsFor);

  return (
    <>
      <PageHead group="plan" title="Household" intro="Who the plan covers, where you live, how you file, and how long the plan should run." />
      <Card
        title="People" data-tour="people"
        actions={plan.people.length < 2 ? (
          <Button icon="plus" data-tour="add-person" onClick={() => update((d) => {
            const y = d.settings.startYear;
            d.people.push({ id: newId('p'), name: 'Partner', birthDate: `${y - 35}-06-15`, longevity: { mode: 'fixed', age: 95 }, residence: structuredClone(d.people[0].residence), socialSecurity: { mode: 'earnings', earnings: [], piaMonthly: 0, claimAge: { years: 67, months: 0 } } });
            if (!d.household.filingStatus.length) d.household.filingStatus = [{ fromYear: y, status: 'mfj' }];
          })}>Add a partner</Button>
        ) : null}
      >
        <ul className="lv-list">
          {plan.people.map((p, pi) => (
            <li key={p.id} className="person-row">
              <div className="lv-grow">
                <strong>{p.name}</strong>
                <div className="lv-muted lv-small">Born {p.birthDate.slice(0, 4)} · {p.residence[p.residence.length - 1]?.state ?? 'no state set'}{lifespansVary(plan) ? ' · lifespan varies in simulations' : ''}</div>
              </div>
              <div className="person-age" data-tour={pi === 0 ? 'plan-until-age' : undefined}>
                <NumberField label="Plan until age" hint={survivalNote(+p.birthDate.slice(0, 4), p.sex, p.longevity.age, plan.settings.startYear) ?? undefined} value={p.longevity.age} min={50} max={115} onChange={(v) => update((d) => { d.people[pi].longevity.age = v; })} />
              </div>
              <Button size="sm" icon="edit" onClick={() => setEditing(p.id)} data-tour="edit-person">Edit</Button>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}><LifespanSwitch plan={plan} /></div>
      </Card>

      <Card title="Filing status over time" data-tour="filing-status" actions={<Button size="sm" icon="plus" onClick={() => update((d) => { d.household.filingStatus = [...status, { fromYear: (status[status.length - 1]?.fromYear ?? d.settings.startYear) + 5, status: 'single' }]; })}>Add a change</Button>}>
        <p className="lv-muted lv-small" style={{ marginBottom: 12 }}>After a spouse dies the plan switches by itself: joint in that year, then qualifying surviving spouse for two years if there are dependents, then single.</p>
        <div className="lv-stack">
          {status.map((f, i) => (
            <div className="lv-row" key={i} style={{ alignItems: 'flex-end' }}>
              <div style={{ width: 110 }}><NumberField label="From year" value={f.fromYear} min={1990} max={2150} onChange={(v) => update((d) => { d.household.filingStatus = status.map((x, j) => (j === i ? { ...x, fromYear: v } : x)); })} /></div>
              <div style={{ flex: 1, minWidth: 200 }}><SelectField label="Status" value={f.status} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value: value as typeof f.status, label }))} onChange={(v) => update((d) => { d.household.filingStatus = status.map((x, j) => (j === i ? { ...x, status: v } : x)); })} /></div>
              {status.length > 1 ? <Button variant="ghost" icon="trash" label="Remove this change" onClick={() => update((d) => { d.household.filingStatus = status.filter((_, j) => j !== i); })} /> : null}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Children and dependents" data-tour="dependents" actions={<Button size="sm" icon="plus" onClick={() => update((d) => { d.household.dependents.push({ name: 'Child', birthYear: d.settings.startYear - 5 }); })}>Add</Button>}>
        {plan.household.dependents.length === 0 ? <p className="lv-muted">None. Dependents affect the child tax credit, household size for health subsidies, and filing status after a death.</p> : null}
        <div className="lv-stack">
          {plan.household.dependents.map((dep, i) => (
            <div className="lv-row" key={i} style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 140 }}><TextField label="Name" value={dep.name} onChange={(v) => update((d) => { d.household.dependents[i].name = v; })} /></div>
              <div style={{ width: 110 }}><NumberField label="Born" value={dep.birthYear} min={1980} max={2150} onChange={(v) => update((d) => { d.household.dependents[i].birthYear = v; })} /></div>
              <Button variant="ghost" icon="trash" label={`Remove ${dep.name}`} onClick={() => update((d) => { d.household.dependents.splice(i, 1); })} />
            </div>
          ))}
        </div>
      </Card>

      <EditDialog open={!!person} title={person ? `Edit ${person.name}` : ''} onClose={() => setEditing(null)} onDelete={idx === 1 ? () => update((d) => { const id = d.people[1].id; d.people.splice(1, 1); d.accounts.forEach((a) => { if (a.ownerId === id || a.ownerId === 'joint') a.ownerId = d.people[0].id; }); d.incomes = d.incomes.filter((i) => i.ownerId !== id); d.healthcare.people = d.healthcare.people.filter((h) => h.personId !== id); }) : undefined}>
        {person ? (
          <>
            <div className="form-grid">
              <TextField label="Name" value={person.name} onChange={(v) => set((p) => { p.name = v; })} />
              <TextField label="Date of birth" type="date" value={person.birthDate} onChange={(v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) set((p) => { p.birthDate = v; }); }} />
              <SelectField label="Sex (for life tables)" value={person.sex ?? 'unset'} options={[{ value: 'unset', label: 'Prefer not to say' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} onChange={(v) => set((p) => { p.sex = v === 'unset' ? undefined : (v as 'male' | 'female'); })} />
              <NumberField label="Plan until age" hint={survivalNote(+person.birthDate.slice(0, 4), person.sex, person.longevity.age, plan.settings.startYear) ?? undefined} value={person.longevity.age} min={50} max={115} onChange={(v) => set((p) => { p.longevity.age = v; })} />
            </div>
            <LifespanSwitch plan={plan} />
            <h3>Where they live</h3>
            {person.residence.map((r, i) => (
              <div className="lv-row" key={i} style={{ alignItems: 'flex-end' }}>
                <div style={{ width: 110 }}><NumberField label="From year" value={r.fromYear} min={1950} max={2150} onChange={(v) => set((p) => { p.residence[i].fromYear = v; })} /></div>
                <div style={{ width: 110 }}><SelectField label="State" value={r.state} options={STATES.map((s) => ({ value: s, label: s }))} onChange={(v) => set((p) => { p.residence[i].state = v; p.residence[i].countyFips = undefined; })} /></div>
                <div style={{ flex: 1, minWidth: 130 }}><TextField label="County FIPS (optional)" hint="5 digits; sharpens marketplace premiums." value={r.countyFips ?? ''} onChange={(v) => set((p) => { p.residence[i].countyFips = /^\d{5}$/.test(v) ? v : v === '' ? undefined : p.residence[i].countyFips; })} /></div>
                {person.residence.length > 1 ? <Button variant="ghost" icon="trash" label="Remove this residence" onClick={() => set((p) => { p.residence.splice(i, 1); })} /> : null}
              </div>
            ))}
            <div><Button size="sm" icon="plus" onClick={() => set((p) => { p.residence.push({ state: p.residence[p.residence.length - 1]?.state ?? 'TX', fromYear: (p.residence[p.residence.length - 1]?.fromYear ?? plan.settings.startYear) + 10 }); })}>Add a move</Button></div>
            <h3>Social Security</h3>
            <div className="form-grid" data-tour="ss-settings">
              <SelectField label="Benefit comes from" value={person.socialSecurity.mode} options={[{ value: 'earnings', label: 'My earnings record' }, { value: 'pia', label: 'A benefit estimate I enter' }, { value: 'none', label: 'No Social Security' }]} onChange={(v) => set((p) => { p.socialSecurity.mode = v; })} />
              {person.socialSecurity.mode === 'pia' ? <MoneyField label="Monthly benefit at full retirement age" hint="In today's dollars, from your SSA statement." cents={person.socialSecurity.piaMonthly} onChange={(v) => set((p) => { p.socialSecurity.piaMonthly = v; })} /> : null}
              <NumberField label="Claim at age" value={person.socialSecurity.claimAge.years} min={62} max={70} onChange={(v) => set((p) => { p.socialSecurity.claimAge.years = v; if (v === 70) p.socialSecurity.claimAge.months = 0; })} />
              <NumberField label="…plus months" value={person.socialSecurity.claimAge.months} min={0} max={11} onChange={(v) => set((p) => { p.socialSecurity.claimAge.months = p.socialSecurity.claimAge.years === 70 ? 0 : v; })} />
            </div>
            {person.socialSecurity.mode === 'earnings' ? (
              <div className="lv-row">
                <Button size="sm" onClick={() => { setEarningsFor(person.id); setEditing(null); }}>Edit earnings record ({person.socialSecurity.earnings.length} years)</Button>
                {person.socialSecurity.earnings.length === 0 ? <span className="lv-muted lv-small">Empty: the benefit is estimated from current wages.</span> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </EditDialog>

      <EditDialog open={!!ePerson} title={ePerson ? `${ePerson.name}: Social Security earnings` : ''} onClose={() => setEarningsFor(null)}>
        {ePerson ? (
          <>
            <p className="lv-muted lv-small">Copy the taxed Social Security earnings from your statement at ssa.gov. Future years come from the income you enter in the plan.</p>
            <div className="lv-row">
              <Button size="sm" icon="plus" onClick={() => update((d) => {
                const e = d.people[eIdx].socialSecurity.earnings;
                const last = e.length ? Math.max(...e.map((x) => x.year)) : +ePerson.birthDate.slice(0, 4) + 21;
                if (last + 1 < d.settings.startYear) e.push({ year: last + 1, amount: e.length ? e[e.length - 1].amount : 3000000 });
              })}>Add a year</Button>
              <span className="lv-muted lv-small">Total entered: {formatMoney(ePerson.socialSecurity.earnings.reduce((s, x) => s + x.amount, 0) / 100)}</span>
            </div>
            {[...ePerson.socialSecurity.earnings].sort((a, b) => b.year - a.year).map((e) => {
              const i = ePerson.socialSecurity.earnings.findIndex((x) => x.year === e.year);
              return (
                <div className="lv-row" key={e.year} style={{ alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}><MoneyField label={`${e.year}`} cents={e.amount} onChange={(v) => update((d) => { d.people[eIdx].socialSecurity.earnings[i].amount = Math.max(0, v); })} /></div>
                  <Button variant="ghost" icon="trash" label={`Remove ${e.year}`} onClick={() => update((d) => { d.people[eIdx].socialSecurity.earnings.splice(i, 1); })} />
                </div>
              );
            })}
          </>
        ) : null}
      </EditDialog>
    </>
  );
}
