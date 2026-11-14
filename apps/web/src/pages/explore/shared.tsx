import { toReal, type ProjectionResult, type YearRecord } from '@fisim/engine';
import { Badge, Button, Icon, Notice, Skeleton } from '@fisim/ui';
import { type ReactNode } from 'react';
import { useProjection } from '../../engine/useResults';
import { usePlan } from '../../state/store';

/**
 * Display helper: today's dollars or future dollars, as the plan is set. Year-end balances (net worth,
 * account values) are deflated by the year-end price level; money that moves during the year (income,
 * spending, tax) by the price level of that year.
 */
export function useMoney(): {
  real: boolean;
  bal: (r: YearRecord, x: number) => number;
  flow: (r: YearRecord, x: number) => number;
  unit: string;
} {
  const plan = usePlan();
  const real = (plan?.settings.display ?? 'real') === 'real';
  return {
    real,
    bal: (r, x) => (real ? toReal(x, r, 'balance') : x),
    flow: (r, x) => (real ? toReal(x, r, 'flow') : x),
    unit: real ? "today's dollars" : 'future dollars',
  };
}

export function Loading({ error }: { error: string | null }): ReactNode {
  const { retry } = useProjection();
  return error ? (
    <div className="lv-card lv-state" role="alert">
      <span className="lv-state-mark" data-tone="danger" aria-hidden="true">
        <Icon name="warning" size={22} />
      </span>
      <h2>The projection could not be worked out</h2>
      <p>{error}</p>
      <div className="lv-row">
        <Button variant="primary" onClick={retry}>
          Retry calculation
        </Button>
      </div>
    </div>
  ) : (
    <div className="lv-placeholder" role="status" aria-live="polite">
      <span className="lv-sr">Working out the projection…</span>
      <span className="lv-placeholder-band" aria-hidden="true" />
      <Skeleton height={360} />
    </div>
  );
}

/** A failed recompute while an earlier result is still on screen: say so instead of showing stale numbers silently. */
export function RecomputeError({ error }: { error: string | null }): ReactNode {
  return error ? (
    <Notice tone="danger">
      Your latest change could not be worked out ({error}). The figures below are from before that change.
    </Notice>
  ) : null;
}

/** Engine notes about a projection, folded into one row that opens on demand. */
export function Warnings({ warnings }: { warnings: string[] }): ReactNode {
  if (!warnings.length) return null;
  return (
    <details className="warn-chips" data-tour="projection-warnings">
      <summary>
        <Badge tone="warn">
          {warnings.length === 1 ? '1 note' : `${warnings.length} notes`} about these figures
        </Badge>
        <span className="lv-small lv-muted lv-ellipsis">{warnings[0]}</span>
      </summary>
      <ul>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

export function ProjectedBadge({ result }: { result: ProjectionResult }): ReactNode {
  const first = result.records.find((r) => r.dataStatus === 'projected');
  return (
    <span className="lv-row" data-tour="estimate-badges">
      <Badge>Estimated</Badge>
      {first ? <Badge tone="warn">Tax and health tables projected from {first.year}</Badge> : null}
      <Badge>{result.dataRelease}</Badge>
    </span>
  );
}

export function YearPicker({
  records,
  year,
  onChange,
}: {
  records: YearRecord[];
  year: number;
  onChange: (y: number) => void;
}): ReactNode {
  const r = records.find((x) => x.year === year) ?? records[0];
  const first = records[0].year;
  const last = records[records.length - 1].year;
  const text = `${r.year} · age ${r.ages.join(' and ')}`;
  return (
    <div className="year-scrub" data-tour="year-picker">
      <Button
        size="sm"
        variant="ghost"
        aria-label="Previous year"
        title="Previous year"
        disabled={r.year === first}
        onClick={() => onChange(r.year - 1)}
      >
        ←
      </Button>
      <span className="year-scrub-now" aria-live="polite">
        {text}
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Next year"
        title="Next year"
        disabled={r.year === last}
        onClick={() => onChange(r.year + 1)}
      >
        →
      </Button>
      <input
        type="range"
        className="lv-range"
        aria-label="Year"
        min={first}
        max={last}
        step={1}
        value={r.year}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${last > first ? ((r.year - first) / (last - first)) * 100 : 0}%` }}
      />
      <span className="year-scrub-end" aria-hidden="true">
        {first}–{last}
      </span>
    </div>
  );
}
