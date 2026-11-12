/** Shared plan-editing fields and labels. */
import type { Allocation, Plan, YearRef } from '@fisim/engine';
import { ASSET_CLASSES } from '@fisim/engine';
import { Button, Dialog, HelpTip, NumberField, PercentField, SelectField, formatPct } from '@fisim/ui';
import type { ReactNode } from 'react';
import { helpText } from './help';

export const ACCOUNT_LABELS: Record<string, string> = {
  taxable: 'Taxable brokerage',
  cash: 'Cash / high-yield savings',
  trad401k: 'Traditional 401(k)',
  trad403b: 'Traditional 403(b)',
  gov457b: '457(b)',
  tradIra: 'Traditional IRA',
  sepIra: 'SEP IRA',
  simpleIra: 'SIMPLE IRA',
  solo401k: 'Solo 401(k)',
  roth401k: 'Roth 401(k)',
  rothIra: 'Roth IRA',
  hsa: 'HSA',
  plan529: '529 plan',
  inheritedIra: 'Inherited IRA',
  iBond: 'I-bonds',
  tBill: 'T-bills',
  annuity: 'Annuity',
};
export const CLASS_LABELS: Record<string, string> = {
  usStocks: 'US stocks',
  usBonds: 'US bonds',
  cash: 'Cash',
  intlStocks: 'International stocks',
  reits: 'REITs',
};
export const STATUS_LABELS: Record<string, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
  qss: 'Qualifying surviving spouse',
};
export const STATES =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  );

export function ownerOptions(plan: Plan, joint = true): { value: string; label: string }[] {
  const o = plan.people.map((p) => ({ value: p.id, label: p.name }));
  if (joint && plan.people.length > 1) o.push({ value: 'joint', label: 'Joint' });
  return o;
}

export function describeWhen(plan: Plan, ref: YearRef | undefined, fallback = 'Now'): string {
  if (!ref) return fallback;
  if (ref.type === 'year') return String(ref.year);
  if (ref.type === 'age')
    return `${plan.people.find((p) => p.id === ref.personId)?.name ?? 'Age'} at ${ref.age}`;
  const m = plan.milestones.find((x) => x.id === ref.milestoneId);
  return `${m?.name ?? 'Milestone'}${ref.offset ? ` ${ref.offset > 0 ? '+' : ''}${ref.offset}y` : ''}`;
}

/** Editor for a point in time: a year, someone's age, or a milestone. */
export function WhenField({
  plan,
  label,
  value,
  onChange,
  optional,
  emptyLabel = 'Not set',
  help = helpText('@when'),
}: {
  plan: Plan;
  label: string;
  help?: ReactNode;
  value: YearRef | undefined;
  onChange: (v: YearRef | undefined) => void;
  optional?: boolean;
  emptyLabel?: string;
}): ReactNode {
  const type = value?.type ?? 'none';
  const opts = [
    ...(optional ? [{ value: 'none', label: emptyLabel }] : []),
    { value: 'year', label: 'In a year' },
    { value: 'age', label: 'At an age' },
    ...(plan.milestones.length ? [{ value: 'milestone', label: 'At a milestone' }] : []),
  ];
  return (
    <div className="lv-row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SelectField
          label={label}
          help={help}
          value={type}
          options={opts}
          onChange={(t) => {
            if (t === 'none') onChange(undefined);
            else if (t === 'year') onChange({ type: 'year', year: plan.settings.startYear + 5 });
            else if (t === 'age') onChange({ type: 'age', personId: plan.people[0].id, age: 65 });
            else onChange({ type: 'milestone', milestoneId: plan.milestones[0].id, offset: 0 });
          }}
        />
      </div>
      {value?.type === 'year' ? (
        <div style={{ width: 96 }}>
          <NumberField
            label="Year"
            value={value.year}
            min={1950}
            max={2150}
            onChange={(year) => onChange({ type: 'year', year })}
          />
        </div>
      ) : null}
      {value?.type === 'age' ? (
        <>
          {plan.people.length > 1 ? (
            <div style={{ width: 120 }}>
              <SelectField
                label="Who"
                value={value.personId}
                options={ownerOptions(plan, false)}
                onChange={(personId) => onChange({ ...value, personId })}
              />
            </div>
          ) : null}
          <div style={{ width: 80 }}>
            <NumberField
              label="Age"
              value={value.age}
              min={0}
              max={120}
              onChange={(age) => onChange({ ...value, age })}
            />
          </div>
        </>
      ) : null}
      {value?.type === 'milestone' ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <SelectField
            label="Milestone"
            value={value.milestoneId}
            options={plan.milestones.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(milestoneId) => onChange({ ...value, milestoneId })}
          />
        </div>
      ) : null}
    </div>
  );
}

export function GrowthField({
  label,
  value,
  onChange,
  hint,
  help,
}: {
  label: string;
  value: { rate: number; basis: 'real' | 'nominal' };
  onChange: (v: { rate: number; basis: 'real' | 'nominal' }) => void;
  hint?: string;
  help?: ReactNode;
}): ReactNode {
  return (
    <div className="lv-row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
      <div style={{ flex: 1 }}>
        <PercentField
          label={label}
          hint={hint}
          help={help}
          value={value.rate}
          onChange={(rate) => onChange({ ...value, rate })}
        />
      </div>
      <div style={{ flex: 1 }}>
        <SelectField
          label="Measured"
          help={helpText('@growthBasis')}
          value={value.basis}
          options={[
            { value: 'real', label: 'Above inflation' },
            { value: 'nominal', label: 'In plain dollars' },
          ]}
          onChange={(basis) => onChange({ ...value, basis })}
        />
      </div>
    </div>
  );
}

export function AllocationEditor({
  value,
  onChange,
}: {
  value: Allocation;
  onChange: (a: Allocation) => void;
}): ReactNode {
  const sum = ASSET_CLASSES.reduce((s, k) => s + (value[k] ?? 0), 0);
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }} data-tour="allocation">
      <legend className="lv-label" style={{ marginBottom: 8 }}>
        Investment mix <HelpTip>{helpText('@allocation')}</HelpTip>{' '}
        <span className={Math.abs(sum - 1) > 0.005 ? '' : 'lv-muted'} style={{ fontWeight: 400 }}>
          (adds up to {formatPct(sum)}
          {Math.abs(sum - 1) > 0.005 ? '; it will be scaled to 100%' : ''})
        </span>
      </legend>
      <div className="form-grid">
        {ASSET_CLASSES.map((k) => (
          <PercentField
            key={k}
            label={CLASS_LABELS[k]}
            digits={1}
            value={value[k] ?? 0}
            onChange={(v) => onChange({ ...value, [k]: Math.max(0, Math.min(1, v)) })}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Standard add/edit dialog footer. */
export function EditDialog({
  open,
  title,
  onClose,
  onDelete,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onDelete?: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Remove
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose} data-tour="dialog-done">
            Done
          </Button>
        </>
      }
    >
      <div className="lv-stack">{children}</div>
    </Dialog>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="lv-stack" style={{ alignItems: 'flex-start', padding: '12px 0' }}>
      <strong>{title}</strong>
      {children ? <p className="lv-muted">{children}</p> : null}
      {action}
    </div>
  );
}
